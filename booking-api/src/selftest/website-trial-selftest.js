// Sandbox self-test for the stage 7 exit item "the Website & App Care trial is active", run by the worker's 5-minute schedule.
// The other website self-tests start from a synthetic paid order, so nothing else buys the Website Package through
// real Stripe. This one does, in Stripe test mode, through the real routes and webhooks:
//   Website Package checkout -> pay with a test card ($499, nothing charged for Care) -> Website & App Care subscription
//   TRIALING with an active entitlement, and the website project created with its intake started
//   -> cancel the test subscription in Stripe -> the cancel syncs back.
// Start one by inserting a self_tests row with kind WEBSITE_TRIAL_RUN and status REQUESTED. Only a failure emails the
// owner. Everything it creates is cancelled at the end (and on failure).
// Stage 11 part 2: kind STORE_APP_TRIAL_RUN does the same for the Store App: Store App Setup checkout ($999, nothing
// charged for the app tier) -> Website & App Care (app tier) TRIALING 90 days with an active STORE_APP_CARE entitlement,
// the Store App project created and its intake started -> cancel -> synced.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { payTestCheckout, stripeTest, updateTest } from "./menu-qr-selftest.js";

const KIND = "WEBSITE_TRIAL_RUN";
// What each kind buys and expects. Same steps, same safety guards.
const RUNS = {
  WEBSITE_TRIAL_RUN: { item: "WEBSITE_PACKAGE", plan: "WEBSITE_CARE", cents: 49900, workflow: "WEBSITE_PACKAGE_V1", entitlement: "WEBSITE_CARE", product: "Website Package", care: "Website & App Care", business: "Trial Self-Test Cafe" },
  STORE_APP_TRIAL_RUN: { item: "STORE_APP_SETUP", plan: "STORE_APP_CARE", cents: 99900, workflow: "STORE_APP_SETUP_V1", entitlement: "STORE_APP_CARE", product: "Store App", care: "Website & App Care (app tier)", business: "Store Trial Self-Test Cafe" }
};
const runOf = (test) => RUNS[test.kind] || RUNS[KIND];
const STAGE_TIMEOUT_MINUTES = 20;
const TRIAL_DAYS = 90;

