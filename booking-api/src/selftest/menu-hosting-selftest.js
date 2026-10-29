// Self-test for the Online Menu + QR year-one move to Menu Care (stage 9 part 2), on the live worker in Stripe test
// mode: a sandbox Menu + QR project for the self-test buyer whose menu was delivered 340 days ago gets its 30-day
// reminder (the email really goes out, to Resend's test inbox); the link's GET opens nothing; POST opens a real
// sandbox Menu Care subscription checkout whose order belongs to that same business. Everything it creates is
// closed at the end (session expired, order cancelled, project and delivery hidden). Daily at 9:40am Pacific; start
// one by inserting a self_tests row with kind MENU_HOSTING_RENEWAL. Only a failure emails the owner.
// Then the 30-day grace (owner decision Oct 28, 2026): the same menu aged to 400 days is offline, gets its one
// "your menu is offline" email, and comes back online as soon as the business has Menu Care.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail, SELF_TEST_EMAIL } from "../lib/email.js";
import { nowIso } from "../lib/http.js";
import { stripeRequest } from "../lib/stripe.js";
import { handleMenuHostingRenewal, menuHostingState, remindMenuHostingRenewals } from "../producers/menu-qr/hosting-renewal.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "MENU_HOSTING_RENEWAL";
const DAILY_HOUR_UTC = 16;
const DAILY_MINUTE_FROM = 40;

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < DAILY_MINUTE_FROM) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`)
    .bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`)
    .bind(crypto.randomUUID(), KIND, t, t).run();
}

// A delivered sandbox Menu + QR project, 340 days old, under its own business.
async function scaffold(env, testId) {
  const t = nowIso();
  const buyer = await env.DB.prepare(`SELECT id FROM customers WHERE lower(email) = ?`).bind(SELF_TEST_EMAIL).first();
  if (!buyer) throw new Error(`No self-test buyer (${SELF_TEST_EMAIL}) in customers`);
  const offer = await env.DB.prepare(`
      SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id
      WHERE o.code = 'ONLINE_MENU_QR' AND v.status = 'ACTIVE' ORDER BY v.version_number DESC LIMIT 1
    `).first();
  if (!offer) throw new Error("No active Online Menu + QR offer");
  const ids = { business: crypto.randomUUID(), order: crypto.randomUUID(), item: crypto.randomUUID(), project: crypto.randomUUID(), asset: crypto.randomUUID(), deliverable: crypto.randomUUID() };
  const delivered = new Date(Date.now() - 340 * 86400000).toISOString();
  const name = `Hosting Self-Test Cafe ${testId.slice(0, 8)}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name, business_status, notes) VALUES (?, ?, ?, ?, 'ACTIVE_CUSTOMER', 'Self-test')`).bind(ids.business, t, t, name),
    env.DB.prepare(`INSERT OR IGNORE INTO customer_businesses (customer_id, business_id, role, is_primary, created_at) VALUES (?, ?, 'CUSTOMER', 0, ?)`).bind(buyer.id, ids.business, t),
    env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, notes) VALUES (?, ?, ?, ?, ?, 'DELIVERED', 'USD', 14400, 0, 0, 14400, 'PAID', 'Menu hosting self-test')`).bind(ids.order, delivered, t, buyer.id, ids.business),
    env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status, metadata_json) VALUES (?, ?, ?, ?, 1, 14400, 14400, 'FULFILLED', ?)`).bind(ids.item, ids.order, offer.offer_id, offer.version_id, JSON.stringify({ offer_code: "ONLINE_MENU_QR", environment: "sandbox", self_test: true })),
    env.DB.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, 'MENU', 'DELIVERED', 'MENU_QR_V1', 1, ?, ?, '{"self_test":true}')`).bind(ids.project, ids.order, ids.item, ids.business, buyer.id, delivered, t),
    env.DB.prepare(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, 'menu.html', 'text/html', 1, 'VALID', ?)`).bind(ids.asset, ids.business, buyer.id, ids.project, `selftest/menu-hosting/${ids.project}.html`, delivered),
    env.DB.prepare(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES (?, ?, ?, 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`).bind(ids.deliverable, ids.project, ids.asset, delivered, delivered)
  ]);
  return ids;
}

async function cleanUp(env, ids, renewalOrderId, entitlementId) {
  const t = nowIso();
  if (entitlementId) await env.DB.prepare(`UPDATE entitlements SET status = 'EXPIRED', ends_at = ?, updated_at = ? WHERE id = ?`).bind(t, t, entitlementId).run();
  if (renewalOrderId) {
    const order = await env.DB.prepare(`SELECT stripe_checkout_session_id FROM orders WHERE id = ?`).bind(renewalOrderId).first();
    if (order?.stripe_checkout_session_id) await stripeRequest(env, "sandbox", `/v1/checkout/sessions/${order.stripe_checkout_session_id}/expire`, { method: "POST" }).catch(() => null);
    await env.DB.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND payment_status != 'PAID'`).bind(t, renewalOrderId).run();
  }
  if (ids) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE deliverables SET customer_visible = 0 WHERE id = ?`).bind(ids.deliverable),
      env.DB.prepare(`UPDATE projects SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).bind(t, ids.project),
      env.DB.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).bind(t, ids.order),
      env.DB.prepare(`UPDATE businesses SET business_status = 'CLOSED', updated_at = ? WHERE id = ?`).bind(t, ids.business)
    ]);
  }
}

