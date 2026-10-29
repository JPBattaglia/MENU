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
        if (!item.menuPackage && !item.inlinePrice && !item.stripePriceId) {
          return jsonResponse({ ok: false, error: `No live Stripe price is configured for ${item.offerCode}` }, 500);
        }
      }
    }
    if (cart.plan && !normalizeName(data?.customer?.business || data?.business)) {
      return jsonResponse({ ok: false, error: "Business name is required for a monthly plan" }, 400);
    }
    // Orders started on ninobattaglia.com (Nino design services) return there after Stripe.
    const returnTo = data?.return_to === "nino" ? "nino" : null;
    if (returnTo) for (const item of normalizedItems) item.extraMetadata = { ...(item.extraMetadata || {}), return_to: returnTo };
    const orderItems = cart.plan ? [...normalizedItems, cart.orderItem()] : normalizedItems;
    const pending = await createPendingOrder(data, orderItems, env, environment);
    pending.returnTo = returnTo;
    if (!pending.ok) {
      return jsonResponse({ ok: false, error: pending.error }, pending.status);
    }
    const opened = await openStripeSession(env, environment, { cart, normalizedItems, orderItems, pending, tracking: data?.tracking || {} });
    if (!opened.ok) {
      return jsonResponse({ ok: false, order_id: pending.orderId, stripe_error: opened.stripeError }, opened.status);
    }
    return jsonResponse({
      ok: true,
      environment,
      order_id: pending.orderId,
      url: opened.url,
      ...(cart.plan ? { mode: "subscription", plan: cart.plan.offerCode, interval: cart.plan.interval } : {})
    });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      error instanceof CheckoutValidationError ? error.status : 500
    );
  }
}

// Builds the Stripe Checkout Session for an order that already exists (new checkouts, and the abandoned-checkout
// "Finish checkout" link, which reopens the same order so its uploaded menu and notes carry over).
async function openStripeSession(env, environment, { cart, normalizedItems, orderItems, pending, tracking = {}, resumed = false }) {
    const params = new URLSearchParams();
    params.append("mode", cart.plan ? "subscription" : "payment");
    if (pending.returnTo === "nino") {
      params.append("success_url", `https://ninobattaglia.com/design-thanks.html?order_id=${encodeURIComponent(pending.orderId)}`);
      params.append("cancel_url", "https://ninobattaglia.com/services.html#design-services");
    } else {
      params.append("success_url", `https://menu-made.com/checkoutsuccess.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(pending.orderId)}`);
      params.append("cancel_url", "https://menu-made.com/checkoutcancel.html");
    }
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
    if (resumed) params.append("metadata[resumed]", "1");
    let stripeData;
    try {
      stripeData = await stripeRequest(env, environment, "/v1/checkout/sessions", { method: "POST", params });
    } catch (stripeError) {
      // A failed reopen leaves the order as it was (still payable from a later click); a failed first open closes it.
      if (!resumed) {
        await env.DB.prepare(`
            UPDATE orders SET status = 'FAILED', payment_status = 'FAILED', updated_at = ? WHERE id = ?
          `).bind(nowIso(), pending.orderId).run();
      }
      return { ok: false, status: stripeError.status || 500, stripeError: stripeError.body || stripeError.message };
    }
    if (!stripeData?.url) {
      if (!resumed) {
        await env.DB.prepare(`
            UPDATE orders SET status = 'FAILED', payment_status = 'FAILED', updated_at = ? WHERE id = ?
          `).bind(nowIso(), pending.orderId).run();
      }
      return { ok: false, status: 500, stripeError: stripeData };
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
        metadata: { environment, stripe_checkout_session_id: stripeData.id, ...(resumed ? { resumed: true } : {}) }
      });
    }
    return { ok: true, url: stripeData.url, sessionId: stripeData.id };
}

function createCheckoutSessionTest(request, env) {
  return createCheckout(request, env, "sandbox");
}

function createCheckoutSession(request, env) {
  return createCheckout(request, env, "live");
}

export {
  openStripeSession,
  createCheckout,
  createCheckoutSessionTest,
  createCheckoutSession
};
