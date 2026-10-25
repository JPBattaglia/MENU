import { resolveActiveOffer } from "./catalog.js";
import { jsonResponse, normalizeNullableText, nowIso } from "../lib/http.js";

async function recordFunnelEvent(request, env) {
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
    const allowedEvents = /* @__PURE__ */ new Set([
      "SITE_VISIT",
      "OFFER_VIEW",
      "CTA_CLICK",
      "CHECKOUT_STARTED",
      "PURCHASE_COMPLETED"
    ]);
    const eventType = String(
      data?.event_type || ""
    ).trim().toUpperCase();
    if (!allowedEvents.has(
      eventType
    )) {
      return jsonResponse(
        {
          ok: false,
          error: "Unsupported funnel event type"
        },
        400
      );
    }
    let offerId = normalizeNullableText(
      data?.offer_id
    );
    let offerVersionId = normalizeNullableText(
      data?.offer_version_id
    );
    const offerIdentifier = normalizeNullableText(
      data?.offer || data?.offer_code || data?.offer_slug
    );
    if (!offerId && offerIdentifier) {
      const offer = await resolveActiveOffer(
        offerIdentifier,
        env
      );
      if (!offer) {
        return jsonResponse(
          {
            ok: false,
            error: "Offer not found or not currently active"
          },
          404
        );
      }
      offerId = offer.offer_id;
      offerVersionId = offer.offer_version_id;
    }
    const eventId = crypto.randomUUID();
    await env.DB.prepare(`
        INSERT INTO funnel_events (
          id,
          created_at,
          event_type,
          visitor_id,
          session_id,
          offer_id,
          offer_version_id,
          order_id,
          source,
          medium,
          campaign,
          referrer,
          landing_path,
          metadata_json
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
      `).bind(
      eventId,
      nowIso(),
      eventType,
      normalizeNullableText(
        data?.visitor_id
      ),
      normalizeNullableText(
        data?.session_id
      ),
      offerId,
      offerVersionId,
      normalizeNullableText(
        data?.order_id
      ),
      normalizeNullableText(
        data?.source
      ),
      normalizeNullableText(
        data?.medium
      ),
      normalizeNullableText(
        data?.campaign
      ),
      normalizeNullableText(
        data?.referrer
      ),
      normalizeNullableText(
        data?.landing_path
      ),
      data?.metadata ? JSON.stringify(
        data.metadata
      ) : null
    ).run();
    return jsonResponse({
      ok: true,
      event_id: eventId,
      event_type: eventType
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

async function insertFunnelEvent(env, data) {
  if (!env.DB) {
    return;
  }
  await env.DB.prepare(`
      INSERT INTO funnel_events (
        id,
        created_at,
        event_type,
        visitor_id,
        session_id,
        offer_id,
        offer_version_id,
        order_id,
        source,
        medium,
        campaign,
        referrer,
        landing_path,
        metadata_json
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `).bind(
    crypto.randomUUID(),
    nowIso(),
    data.event_type,
    data.visitor_id || null,
    data.session_id || null,
    data.offer_id || null,
    data.offer_version_id || null,
    data.order_id || null,
    data.source || null,
    data.medium || null,
    data.campaign || null,
    data.referrer || null,
    data.landing_path || null,
    data.metadata ? JSON.stringify(
      data.metadata
    ) : null
  ).run();
}

export {
  recordFunnelEvent,
  insertFunnelEvent
};
