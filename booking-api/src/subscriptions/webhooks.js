// Stripe subscription events (stage 3). The webhook router has already verified the signature,
// worked out the environment from which secret matched, and logged the event in provider_events.
import { addMonths, createPeriodJobs } from "./periods.js";
import { sendSubscriptionWelcome } from "./portal.js";
import { ForeignSubscriptionError, PRODUCING, isoFromUnix, syncSubscription } from "./sync.js";

const SUBSCRIPTION_EVENTS = new Set([
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted"
]);

const idOf = (value) => (value && typeof value === "object" ? value.id : value) || null;

// Invoices moved the subscription reference under `parent` in the 2025 API versions.
function invoiceSubscriptionId(invoice) {
  return idOf(invoice?.subscription)
    || idOf(invoice?.parent?.subscription_details?.subscription)
    || idOf(invoice?.lines?.data?.find((line) => line?.parent?.subscription_item_details?.subscription)?.parent?.subscription_item_details?.subscription)
    || null;
}

// The service period an invoice pays for: its recurring line (not a one-time setup line).
const isSubscriptionLine = (line) => line?.type === "subscription" || line?.parent?.type === "subscription_item_details"
  || Boolean(line?.price?.recurring) || Boolean(line?.pricing?.price_details);

// What the invoice charged for the plan itself. A first invoice can also carry a one-time item bought in the same
// checkout (Website Package $499 with Care's trial): before Oct 30, 2026 the whole amount_paid was recorded on the
// plan's period order, double-counting the one-time sale (found by the stage 12 trial self-test).
function invoiceSubscriptionAmount(invoice) {
  const lines = (invoice?.lines?.data || []).filter(isSubscriptionLine).filter((l) => Number.isFinite(Number(l?.amount)));
  return lines.length ? lines.reduce((sum, l) => sum + Number(l.amount), 0) : Number(invoice?.amount_paid || 0);
}

function invoiceServicePeriod(invoice) {
  const lines = invoice?.lines?.data || [];
  const recurring = lines.find(isSubscriptionLine) || lines[0];
  return {
    start: isoFromUnix(recurring?.period?.start ?? invoice?.period_start),
    end: isoFromUnix(recurring?.period?.end ?? invoice?.period_end)
  };
}

async function onSubscriptionCheckoutCompleted(session, env, environment) {
  const stripeSubscriptionId = idOf(session?.subscription);
  if (session?.mode !== "subscription" || !stripeSubscriptionId) return null;
  const subscription = await syncSubscription(env, environment, stripeSubscriptionId);
  if (PRODUCING.has(subscription.status)) {
    await sendSubscriptionWelcome(env, subscription).catch((error) => console.error("Welcome email failed:", error?.message || error));
  }
  return subscription;
}

async function onInvoicePaid(invoice, env, environment) {
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  if (!stripeSubscriptionId) return { ignored: "not a subscription invoice" };
  const subscription = await syncSubscription(env, environment, stripeSubscriptionId);
  const period = invoiceServicePeriod(invoice);
  if (!period.start) throw new Error(`Invoice ${invoice?.id} has no service period`);
  // An annual invoice pays for twelve months; this creates the first, the daily pass creates the rest.
  const firstMonthEnd = subscription.plan.interval === "YEAR" ? addMonths(period.start, 1) : period.end;
  return createPeriodJobs(env, subscription, period.start, firstMonthEnd, {
    invoiceId: invoice?.id || null,
    amountCents: invoiceSubscriptionAmount(invoice),
    trigger: "INVOICE_PAID"
  });
}

async function onInvoicePaymentFailed(invoice, env, environment) {
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  if (!stripeSubscriptionId) return { ignored: "not a subscription invoice" };
  const first = await syncSubscription(env, environment, stripeSubscriptionId);
  // Stripe may still say "active" while it retries; no new jobs until a later invoice is paid.
  if (PRODUCING.has(first.status)) {
    return syncSubscription(env, environment, stripeSubscriptionId, { overrideStatus: "PAST_DUE" });
  }
  return first;
}

async function onSubscriptionChanged(subscriptionObject, env, environment) {
  const subscription = await syncSubscription(env, environment, subscriptionObject.id);
  if (subscription.previousStatus === null && PRODUCING.has(subscription.status)) {
    await sendSubscriptionWelcome(env, subscription).catch(() => null);
  }
  return subscription;
}

async function handleSubscriptionEvent(event, env, environment) {
  try {
    return await routeSubscriptionEvent(event, env, environment);
  } catch (error) {
    if (error instanceof ForeignSubscriptionError) return { ignored: error.message };
    throw error;
  }
}

async function routeSubscriptionEvent(event, env, environment) {
  const object = event?.data?.object;
  switch (event.type) {
    case "invoice.paid":
      return onInvoicePaid(object, env, environment);
    case "invoice.payment_failed":
      return onInvoicePaymentFailed(object, env, environment);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return onSubscriptionChanged(object, env, environment);
    default:
      return null;
  }
}

export { SUBSCRIPTION_EVENTS, handleSubscriptionEvent, onSubscriptionCheckoutCompleted, invoiceSubscriptionAmount, invoiceSubscriptionId, invoiceServicePeriod };
