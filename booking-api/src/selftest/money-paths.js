// Stage 12, task 5: the money paths, read-only in live mode (MONEY_PATHS). Once a day at 21:00 UTC, in one pass:
//   1. Prices: every active catalog offer version with a live Stripe price ID points at a price that exists, is
//      active, and has the catalog's amount and billing (one-time, monthly or yearly). Pages show catalog prices
//      (tools/site_pages.py), so this also proves the pages match what Stripe charges.
//   2. Checkout: one live Checkout Session is opened for one public offer's real price (a different offer each day)
//      and expired straight away. Nothing is paid, no order row is made, no email is sent.
//   3. Webhook: the live endpoint for https://menu-made.com/api/stripe-webhook exists, is enabled and listens to
//      every event the worker needs.
//   4. Deliveries: no live event from the last 3 days (older than an hour) failed to reach the webhook.
// The Nino shop's own Stripe account is checked by its worker's self-check (listed under "Checked elsewhere").
// The result is a self_tests row (MONEY_PATHS): on the coverage map and in the daily failure-only email.
// Start one now by inserting a self_tests row with kind MONEY_PATHS and status REQUESTED.
import { nowIso } from "../lib/http.js";
import { stripeRequest } from "../lib/stripe.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "MONEY_PATHS";
const DAILY_HOUR_UTC = 21;
const WEBHOOK_URL = "https://menu-made.com/api/stripe-webhook";
const NEEDED_EVENTS = ["checkout.session.completed", "invoice.paid", "invoice.payment_failed",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
const INTERVAL = { MONTH: "month", YEAR: "year" };

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() >= 20) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = now.toISOString();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

// The checks themselves. Returns { problems: [...], notes: [...] }. stripe(path, options) is the live Stripe call.
async function checkMoneyPaths(env, stripe, now = Date.now()) {
  const problems = []; const notes = [];
  const versions = (await env.DB.prepare(`
      SELECT o.code, o.is_public, v.billing_interval, v.price_cents, v.stripe_price_id
      FROM offers o JOIN offer_versions v ON v.offer_id = o.id
      WHERE o.status = 'ACTIVE' AND v.status = 'ACTIVE' AND v.stripe_price_id IS NOT NULL ORDER BY o.code, v.version_number`).all()).results || [];

  // 1. Prices.
  const prices = new Map();
  let page = await stripe("/v1/prices", { params: [["limit", "100"]] });
  for (const p of page.data || []) prices.set(p.id, p);
  while (page.has_more && page.data?.length) {
    page = await stripe("/v1/prices", { params: [["limit", "100"], ["starting_after", page.data[page.data.length - 1].id]] });
    for (const p of page.data || []) prices.set(p.id, p);
  }
  for (const v of versions) {
    const p = prices.get(v.stripe_price_id);
    const label = `${v.code}${v.billing_interval ? ` (${v.billing_interval.toLowerCase()}ly)` : ""}`;
    if (!p) { problems.push(`${label}: price ${v.stripe_price_id} isn't in Stripe live`); continue; }
    if (!p.active) problems.push(`${label}: Stripe price ${p.id} is archived`);
    if (Number(p.unit_amount) !== Number(v.price_cents)) problems.push(`${label}: Stripe charges ${p.unit_amount}, the catalog says ${v.price_cents}`);
    const want = v.billing_interval ? INTERVAL[v.billing_interval] : null;
    const got = p.recurring?.interval || null;
    if (want !== got) problems.push(`${label}: Stripe bills ${got || "once"}, the catalog says ${want || "once"}`);
  }
  notes.push(`${versions.length} live prices checked`);

  // 2. One live checkout session for a different public offer each day, expired at once.
  const sellable = versions.filter((v) => v.is_public);
  if (sellable.length) {
    const pick = sellable[Math.floor(now / 86400000) % sellable.length];
    const recurring = Boolean(pick.billing_interval);
    try {
      const session = await stripe("/v1/checkout/sessions", { method: "POST", params: {
        mode: recurring ? "subscription" : "payment", "line_items[0][price]": pick.stripe_price_id, "line_items[0][quantity]": "1",
        success_url: "https://menu-made.com/checkoutsuccess.html", cancel_url: "https://menu-made.com/checkoutcancel.html",
        "metadata[self_test]": "money-paths"
      } });
      if (!session?.id?.startsWith("cs_live_") || !session.url) problems.push(`Checkout: Stripe didn't open a live session for ${pick.code}`);
      else {
        await stripe(`/v1/checkout/sessions/${session.id}/expire`, { method: "POST" }).catch((e) => problems.push(`Checkout: the test session ${session.id} couldn't be expired (${String(e.message).slice(0, 80)})`));
        notes.push(`live checkout opened and expired for ${pick.code}`);
      }
    } catch (error) { problems.push(`Checkout: opening a live session for ${pick.code} failed: ${String(error?.message || error).slice(0, 200)}`); }
  }

  // 3. Webhook endpoint.
  const endpoints = (await stripe("/v1/webhook_endpoints", { params: [["limit", "100"]] })).data || [];
  const endpoint = endpoints.find((e) => e.url === WEBHOOK_URL);
  if (!endpoint) problems.push(`Webhook: no live endpoint for ${WEBHOOK_URL}`);
  else {
    if (endpoint.status !== "enabled") problems.push(`Webhook: the live endpoint is ${endpoint.status}`);
    const events = endpoint.enabled_events || [];
    const missing = events.includes("*") ? [] : NEEDED_EVENTS.filter((e) => !events.includes(e));
    if (missing.length) problems.push(`Webhook: the live endpoint doesn't send ${missing.join(", ")}`);
    else notes.push("live webhook enabled with every needed event");
  }

  // 4. Deliveries: events from the last 3 days that still haven't reached the webhook an hour later.
  const failed = (await stripe("/v1/events", { params: [["delivery_success", "false"], ["created[gte]", String(Math.floor(now / 1000) - 3 * 86400)], ["created[lte]", String(Math.floor(now / 1000) - 3600)], ["limit", "20"]] })).data || [];
  if (failed.length) problems.push(`Webhook: ${failed.length} live event${failed.length === 1 ? "" : "s"} didn't reach the worker (e.g. ${failed.slice(0, 3).map((e) => `${e.type} ${e.id}`).join(", ")})`);
  else notes.push("no failed webhook deliveries in 3 days");
  return { problems, notes };
}

