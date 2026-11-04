// Self-serve cancel with a full refund (owner decision Nov 4, 2026): custom work can be cancelled for a full refund
// until work starts. Shirts and staff merch (physical goods) and plans (cancel at period end) are not refundable.
//   - Online Menu + QR: until the menu is delivered (production starts automatically at payment, so "work starts"
//     for the buyer is delivery).
//   - Every other one-time service (Nino design work, Website Package, Google Visibility, Conversion Fix, Guest App,
//     Mobile App, ...): until the buyer sends the brief or intake form, i.e. while the project waits for their input.
// Within REFUND_DAYS of purchase. The account page shows the link; GET shows a confirm page (link scanners never
// trigger a refund), POST refunds through Stripe and stops production.
//
//   GET|POST /api/order/<order_id>/cancel?t=<signed token>
import { publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { ownerEmailAddress } from "../lib/config.js";
import { nowIso } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { stripeRequest } from "../lib/stripe.js";

const KIND = "order_cancel";
const REFUND_DAYS = 30;
const DONE = new Set(["DELIVERED", "COMPLETED", "CANCELLED", "FAILED"]);
const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(Number(cents || 0) % 100 ? 2 : 0)}`;

async function loadOrder(env, orderId) {
  const order = await env.DB.prepare(`
      SELECT o.id, o.status, o.payment_status, o.total_cents, o.placed_at, o.created_at, o.stripe_payment_intent_id, o.stripe_checkout_session_id,
             c.email, c.first_name
      FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`).bind(orderId).first();
  if (!order) return null;
  const items = (await env.DB.prepare(`
      SELECT oi.id, of.code, of.name, of.billing_type, of.fulfillment_type, of.category
      FROM order_items oi JOIN offers of ON of.id = oi.offer_id WHERE oi.order_id = ?`).bind(orderId).all()).results || [];
  const projects = (await env.DB.prepare(`
      SELECT p.id, p.status, p.order_item_id,
             (SELECT COUNT(*) FROM deliverables d WHERE d.project_id = p.id AND d.customer_visible = 1 AND d.status = 'FINAL') AS delivered
      FROM projects p WHERE p.order_id = ?`).bind(orderId).all()).results || [];
  return { order, items, projects };
}

// { ok: true } or { ok: false, reason } in words the buyer can read.
function refundEligibility(loaded, now = Date.now()) {
  if (!loaded) return { ok: false, reason: "We couldn't find this order." };
  const { order, items, projects } = loaded;
  if (order.payment_status === "REFUNDED" || order.status === "REFUNDED") return { ok: false, refunded: true, reason: "This order has already been refunded." };
  if (order.payment_status !== "PAID" || !order.stripe_payment_intent_id) return { ok: false, reason: "This order can't be refunded online. Reply to any of our emails and we'll help." };
  if (now - Date.parse(order.placed_at || order.created_at) > REFUND_DAYS * 864e5) return { ok: false, reason: `Online cancelling is open for ${REFUND_DAYS} days after purchase.` };
  if (!items.length) return { ok: false, reason: "This order has nothing to cancel." };
  for (const item of items) {
    if (item.billing_type !== "ONE_TIME") return { ok: false, reason: "Plans aren't refunded; you can cancel a plan at the end of its period under Manage your plan." };
    if (item.fulfillment_type === "PHYSICAL" || item.category === "MERCH") return { ok: false, reason: "Printed items are made to order and can't be refunded. If one arrives damaged, email us a photo and we'll reprint it." };
    const project = projects.find((p) => p.order_item_id === item.id);
    if (!project) return { ok: false, reason: "This order can't be refunded online. Reply to any of our emails and we'll help." };
    if (item.code === "ONLINE_MENU_QR") {
      if (DONE.has(project.status) || Number(project.delivered) > 0) return { ok: false, reason: "Your menu has already been delivered, so it can't be refunded. You still have your two revisions." };
    } else if (!["CREATED", "AWAITING_INPUTS"].includes(project.status)) {
      return { ok: false, reason: "Work on this order has started, so it can't be refunded. You still have your included rounds of changes." };
    }
  }
  return { ok: true };
}

async function cancelLink(env, orderId) {
  const token = await signLinkToken(env, { kind: KIND, id: orderId, ttlDays: REFUND_DAYS + 1 });
  return `${publicBaseUrl(env)}/api/order/${orderId}/cancel?t=${encodeURIComponent(token)}`;
}

function page(status, title, body) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#edf3f5;color:#26434f;"><main style="max-width:560px;margin:48px auto;padding:28px;background:#fff;border:1px solid #dce8ec;">
<h1 style="margin:0 0 12px;font-size:22px;color:#071f2c;">${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

async function handleOrderCancel(request, env, orderId) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") || "";
  const payload = await verifyLinkToken(env, token, [KIND], orderId);
  if (!payload || payload.expired) return page(403, "This link has expired", `<p>Open <a href="https://menu-made.com/account">your account</a> for a fresh link, or reply to any of our emails.</p>`);
  const loaded = await loadOrder(env, orderId);
  const check = refundEligibility(loaded);
  if (!check.ok) return page(check.refunded ? 200 : 409, check.refunded ? "Already refunded" : "This order can't be cancelled online", `<p>${escapeHtml(check.reason)}</p>`);
  const { order, items } = loaded;
  const names = items.map((i) => i.name).join(", ");
  if (request.method !== "POST") {
    return page(200, "Cancel this order?", `<p><strong>${escapeHtml(names)}</strong>, ${money(order.total_cents)}.</p><p>We'll stop work and refund ${money(order.total_cents)} to your card. Refunds usually show in 5 to 10 business days.</p>
