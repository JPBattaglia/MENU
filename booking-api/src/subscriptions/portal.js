// Billing portal (stage 3): subscribers upgrade, switch to annual or cancel without the owner.
// Emails carry a signed "Manage your plan" link; opening it creates a Stripe Customer Portal session
// and redirects there. The link only identifies one subscription and expires after a year.
import { publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { jsonResponse } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { stripeRequest } from "../lib/stripe.js";
import { subscriptionEnvironment } from "./sync.js";

const PORTAL_LINK_TTL_DAYS = 365;

async function billingPortalLink(env, subscriptionId) {
  const token = await signLinkToken(env, { kind: "billing", id: subscriptionId, ttlDays: PORTAL_LINK_TTL_DAYS });
  return `${publicBaseUrl(env)}/api/billing-portal/${subscriptionId}?t=${encodeURIComponent(token)}`;
}

function messagePage(title, body, status) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#edf3f5;color:#102f3d;margin:0;padding:40px 16px;"><main style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dce8ec;padding:28px;">
<h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(title)}</h1><p style="line-height:1.6;margin:0;">${body}</p></main></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

// GET /api/billing-portal/<subscription id>?t=<signed token>  (POST works the same, returning JSON)
async function handleBillingPortal(request, env, subscriptionId) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") || (request.method === "POST" ? (await request.json().catch(() => ({})))?.token : null);
  const payload = await verifyLinkToken(env, token, ["billing"], subscriptionId);
  const asJson = request.method === "POST";
  if (!payload || payload.expired) {
    return asJson
      ? jsonResponse({ ok: false, error: payload?.expired ? "Link expired" : "Invalid link" }, 403)
      : messagePage("This link has expired", `Email <a href="mailto:info@menu-made.com">info@menu-made.com</a> and we'll send a fresh link to manage your plan.`, 403);
  }
  const subscription = await env.DB.prepare(`
      SELECT id, provider_customer_id FROM subscriptions WHERE id = ?
    `).bind(subscriptionId).first();
  if (!subscription) {
    return asJson ? jsonResponse({ ok: false, error: "Not found" }, 404) : messagePage("Plan not found", "We couldn't find this plan.", 404);
  }
  try {
    const environment = await subscriptionEnvironment(env, subscriptionId);
    const session = await stripeRequest(env, environment, "/v1/billing_portal/sessions", {
      method: "POST",
      params: { customer: subscription.provider_customer_id, return_url: `${publicBaseUrl(env)}/` }
    });
    return asJson ? jsonResponse({ ok: true, url: session.url }) : Response.redirect(session.url, 303);
  } catch (error) {
    console.error("Billing portal failed:", error?.message || error);
    return asJson
      ? jsonResponse({ ok: false, error: "The billing portal is not available right now" }, 502)
      : messagePage("Plan management is unavailable", `Please try again shortly, or email <a href="mailto:info@menu-made.com">info@menu-made.com</a>.`, 502);
  }
}

async function sendSubscriptionWelcome(env, subscription) {
  const customer = await env.DB.prepare(`SELECT email, first_name FROM customers WHERE id = ?`).bind(subscription.customerId).first();
  if (!customer?.email) return null;
  const key = `subscription-welcome/${subscription.id}`;
  const sent = await env.DB.prepare(`
      SELECT 1 FROM communications WHERE template_key = 'subscription_welcome_v1' AND status = 'SENT'
        AND json_extract(metadata_json, '$.idempotency_key') = ? LIMIT 1
    `).bind(key).first();
  if (sent) return { ok: true, duplicate: true };
  const manageUrl = await billingPortalLink(env, subscription.id);
  const annual = subscription.plan.interval === "YEAR";
  const price = `$${(subscription.plan.priceCents / 100).toFixed(subscription.plan.priceCents % 100 ? 2 : 0)}/${annual ? "year" : "month"}`;
  const includedNames = subscription.included.map((p) => p.offerName).join(", ");
  const trial = subscription.status === "TRIALING" && subscription.stripe?.trial_end
    ? new Date(subscription.stripe.trial_end * 1000).toISOString().slice(0, 10) : null;
  const paragraphs = [
    `Hi${customer.first_name ? ` ${escapeHtml(customer.first_name)}` : ""}, your ${escapeHtml(subscription.plan.offerName)} is active. We'll start this month's work for you right away.`,
    trial ? `It's included free until ${trial}; billing starts after that.` : `You'll be billed ${price} until you change or cancel your plan.`,
    "Use the button below anytime to update your card, switch between monthly and annual billing, or cancel."
  ];
  return sendTransactionalEmail(env, {
    to: customer.email,
    subject: `Your ${subscription.plan.offerName} is active`,
    html: brandedEmailHtml({
      preheader: `Your ${subscription.plan.offerName} is active.`,
      eyebrow: "PLAN ACTIVE",
      heading: `Welcome to your ${subscription.plan.offerName}`,
      paragraphs,
      rows: [["Plan", subscription.plan.offerName], ["Includes", includedNames], ["Billing", trial ? `Free until ${trial}, then ${price}` : price]],
      buttons: [{ label: "Manage your plan", url: manageUrl, primary: true }]
    }),
    text: `Your ${subscription.plan.offerName} is active.\nIncludes: ${includedNames}\nBilling: ${trial ? `free until ${trial}, then ${price}` : price}\nManage your plan: ${manageUrl}`,
    idempotencyKey: key,
    purpose: "SUBSCRIPTION_WELCOME",
    templateKey: "subscription_welcome_v1",
    context: { customerId: subscription.customerId, businessId: subscription.businessId },
    bccInternal: true
  });
}

export { billingPortalLink, handleBillingPortal, sendSubscriptionWelcome };
