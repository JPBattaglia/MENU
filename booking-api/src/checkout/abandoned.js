// Stage 9 part 2: abandoned-checkout follow-up. A buyer who opened Stripe Checkout and didn't pay gets ONE email
// 24 hours later with a signed "Finish checkout" link. The link reopens the SAME order in a fresh Stripe session
// (Stripe sessions expire after 24 hours), so the uploaded menu and notes on the order carry over. Before a new
// session is opened the old one is expired, so an order never has two payable sessions at once.
//
// Runs once an hour from the scheduled handler (the */5 tick whose minute is 0-4). Only live orders 24-72 hours old
// are emailed; the self-test targets its own sandbox order directly.
import { CheckoutValidationError, normalizeCheckoutItems } from "./quote.js";
import { openStripeSession } from "./session.js";
import { publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, isCustomerEmail, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { stripeRequest } from "../lib/stripe.js";
import { buildSubscriptionCart } from "../subscriptions/checkout.js";
import { automationOff } from "../lib/switches.js";


const RESUME_KIND = "checkout-resume";
const RESUME_TTL_DAYS = 14;
const PURPOSE = "ABANDONED_CHECKOUT";
const AFTER_HOURS = 24;
const UNTIL_HOURS = 72;

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(Number(cents || 0) % 100 ? 2 : 0)}`;

function orderEnvironment(items) {
  return items.some((item) => parseJsonOrNull(item.metadata_json)?.environment === "sandbox") ? "sandbox" : "live";
}

async function loadOrder(env, orderId) {
  const order = await env.DB.prepare(`
      SELECT o.*, c.email, c.first_name, c.last_name, c.phone AS customer_phone, b.name AS business_name
      FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN businesses b ON b.id = o.business_id
      WHERE o.id = ?
    `).bind(orderId).first();
  if (!order) return null;
  const items = (await env.DB.prepare(`
      SELECT i.*, f.code AS offer_code, f.name AS offer_name
      FROM order_items i JOIN offers f ON f.id = i.offer_id WHERE i.order_id = ? ORDER BY i.rowid
    `).bind(orderId).all()).results || [];
  return { order, items, environment: orderEnvironment(items) };
}

// What the buyer saw in the cart, as lines for the email and the resume page.
function cartLines(items) {
  return items.filter((item) => {
    const meta = parseJsonOrNull(item.metadata_json) || {};
    return !(meta.billing === "RECURRING" && meta.trial_days); // Website & App Care during the Website Package trial
  }).map((item) => {
    const meta = parseJsonOrNull(item.metadata_json) || {};
    if (meta.billing === "RECURRING") {
      const per = meta.interval === "YEAR" ? "year" : "month";
      return [item.offer_name, `${money(meta.recurring_amount_cents ?? item.unit_price_cents)}/${per}`];
    }
    if (meta.menu_package) return [item.offer_name, `${money(item.line_total_cents)} (${meta.menu_package.menu_pages} menu pages, first-year hosting)`];
    return [item.offer_name, money(item.line_total_cents)];
  });
}

function trialNote(items) {
  const trial = items.find((item) => parseJsonOrNull(item.metadata_json)?.trial_days);
  if (!trial) return null;
  const meta = parseJsonOrNull(trial.metadata_json);
  return `${trial.offer_name} is free for the first ${Math.round(meta.trial_days / 30)} months, then ${money(meta.recurring_amount_cents)}/${meta.interval === "YEAR" ? "year" : "month"}.`;
}

// Turns the stored order back into the cart the checkout endpoint accepts, so the same rules and prices apply.
function cartInputFromItems(items) {
  const inputs = [];
  let interval = "month";
  let menuPages;
  let designPages;
  let returnTo;
  for (const item of items) {
    const meta = parseJsonOrNull(item.metadata_json) || {};
    if (meta.billing === "RECURRING") {
      interval = meta.interval === "YEAR" ? "year" : "month";
      if (meta.trial_days) continue; // re-added by the Website Package rule
      inputs.push({ key: meta.plan_code || item.offer_code, interval });
      continue;
    }
    if (meta.menu_package) menuPages = Number(meta.menu_package.menu_pages);
    if (meta.design_pages) designPages = Number(meta.design_pages);
    if (meta.return_to === "nino") returnTo = "nino";
    inputs.push({ key: item.offer_code, qty: Number(item.quantity || 1) });
  }
  return { items: inputs, interval, ...(menuPages ? { menu_pages: menuPages } : {}), ...(designPages ? { design_pages: designPages } : {}), ...(returnTo ? { return_to: returnTo } : {}) };
}

async function resumeLink(env, orderId) {
  const token = await signLinkToken(env, { kind: RESUME_KIND, id: orderId, ttlDays: RESUME_TTL_DAYS });
  return `${publicBaseUrl(env)}/api/checkout/resume/${orderId}?t=${encodeURIComponent(token)}`;
}

async function alreadyFollowedUp(env, orderId) {
  return Boolean(await env.DB.prepare(`SELECT 1 FROM communications WHERE order_id = ? AND purpose = ? LIMIT 1`).bind(orderId, PURPOSE).first());
}

// Candidates: unpaid orders whose Stripe session was opened 24-72 hours ago.
async function candidateOrders(env, now) {
  const from = new Date(now.getTime() - UNTIL_HOURS * 3600000).toISOString();
  const until = new Date(now.getTime() - AFTER_HOURS * 3600000).toISOString();
  return (await env.DB.prepare(`
      SELECT id, customer_id, created_at FROM orders
      WHERE status = 'PAYMENT_PENDING' AND payment_status IN ('PENDING', 'UNPAID')
        AND stripe_checkout_session_id IS NOT NULL AND created_at >= ? AND created_at <= ?
      ORDER BY created_at LIMIT 20
    `).bind(from, until).all()).results || [];
}

// The buyer came back on their own (paid or started again later): no reminder for the older order.
async function boughtOrRetriedSince(env, row) {
  return Boolean(await env.DB.prepare(`
      SELECT 1 FROM orders WHERE customer_id = ? AND id != ? AND created_at > ? AND status NOT IN ('FAILED', 'CANCELLED') LIMIT 1
    `).bind(row.customer_id, row.id, row.created_at).first());
}

async function sendFollowUp(env, loaded) {
  const { order, items, environment } = loaded;
  const link = await resumeLink(env, order.id);
  const lines = cartLines(items);
  const hasUpload = /Document ref: /i.test(order.notes || "");
  const greeting = order.first_name ? `Hi ${order.first_name},` : "Hi,";
  const trial = trialNote(items);
  const paragraphs = [
    escapeHtml(greeting),
    `You started an order with Menu-Made${order.business_name ? ` for ${escapeHtml(order.business_name)}` : ""} but didn't finish checking out. Nothing was charged.`,
    hasUpload ? "Your order is saved, including the menu you uploaded, so you can pick up where you left off." : "Your order is saved, so you can pick up where you left off.",
    ...(trial ? [escapeHtml(trial)] : [])
  ];
  return sendTransactionalEmail(env, {
    to: order.email,
    subject: "Your Menu-Made order is saved",
    html: brandedEmailHtml({
      preheader: "Finish checking out whenever you're ready. Nothing was charged.",
      eyebrow: "Your order",
      heading: "Finish your order",
      paragraphs,
      rows: lines,
      buttons: [{ label: "Finish checkout", url: link, primary: true }],
      footnote: `The link works for ${RESUME_TTL_DAYS} days. Questions first? Reply to this email. This is the only reminder we'll send.`
    }),
    text: [greeting, "",
      `You started an order with Menu-Made but didn't finish checking out. Nothing was charged.${hasUpload ? " Your uploaded menu is saved with it." : ""}`,
      "", ...lines.map(([name, price]) => `- ${name}: ${price}`), ...(trial ? ["", trial] : []), "",
      `Finish checkout (works for ${RESUME_TTL_DAYS} days): ${link}`, "",
      "Questions first? Reply to this email. This is the only reminder we'll send."].join("\n"),
    idempotencyKey: `abandoned-checkout/${order.id}`,
    purpose: PURPOSE,
    templateKey: "abandoned_checkout_v1",
    context: { customerId: order.customer_id, businessId: order.business_id, orderId: order.id }
  }).then((result) => ({ ...result, link, environment }));
}

