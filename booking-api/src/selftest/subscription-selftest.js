// Sandbox self-test for the subscription engine (stage 3 exit), run by the worker's 5-minute schedule.
// Stripe test mode with a test clock, through the real routes and real webhooks:
//   Growth bundle checkout (monthly) -> pay with test card -> subscription ACTIVE, 4 entitlements, 4 first-month jobs
//   -> advance the clock a month -> renewal invoice.paid creates exactly 4 more jobs
//   -> cancel -> entitlements expire -> advance another month -> no new jobs.
// Start one by inserting a self_tests row with kind SUBSCRIPTION_GROWTH and status REQUESTED.
// Also runs daily. Only a failure emails the owner. Test jobs are cancelled and the test clock deleted at the end.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { payTestCheckout, stripeTest, updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "SUBSCRIPTION_GROWTH";
const PLAN = "BUNDLE_GROWTH";
const EXPECTED_PLANS = ["ACCESSIBILITY_MONITORING", "GOOGLE_PROFILE_CARE", "MENU_CARE", "REVIEW_REPLIES"];
const STAGE_TIMEOUT_MINUTES = 25;
const QUIET_MINUTES = 3;
const DAILY_HOUR_UTC = 15;

const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function loadActiveTests(env) {
  return (await env.DB.prepare(`
      SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2
    `).bind(KIND).all()).results || [];
}

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 30) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`)
    .bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`)
    .bind(crypto.randomUUID(), KIND, t, t).run();
}

async function subscriptionFor(env, test) {
  return env.DB.prepare(`
      SELECT s.* FROM subscriptions s JOIN entitlements e ON e.subscription_id = s.id
      WHERE s.provider_customer_id = ? GROUP BY s.id ORDER BY s.created_at DESC LIMIT 1
    `).bind(state(test).customer_id || "").first();
}

async function periodJobs(env, subscriptionId) {
  return (await env.DB.prepare(`
      SELECT p.id, json_extract(p.metadata_json, '$.plan_code') AS plan, json_extract(p.metadata_json, '$.period_start') AS period_start,
             r.status AS run_status, r.trigger_type
      FROM projects p JOIN workflow_runs r ON r.project_id = p.id
      WHERE json_extract(p.metadata_json, '$.subscription_id') = ?
      ORDER BY period_start, plan
    `).bind(subscriptionId).all()).results || [];
}

function checkPeriod(jobs, periodStart, label) {
  const plans = jobs.filter((j) => j.period_start === periodStart).map((j) => j.plan).sort();
  if (JSON.stringify(plans) !== JSON.stringify(EXPECTED_PLANS)) {
    throw new Error(`${label}: expected one job each for ${EXPECTED_PLANS.join(", ")}, found [${plans.join(", ")}]`);
  }
  if (jobs.some((j) => j.trigger_type !== "SUBSCRIPTION_PERIOD" || j.run_status !== "QUEUED")) {
    throw new Error(`${label}: every period job should be a QUEUED SUBSCRIPTION_PERIOD run`);
  }
}

async function clockReady(env, clockId) {
  const clock = await stripeTest(env, `/v1/test_helpers/test_clocks/${clockId}`);
  if (clock.status === "internal_failure") throw new Error(`Stripe test clock ${clockId} failed to advance`);
  return clock.status === "ready" ? clock : null;
}

async function advanceClock(env, clockId, toSeconds) {
  await stripeTest(env, `/v1/test_helpers/test_clocks/${clockId}/advance`, "POST", { frozen_time: String(toSeconds) });
}

// The test-mode webhook endpoint must send the subscription events; add any that are missing (never removes any).
const REQUIRED_EVENTS = ["checkout.session.completed", "invoice.paid", "invoice.payment_failed",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];

async function ensureTestWebhookEvents(env) {
  const list = await stripeTest(env, "/v1/webhook_endpoints?limit=100");
  const endpoint = (list.data || []).find((e) => /\/api\/stripe-webhook$/.test(e.url) && e.status === "enabled");
  if (!endpoint) throw new Error("No enabled test-mode webhook endpoint for /api/stripe-webhook");
  const current = endpoint.enabled_events || [];
  if (current.includes("*")) return [];
  const missing = REQUIRED_EVENTS.filter((e) => !current.includes(e));
  if (missing.length) {
    const params = new URLSearchParams();
    for (const e of [...current, ...missing]) params.append("enabled_events[]", e);
    await stripeTest(env, `/v1/webhook_endpoints/${endpoint.id}`, "POST", params);
  }
  return missing;
}

// ---------- Stages ----------

