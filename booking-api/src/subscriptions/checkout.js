// Stage 3: turns a cart that holds a plan or bundle into a subscription-mode Stripe Checkout.
// Rules (handbook, Stage plans → Stage 3):
//   - one plan or bundle per checkout, monthly or annual; setups ride along as one-time line items
//   - Website Package alone starts Website Care with a 90-day trial in the same checkout
//   - Guest App needs the Guest App Setup in the same cart
import { CheckoutValidationError } from "../checkout/quote.js";
import { parseJsonOrNull } from "../lib/http.js";
import { stripeRequest } from "../lib/stripe.js";
import { normalizeInterval, resolvePlan } from "./plans.js";

async function classifyItem(identifier, env) {
  const clean = String(identifier || "").trim();
  if (!clean) return null;
  return env.DB.prepare(`
      SELECT o.code, o.billing_type FROM offers o
      WHERE lower(o.id) = lower(?) OR lower(o.code) = lower(?) OR lower(COALESCE(o.public_slug, '')) = lower(?)
      LIMIT 1
    `).bind(clean, clean, clean).first();
}

async function setupTrialDays(env, setupCode = "WEBSITE_PACKAGE") {
  const row = await env.DB.prepare(`
      SELECT v.scope_json FROM offers o JOIN offer_versions v ON v.offer_id = o.id
      WHERE o.code = ? AND v.status = 'ACTIVE' ORDER BY v.version_number DESC LIMIT 1
    `).bind(setupCode).first();
  const months = Number(parseJsonOrNull(row?.scope_json)?.includes_trial?.months || 3);
  return Math.round(months * 30);
}

// Sandbox only: the self-test passes a customer bound to a Stripe test clock so it can fast-forward renewals.
async function testClockCustomer(customerId, env, environment) {
  if (!customerId) return null;
  if (environment !== "sandbox" || !/^cus_[A-Za-z0-9]+$/.test(String(customerId))) {
    throw new CheckoutValidationError("A Stripe customer can only be passed to the sandbox checkout.");
  }
  const customer = await stripeRequest(env, "sandbox", `/v1/customers/${customerId}`);
  if (!customer?.test_clock || customer?.metadata?.self_test !== "1") {
    throw new CheckoutValidationError("Only self-test customers on a Stripe test clock can be passed in.");
  }
  return customer.id;
}

async function buildSubscriptionCart(itemsInput, data, env, environment) {
  const live = environment === "live";
  const oneTimeInputs = [];
  const planInputs = [];
  const setupCodes = new Set();
  for (const item of itemsInput) {
    const identifier = item?.offer_id || item?.code || item?.slug || item?.key;
    const row = identifier ? await classifyItem(identifier, env) : null;
    if (row?.billing_type === "RECURRING") {
      planInputs.push({ identifier, interval: item.interval });
    } else {
      oneTimeInputs.push(item);
      if (row?.code) setupCodes.add(row.code);
    }
  }
  if (planInputs.length > 1) {
    throw new CheckoutValidationError("Choose one plan or bundle per checkout.");
  }
  const interval = normalizeInterval(planInputs[0]?.interval || data?.interval);
  if (!interval) {
    throw new CheckoutValidationError("Billing interval must be monthly or annual.");
  }
  let planIdentifier = planInputs[0]?.identifier || null;
  let trialDays = 0;
  if (setupCodes.has("WEBSITE_PACKAGE") && setupCodes.has("STORE_APP_SETUP")) {
    throw new CheckoutValidationError("Check out the Website Package and the Store App separately.");
  }
  if (setupCodes.has("WEBSITE_PACKAGE")) {
    if (!planIdentifier) {
      planIdentifier = "WEBSITE_CARE";
      trialDays = await setupTrialDays(env);
    }
  }
  // Stage 11: the Store App starts Website & App Care (app tier) with a 90-day trial in the same checkout.
  if (setupCodes.has("STORE_APP_SETUP")) {
    if (planIdentifier && String(planIdentifier).toUpperCase() !== "STORE_APP_CARE") {
      throw new CheckoutValidationError("The Store App includes Website & App Care (app tier); check it out on its own.");
    }
    planIdentifier = "STORE_APP_CARE";
    trialDays = await setupTrialDays(env, "STORE_APP_SETUP");
  }
  let plan = null;
  if (planIdentifier) {
    plan = await resolvePlan(planIdentifier, interval, env, { requirePublic: live });
    if (!plan) {
      throw new CheckoutValidationError(live
        ? "That plan isn't available yet."
        : `No active ${interval === "YEAR" ? "annual" : "monthly"} plan matches ${planIdentifier}.`);
    }
    if (live && !plan.stripePriceId) {
      throw new CheckoutValidationError(`No live Stripe price is configured for ${plan.offerCode}`, 500);
    }
    if (setupCodes.has("WEBSITE_PACKAGE") && !plan.includes.includes("WEBSITE_CARE")) {
      throw new CheckoutValidationError("The Website Package includes Website Care; check it out on its own or with a plan that includes Website Care.");
    }
  }
  const stripeCustomerId = await testClockCustomer(data?.stripe_test_customer, env, environment);
  return {
    plan,
    trialDays,
    oneTimeInputs,
    stripeCustomerId,
    validateSetups(normalizedItems) {
      const codes = new Set(normalizedItems.map((item) => String(item.offerCode).toUpperCase()));
      if (plan?.requiresSetup && !codes.has(plan.requiresSetup)) {
        throw new CheckoutValidationError(`The ${plan.offerName} plan needs its setup in the same checkout.`);
      }
    },
    orderItem() {
      return {
        key: plan.offerCode,
        quantity: 1,
        offerId: plan.offerId,
        offerCode: plan.offerCode,
        offerName: plan.offerName,
        offerVersionId: plan.offerVersionId,
        // Nothing is charged today during a trial; the recurring amount is kept in metadata.
        priceCents: trialDays ? 0 : plan.priceCents,
        currency: plan.currency,
        stripePriceId: plan.stripePriceId,
        extraMetadata: {
          billing: "RECURRING",
          plan_code: plan.offerCode,
          interval: plan.interval,
          includes: plan.includes,
          recurring_amount_cents: plan.priceCents,
          ...(trialDays ? { trial_days: trialDays } : {})
        }
      };
    }
  };
}

function appendSubscriptionParams(params, cart, index, environment, pending) {
  const { plan, trialDays } = cart;
  const prefix = `line_items[${index}]`;
  if (environment === "live") {
    params.append(`${prefix}[price]`, plan.stripePriceId);
  } else {
    params.append(`${prefix}[price_data][currency]`, plan.currency.toLowerCase());
    params.append(`${prefix}[price_data][unit_amount]`, String(plan.priceCents));
    params.append(`${prefix}[price_data][recurring][interval]`, plan.interval === "YEAR" ? "year" : "month");
    params.append(`${prefix}[price_data][product_data][name]`, `${plan.offerName} (${plan.interval === "YEAR" ? "annual" : "monthly"})`);
    params.append(`${prefix}[price_data][product_data][metadata][plan_code]`, plan.offerCode);
  }
  params.append(`${prefix}[quantity]`, "1");
  params.append("subscription_data[metadata][order_id]", pending.orderId);
  params.append("subscription_data[metadata][plan_code]", plan.offerCode);
  params.append("subscription_data[metadata][environment]", environment);
  if (trialDays) {
    params.append("subscription_data[trial_period_days]", String(trialDays));
  }
}

export { buildSubscriptionCart, appendSubscriptionParams };
