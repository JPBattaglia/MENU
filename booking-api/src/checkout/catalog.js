import { jsonResponse, nowIso, parseJsonOrNull } from "../lib/http.js";

async function getPublicOffers(env) {
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
    const timestamp = nowIso();
    const result = await env.DB.prepare(`
          SELECT
            o.id AS offer_id,
            o.code,
            o.name,
            o.category,
            o.public_slug,
            o.description,
            o.short_description,
            o.sort_order,
            o.is_featured,
            o.cta_text,
            o.display_badge,
            o.billing_type,
            o.fulfillment_type,
            o.requires_approval,
            o.requires_assets,
            o.default_workflow_key,

            v.id AS offer_version_id,
            v.version_number,
            v.price_cents,
            v.currency,
            v.billing_interval,
            v.setup_fee_cents,
            v.scope_json,
            v.exclusions_json,
            v.required_inputs_json,
            v.revision_limit,
            v.estimated_manual_minutes

          FROM offers o

          JOIN offer_versions v
            ON v.offer_id = o.id

          WHERE
            o.status = 'ACTIVE'
            AND o.is_public = 1
            AND v.status = 'ACTIVE'

            AND (
              v.effective_from IS NULL
              OR v.effective_from <= ?
            )

            AND (
              v.effective_to IS NULL
              OR v.effective_to > ?
            )

          ORDER BY
            o.sort_order ASC,
            o.name ASC,
            v.version_number DESC
        `).bind(
      timestamp,
      timestamp
    ).all();
    const seenOffers = /* @__PURE__ */ new Set();
    const offers = [];
    for (const row of result.results || []) {
      if (seenOffers.has(
        row.offer_id
      )) {
        continue;
      }
      seenOffers.add(
        row.offer_id
      );
      offers.push({
        id: row.offer_id,
        code: row.code,
        slug: row.public_slug,
        name: row.name,
        category: row.category,
        description: row.description,
        short_description: row.short_description,
        sort_order: Number(
          row.sort_order || 0
        ),
        featured: Boolean(
          row.is_featured
        ),
        cta_text: row.cta_text || "Get Started",
        display_badge: row.display_badge,
        billing_type: row.billing_type,
        fulfillment_type: row.fulfillment_type,
        requires_approval: Boolean(
          row.requires_approval
        ),
        requires_assets: Boolean(
          row.requires_assets
        ),
        workflow_key: row.default_workflow_key,
        current_version: {
          id: row.offer_version_id,
          version_number: Number(
            row.version_number
          ),
          price_cents: Number(
            row.price_cents
          ),
          currency: String(
            row.currency || "USD"
          ).toUpperCase(),
          billing_interval: row.billing_interval,
          setup_fee_cents: row.setup_fee_cents === null ? null : Number(
            row.setup_fee_cents
          ),
          scope: parseJsonOrNull(
            row.scope_json
          ),
          exclusions: parseJsonOrNull(
            row.exclusions_json
          ),
          required_inputs: parseJsonOrNull(
            row.required_inputs_json
          ),
          revision_limit: row.revision_limit === null ? null : Number(
            row.revision_limit
          ),
          estimated_manual_minutes: row.estimated_manual_minutes === null ? null : Number(
            row.estimated_manual_minutes
          )
        }
      });
    }
    return jsonResponse({
      ok: true,
      count: offers.length,
      offers
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

async function resolveActiveOffer(identifier, env, options = {}) {
  const clean = String(identifier || "").trim();
  if (!clean) {
    return null;
  }
  const requirePublic = options.requirePublic !== false;
  const timestamp = nowIso();
  const row = await env.DB.prepare(`
        SELECT
          o.id AS offer_id,
          o.code AS offer_code,
          o.name AS offer_name,
          o.category,
          o.public_slug,
          o.default_workflow_key,

          v.id AS offer_version_id,
          v.version_number,
          v.price_cents,
          v.currency,
          v.stripe_price_id,
          v.stripe_product_id

        FROM offers o

        JOIN offer_versions v
          ON v.offer_id = o.id

        WHERE
          o.status = 'ACTIVE'

          AND (
            ? = 0
            OR o.is_public = 1
          )

          AND v.status = 'ACTIVE'

          AND (
            v.effective_from IS NULL
            OR v.effective_from <= ?
          )

          AND (
            v.effective_to IS NULL
            OR v.effective_to > ?
          )

          AND (
            lower(o.id) = lower(?)
            OR lower(o.code) = lower(?)
            OR (
              o.public_slug IS NOT NULL
              AND lower(o.public_slug) =
                lower(?)
            )
          )

        ORDER BY
          v.version_number DESC

        LIMIT 1
      `).bind(
    requirePublic ? 1 : 0,
    timestamp,
    timestamp,
    clean,
    clean,
    clean
  ).first();
  return row || null;
}

// Stage 9: what the revamped site shows. Every active, non-test offer with both billing intervals,
// what a plan or bundle includes, and on_sale (is_public). Pages read prices only from here, never
// hard-coded. Cached at the edge for 5 minutes to keep D1 reads low (free-tier read limit).
const SITE_HIDDEN = /^(ROUTING_SELFTEST_|M25_)/;

async function getSiteCatalog(env) {
  try {
    if (!env.DB) return jsonResponse({ ok: false, error: "D1 binding DB is not available" }, 500);
    const timestamp = nowIso();
    const { results = [] } = await env.DB.prepare(`
        SELECT o.code, o.name, o.short_description, o.billing_type, o.is_public, o.sort_order,
               v.billing_interval, v.price_cents, v.currency, v.scope_json, v.version_number
        FROM offers o JOIN offer_versions v ON v.offer_id = o.id
        WHERE o.status = 'ACTIVE' AND v.status = 'ACTIVE'
          AND (v.effective_from IS NULL OR v.effective_from <= ?)
          AND (v.effective_to IS NULL OR v.effective_to > ?)
        ORDER BY o.sort_order ASC, o.code ASC, v.version_number DESC
      `).bind(timestamp, timestamp).all();
    const byCode = new Map();
    for (const row of results) {
      if (SITE_HIDDEN.test(row.code)) continue;
      let offer = byCode.get(row.code);
      const scope = parseJsonOrNull(row.scope_json) || {};
      if (!offer) {
        const recurring = row.billing_type === "RECURRING";
        offer = {
          code: row.code,
          name: row.name,
          short_description: row.short_description || null,
          kind: recurring ? (scope.kind === "BUNDLE" ? "BUNDLE" : "PLAN") : "ONE_TIME",
          on_sale: Boolean(row.is_public),
          currency: String(row.currency || "USD").toUpperCase(),
          ...(recurring
            ? { prices: {}, includes: Array.isArray(scope.includes) ? scope.includes : [row.code], requires_setup: scope.requires_setup || null }
            : { price_cents: Number(row.price_cents) })
        };
        byCode.set(row.code, offer);
      }
      if (offer.prices) {
        const key = row.billing_interval === "YEAR" ? "year" : "month";
        if (offer.prices[key] === undefined) offer.prices[key] = Number(row.price_cents);
      }
    }
    const response = jsonResponse({ ok: true, offers: [...byCode.values()] });
    response.headers.set("Cache-Control", "public, max-age=300");
    return response;
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export {
  getSiteCatalog,
  getPublicOffers,
  resolveActiveOffer
};
