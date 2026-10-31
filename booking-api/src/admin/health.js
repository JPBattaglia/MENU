// Stage 13: the daily health summary. The owner wants failures only, so this adds to the 22:00 UTC daily check (see
// selftest/coverage.js) the things on REAL orders that still need him, and the email goes out only when there is
// something. Each failure already sends its own alert the moment it happens; this is the once-a-day reminder for
// anything still open, so nothing sits forgotten.
//
// Counted (real orders only; the self-tests' orders never count, see LIVE_ORDER):
//   - production runs that failed and haven't been retried or cancelled
//   - deliveries waiting for the owner's approval for more than APPROVAL_STALE_HOURS
//   - production runs queued or running for more than STUCK_HOURS with nothing waiting on the buyer or the owner
//   - open errors marked "needs a person" that aren't tied to a test order
//   - subscriptions whose renewal payment failed (past due) — Stripe retries the card, but the owner may want to call
// When an email goes out, it also carries one line of context for the last 24 hours (paid orders, subscriptions started
// and cancelled), so the owner sees the day without a separate "all good" email.
//
// Five small queries, one per item, plus one for the context line only when there is something to send.
import { SELF_TEST_EMAIL } from "../lib/email.js";

const APPROVAL_STALE_HOURS = 24;
const STUCK_HOURS = 24;
const LIST = 5; // names listed per item; the count is always exact

// A real order: not a Stripe test-mode checkout, and not the self-tests' buyer (every self-test buys as the Resend test
// inbox, SELF_TEST_EMAIL). Monthly subscription jobs have no checkout session at all, so a missing one still counts.
const LIVE_ORDER = `(o.stripe_checkout_session_id IS NULL OR o.stripe_checkout_session_id NOT LIKE 'cs_test_%')
        AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.email = '${SELF_TEST_EMAIL}')`;
const REAL_BUYER = `NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = s.customer_id AND c.email = '${SELF_TEST_EMAIL}')`;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const names = (rows) => {
  const shown = rows.slice(0, LIST).map((r) => r.business || r.workflow_key || "unknown").join(", ");
  return rows.length > LIST ? `${shown} and ${rows.length - LIST} more` : shown;
};

async function operationsNeedingOwner(env, now = Date.now()) {
  if (!env.DB) return [];
  const all = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  const approvalCutoff = new Date(now - APPROVAL_STALE_HOURS * 3600000).toISOString();
  const stuckCutoff = new Date(now - STUCK_HOURS * 3600000).toISOString();
  const items = [];

  const failed = await all(`
      SELECT b.name AS business, r.workflow_key FROM workflow_runs r
      JOIN projects p ON p.id = r.project_id JOIN orders o ON o.id = p.order_id LEFT JOIN businesses b ON b.id = p.business_id
      WHERE r.status = 'FAILED' AND ${LIVE_ORDER} AND p.status NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED')
      ORDER BY r.failed_at DESC LIMIT 50`);
  if (failed.length) items.push({ code: "RUN_FAILED", name: plural(failed.length, "order stopped", "orders stopped"),
    detail: `${names(failed)}. The automation won't retry on its own. Open the owner queue, or forward this email to Claude.` });

  const waiting = await all(`
      SELECT b.name AS business, p.workflow_key FROM approvals a
      JOIN projects p ON p.id = a.project_id JOIN orders o ON o.id = p.order_id LEFT JOIN businesses b ON b.id = p.business_id
      WHERE a.approval_type = 'OWNER_RELEASE' AND a.status = 'PENDING' AND a.requested_at < ? AND ${LIVE_ORDER}
      ORDER BY a.requested_at ASC LIMIT 50`, approvalCutoff);
  if (waiting.length) items.push({ code: "APPROVAL_WAITING", name: plural(waiting.length, "approval waiting", "approvals waiting"),
    detail: `${names(waiting)}, waiting over ${APPROVAL_STALE_HOURS} hours. The buyer gets nothing until you approve: use the Approve button in the approval email.` });

  const stuck = await all(`
      SELECT b.name AS business, r.workflow_key FROM workflow_runs r
      JOIN projects p ON p.id = r.project_id JOIN orders o ON o.id = p.order_id LEFT JOIN businesses b ON b.id = p.business_id
      WHERE r.status IN ('QUEUED', 'RUNNING') AND r.created_at < ? AND ${LIVE_ORDER}
        AND NOT EXISTS (SELECT 1 FROM workflow_steps s WHERE s.workflow_run_id = r.id AND s.status = 'WAITING')
        AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.project_id = p.id AND a.status = 'PENDING')
      ORDER BY r.created_at ASC LIMIT 50`, stuckCutoff);
  if (stuck.length) items.push({ code: "RUN_STUCK", name: plural(stuck.length, "order not moving", "orders not moving"),
    detail: `${names(stuck)}: in production over ${STUCK_HOURS} hours with nothing waiting on the buyer or you. Forward this email to Claude.` });

  const errors = await all(`
      SELECT e.message AS business FROM system_errors e
      LEFT JOIN workflow_runs r ON r.id = e.workflow_run_id LEFT JOIN projects p ON p.id = COALESCE(e.project_id, r.project_id)
      LEFT JOIN orders o ON o.id = COALESCE(e.order_id, p.order_id)
      WHERE e.status = 'OPEN' AND e.manual_intervention_required = 1
        AND (o.id IS NULL OR (${LIVE_ORDER}))
        AND e.error_type <> 'PRODUCTION_STEP_FAILED'
      ORDER BY e.created_at DESC LIMIT 50`);
  // PRODUCTION_STEP_FAILED errors are the same problems as "orders stopped" above, so they aren't counted twice.
  if (errors.length) items.push({ code: "OPEN_ERROR", name: plural(errors.length, "open error", "open errors"),
    detail: `${errors.slice(0, 2).map((e) => String(e.business || "").slice(0, 120)).join("; ")}${errors.length > 2 ? ` and ${errors.length - 2} more` : ""}. Forward this email to Claude.` });

  const pastDue = await all(`
      SELECT b.name AS business FROM subscriptions s JOIN businesses b ON b.id = s.business_id
      WHERE s.status = 'PAST_DUE' AND ${REAL_BUYER}
      LIMIT 50`);
  if (pastDue.length) items.push({ code: "PAST_DUE", name: plural(pastDue.length, "payment failed", "payments failed"),
    detail: `${names(pastDue)}: the renewal card was declined. Stripe retries it and emails the buyer; their services pause until it's paid. Nothing to do unless you want to call them.` });

  return items;
}