async function runHostingCheck(env, test, holder) {
  const ids = holder.ids = await scaffold(env, test.id);
  const sent = await remindMenuHostingRenewals(env, { projectIds: [ids.project] });
  const result = sent.results[0];
  if (sent.sent !== 1 || !result?.ok || result.reminder !== "d30") throw new Error(`30-day reminder not sent: ${JSON.stringify(sent).slice(0, 300)}`);
  const again = await remindMenuHostingRenewals(env, { projectIds: [ids.project] });
  if (again.sent !== 0) throw new Error("The 30-day reminder went out twice");
  const link = new URL(result.link);
  const token = link.searchParams.get("t");
  const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE business_id = ?`).bind(ids.business).first();
  const page = await handleMenuHostingRenewal(new Request(link.href), env, ids.project);
  const html = await page.text();
  if (page.status !== 200 || !/a month/.test(html) || !/a year/.test(html)) throw new Error(`The renewal page answered ${page.status} without both prices`);
  const afterGet = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE business_id = ?`).bind(ids.business).first();
  if (afterGet.n !== before.n) throw new Error("Opening the link (GET) started a checkout");
  const post = await handleMenuHostingRenewal(new Request(`${publicBaseUrl(env)}/api/menu-hosting/${ids.project}`, { method: "POST", body: new URLSearchParams({ t: token, interval: "month" }) }), env, ids.project);
  const location = post.headers.get("Location") || "";
  if (post.status !== 303 || !location.startsWith("https://checkout.stripe.com/")) throw new Error(`Add Menu Care answered ${post.status} (${location.slice(0, 80)})`);
  const order = await env.DB.prepare(`SELECT id, business_id, stripe_checkout_session_id FROM orders WHERE business_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1`).bind(ids.business, ids.order).first();
  if (!order) throw new Error("The Menu Care order is not on the business that owns the menu");
  holder.renewalOrderId = order.id;
  const session = await stripeRequest(env, "sandbox", `/v1/checkout/sessions/${order.stripe_checkout_session_id}`);
  if (session.mode !== "subscription" || session.metadata?.order_id !== order.id || session.amount_total !== 2900) {
    throw new Error(`Menu Care checkout is wrong: mode ${session.mode}, order ${session.metadata?.order_id}, total ${session.amount_total}`);
  }
  // Grace period: 380 days = in the 30 days after the year ends, still online; 400 days = offline.
  const age = (days) => env.DB.prepare(`UPDATE deliverables SET delivered_at = ? WHERE id = ?`).bind(new Date(Date.now() - days * 86400000).toISOString(), ids.deliverable).run();
  await age(380);
  const grace = await menuHostingState(env, ids.business);
  if (!grace.live || grace.reason !== "grace") throw new Error(`10 days after the first year the menu should still be online, got ${JSON.stringify(grace)}`);
  await age(400);
  const off = await menuHostingState(env, ids.business);
  if (off.live) throw new Error("35 days after the first year without Menu Care the menu is still online");
  const notice = await remindMenuHostingRenewals(env, { projectIds: [ids.project] });
  if (notice.sent !== 1 || notice.results[0]?.reminder !== "offline") throw new Error(`Offline email not sent: ${JSON.stringify(notice).slice(0, 300)}`);
  const t = nowIso();
  holder.entitlement = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO entitlements (id, customer_id, business_id, order_item_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES (?, (SELECT customer_id FROM projects WHERE id = ?), ?, ?, 'MENU_CARE', 'ACTIVE', ?, ?, ?)`)
    .bind(holder.entitlement, ids.project, ids.business, ids.item, t, t, t).run();
  const back = await menuHostingState(env, ids.business);
  if (!back.live) throw new Error("With Menu Care the menu did not come back online");
  return `30-day reminder sent once; GET opened nothing; POST opened ${session.id} (Menu Care, $29/month) for the menu's own business; online during the grace period, offline after it with one offline email, back online with Menu Care`;
}

async function advanceMenuHostingSelfTests(env, deps = {}) {
  if (!env.DB || !env.STRIPE_SECRET_KEY_TEST) return [];
  await maybeScheduleDaily(env, deps.now).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status = 'REQUESTED' ORDER BY created_at LIMIT 1`).bind(KIND).all()).results || [];
  const results = [];
  for (const test of tests) {
    const holder = {};
    try {
      const summary = await runHostingCheck(env, test, holder);
      await cleanUp(env, holder.ids, holder.renewalOrderId, holder.entitlement);
      await updateTest(env, test, { status: "PASSED", stage: "DONE", order_id: holder.renewalOrderId, project_id: holder.ids.project, log: `PASSED: ${summary}` });
      results.push({ id: test.id, status: "PASSED" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await cleanUp(env, holder.ids, holder.renewalOrderId, holder.entitlement).catch(() => null);
      await updateTest(env, test, { status: "FAILED", stage: "CHECK", error: message, log: `FAILED: ${message}` });
      results.push({ id: test.id, status: "FAILED", error: message });
      await sendTransactionalEmail(env, {
        to: ownerEmailAddress(env),
        subject: "Menu hosting renewal self-test failed",
        html: brandedEmailHtml({ eyebrow: "Self-test", heading: "Menu hosting reminders need a look", paragraphs: [`The daily menu hosting check failed: ${message}`, "Online Menu + QR buyers may not get their reminder to keep their menu online with Menu Care, or its link may not work, until this is fixed."] }),
        text: `The daily menu hosting renewal self-test failed: ${message}`,
        idempotencyKey: `self-test-failed/${test.id}`,
        purpose: "AUTOMATION_ALERT",
        templateKey: "self_test_failed_v1"
      }).catch(() => null);
    }
  }
  return results;
}

export { KIND, advanceMenuHostingSelfTests };
