// Mirrors a Stripe subscription into `subscriptions` and its `entitlements` (one per included plan).
// Every webhook and the daily reconciliation go through syncSubscription, so the row always reflects
// what Stripe says now, whatever order events arrive in. Safe to run any number of times.
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { stripeRequest } from "../lib/stripe.js";
import { sha256Hex } from "../lib/util.js";
import { includedPlanVersions, planForStripePrice } from "./plans.js";

// A subscription that did not come from a menu-made checkout (no order to attach it to).
class ForeignSubscriptionError extends Error {}

const STATUS = {
  incomplete: "INCOMPLETE",
  incomplete_expired: "EXPIRED",
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELLED",
  unpaid: "UNPAID",
  paused: "PAUSED"
};
const PRODUCING = new Set(["ACTIVE", "TRIALING"]);
const ENDED = new Set(["CANCELLED", "EXPIRED"]);

// Deterministic UUID-shaped ids, so a replayed event or a second pass writes the same rows.
async function stableId(kind, ...parts) {
  const hex = await sha256Hex(`${kind}:${parts.join(":")}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const isoFromUnix = (seconds) => Number.isFinite(Number(seconds)) && seconds ? new Date(Number(seconds) * 1000).toISOString() : null;

function entitlementStatus(subscriptionStatus) {
  if (PRODUCING.has(subscriptionStatus)) return "ACTIVE";
  if (ENDED.has(subscriptionStatus)) return "EXPIRED";
  return "SUSPENDED";
}

// API versions from 2025-03 on keep billing periods on the subscription item; older ones on the subscription.
function periodOf(subscription) {
  const item = subscription?.items?.data?.[0] || {};
  return {
    start: isoFromUnix(item.current_period_start ?? subscription.current_period_start),
    end: isoFromUnix(item.current_period_end ?? subscription.current_period_end)
  };
}

async function fetchStripeSubscription(env, environment, stripeSubscriptionId) {
  return stripeRequest(env, environment, `/v1/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`, {
    params: [["expand[]", "items.data.price.product"]]
  });
}

async function findOwner(subscription, env) {
  const orderId = subscription?.metadata?.order_id;
  if (orderId) {
    const order = await env.DB.prepare(`SELECT id, customer_id, business_id FROM orders WHERE id = ?`).bind(orderId).first();
    if (order) return order;
  }
  const existing = await env.DB.prepare(`
      SELECT customer_id, business_id FROM subscriptions WHERE provider = 'STRIPE' AND provider_subscription_id = ?
    `).bind(subscription.id).first();
  return existing ? { id: null, ...existing } : null;
}

async function syncSubscription(env, environment, stripeSubscriptionId, { overrideStatus = null } = {}) {
  const stripeSub = await fetchStripeSubscription(env, environment, stripeSubscriptionId);
  const owner = await findOwner(stripeSub, env);
  if (!owner) throw new ForeignSubscriptionError(`Subscription ${stripeSub.id} has no matching order (metadata.order_id ${stripeSub?.metadata?.order_id || "missing"})`);
  if (!owner.business_id) throw new Error(`Subscription ${stripeSub.id} order has no business`);
  const item = stripeSub.items?.data?.[0];
  const plan = await planForStripePrice(item?.price, stripeSub?.metadata?.plan_code, env);
  if (!plan) throw new Error(`Subscription ${stripeSub.id} uses a price that matches no plan (${item?.price?.id || "none"})`);
  const status = overrideStatus || STATUS[stripeSub.status] || "INCOMPLETE";
  const period = periodOf(stripeSub);
  const now = nowIso();
  const subscriptionId = await stableId("subscription", stripeSub.id);
  const previous = await env.DB.prepare(`SELECT status, offer_id FROM subscriptions WHERE id = ?`).bind(subscriptionId).first();
  const providerCustomerId = typeof stripeSub.customer === "object" ? stripeSub.customer?.id : stripeSub.customer;
  const amountCents = Number(item?.price?.unit_amount ?? plan.priceCents) * Number(item?.quantity || 1);
  await env.DB.prepare(`
      INSERT INTO subscriptions (
        id, customer_id, business_id, offer_id, offer_version_id, provider, provider_subscription_id, provider_customer_id,
        status, billing_interval, amount_cents, currency, current_period_start, current_period_end, cancel_at_period_end,
        started_at, cancelled_at, ended_at, trial_ends_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'STRIPE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET
        offer_id = excluded.offer_id,
        offer_version_id = excluded.offer_version_id,
        provider_customer_id = excluded.provider_customer_id,
        status = excluded.status,
        billing_interval = excluded.billing_interval,
        amount_cents = excluded.amount_cents,
        currency = excluded.currency,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        cancelled_at = excluded.cancelled_at,
        ended_at = excluded.ended_at,
        trial_ends_at = excluded.trial_ends_at,
        updated_at = excluded.updated_at
    `).bind(
    subscriptionId, owner.customer_id, owner.business_id, plan.offerId, plan.offerVersionId, stripeSub.id, providerCustomerId,
    status, plan.interval, amountCents, String(stripeSub.currency || plan.currency).toUpperCase(), period.start, period.end,
    stripeSub.cancel_at_period_end ? 1 : 0, isoFromUnix(stripeSub.start_date) || now, isoFromUnix(stripeSub.canceled_at),
    isoFromUnix(stripeSub.ended_at), isoFromUnix(stripeSub.trial_end), now, now
  ).run();

  // Entitlements: one per included plan; plans dropped by an upgrade or downgrade expire.
  const included = await includedPlanVersions(plan, env);
  const entStatus = entitlementStatus(status);
  const keep = [];
  for (const version of included) {
    const entitlementId = await stableId("entitlement", subscriptionId, version.offerCode);
    keep.push(entitlementId);
    await env.DB.prepare(`
        INSERT INTO entitlements (
          id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, ends_at,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          status = excluded.status,
          ends_at = excluded.ends_at,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).bind(
      entitlementId, owner.customer_id, owner.business_id, subscriptionId, version.offerCode, entStatus,
      period.start || now, ENDED.has(status) ? (isoFromUnix(stripeSub.ended_at) || now) : null,
      JSON.stringify({
        environment,
        offer_id: version.offerId,
        offer_version_id: version.offerVersionId,
        workflow_key: version.workflowKey,
        via_plan: plan.offerCode
      }),
      now, now
    ).run();
  }
  const placeholders = keep.map(() => "?").join(", ");
  await env.DB.prepare(`
      UPDATE entitlements SET status = 'EXPIRED', ends_at = COALESCE(ends_at, ?), updated_at = ?
      WHERE subscription_id = ? AND status != 'EXPIRED' AND id NOT IN (${placeholders})
    `).bind(now, now, subscriptionId, ...keep).run();

  await env.DB.prepare(`
      UPDATE customers SET stripe_customer_id = COALESCE(stripe_customer_id, ?), updated_at = ? WHERE id = ?
    `).bind(environment === "live" ? providerCustomerId : null, now, owner.customer_id).run();

  if (!previous || previous.status !== status || previous.offer_id !== plan.offerId) {
    await env.DB.prepare(`
        INSERT INTO business_events (id, created_at, event_type, entity_type, entity_id, actor_type, actor_id, correlation_id, payload_json)
        VALUES (?, ?, 'SUBSCRIPTION_SYNCED', 'SUBSCRIPTION', ?, 'PROVIDER', 'STRIPE', ?, ?)
      `).bind(crypto.randomUUID(), now, subscriptionId, stripeSub.id, JSON.stringify({
      from: previous?.status || null, to: status, plan: plan.offerCode, interval: plan.interval, environment
    })).run();
  }
  return {
    id: subscriptionId,
    stripeSubscriptionId: stripeSub.id,
    providerCustomerId,
    customerId: owner.customer_id,
    businessId: owner.business_id,
    status,
    previousStatus: previous?.status || null,
    plan,
    included,
    period,
    environment,
    stripe: stripeSub
  };
}

// The environment a stored subscription belongs to (kept on its entitlements).
async function subscriptionEnvironment(env, subscriptionId) {
  const row = await env.DB.prepare(`SELECT metadata_json FROM entitlements WHERE subscription_id = ? LIMIT 1`).bind(subscriptionId).first();
  return parseJsonOrNull(row?.metadata_json)?.environment === "live" ? "live" : "sandbox";
}

export { ForeignSubscriptionError, STATUS, PRODUCING, ENDED, stableId, isoFromUnix, periodOf, syncSubscription, subscriptionEnvironment, fetchStripeSubscription };