// One line for the last 24 hours, only used when an email is going out anyway.
async function lastDayLine(env, now = Date.now()) {
  const since = new Date(now - 24 * 3600000).toISOString();
  const row = await env.DB.prepare(`
      SELECT (SELECT COUNT(*) FROM orders o WHERE o.payment_status = 'PAID' AND o.created_at >= ?1 AND ${LIVE_ORDER}) AS orders,
             (SELECT COUNT(*) FROM subscriptions s WHERE s.started_at >= ?1 AND ${REAL_BUYER}) AS started,
             (SELECT COUNT(*) FROM subscriptions s WHERE s.cancelled_at >= ?1 AND ${REAL_BUYER}) AS cancelled`)
    .bind(since).first().catch(() => null);
  if (!row) return null;
  return `Last 24 hours: ${plural(Number(row.orders), "paid order", "paid orders")}, ${plural(Number(row.started), "subscription", "subscriptions")} started, ${Number(row.cancelled)} cancelled.`;
}

// Renewals calendar (stage 13): GITHUB_DISPATCH_TOKEN is a worker secret, so the worker checks its own expiry. GitHub
// returns the expiry of a fine-grained token in a response header; /rate_limit costs nothing against the API limit.
// Domains, the Apple membership and the yearly store deadlines are checked weekly by .github/workflows/renewals.yml.
const TOKEN_WARN_DAYS = 30;
async function githubTokenItem(env, now = Date.now()) {
  if (!env.GITHUB_DISPATCH_TOKEN) return null;
  let response;
  try {
    response = await (env.GITHUB_DISPATCH_FETCH || fetch)("https://api.github.com/rate_limit", { // GITHUB_DISPATCH_FETCH is a test seam
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "menu-made-worker" }
    });
  } catch {
    return null; // GitHub unreachable for a moment: tomorrow's check tries again
  }
  if (response.status === 401) return { code: "GITHUB_TOKEN", name: "GitHub token refused", detail: "GitHub no longer accepts the worker's token, so app builds, images and notifications wait. Tell Claude \"GitHub token refused\"; it walks you through a new one (about 3 minutes)." };
  const header = response.headers.get("github-authentication-token-expiration");
  if (!header) return null; // a token with no expiry
  const expires = Date.parse(header.replace(" UTC", "Z").replace(" ", "T"));
  if (!Number.isFinite(expires)) return null;
  const days = Math.floor((expires - now) / 86400000);
  if (days > TOKEN_WARN_DAYS) return null;
  return { code: "GITHUB_TOKEN", name: "GitHub token expiring", detail: `The worker's GitHub token expires on ${new Date(expires).toISOString().slice(0, 10)} (${days} days). Tell Claude "GitHub token expiring"; it walks you through a new one (about 3 minutes).` };
}

export { APPROVAL_STALE_HOURS, STUCK_HOURS, githubTokenItem, lastDayLine, operationsNeedingOwner };