async function stageStart(env, app, test) {
  if (!env.STRIPE_SECRET_KEY_TEST) throw new Error("STRIPE_SECRET_KEY_TEST is not configured");
  const added = await ensureTestWebhookEvents(env);
  if (added.length) test = await updateTest(env, test, { log: `Test-mode webhook endpoint now also sends ${added.join(", ")}` });
  const frozen = Math.floor(Date.now() / 1000);
  const clock = await stripeTest(env, "/v1/test_helpers/test_clocks", "POST", { frozen_time: String(frozen), name: `menu-made self-test ${test.id.slice(0, 8)}` });
  const customer = await stripeTest(env, "/v1/customers", "POST", {
    email: SELF_TEST_EMAIL, name: "Menu-Made Self-Test", test_clock: clock.id, "metadata[self_test]": "1"
  });
  test = await updateTest(env, test, { status: "RUNNING", stage: "START", state: { clock_id: clock.id, customer_id: customer.id },
    log: `Test clock ${clock.id} and customer ${customer.id} created` });
  const checkout = await json(await app(new Request(`${publicBaseUrl(env)}/api/create-checkout-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://menu-made.com" },
    body: JSON.stringify({
      items: [{ key: PLAN }],
      interval: "month",
      stripe_test_customer: customer.id,
      customer: { name: "Menu-Made Self-Test", business: "Self-Test Bistro", email: SELF_TEST_EMAIL, phone: "", notes: "Automated subscription self-test" }
    })
  })));
  if (!checkout.body?.ok || checkout.body.mode !== "subscription") {
    throw new Error(`Subscription checkout failed (HTTP ${checkout.status}): ${JSON.stringify(checkout.body).slice(0, 300)}`);
  }
  const order = await env.DB.prepare(`SELECT stripe_checkout_session_id, total_cents FROM orders WHERE id = ?`).bind(checkout.body.order_id).first();
  if (order?.total_cents !== 17900) throw new Error(`Expected a $179 Growth order, got ${order?.total_cents}`);
  const paid = await payTestCheckout(env, order.stripe_checkout_session_id);
  return updateTest(env, test, { stage: "AWAIT_ACTIVE", order_id: checkout.body.order_id,
    state: { session_id: order.stripe_checkout_session_id },
    log: `Growth bundle checkout ${checkout.body.order_id} paid with test card (${paid.amount})` });
}

async function stageAwaitActive(env, app, test) {
  const sub = await subscriptionFor(env, test);
  if (!sub || sub.status !== "ACTIVE") return null;
  const entitlements = (await env.DB.prepare(`SELECT entitlement_type, status FROM entitlements WHERE subscription_id = ? ORDER BY entitlement_type`)
    .bind(sub.id).all()).results || [];
  if (JSON.stringify(entitlements.map((e) => `${e.entitlement_type}:${e.status}`)) !== JSON.stringify(EXPECTED_PLANS.map((p) => `${p}:ACTIVE`))) {
    throw new Error(`Expected 4 active entitlements, found ${entitlements.map((e) => `${e.entitlement_type}=${e.status}`).join(", ")}`);
  }
  const jobs = await periodJobs(env, sub.id);
  if (jobs.length < 4) return null;
  if (jobs.length !== 4) throw new Error(`First period should have 4 jobs, found ${jobs.length}`);
  checkPeriod(jobs, jobs[0].period_start, "First month");
  const welcome = await env.DB.prepare(`SELECT status FROM communications WHERE template_key = 'subscription_welcome_v1' AND customer_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(sub.customer_id).first();
  if (welcome?.status !== "SENT") throw new Error(`Welcome email with the billing-portal link was not sent (${welcome?.status || "none"})`);
  // Fast-forward past the end of the first month: Stripe bills the renewal and sends invoice.paid.
  const target = Math.floor(Date.parse(sub.current_period_end) / 1000) + 3 * 3600; // renewal invoices finalize about an hour after they're created
  await advanceClock(env, state(test).clock_id, target);
  return updateTest(env, test, { stage: "AWAIT_RENEWAL", state: { subscription_id: sub.id, stripe_subscription_id: sub.provider_subscription_id, first_period: jobs[0].period_start, renew_to: target },
    log: `Subscription ACTIVE with 4 entitlements and 4 first-month jobs; welcome email sent; clock advancing to ${new Date(target * 1000).toISOString()}` });
}

async function stageAwaitRenewal(env, app, test) {
  const s = state(test);
  if (!(await clockReady(env, s.clock_id))) return null;
  const jobs = await periodJobs(env, s.subscription_id);
  if (jobs.length < 8) return null;
  if (jobs.length !== 8) throw new Error(`After one renewal there should be 8 jobs, found ${jobs.length}`);
  const second = jobs.find((j) => j.period_start !== s.first_period)?.period_start;
  checkPeriod(jobs, second, "Renewal month");
  const sub = await env.DB.prepare(`SELECT status, current_period_start FROM subscriptions WHERE id = ?`).bind(s.subscription_id).first();
  if (sub?.status !== "ACTIVE" || sub.current_period_start !== second) throw new Error(`Subscription did not roll to the new period (${sub?.status}, ${sub?.current_period_start})`);
  await stripeTest(env, `/v1/subscriptions/${s.stripe_subscription_id}`, "DELETE");
  return updateTest(env, test, { stage: "AWAIT_CANCELLED", state: { second_period: second },
    log: `Renewal created exactly 4 jobs for ${second.slice(0, 10)}; subscription cancelled in Stripe` });
}

async function stageAwaitCancelled(env, app, test) {
  const s = state(test);
  const sub = await env.DB.prepare(`SELECT status FROM subscriptions WHERE id = ?`).bind(s.subscription_id).first();
  if (sub?.status !== "CANCELLED") return null;
  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM entitlements WHERE subscription_id = ? AND status != 'EXPIRED'`).bind(s.subscription_id).first();
  if (Number(open?.n) !== 0) throw new Error(`${open.n} entitlements still open after cancel`);
  const target = Math.floor(Date.parse(s.second_period) / 1000) + 40 * 86400;
  await advanceClock(env, s.clock_id, target);
  return updateTest(env, test, { stage: "AWAIT_NO_NEW_JOBS", log: "Cancel synced: subscription CANCELLED, entitlements EXPIRED; clock advancing another month" });
}

async function stageAwaitNoNewJobs(env, app, test) {
  const s = state(test);
  if (!(await clockReady(env, s.clock_id))) return null;
  if (Date.now() - Date.parse(test.stage_started_at) < QUIET_MINUTES * 60000) return null;
  const jobs = await periodJobs(env, s.subscription_id);
  if (jobs.length !== 8) throw new Error(`A cancelled subscription created new jobs (${jobs.length} total)`);
  await cleanUp(env, test);
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: "No jobs after cancel. Passed; test jobs cancelled and test clock deleted" });
}

// Test jobs must never reach a producer, and the test clock is deleted (it removes its customer and subscription).
async function cleanUp(env, test) {
  const s = state(test);
  if (s.subscription_id) {
    const t = nowIso();
    await env.DB.prepare(`
        UPDATE workflow_steps SET status = 'CANCELLED', completed_at = ? WHERE status = 'QUEUED' AND workflow_run_id IN (
          SELECT r.id FROM workflow_runs r JOIN projects p ON p.id = r.project_id WHERE json_extract(p.metadata_json, '$.subscription_id') = ?)
      `).bind(t, s.subscription_id).run();
    await env.DB.prepare(`
        UPDATE workflow_runs SET status = 'CANCELLED', completed_at = ? WHERE status = 'QUEUED' AND project_id IN (
          SELECT id FROM projects WHERE json_extract(metadata_json, '$.subscription_id') = ?)
      `).bind(t, s.subscription_id).run();
    await env.DB.prepare(`
        UPDATE projects SET status = 'CANCELLED', updated_at = ? WHERE json_extract(metadata_json, '$.subscription_id') = ? AND status = 'READY'
      `).bind(t, s.subscription_id).run();
  }
  if (s.clock_id) await stripeTest(env, `/v1/test_helpers/test_clocks/${s.clock_id}`, "DELETE").catch(() => null);
}

const STAGES = {
  START: stageStart,
  AWAIT_ACTIVE: stageAwaitActive,
  AWAIT_RENEWAL: stageAwaitRenewal,
  AWAIT_CANCELLED: stageAwaitCancelled,
  AWAIT_NO_NEW_JOBS: stageAwaitNoNewJobs
};

async function failTest(env, test, message) {
  test = (await env.DB.prepare(`SELECT * FROM self_tests WHERE id = ?`).bind(test.id).first()) || test;
  const failed = await updateTest(env, test, { status: "FAILED", error: message.slice(0, 1000), log: `FAILED: ${message}` });
  await cleanUp(env, failed).catch(() => null);
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Subscription self-test failed",
    html: brandedEmailHtml({
      preheader: "The automated sandbox test of monthly plans failed.",
      eyebrow: "SELF-TEST",
      heading: "The subscription self-test failed",
      paragraphs: ["The automated Growth plan test (Stripe test mode, test clock) stopped. Real subscriptions may hit the same problem."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]]
    }),
    text: `The subscription self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`,
    purpose: "AUTOMATION_ALERT",
    templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceSubscriptionSelfTests(env, app) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const results = [];
  for (let test of await loadActiveTests(env)) {
    for (let guard = 0; guard < 6; guard++) {
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

export { advanceSubscriptionSelfTests, KIND as SUBSCRIPTION_SELF_TEST_KIND };
