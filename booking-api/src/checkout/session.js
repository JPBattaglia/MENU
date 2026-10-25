import { insertFunnelEvent } from "./funnel.js";
import { createPendingOrder } from "./orders.js";
import { CheckoutValidationError, appendCheckoutLineItem, normalizeCheckoutItems } from "./quote.js";
import { jsonResponse, normalizeNullableText, nowIso } from "../lib/http.js";

async function createCheckoutSessionTest(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    if (!env.STRIPE_SECRET_KEY_TEST) {
      return jsonResponse(
        {
          ok: false,
          error: "Stripe sandbox secret key is not configured"
        },
        500
      );
    }
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body"
        },
        400
      );
    }
    const itemsInput = Array.isArray(data?.items) ? data.items : [];
    const normalizedItems = await normalizeCheckoutItems(
      itemsInput,
      env,
      data
    );
    if (normalizedItems.length === 0) {
      return jsonResponse(
        {
          ok: false,
          error: "No valid active public offers selected"
        },
        400
      );
    }
    const pending = await createPendingOrder(
      data,
      normalizedItems,
      env,
      "sandbox"
    );
    if (!pending.ok) {
      return jsonResponse(
        {
          ok: false,
          error: pending.error
        },
        pending.status
      );
    }
    const tracking = data?.tracking || {};
    const params = new URLSearchParams();
    params.append(
      "mode",
      "payment"
    );
    params.append(
      "success_url",
      `https://menu-made.com/checkoutsuccess.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(pending.orderId)}`
    );
    params.append(
      "cancel_url",
      "https://menu-made.com/checkoutcancel.html"
    );
    params.append(
      "customer_email",
      pending.email
    );
    params.append(
      "metadata[order_id]",
      pending.orderId
    );
    params.append(
      "metadata[environment]",
      "sandbox"
    );
    params.append(
      "metadata[name]",
      pending.name
    );
    params.append(
      "metadata[business]",
      pending.businessName
    );
    params.append(
      "metadata[email]",
      pending.email
    );
    params.append(
      "metadata[phone]",
      pending.phone
    );
    params.append(
      "metadata[notes]",
      pending.notes
    );
    params.append(
      "metadata[services]",
      normalizedItems.map(
        (item) => item.offerName
      ).join(", ")
    );
    if (tracking.visitor_id) {
      params.append(
        "metadata[visitor_id]",
        String(
          tracking.visitor_id
        )
      );
    }
    if (tracking.session_id) {
      params.append(
        "metadata[visitor_session_id]",
        String(
          tracking.session_id
        )
      );
    }
    if (tracking.source) {
      params.append(
        "metadata[source]",
        String(
          tracking.source
        )
      );
    }
    if (tracking.medium) {
      params.append(
        "metadata[medium]",
        String(
          tracking.medium
        )
      );
    }
    if (tracking.campaign) {
      params.append(
        "metadata[campaign]",
        String(
          tracking.campaign
        )
      );
    }
    normalizedItems.forEach((item, index) => appendCheckoutLineItem(params, item, index, "sandbox"));
    const stripeRes = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY_TEST}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      }
    );
    const stripeData = await stripeRes.json();
    if (!stripeRes.ok || !stripeData.url) {
      await env.DB.prepare(`
          UPDATE orders
          SET
            status = 'FAILED',
            payment_status = 'FAILED',
            updated_at = ?
          WHERE id = ?
        `).bind(
        nowIso(),
        pending.orderId
      ).run();
      return jsonResponse(
        {
          ok: false,
          order_id: pending.orderId,
          stripe_error: stripeData
        },
        stripeRes.status || 500
      );
    }
    await env.DB.prepare(`
        UPDATE orders
        SET
          stripe_checkout_session_id = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
      stripeData.id,
      nowIso(),
      pending.orderId
    ).run();
    for (const item of normalizedItems) {
      await insertFunnelEvent(
        env,
        {
          event_type: "CHECKOUT_STARTED",
          visitor_id: normalizeNullableText(
            tracking.visitor_id
          ),
          session_id: normalizeNullableText(
            tracking.session_id
          ),
          offer_id: item.offerId,
          offer_version_id: item.offerVersionId,
          order_id: pending.orderId,
          source: normalizeNullableText(
            tracking.source
          ),
          medium: normalizeNullableText(
            tracking.medium
          ),
          campaign: normalizeNullableText(
            tracking.campaign
          ),
          referrer: normalizeNullableText(
            tracking.referrer
          ),
          landing_path: normalizeNullableText(
            tracking.landing_path
          ),
          metadata: {
            environment: "sandbox",
            stripe_checkout_session_id: stripeData.id
          }
        }
      );
    }
    return jsonResponse({
      ok: true,
      environment: "sandbox",
      order_id: pending.orderId,
      url: stripeData.url
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      error instanceof CheckoutValidationError ? error.status : 500
    );
  }
}

async function createCheckoutSession(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    if (!env.STRIPE_SECRET_KEY) {
      return jsonResponse(
        {
          ok: false,
          error: "Stripe live secret key is not configured"
        },
        500
      );
    }
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body"
        },
        400
      );
    }
    const itemsInput = Array.isArray(data?.items) ? data.items : [];
    const normalizedItems = await normalizeCheckoutItems(
      itemsInput,
      env,
      data
    );
    if (normalizedItems.length === 0) {
      return jsonResponse(
        {
          ok: false,
          error: "No valid active public offers selected"
        },
        400
      );
    }
    for (const item of normalizedItems) {
      if (!item.menuPackage && !item.stripePriceId) {
        return jsonResponse(
          {
            ok: false,
            error: `No live Stripe price is configured for ${item.offerCode}`
          },
          500
        );
      }
    }
    const pending = await createPendingOrder(
      data,
      normalizedItems,
      env,
      "live"
    );
    if (!pending.ok) {
      return jsonResponse(
        {
          ok: false,
          error: pending.error
        },
        pending.status
      );
    }
    const tracking = data?.tracking || {};
    const params = new URLSearchParams();
    params.append(
      "mode",
      "payment"
    );
    params.append(
      "success_url",
      `https://menu-made.com/checkoutsuccess.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(pending.orderId)}`
    );
    params.append(
      "cancel_url",
      "https://menu-made.com/checkoutcancel.html"
    );
    params.append(
      "customer_email",
      pending.email
    );
    params.append(
      "metadata[order_id]",
      pending.orderId
    );
    params.append(
      "metadata[environment]",
      "live"
    );
    params.append(
      "metadata[name]",
      pending.name
    );
    params.append(
      "metadata[business]",
      pending.businessName
    );
    params.append(
      "metadata[email]",
      pending.email
    );
    params.append(
      "metadata[phone]",
      pending.phone
    );
    params.append(
      "metadata[notes]",
      pending.notes
    );
    params.append(
      "metadata[services]",
      normalizedItems.map(
        (item) => item.offerName
      ).join(", ")
    );
    if (tracking.visitor_id) {
      params.append(
        "metadata[visitor_id]",
        String(
          tracking.visitor_id
        )
      );
    }
    if (tracking.session_id) {
      params.append(
        "metadata[visitor_session_id]",
        String(
          tracking.session_id
        )
      );
    }
    if (tracking.source) {
      params.append(
        "metadata[source]",
        String(
          tracking.source
        )
      );
    }
    if (tracking.medium) {
      params.append(
        "metadata[medium]",
        String(
          tracking.medium
        )
      );
    }
    if (tracking.campaign) {
      params.append(
        "metadata[campaign]",
        String(
          tracking.campaign
        )
      );
    }
    normalizedItems.forEach((item, index) => appendCheckoutLineItem(params, item, index, "live"));
    const stripeRes = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      }
    );
    const stripeData = await stripeRes.json();
    if (!stripeRes.ok || !stripeData.url) {
      await env.DB.prepare(`
          UPDATE orders
          SET
            status = 'FAILED',
            payment_status = 'FAILED',
            updated_at = ?
          WHERE id = ?
        `).bind(
        nowIso(),
        pending.orderId
      ).run();
      return jsonResponse(
        {
          ok: false,
          order_id: pending.orderId,
          stripe_error: stripeData
        },
        stripeRes.status || 500
      );
    }
    await env.DB.prepare(`
        UPDATE orders
        SET
          stripe_checkout_session_id = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
      stripeData.id,
      nowIso(),
      pending.orderId
    ).run();
    for (const item of normalizedItems) {
      await insertFunnelEvent(
        env,
        {
          event_type: "CHECKOUT_STARTED",
          visitor_id: normalizeNullableText(
            tracking.visitor_id
          ),
          session_id: normalizeNullableText(
            tracking.session_id
          ),
          offer_id: item.offerId,
          offer_version_id: item.offerVersionId,
          order_id: pending.orderId,
          source: normalizeNullableText(
            tracking.source
          ),
          medium: normalizeNullableText(
            tracking.medium
          ),
          campaign: normalizeNullableText(
            tracking.campaign
          ),
          referrer: normalizeNullableText(
            tracking.referrer
          ),
          landing_path: normalizeNullableText(
            tracking.landing_path
          ),
          metadata: {
            environment: "live",
            stripe_checkout_session_id: stripeData.id
          }
        }
      );
    }
    return jsonResponse({
      ok: true,
      environment: "live",
      order_id: pending.orderId,
      url: stripeData.url
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      error instanceof CheckoutValidationError ? error.status : 500
    );
  }
}

export {
  createCheckoutSessionTest,
  createCheckoutSession
};