async function advanceMoneyPathsSelfTests(env, deps = {}) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env, deps.now).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status = 'REQUESTED' ORDER BY created_at LIMIT 1`).bind(KIND).all()).results || [];
  const out = [];
  for (const test of tests) {
    const t = nowIso();
    await env.DB.prepare(`UPDATE self_tests SET status = 'RUNNING', stage = 'CHECK', stage_started_at = ?, updated_at = ? WHERE id = ? AND status = 'REQUESTED'`).bind(t, t, test.id).run();
    let status = "PASSED"; let error = null; let log = [];
    try {
      if (!env.STRIPE_SECRET_KEY) throw new Error("The live Stripe key isn't on the worker");
      const stripe = deps.stripe || ((path, options = {}) => stripeRequest(env, "live", path, options));
      const { problems, notes } = await checkMoneyPaths(env, stripe, deps.clock ? deps.clock() : Date.now());
      log = notes.map((note) => ({ at: nowIso(), stage: "CHECK", note }));
      if (problems.length) { status = "FAILED"; error = `${problems.length} problem${problems.length === 1 ? "" : "s"}: ${problems.join(" | ")}`.slice(0, 1000); }
    } catch (e) { status = "FAILED"; error = `The money-paths check didn't finish: ${String(e?.message || e).slice(0, 300)}`; }
    const done = nowIso();
    await env.DB.prepare(`UPDATE self_tests SET status = ?, stage = 'DONE', error = ?, log_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
      .bind(status, error, JSON.stringify(log), done, done, test.id).run();
    out.push({ id: test.id, status });
  }
  return out;
}

export { KIND as MONEY_PATHS_KIND, NEEDED_EVENTS, advanceMoneyPathsSelfTests, checkMoneyPaths, maybeScheduleDaily };
