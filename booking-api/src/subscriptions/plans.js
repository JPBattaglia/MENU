// Plans and bundles as stored in offers / offer_versions (built from subscription-catalog.json).
// Version 1 of a recurring offer bills monthly and version 2 annually; scope_json says what it includes.
import { nowIso, parseJsonOrNull } from "../lib/http.js";

const INTERVALS = { month: "MONTH", monthly: "MONTH", year: "YEAR", annual: "YEAR", yearly: "YEAR" };

function normalizeInterval(value) {
  return INTERVALS[String(value || "month").trim().toLowerCase()] || null;
}

function toPlan(row) {
  if (!row) return null;
  const scope = parseJsonOrNull(row.scope_json) || {};
  return {
    offerId: row.offer_id,
    offerCode: row.offer_code,
    offerName: row.offer_name,
    offerVersionId: row.offer_version_id,
    isPublic: Boolean(row.is_public),
    interval: row.billing_interval,
    priceCents: Number(row.price_cents),
    currency: String(row.currency || "USD").toUpperCase(),
    stripePriceId: row.stripe_price_id || null,
    stripeProductId: row.stripe_product_id || null,
    kind: scope.kind || "PLAN",
    includes: Array.isArray(scope.includes) && scope.includes.length ? scope.includes : [row.offer_code],
    requiresSetup: scope.requires_setup || null
  };
}

const PLAN_SELECT = `
  SELECT o.id AS offer_id, o.code AS offer_code, o.name AS offer_name, o.is_public,
         v.id AS offer_version_id, v.billing_interval, v.price_cents, v.currency, v.scope_json,
         v.stripe_price_id, v.stripe_product_id
  FROM offers o JOIN offer_versions v ON v.offer_id = o.id
  WHERE o.billing_type = 'RECURRING' AND v.status = 'ACTIVE'`;

// A sellable plan or bundle for an interval. requirePublic stays true for live checkout.
async function resolvePlan(identifier, interval, env, { requirePublic = true, activeOnly = true } = {}) {
  const clean = String(identifier || "").trim();
  if (!clean || !interval) return null;
  const now = nowIso();
  const row = await env.DB.prepare(`${PLAN_SELECT}
      AND (? = 0 OR o.status = 'ACTIVE')
      AND (? = 0 OR o.is_public = 1)
      AND v.billing_interval = ?
      AND (v.effective_from IS NULL OR v.effective_from <= ?)
      AND (v.effective_to IS NULL OR v.effective_to > ?)
      AND (lower(o.id) = lower(?) OR lower(o.code) = lower(?) OR lower(COALESCE(o.public_slug, '')) = lower(?))
      ORDER BY v.version_number DESC LIMIT 1`)
    .bind(activeOnly ? 1 : 0, requirePublic ? 1 : 0, interval, now, now, clean, clean, clean).first();
  return toPlan(row);
}

// Maps a Stripe recurring price back to a plan: the live price ID first, then the plan code that sandbox
// checkouts put on the product, then the subscription's own metadata.
async function planForStripePrice(price, fallbackCode, env) {
  const interval = price?.recurring?.interval === "year" ? "YEAR" : "MONTH";
  if (price?.id) {
    const row = await env.DB.prepare(`${PLAN_SELECT} AND v.stripe_price_id = ? LIMIT 1`).bind(price.id).first();
    if (row) return toPlan(row);
  }
  const productCode = typeof price?.product === "object" ? price.product?.metadata?.plan_code : null;
  for (const code of [productCode, fallbackCode]) {
    if (!code) continue;
    const plan = await resolvePlan(code, interval, env, { requirePublic: false, activeOnly: false });
    if (plan) return plan;
  }
  return null;
}

// The offer version of an included plan, used for each period's order item (same interval as the subscription).
async function includedPlanVersions(plan, env) {
  const out = [];
  for (const code of plan.includes) {
    const included = code === plan.offerCode ? plan : await resolvePlan(code, plan.interval, env, { requirePublic: false, activeOnly: false });
    if (!included) throw new Error(`${plan.offerCode} includes ${code}, which has no ${plan.interval} offer version`);
    const workflow = await env.DB.prepare(`SELECT default_workflow_key FROM offers WHERE id = ?`).bind(included.offerId).first();
    out.push({ ...included, workflowKey: workflow?.default_workflow_key });
  }
  return out;
}

export { normalizeInterval, resolvePlan, planForStripePrice, includedPlanVersions };
