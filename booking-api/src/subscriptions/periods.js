// Turns a paid subscription period into production jobs: one order for the period, and per included plan
// one order item, one project and one queued workflow run. All ids are derived from
// (subscription, period, plan), so a repeated webhook or daily pass never creates a second job.
// Monthly plans get their job from invoice.paid; annual plans are charged once a year, and the daily pass
// creates each month's job inside the paid year.
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { loadWorkflowDefinition } from "../workflows/definitions.js";
import { PRODUCING, stableId } from "./sync.js";

function addMonths(iso, months) {
  const start = new Date(iso);
  const day = start.getUTCDate();
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1,
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

// Monthly service windows inside [periodStart, periodEnd) that have begun by `now`.
function serviceMonthsDue(periodStart, periodEnd, now = new Date()) {
  if (!periodStart || !periodEnd) return [];
  const out = [];
  for (let k = 0; k < 12; k++) {
    const start = addMonths(periodStart, k);
    if (start >= periodEnd || Date.parse(start) > now.getTime()) break;
    const next = addMonths(periodStart, k + 1);
    out.push({ start, end: next < periodEnd ? next : periodEnd });
  }
  return out;
}

async function createPeriodJobs(env, subscription, periodStart, periodEnd, { invoiceId = null, amountCents = 0, trigger = "INVOICE_PAID" } = {}) {
  if (!PRODUCING.has(subscription.status)) {
    return { created: 0, skipped: `subscription ${subscription.status}` };
  }
  const periodKey = String(periodStart).slice(0, 10);
  const entitlements = (await env.DB.prepare(`
      SELECT id, entitlement_type, metadata_json FROM entitlements
      WHERE subscription_id = ? AND status = 'ACTIVE' ORDER BY entitlement_type
    `).bind(subscription.id).all()).results || [];
  if (entitlements.length === 0) return { created: 0, skipped: "no active entitlements" };

  const now = nowIso();
  const orderId = await stableId("period-order", subscription.id, periodKey);
  await env.DB.prepare(`
      INSERT OR IGNORE INTO orders (
        id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents,
        tax_cents, total_cents, payment_status, placed_at, notes
      ) VALUES (?, ?, ?, ?, ?, 'READY_FOR_PRODUCTION', 'USD', ?, 0, 0, ?, 'PAID', ?, ?)
    `).bind(orderId, now, now, subscription.customerId, subscription.businessId, amountCents, amountCents, now,
    `Subscription ${subscription.plan.offerCode} period ${periodKey} (${subscription.stripeSubscriptionId})`).run();

  let created = 0;
  const projects = [];
  for (const entitlement of entitlements) {
    const meta = parseJsonOrNull(entitlement.metadata_json) || {};
    const workflowKey = meta.workflow_key;
    const offer = await env.DB.prepare(`SELECT category FROM offers WHERE id = ?`).bind(meta.offer_id).first();
    if (!workflowKey || !offer) throw new Error(`Entitlement ${entitlement.id} has no offer or workflow`);
    const definition = await loadWorkflowDefinition(workflowKey, 1, env);
    const itemId = await stableId("period-item", subscription.id, periodKey, entitlement.entitlement_type);
    const projectId = await stableId("period-project", subscription.id, periodKey, entitlement.entitlement_type);
    const runId = await stableId("period-run", subscription.id, periodKey, entitlement.entitlement_type);
    const metadata = {
      source: "SUBSCRIPTION_PERIOD",
      subscription_id: subscription.id,
      stripe_subscription_id: subscription.stripeSubscriptionId,
      entitlement_id: entitlement.id,
      plan_code: entitlement.entitlement_type,
      via_plan: subscription.plan.offerCode,
      period_start: periodStart,
      period_end: periodEnd,
      invoice_id: invoiceId,
      environment: subscription.environment
    };
    await env.DB.prepare(`
        INSERT OR IGNORE INTO order_items (
          id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status, metadata_json
        ) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY', ?)
      `).bind(itemId, orderId, meta.offer_id, meta.offer_version_id, JSON.stringify(metadata)).run();
    const inserted = await env.DB.prepare(`
        INSERT OR IGNORE INTO projects (
          id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version,
          priority, manual_review_required, created_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, 1, 'NORMAL', 0, ?, ?, ?)
      `).bind(projectId, orderId, itemId, subscription.businessId, subscription.customerId, offer.category, workflowKey,
      now, now, JSON.stringify(metadata)).run();
    await env.DB.prepare(`
        INSERT OR IGNORE INTO workflow_runs (
          id, project_id, workflow_key, workflow_version, status, trigger_type, trigger_reference, attempt_number, created_at
        ) VALUES (?, ?, ?, 1, 'QUEUED', 'SUBSCRIPTION_PERIOD', ?, 1, ?)
      `).bind(runId, projectId, workflowKey, `${entitlement.id}:${periodKey}`, now).run();
    for (const step of definition.steps) {
      await env.DB.prepare(`
          INSERT OR IGNORE INTO workflow_steps (id, workflow_run_id, step_key, step_order, status, attempt_count, input_json)
          VALUES (?, ?, ?, ?, 'QUEUED', 0, ?)
        `).bind(await stableId("period-step", runId, step.key), runId, step.key, step.order,
        JSON.stringify({ project_id: projectId, order_id: orderId, customer_id: subscription.customerId,
          workflow_key: workflowKey, workflow_version: 1, workflow_definition_id: definition.id, queued_at: now })).run();
    }
    if (Number(inserted.meta?.changes || 0) > 0) {
      created += 1;
      projects.push({ id: projectId, plan: entitlement.entitlement_type });
    }
  }
  if (created > 0) {
    await env.DB.prepare(`
        INSERT INTO business_events (id, created_at, event_type, entity_type, entity_id, actor_type, actor_id, correlation_id, payload_json)
        VALUES (?, ?, 'SUBSCRIPTION_PERIOD_JOBS_CREATED', 'SUBSCRIPTION', ?, 'SYSTEM', 'MENU_MADE_AUTOMATION', ?, ?)
      `).bind(crypto.randomUUID(), now, subscription.id, invoiceId || periodKey,
      JSON.stringify({ period_start: periodStart, period_end: periodEnd, order_id: orderId, trigger, projects })).run();
  }
  return { created, orderId, periodKey, projects };
}

export { addMonths, serviceMonthsDue, createPeriodJobs };
