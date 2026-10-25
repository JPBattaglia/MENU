import { insertFunnelEvent } from "./funnel.js";
import { createPendingOrder } from "./orders.js";
import { CheckoutValidationError, appendCheckoutLineItem, normalizeCheckoutItems } from "./quote.js";
import { jsonResponse, normalizeName, normalizeNullableText, nowIso } from "../lib/http.js";
import { stripeRequest } from "../lib/stripe.js";
import { buildSubscriptionCart, appendSubscriptionParams } from "../subscriptions/checkout.js";

// One checkout for both environments. "sandbox" uses the Stripe test key and inline prices;
// "live" uses the live key and the catalog's live price IDs. A cart with a plan or bundle
// becomes a subscription-mode session (stage 3); anything else stays a one-time payment.
async function createCheckout(request, env, environment) {
  const live = environment === "live";
  try {
    if (!env.DB) {
      return jsonResponse({ ok: false, error: "D1 binding DB is not available" }, 500);
    }
    if (live ? !env.STRIPE_SECRET_KEY : !env.STRIPE_SECRET_KEY_TEST) {
      return jsonResponse({ ok: false, error: live ? "Stripe live secret key is not configured" : "Stripe sandbox secret key is not configured" }, 500);
    }
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
    }
    const itemsInput = Array.isArray(data?.items) ? data.items : [];
    // Plans and bundles are split out first; everything else goes through the one-time catalog.
    const cart = await buildSubscriptionCart(itemsInput, data, env, environment);
    const normalizedItems = await normalizeCheckoutItems(cart.oneTimeInputs, env, data, { requirePublic: live });
    cart.validateSetups(normalizedItems);
    if (normalizedItems.length === 0 && !cart.plan) {
      return jsonResponse({ ok: false, error: "No valid active public offers selected" }, 400);
    }
    if (live) {
      for (const item of normalizedItems) {
        if (!item.menuPackage && !item.stripePriceId) {
          return jsonResponse({ ok: false, error: `No live Stripe price is configured for ${item.offerCode}` }, 500);
        }
      }
    }
    if (cart.plan && !normalizeName(data?.customer?.business || data?.business)) {
      return jsonResponse({ ok: false, error: "Business name is required for a monthly plan" }, 400);
    }
    const orderItems = cart.plan ? [...normalizedItems, cart.orderItem()] : normalizedItems;
    const pending = await createPendingOrder(data, orderItems, env, environment);
    if (!pending.ok) {
      return jsonResponse({ ok: false, error: pending.error }, pending.status);
    }
    const tracking = data?.tracking || {};
    const params = new URLSearchParams();
    params.append("mode", cart.plan ? "subscription" : "payment");
    params.append("success_url", `https://menu-made.com/checkoutsuccess.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(pending.orderId)}`);
    params.append("cancel_url", "https://menu-made.com/checkoutcancel.html");
    if (cart.stripeCustomerId) {
      params.append("customer", cart.stripeCustomerId);
    } else {
      params.append("customer_email", pending.email);
    }
    params.append("metadata[order_id]", pending.orderId);
    params.append("metadata[environment]", environment);
    params.append("metadata[name]", pending.name);
    params.append("metadata[business]", pending.businessName);
    params.append("metadata[email]", pending.email);
    params.append("metadata[phone]", pending.phone);
    params.append("metadata[notes]", pending.notes);
    params.append("metadata[services]", orderItems.map((item) => item.offerName).join(", "));
    if (tracking.visitor_id) params.append("metadata[visitor_id]", String(tracking.visitor_id));
    if (tracking.session_id) params.append("metadata[visitor_session_id]", String(tracking.session_id));
    if (tracking.source) params.append("metadata[source]", String(tracking.source));
    if (tracking.medium) params.append("metadata[medium]", String(tracking.medium));
    if (tracking.campaign) params.append("metadata[campaign]", String(tracking.campaign));
    normalizedItems.forEach((item, index) => appendCheckoutLineItem(params, item, index, environment));
    if (cart.plan) {
      appendSubscriptionParams(params, cart, normalizedItems.length, environment, pending);
    }
    let stripeData;
    try {
      stripeData = await stripeRequest(env, environment, "/v1/checkout/sessions", { method: "POST", params });
    } catch (stripeError) {
      await env.DB.prepare(`
          UPDATE orders SET status = 'FAILED', payment_status = 'FAILED', updated_at = ? WHERE id = ?
        `).bind(nowIso(), pending.orderId).run();
      return jsonResponse({ ok: false, order_id: pending.orderId, stripe_error: stripeError.body || stripeError.message }, stripeError.status || 500);
    }
    if (!stripeData?.url) {
      await env.DB.prepare(`
          UPDATE orders SET status = 'FAILED', payment_status = 'FAILED', updated_at = ? WHERE id = ?
        `).bind(nowIso(), pending.orderId).run();
      return jsonResponse({ ok: false, order_id: pending.orderId, stripe_error: stripeData }, 500);
    }
    await env.DB.prepare(`
        UPDATE orders SET stripe_checkout_session_id = ?, updated_at = ? WHERE id = ?
      `).bind(stripeData.id, nowIso(), pending.orderId).run();
    for (const item of orderItems) {
      await insertFunnelEvent(env, {
        event_type: "CHECKOUT_STARTED",
        visitor_id: normalizeNullableText(tracking.visitor_id),
        session_id: normalizeNullableText(tracking.session_id),
        offer_id: item.offerId,
        offer_version_id: item.offerVersionId,
        order_id: pending.orderId,
        source: normalizeNullableText(tracking.source),
        medium: normalizeNullableText(tracking.medium),
        campaign: normalizeNullableText(tracking.campaign),
        referrer: normalizeNullableText(tracking.referrer),
        landing_path: normalizeNullableText(tracking.landing_path),
        metadata: { environment, stripe_checkout_session_id: stripeData.id }
      });
    }
    return jsonResponse({
      ok: true,
      environment,
      order_id: pending.orderId,
      url: stripeData.url,
      ...(cart.plan ? { mode: "subscription", plan: cart.plan.offerCode, interval: cart.plan.interval } : {})
    });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      error instanceof CheckoutValidationError ? error.status : 500
    );
  }
}

function createCheckoutSessionTest(request, env) {
  return createCheckout(request, env, "sandbox");
}

function createCheckoutSession(request, env) {
  return createCheckout(request, env, "live");
}

export {
  createCheckout,
  createCheckoutSessionTest,
  createCheckoutSession
};
