// Self-test for the abandoned-checkout follow-up (stage 9 part 2), run on the live worker in Stripe test mode:
// open a real sandbox checkout (Menu Care monthly + Conversion Fix) as the self-test buyer, age the order past 24
// hours, run the follow-up for that order (the email really goes out, to Resend's test inbox), check the link's GET
// opens nothing, POST it and check a new Stripe session opened while the old one was expired, and that a second
// run sends nothing. The order is cancelled at the end. Daily at 9:30am Pacific; start one by inserting a self_tests
// row with kind ABANDONED_CHECKOUT. Only a failure emails the owner.
import { followUpAbandonedCheckouts, handleCheckoutResume } from "../checkout/abandoned.js";
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail, SELF_TEST_EMAIL } from "../lib/email.js";
import { nowIso } from "../lib/http.js";
import { stripeRequest } from "../lib/stripe.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "ABANDONED_CHECKOUT";
const DAILY_HOUR_UTC = 16;
const DAILY_MINUTE_FROM = 30;

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < DAILY_MINUTE_FROM) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`)
    .bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`)
    .bind(crypto.randomUUID(), KIND, t, t).run();
}

async function cleanUp(env, orderId) {
  if (!orderId) return;
  const order = await env.DB.prepare(`SELECT stripe_checkout_session_id FROM orders WHERE id = ?`).bind(orderId).first();
  if (order?.stripe_checkout_session_id) {
    await stripeRequest(env, "sandbox", `/v1/checkout/sessions/${order.stripe_checkout_session_id}/expire`, { method: "POST" }).catch(() => null);
  }
  await env.DB.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND payment_status != 'PAID'`).bind(nowIso(), orderId).run();
}

async function runAbandonedCheckoutCheck(env, app, test) {
  const base = publicBaseUrl(env);
  const response = await app(new Request(`${base}/api/create-checkout-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://menu-made.com" },
    body: JSON.stringify({
      items: [{ key: "MENU_CARE", interval: "month" }, { key: "CONVERSION_FIX" }],
      interval: "month",
      customer: { name: "Menu-Made Self-Test", business: "Abandoned Checkout Self-Test Cafe", email: SELF_TEST_EMAIL, phone: "", notes: "Automated abandoned-checkout self-test" }
    })
  }));
  const body = await response.json().catch(() => null);
  if (!body?.ok || body.mode !== "subscription") throw new Error(`Sandbox checkout failed (HTTP ${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  const orderId = body.order_id;
  await updateTest(env, test, { status: "RUNNING", stage: "CHECK", order_id: orderId, log: `Sandbox checkout ${orderId} opened and left unpaid` });
  const first = await env.DB.prepare(`SELECT stripe_checkout_session_id FROM orders WHERE id = ?`).bind(orderId).first();
  // Age the order past the 24-hour mark (the follow-up only reads created_at).
  await env.DB.prepare(`UPDATE orders SET created_at = ? WHERE id = ?`).bind(new Date(Date.now() - 25 * 3600000).toISOString(), orderId).run();
  const sent = await followUpAbandonedCheckouts(env, { orderIds: [orderId] });
  const result = sent.results[0];
  if (sent.sent !== 1 || !result?.ok) throw new Error(`Follow-up email not sent: ${JSON.stringify(sent).slice(0, 300)}`);
  const logged = await env.DB.prepare(`SELECT status FROM communications WHERE order_id = ? AND purpose = 'ABANDONED_CHECKOUT'`).bind(orderId).first();
  if (logged?.status !== "SENT") throw new Error("Follow-up email was not logged as SENT");
  const link = new URL(result.link);
  const token = link.searchParams.get("t");
  const page = await handleCheckoutResume(new Request(link.href), env, orderId);
  if (page.status !== 200) throw new Error(`Opening the link answered ${page.status}`);
  const afterGet = await env.DB.prepare(`SELECT stripe_checkout_session_id FROM orders WHERE id = ?`).bind(orderId).first();
  if (afterGet.stripe_checkout_session_id !== first.stripe_checkout_session_id) throw new Error("Opening the link (GET) opened a new checkout; link scanners would do the same");
  const post = await handleCheckoutResume(new Request(`${base}/api/checkout/resume/${orderId}`, { method: "POST", body: new URLSearchParams({ t: token }) }), env, orderId);
  const location = post.headers.get("Location") || "";
  if (post.status !== 303 || !location.startsWith("https://checkout.stripe.com/")) throw new Error(`Finish checkout answered ${post.status} (${location.slice(0, 80)})`);
  const afterPost = await env.DB.prepare(`SELECT stripe_checkout_session_id, status FROM orders WHERE id = ?`).bind(orderId).first();
  if (afterPost.stripe_checkout_session_id === first.stripe_checkout_session_id || afterPost.status !== "PAYMENT_PENDING") {
    throw new Error("Finish checkout did not attach a new session to the same unpaid order");
  }
  const old = await stripeRequest(env, "sandbox", `/v1/checkout/sessions/${first.stripe_checkout_session_id}`);
  if (old.status !== "expired") throw new Error(`The first session is still ${old.status}; two payable sessions for one order`);
  const fresh = await stripeRequest(env, "sandbox", `/v1/checkout/sessions/${afterPost.stripe_checkout_session_id}`);
  if (fresh.mode !== "subscription" || fresh.metadata?.order_id !== orderId || fresh.amount_total !== 29900 + 2900) {
    throw new Error(`New session is wrong: mode ${fresh.mode}, order ${fresh.metadata?.order_id}, total ${fresh.amount_total}`);
  }
  const again = await followUpAbandonedCheckouts(env, { orderIds: [orderId] });
  if (again.sent !== 0) throw new Error("A second follow-up went out; buyers must get one reminder only");
  return { orderId, summary: `email sent and logged; GET opened nothing; POST opened ${fresh.id} ($${fresh.amount_total / 100}, subscription) and expired the old session; no second email` };
}

async function advanceAbandonedCheckoutSelfTests(env, app, deps = {}) {
  if (!env.DB || !env.STRIPE_SECRET_KEY_TEST) return [];
  await maybeScheduleDaily(env, deps.now).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status = 'REQUESTED' ORDER BY created_at LIMIT 1`).bind(KIND).all()).results || [];
  const results = [];
  for (const test of tests) {
    let orderId = null;
    try {
      const outcome = await runAbandonedCheckoutCheck(env, app, test);
      orderId = outcome.orderId;
      await cleanUp(env, orderId);
      await updateTest(env, { ...test, stage: "CHECK" }, { status: "PASSED", stage: "DONE", order_id: orderId, log: `PASSED: ${outcome.summary}` });
      results.push({ id: test.id, status: "PASSED" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      orderId = (await env.DB.prepare(`SELECT order_id FROM self_tests WHERE id = ?`).bind(test.id).first())?.order_id || null;
      await cleanUp(env, orderId).catch(() => null);
      await updateTest(env, test, { status: "FAILED", stage: "CHECK", error: message, log: `FAILED: ${message}` });
      results.push({ id: test.id, status: "FAILED", error: message });
      await sendTransactionalEmail(env, {
        to: ownerEmailAddress(env),
        subject: "Abandoned-checkout self-test failed",
        html: brandedEmailHtml({ eyebrow: "Self-test", heading: "Checkout reminders need a look", paragraphs: [`The daily abandoned-checkout check failed: ${message}`, "Buyers who leave a checkout may not get their reminder, or its Finish checkout link may not work, until this is fixed."] }),
        text: `The daily abandoned-checkout self-test failed: ${message}`,
        idempotencyKey: `self-test-failed/${test.id}`,
        purpose: "AUTOMATION_ALERT",
        templateKey: "self_test_failed_v1"
      }).catch(() => null);
    }
  }
  return results;
}

export { KIND, advanceAbandonedCheckoutSelfTests, runAbandonedCheckoutCheck };