<form method="post"><button type="submit" style="font:inherit;font-weight:700;padding:11px 18px;border-radius:6px;border:0;background:#071f2c;color:#fff;cursor:pointer;">Cancel and refund ${money(order.total_cents)}</button></form>
<p style="margin-top:18px;"><a href="https://menu-made.com/account">Keep my order</a></p>`);
  }
  const environment = String(order.stripe_checkout_session_id || "").startsWith("cs_test_") ? "sandbox" : "live";
  try {
    await stripeRequest(env, environment, "/v1/refunds", { method: "POST", params: { payment_intent: order.stripe_payment_intent_id, reason: "requested_by_customer", "metadata[order_id]": order.id }, idempotencyKey: `order-cancel/${order.id}` });
  } catch (error) {
    console.error("Refund failed:", error instanceof Error ? error.message : String(error));
    return page(502, "We couldn't refund this just now", `<p>Nothing was cancelled. Please try again in a few minutes, or reply to any of our emails.</p>`);
  }
  await stopOrder(env, order.id);
  const ownerTo = ownerEmailAddress(env);
  await sendTransactionalEmail(env, {
    to: order.email, subject: "Your order is cancelled and refunded",
    html: brandedEmailHtml({ eyebrow: "REFUND", heading: "Cancelled and refunded", paragraphs: [`We've cancelled ${escapeHtml(names)} and refunded ${money(order.total_cents)} to your card. It usually shows in 5 to 10 business days.`] }),
    text: `We've cancelled ${names} and refunded ${money(order.total_cents)} to your card. It usually shows in 5 to 10 business days.`,
    idempotencyKey: `order-cancel/${order.id}/buyer`, purpose: "ORDER_REFUND", templateKey: "order_refund_v1"
  }).catch(() => null);
  await sendTransactionalEmail(env, {
    to: ownerTo, subject: `Refunded: ${names} (${money(order.total_cents)})`,
    html: brandedEmailHtml({ eyebrow: "FYI", heading: "A buyer cancelled before work started", paragraphs: [`${escapeHtml(order.email)} cancelled order ${escapeHtml(order.id)} (${escapeHtml(names)}) and was refunded ${money(order.total_cents)} automatically. Production for it has stopped. Nothing for you to do.`] }),
    text: `${order.email} cancelled order ${order.id} (${names}), refunded ${money(order.total_cents)} automatically. Nothing for you to do.`,
    idempotencyKey: `order-cancel/${order.id}/owner`, purpose: "OWNER_REFUND_NOTICE", templateKey: "order_refund_owner_v1"
  }).catch(() => null);
  return page(200, "Cancelled and refunded", `<p>We've stopped work and refunded ${money(order.total_cents)} to your card. It usually shows in 5 to 10 business days. A confirmation is on its way to your email.</p>`);
}

async function stopOrder(env, orderId) {
  const t = nowIso();
  await env.DB.prepare(`UPDATE orders SET status = 'REFUNDED', payment_status = 'REFUNDED', cancelled_at = ?, updated_at = ? WHERE id = ?`).bind(t, t, orderId).run();
  await env.DB.prepare(`UPDATE order_items SET fulfillment_status = 'CANCELLED' WHERE order_id = ?`).bind(orderId).run();
  await env.DB.prepare(`UPDATE projects SET status = 'CANCELLED', blocked_reason = 'Buyer cancelled for a refund', updated_at = ? WHERE order_id = ?`).bind(t, orderId).run();
  await env.DB.prepare(`UPDATE workflow_runs SET status = 'CANCELLED' WHERE project_id IN (SELECT id FROM projects WHERE order_id = ?) AND status IN ('QUEUED','RUNNING','WAITING')`).bind(orderId).run();
  await env.DB.prepare(`UPDATE approvals SET status = 'EXPIRED', responded_at = ? WHERE project_id IN (SELECT id FROM projects WHERE order_id = ?) AND status = 'PENDING'`).bind(t, orderId).run();
}

export { REFUND_DAYS, cancelLink, handleOrderCancel, loadOrder, refundEligibility };
