// Review Replies runs weekly, but subscription periods create one job a month (subscriptions/periods.js): that job is
// week 1. Once a day (from the daily subscription pass) this adds weeks 2-4 inside each paid month, as their own
// projects under the same period order, for subscriptions that are producing and have Google connected. A customer who
// has not connected Google keeps a single waiting job instead of one per week. Ids are derived from
// (subscription, week start), so repeating the pass never creates a second job.
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { SELF_TEST_EMAIL } from "../../lib/email.js";
import { PRODUCING, stableId } from "../../subscriptions/sync.js";
import { loadWorkflowDefinition } from "../../workflows/definitions.js";

const WORKFLOW = "REVIEW_REPLIES_V1";
const WEEK_MS = 7 * 864e5;
const MIN_DAYS_BEFORE_PERIOD_END = 4; // the next month's job is close: no extra week

function weekStartsDue(periodStart, periodEnd, now) {
  const out = [];
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return out;
  for (let k = 1; k < 6; k++) {
    const at = start + k * WEEK_MS;
    if (at > now.getTime() || at + MIN_DAYS_BEFORE_PERIOD_END * 864e5 > end) break;
    out.push(new Date(at).toISOString());
  }
  return out;
}

async function createReviewWeekJobs(env, now = new Date()) {
  const periods = (await env.DB.prepare(`
      SELECT p.id, p.order_id, p.order_item_id, p.business_id, p.customer_id, p.project_type, p.metadata_json,
        s.status AS subscription_status, g.status AS google_status, c.email
      FROM projects p
      JOIN subscriptions s ON s.id = json_extract(p.metadata_json, '$.subscription_id')
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN google_connections g ON g.subscription_id = s.id
      WHERE p.workflow_key = ? AND json_extract(p.metadata_json, '$.source') = 'SUBSCRIPTION_PERIOD'
        AND json_extract(p.metadata_json, '$.period_end') > ?
    `).bind(WORKFLOW, now.toISOString()).all()).results || [];
  let created = 0;
  let definition = null;
  for (const period of periods) {
    if (!PRODUCING.has(period.subscription_status) || period.google_status !== "ACTIVE" || period.email === SELF_TEST_EMAIL) continue;
    const meta = parseJsonOrNull(period.metadata_json) || {};
    const entitlement = await env.DB.prepare(`SELECT status FROM entitlements WHERE id = ?`).bind(meta.entitlement_id || "").first();
    if (entitlement && entitlement.status !== "ACTIVE") continue;
    for (const weekStart of weekStartsDue(meta.period_start, meta.period_end, now)) {
      definition = definition || await loadWorkflowDefinition(WORKFLOW, 1, env);
      const weekKey = weekStart.slice(0, 10);
      const projectId = await stableId("review-week-project", meta.subscription_id, weekKey);
      const runId = await stableId("review-week-run", meta.subscription_id, weekKey);
      const t = nowIso();
      const metadata = { ...meta, source: "REVIEW_REPLIES_WEEK", week_start: weekStart, period_project_id: period.id };
      const inserted = await env.DB.prepare(`
          INSERT OR IGNORE INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version,
            priority, manual_review_required, created_at, updated_at, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, 1, 'NORMAL', 0, ?, ?, ?)
        `).bind(projectId, period.order_id, period.order_item_id, period.business_id, period.customer_id, period.project_type, WORKFLOW, t, t, JSON.stringify(metadata)).run();
      await env.DB.prepare(`
          INSERT OR IGNORE INTO workflow_runs (id, project_id, workflow_key, workflow_version, status, trigger_type, trigger_reference, attempt_number, created_at)
          VALUES (?, ?, ?, 1, 'QUEUED', 'REVIEW_WEEK', ?, 1, ?)
        `).bind(runId, projectId, WORKFLOW, `${period.id}:${weekKey}`, t).run();
      for (const step of definition.steps) {
        await env.DB.prepare(`
            INSERT OR IGNORE INTO workflow_steps (id, workflow_run_id, step_key, step_order, status, attempt_count, input_json)
            VALUES (?, ?, ?, ?, 'QUEUED', 0, ?)
          `).bind(await stableId("review-week-step", runId, step.key), runId, step.key, step.order,
          JSON.stringify({ project_id: projectId, order_id: period.order_id, customer_id: period.customer_id, workflow_key: WORKFLOW, workflow_version: 1, workflow_definition_id: definition.id, queued_at: t })).run();
      }
      if (Number(inserted.meta?.changes || 0) > 0) created += 1;
    }
  }
  return { created, periods: periods.length };
}

export { weekStartsDue, createReviewWeekJobs };
