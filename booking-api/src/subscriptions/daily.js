// Once a day from the scheduled handler: re-read every open subscription from Stripe (fixes any drift
// from a missed webhook), then create the jobs each producing subscription is owed right now — the
// current month for monthly plans (normally already made by invoice.paid) and each started month
// inside the paid year for annual plans.
import { nowIso } from "../lib/http.js";
import { createPeriodJobs, serviceMonthsDue } from "./periods.js";
import { PRODUCING, subscriptionEnvironment, syncSubscription } from "./sync.js";
import { createReviewWeekJobs } from "../producers/review-replies/weeks.js";
import { remindGoogleVisibilityConnects } from "../producers/google-visibility/intake.js";

const DAILY_MARKER = "SUBSCRIPTIONS_DAILY_PASS";
const MIN_HOURS_BETWEEN = 20;

async function dueForDailyPass(env, now) {
  const last = await env.DB.prepare(`
      SELECT created_at FROM business_events WHERE event_type = ? ORDER BY created_at DESC LIMIT 1
    `).bind(DAILY_MARKER).first();
  return !last || now.getTime() - Date.parse(last.created_at) > MIN_HOURS_BETWEEN * 3600000;
}

async function runDailySubscriptionPass(env, { now = new Date(), force = false } = {}) {
  if (!env.DB) return null;
  if (!force && !(await dueForDailyPass(env, now))) return { skipped: "ran recently" };
  const open = (await env.DB.prepare(`
      SELECT id, provider_subscription_id, status FROM subscriptions
      WHERE status NOT IN ('CANCELLED', 'EXPIRED') ORDER BY created_at
    `).all()).results || [];
  const summary = { checked: 0, drift: [], jobs: 0, errors: [] };
  for (const row of open) {
    try {
      const environment = await subscriptionEnvironment(env, row.id);
      const subscription = await syncSubscription(env, environment, row.provider_subscription_id);
      summary.checked += 1;
      if (subscription.previousStatus !== subscription.status) {
        summary.drift.push({ id: row.id, from: subscription.previousStatus, to: subscription.status });
      }
      if (!PRODUCING.has(subscription.status)) continue;
      const months = subscription.plan.interval === "YEAR"
        ? serviceMonthsDue(subscription.period.start, subscription.period.end, now)
        : (subscription.period.start && Date.parse(subscription.period.start) <= now.getTime()
          ? [{ start: subscription.period.start, end: subscription.period.end }] : []);
      for (const month of months) {
        const result = await createPeriodJobs(env, subscription, month.start, month.end, { trigger: "DAILY_PASS" });
        summary.jobs += result.created || 0;
      }
    } catch (error) {
      summary.errors.push({ id: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  try {
    // Review Replies is weekly: add this month's later weeks as their own jobs.
    summary.review_weeks = (await createReviewWeekJobs(env, now)).created;
  } catch (error) {
    summary.errors.push({ id: "review-weeks", error: error instanceof Error ? error.message : String(error) });
  }
  try {
    // Google Visibility orders still waiting for the buyer to connect Google: reminders, then the owner.
    summary.visibility_reminders = (await remindGoogleVisibilityConnects(env, now)).sent;
  } catch (error) {
    summary.errors.push({ id: "visibility-reminders", error: error instanceof Error ? error.message : String(error) });
  }
  await env.DB.prepare(`
      INSERT INTO business_events (id, created_at, event_type, entity_type, entity_id, actor_type, actor_id, correlation_id, payload_json)
      VALUES (?, ?, ?, 'SYSTEM', 'subscriptions', 'SYSTEM', 'MENU_MADE_AUTOMATION', NULL, ?)
    `).bind(crypto.randomUUID(), nowIso(), DAILY_MARKER, JSON.stringify(summary)).run();
  if (summary.errors.length) console.error("Daily subscription pass errors:", JSON.stringify(summary.errors).slice(0, 1000));
  return summary;
}

export { runDailySubscriptionPass };