const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function stageStart(env, app, test) {
  if (!env.STRIPE_SECRET_KEY_TEST) throw new Error("STRIPE_SECRET_KEY_TEST is not configured");
  // The test checkout only accepts a self-test customer on a Stripe test clock (a safety guard in the checkout route).
  // Deleting the clock at the end also deletes the customer and its subscription in Stripe.
  const run = runOf(test);
  const clock = await stripeTest(env, "/v1/test_helpers/test_clocks", "POST", { frozen_time: String(Math.floor(Date.now() / 1000)), name: `menu-made ${run.item.toLowerCase()} trial ${String(test.id).slice(0, 12)}` });
  test = await updateTest(env, test, { status: "RUNNING", stage: "START", state: { clock_id: clock.id }, log: `Test clock ${clock.id} created` });
  const customer = await stripeTest(env, "/v1/customers", "POST", { email: SELF_TEST_EMAIL, name: "Menu-Made Self-Test", test_clock: clock.id, "metadata[self_test]": "1" });
  test = await updateTest(env, test, { state: { customer_id: customer.id }, log: `Test customer ${customer.id} created on the clock` });
  const checkout = await json(await app(new Request(`${publicBaseUrl(env)}/api/create-checkout-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://menu-made.com" },
    body: JSON.stringify({
      items: [{ key: run.item }],
      interval: "month",
      stripe_test_customer: customer.id,
      customer: { name: "Menu-Made Self-Test", business: run.business, email: SELF_TEST_EMAIL, phone: "", notes: `Automated ${run.product} trial self-test` }
    })
  })));
  if (!checkout.body?.ok || checkout.body.mode !== "subscription" || checkout.body.plan !== run.plan) {
    throw new Error(`${run.product} checkout failed (HTTP ${checkout.status}): ${JSON.stringify(checkout.body).slice(0, 300)}`);
  }
  const order = await env.DB.prepare(`SELECT stripe_checkout_session_id, total_cents FROM orders WHERE id = ?`).bind(checkout.body.order_id).first();
  if (order?.total_cents !== run.cents) throw new Error(`Expected a $${run.cents / 100} order with ${run.care} free during the trial, got ${order?.total_cents}`);
  const paid = await payTestCheckout(env, order.stripe_checkout_session_id);
  if (Number(paid.amount) !== run.cents) throw new Error(`Stripe charged ${paid.amount} today, expected ${run.cents} (Care must be free during the trial)`);
  return updateTest(env, test, { stage: "AWAIT_TRIAL", order_id: checkout.body.order_id,
    log: `${run.product} checkout ${checkout.body.order_id} paid with test card (${paid.amount}, Care not charged)` });
}

async function stageAwaitTrial(env, app, test) {
  const run = runOf(test);
  const sub = await env.DB.prepare(`SELECT * FROM subscriptions WHERE provider_customer_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(state(test).customer_id || "").first();
  const project = await env.DB.prepare(`SELECT id, status FROM projects WHERE order_id = ? AND workflow_key = ? LIMIT 1`).bind(test.order_id, run.workflow).first();
  if (!sub || !project) return null;
  if (sub.status !== "TRIALING") throw new Error(`${run.care} subscription is ${sub.status}, expected TRIALING`);
  const trialEnd = sub.trial_ends_at || sub.current_period_end;
  const days = (Date.parse(trialEnd) - Date.now()) / 86400000;
  if (!(days > TRIAL_DAYS - 2 && days < TRIAL_DAYS + 2)) throw new Error(`The trial ends ${trialEnd}, not about ${TRIAL_DAYS} days from now`);
  const care = await env.DB.prepare(`SELECT status FROM entitlements WHERE subscription_id = ? AND entitlement_type = ?`).bind(sub.id, run.entitlement).first();
  if (care?.status !== "ACTIVE") throw new Error(`${run.care} entitlement is ${care?.status || "missing"}, expected ACTIVE`);
  const intake = await env.DB.prepare(`SELECT status FROM communications WHERE project_id = ? ORDER BY created_at LIMIT 1`).bind(project.id).first();
  if (!intake) return null; // the intake email is sent on the same webhook; give it a tick
  await stripeTest(env, `/v1/subscriptions/${sub.provider_subscription_id}`, "DELETE");
  return updateTest(env, test, { stage: "AWAIT_CANCELLED", project_id: project.id, state: { subscription_id: sub.id },
    log: `${run.care} TRIALING until ${String(trialEnd).slice(0, 10)} (${Math.round(days)} days) with an active entitlement; ${run.product} project created and intake email ${intake.status}; test subscription cancelled in Stripe` });
}

async function stageAwaitCancelled(env, app, test) {
  const sub = await env.DB.prepare(`SELECT status FROM subscriptions WHERE id = ?`).bind(state(test).subscription_id).first();
  if (sub?.status !== "CANCELLED") return null;
  await cleanUp(env, test);
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: `Cancel synced from Stripe; test ${runOf(test).product} project and order cancelled` });
}

// The website job would otherwise wait for intake forever, and a live trial would roll into a paid test subscription.
async function cleanUp(env, test) {
  const t = nowIso();
  if (test.order_id) {
    await env.DB.prepare(`UPDATE projects SET status = 'CANCELLED', updated_at = ? WHERE order_id = ? AND status NOT IN ('DELIVERED', 'COMPLETED')`).bind(t, test.order_id).run();
    await env.DB.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND status NOT IN ('DELIVERED', 'COMPLETED')`).bind(t, test.order_id).run();
  }
  // Deleting the test clock removes its customer and any subscription still on it.
  const clockId = state(test).clock_id;
  if (clockId) await stripeTest(env, `/v1/test_helpers/test_clocks/${clockId}`, "DELETE").catch(() => null);
}

const STAGES = { START: stageStart, AWAIT_TRIAL: stageAwaitTrial, AWAIT_CANCELLED: stageAwaitCancelled };

async function failTest(env, test, message) {
  test = (await env.DB.prepare(`SELECT * FROM self_tests WHERE id = ?`).bind(test.id).first()) || test;
  const failed = await updateTest(env, test, { status: "FAILED", error: message.slice(0, 1000), log: `FAILED: ${message}` });
  await cleanUp(env, failed).catch(() => null);
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `${runOf(test).product} trial self-test failed`,
    html: brandedEmailHtml({ preheader: `The automated test of the ${runOf(test).product} checkout failed.`, eyebrow: "SELF-TEST", heading: `The ${runOf(test).product} trial self-test failed`,
      paragraphs: [`A test-mode ${runOf(test).product} purchase did not start ${runOf(test).care.replace("&", "&amp;")}'s free trial as expected. Real purchases may hit the same problem.`],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The ${runOf(test).product} trial self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceWebsiteTrialSelfTests(env, app) {
  if (!env.DB) return [];
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind IN ('WEBSITE_TRIAL_RUN', 'STORE_APP_TRIAL_RUN') AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at LIMIT 2`).all()).results || [];
  const results = [];
  for (let test of tests) {
    for (let guard = 0; guard < 4; guard++) {
      const stage = test.status === "REQUESTED" ? "START" : test.stage;
      const handler = STAGES[stage];
      if (!handler) break;
      try {
        const next = await handler(env, app, test);
        if (!next) {
          if (Date.now() - Date.parse(test.stage_started_at || test.created_at) > STAGE_TIMEOUT_MINUTES * 60000) {
            test = await failTest(env, test, `Timed out after ${STAGE_TIMEOUT_MINUTES} minutes waiting at ${stage}`);
          }
          break;
        }
        test = next;
        if (test.status !== "RUNNING") break;
      } catch (error) {
        test = await failTest(env, test, error instanceof Error ? error.message : String(error));
        break;
      }
    }
    results.push({ id: test.id, status: test.status, stage: test.stage });
  }
  return results;
}

export { advanceWebsiteTrialSelfTests };