// orderIds: the self-test names its own sandbox order (and skips the "came back since" check, because the
// self-test buyer places many orders). Everyone else: live orders only.
async function followUpAbandonedCheckouts(env, { now = new Date(), orderIds = null } = {}) {
  if (!env.DB) return { sent: 0 };
  const rows = orderIds
    ? (await Promise.all(orderIds.map((id) => env.DB.prepare(`SELECT id, customer_id, created_at FROM orders WHERE id = ?`).bind(id).first()))).filter(Boolean)
    : await candidateOrders(env, now);
  const summary = { checked: 0, sent: 0, skipped: [], results: [] };
  for (const row of rows) {
    summary.checked += 1;
    const skip = (reason) => summary.skipped.push({ id: row.id, reason });
    try {
      const age = now.getTime() - Date.parse(row.created_at);
      if (age < AFTER_HOURS * 3600000 || age > UNTIL_HOURS * 3600000) { skip("outside the 24-72 hour window"); continue; }
      if (await alreadyFollowedUp(env, row.id)) { skip("already emailed"); continue; }
      const loaded = await loadOrder(env, row.id);
      if (!loaded || loaded.order.status !== "PAYMENT_PENDING" || !["PENDING", "UNPAID"].includes(loaded.order.payment_status)) { skip("no longer unpaid"); continue; }
      if (!orderIds && loaded.environment !== "live") { skip("sandbox order"); continue; }
      if (!isCustomerEmail(loaded.order.email, PURPOSE, env)) { skip("owner address"); continue; }
      // Staff merch carts carry sizes, colours and a shipping quote that expire; the merch page rebuilds them instead.
      if (loaded.items.some((item) => parseJsonOrNull(item.metadata_json)?.staff_merch)) { skip("staff merch order"); continue; }
      if (!orderIds && await boughtOrRetriedSince(env, row)) { skip("buyer came back since"); continue; }
      // The webhook may be late: never remind someone who actually paid.
      const session = loaded.order.stripe_checkout_session_id
        ? await stripeRequest(env, loaded.environment, `/v1/checkout/sessions/${loaded.order.stripe_checkout_session_id}`) : null;
      if (session?.status === "complete" || session?.payment_status === "paid") { skip("paid at Stripe"); continue; }
      const result = await sendFollowUp(env, loaded);
      if (result.ok) summary.sent += 1;
      summary.results.push({ id: row.id, ok: result.ok, error: result.error || null, link: result.link });
    } catch (error) {
      skip(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}

// The hourly tick: minute 0-4 of each hour (the cron runs every 5 minutes).
async function maybeFollowUpAbandonedCheckouts(env, now = new Date()) {
  if (now.getUTCMinutes() >= 5) return null;
  if (await automationOff(env, "ABANDONED_EMAILS")) return null; // owner switch
  return followUpAbandonedCheckouts(env, { now });
}

function closedPage(title, message) {
  return simplePage(200, title, `<p>${message}</p><p><a class="btn" href="/contact.html">Start a new order</a><a class="btn" href="/account.html">Your account</a></p>`);
}

// GET /api/checkout/resume/<order>?t=  shows the saved order and a button (link scanners can't open sessions);
// POST expires any open session for the order, re-prices it from today's catalog and redirects to a new one.
async function handleCheckoutResume(request, env, orderId) {
  const url = new URL(request.url);
  const form = request.method === "POST" ? await request.formData().catch(() => null) : null;
  const token = String((form ? form.get("t") : url.searchParams.get("t")) || "");
  const payload = await verifyLinkToken(env, token, [RESUME_KIND], orderId);
  if (!payload) return simplePage(404, "Link not found", `<p>This link isn't valid. You can start a new order instead.</p><p><a class="btn" href="/contact.html">Start an order</a></p>`);
  if (payload.expired) return closedPage("This link has expired", "Saved checkouts can be finished for 14 days.");
  const loaded = await loadOrder(env, orderId);
  if (!loaded) return closedPage("Order not found", "We couldn't find this order.");
  const { order, items, environment } = loaded;
  if (order.payment_status === "PAID" || ["PAID", "IN_PRODUCTION", "DELIVERED", "COMPLETED"].includes(order.status)) {
    return simplePage(200, "This order is paid", `<p>Thanks, this order is already paid. Your deliveries and next steps are in your account.</p><p><a class="btn" href="/account.html">Your account</a></p>`);
  }
  if (order.status !== "PAYMENT_PENDING") return closedPage("This order was closed", "This order can't be finished any more.");
  const lines = cartLines(items);
  const trial = trialNote(items);
  if (request.method !== "POST") {
    return simplePage(200, "Finish your order",
      `<p>${order.business_name ? `Order for <strong>${escapeHtml(order.business_name)}</strong>. ` : ""}Nothing has been charged yet.</p>
<dl>${lines.map(([name, price]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(price)}</dd>`).join("")}</dl>
${trial ? `<p>${escapeHtml(trial)}</p>` : ""}
<form method="post"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">Continue to secure checkout</button></form>
<p>Prices are today's prices. Payment is handled by Stripe.</p>`);
  }
  // Only one payable session per order: close the old one first (if the buyer paid it meanwhile, say so).
  if (order.stripe_checkout_session_id) {
    const previous = await stripeRequest(env, environment, `/v1/checkout/sessions/${order.stripe_checkout_session_id}`).catch(() => null);
    if (previous?.status === "complete") {
      return simplePage(200, "This order is paid", `<p>Thanks, this order is already paid. Your deliveries and next steps are in your account.</p><p><a class="btn" href="/account.html">Your account</a></p>`);
    }
    if (previous?.status === "open") {
      await stripeRequest(env, environment, `/v1/checkout/sessions/${previous.id}/expire`, { method: "POST" }).catch(() => null);
    }
  }
  try {
    const data = { ...cartInputFromItems(items), customer: { business: order.business_name || "" } };
    const cart = await buildSubscriptionCart(data.items, data, env, environment);
    const normalizedItems = await normalizeCheckoutItems(cart.oneTimeInputs, env, data, { requirePublic: environment === "live" });
    cart.validateSetups(normalizedItems);
    const orderItems = cart.plan ? [...normalizedItems, cart.orderItem()] : normalizedItems;
    const before = items.reduce((sum, item) => sum + Number(item.line_total_cents || 0), 0);
    const after = orderItems.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
    if (orderItems.length !== items.length || before !== after) {
      return closedPage("Prices have changed", "Something in this order has changed since you started it, so please start a new order. Your saved details are not lost: reply to our email and we'll help.");
    }
    const pending = {
      orderId: order.id,
      email: order.email,
      name: [order.first_name, order.last_name].filter(Boolean).join(" "),
      businessName: order.business_name || "",
      phone: order.customer_phone || "",
      notes: order.notes || "",
      returnTo: data.return_to || null
    };
    const opened = await openStripeSession(env, environment, { cart, normalizedItems, orderItems, pending, resumed: true });
    if (!opened.ok) return closedPage("Checkout couldn't open", "Stripe didn't open a checkout just now. Please try the link again in a minute, or reply to our email.");
    return new Response(null, { status: 303, headers: { Location: opened.url, "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CheckoutValidationError) return closedPage("This order can't be finished", escapeHtml(error.message));
    throw error;
  }
}

export {
  RESUME_KIND,
  PURPOSE as ABANDONED_CHECKOUT_PURPOSE,
  cartInputFromItems,
  followUpAbandonedCheckouts,
  maybeFollowUpAbandonedCheckouts,
  handleCheckoutResume,
  resumeLink
};
