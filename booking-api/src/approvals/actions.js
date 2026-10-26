// What happens when the owner (or the auto-release rule) answers an approval: approve, request changes, or let
// an expired link start over. The HTTP pages in approvals.js and the scheduled pass both call these.
import { recordProjectEvent } from "../lib/db.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { internalRunnerRequest, runNextProductionStep } from "../workflows/runner.js";
import { loadStepContext } from "./release.js";
import { loadStepConfig } from "./routing.js";

const DEFAULT_STEP_KEY = "PACKAGE_DELIVERABLES";

async function requeueForNewApproval(approval, env) {
  const metadata = parseJsonOrNull(approval.metadata_json) || {};
  await env.DB.prepare(`UPDATE approvals SET status = 'EXPIRED', responded_at = ? WHERE id = ? AND status = 'PENDING'`).bind(nowIso(), approval.id).run();
  if (metadata.workflow_run_id) {
    await env.DB.prepare(`
        UPDATE workflow_steps SET status = 'QUEUED', error_message = NULL
        WHERE workflow_run_id = ? AND step_key = ? AND status = 'WAITING'
      `).bind(metadata.workflow_run_id, metadata.step_key || DEFAULT_STEP_KEY).run();
    await env.DB.prepare(`
        UPDATE workflow_runs SET status = 'RUNNING', error_code = NULL, error_message = NULL
        WHERE id = ? AND status = 'WAITING'
      `).bind(metadata.workflow_run_id).run();
  }
}

// by: "OWNER" for a click on the approve page, "AUTO_RELEASE" for the optional timer.
async function approveApproval(env, ctx, approval, by = "OWNER") {
  const respondedAt = nowIso();
  const updated = await env.DB.prepare(`
      UPDATE approvals
      SET status = 'APPROVED', responded_at = ?, approved_at = ?, approved_by = ?
      WHERE id = ? AND status = 'PENDING'
    `).bind(respondedAt, respondedAt, by, approval.id).run();
  if (Number(updated.meta?.changes || 0) === 0) return { changed: false };
  const metadata = parseJsonOrNull(approval.metadata_json) || {};
  const stepKey = metadata.step_key || DEFAULT_STEP_KEY;
  if (metadata.workflow_run_id) {
    await env.DB.prepare(`
        UPDATE workflow_steps SET status = 'QUEUED', error_message = NULL
        WHERE workflow_run_id = ? AND step_key = ? AND status = 'WAITING'
      `).bind(metadata.workflow_run_id, stepKey).run();
    await env.DB.prepare(`
        UPDATE workflow_runs SET status = 'RUNNING', error_code = NULL, error_message = NULL
        WHERE id = ? AND status = 'WAITING'
      `).bind(metadata.workflow_run_id).run();
  }
  await recordProjectEvent(env, approval.project_id, "OWNER_APPROVAL_GRANTED", metadata.workflow_run_id || null,
    { approval_id: approval.id, by }, by === "OWNER" ? "ADMIN" : "SYSTEM", by === "OWNER" ? "OWNER" : by);
  if (metadata.workflow_run_id && env.PRODUCTION_RUNNER_SECRET) {
    const deliverNow = runNextProductionStep(internalRunnerRequest(env, { workflow_run_id: metadata.workflow_run_id, step_key: stepKey }), env)
      .catch((error) => console.error("Immediate delivery failed; the scheduled runner will retry:", error instanceof Error ? error.message : String(error)));
    if (ctx?.waitUntil) ctx.waitUntil(deliverNow);
    else await deliverNow;
  }
  return { changed: true };
}

// The owner's note for the regeneration in progress, for producers that can act on it (null when none).
async function loadRegenerationNote(env, projectId) {
  const row = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(projectId).first();
  const regeneration = parseJsonOrNull(row?.metadata_json)?.regeneration;
  return regeneration?.note ? { note: regeneration.note, count: Number(regeneration.count || 1) } : null;
}

// Owner asks for changes. A product whose delivering step names "regenerate_from" gets exactly one automatic
// regeneration from that step (the producer reads the note with loadRegenerationNote); the new version goes
// back to the owner as a fresh approval. Any other case is flagged in the queue for a manual fix.
async function requestChanges(env, approval, note) {
  const cleanNote = String(note || "").trim().slice(0, 1000);
  const metadata = parseJsonOrNull(approval.metadata_json) || {};
  const respondedAt = nowIso();
  const stepKey = metadata.step_key || DEFAULT_STEP_KEY;
  const step = metadata.workflow_run_id ? await loadStepContext(env, metadata.workflow_run_id, stepKey) : null;
  const config = step ? await loadStepConfig(env, step.workflow_key, step.workflow_version, stepKey) : null;
  const project = await env.DB.prepare(`SELECT order_item_id, metadata_json FROM projects WHERE id = ?`).bind(approval.project_id).first();
  const projectMeta = parseJsonOrNull(project?.metadata_json) || {};
  const used = Number(projectMeta.regeneration?.count || 0);
  const regenerate = Boolean(config?.regenerateFrom) && used < 1;

  const nextMeta = { ...metadata, owner_note: cleanNote, regenerated: regenerate };
  const updated = await env.DB.prepare(`
      UPDATE approvals SET status = 'CHANGES_REQUESTED', responded_at = ?, customer_comments = ?, metadata_json = ?
      WHERE id = ? AND status = 'PENDING'
    `).bind(respondedAt, cleanNote, JSON.stringify(nextMeta), approval.id).run();
  if (Number(updated.meta?.changes || 0) === 0) return { changed: false };

  if (regenerate) {
    const from = await env.DB.prepare(`SELECT step_order FROM workflow_steps WHERE workflow_run_id = ? AND step_key = ?`)
      .bind(step.workflow_run_id, config.regenerateFrom).first();
    if (from) {
      await env.DB.prepare(`
          UPDATE workflow_steps
          SET status = 'QUEUED', output_json = NULL, error_message = NULL, started_at = NULL, completed_at = NULL
          WHERE workflow_run_id = ? AND step_order >= ?
        `).bind(step.workflow_run_id, from.step_order).run();
      await env.DB.prepare(`
          UPDATE workflow_runs SET status = 'QUEUED', error_code = NULL, error_message = NULL WHERE id = ?
        `).bind(step.workflow_run_id).run();
      for (const deliverableId of metadata.deliverable_ids || []) {
        await env.DB.prepare(`UPDATE deliverables SET status = 'SUPERSEDED' WHERE id = ? AND customer_visible = 0`).bind(deliverableId).run();
      }
      projectMeta.regeneration = { count: used + 1, note: cleanNote, requested_at: respondedAt, approval_id: approval.id };
      await env.DB.prepare(`UPDATE projects SET status = 'READY', blocked_reason = NULL, metadata_json = ?, updated_at = ? WHERE id = ?`)
        .bind(JSON.stringify(projectMeta), respondedAt, approval.project_id).run();
      await env.DB.prepare(`UPDATE order_items SET fulfillment_status = 'IN_PROGRESS' WHERE id = ?`).bind(project.order_item_id).run();
      await recordProjectEvent(env, approval.project_id, "OWNER_CHANGES_REQUESTED", step.workflow_run_id,
        { approval_id: approval.id, note: cleanNote, regenerating: true, from_step: config.regenerateFrom }, "ADMIN", "OWNER");
      return { changed: true, regenerating: true };
    }
  }

  const reason = `Owner requested changes${cleanNote ? `: ${cleanNote}` : ""}. Fix by hand; this item is not regenerated automatically.`.slice(0, 500);
  await env.DB.prepare(`UPDATE projects SET status = 'BLOCKED', blocked_reason = ?, updated_at = ? WHERE id = ?`).bind(reason, respondedAt, approval.project_id).run();
  if (metadata.workflow_run_id) {
    await env.DB.prepare(`UPDATE workflow_runs SET error_code = 'CHANGES_REQUESTED', error_message = ? WHERE id = ?`).bind(reason, metadata.workflow_run_id).run();
  }
  await env.DB.prepare(`
      INSERT INTO system_errors (id, created_at, updated_at, error_type, severity, status, message, project_id, workflow_run_id, manual_intervention_required, details_json)
      VALUES (?, ?, ?, 'OWNER_CHANGES_REQUESTED', 'WARNING', 'OPEN', ?, ?, ?, 1, ?)
    `).bind(crypto.randomUUID(), respondedAt, respondedAt, reason, approval.project_id, metadata.workflow_run_id || null,
    JSON.stringify({ approval_id: approval.id, note: cleanNote, regeneration_used: used })).run();
  await recordProjectEvent(env, approval.project_id, "OWNER_CHANGES_REQUESTED", metadata.workflow_run_id || null,
    { approval_id: approval.id, note: cleanNote, regenerating: false }, "ADMIN", "OWNER");
  return { changed: true, regenerating: false };
}

// Optional per-product rule (off unless the delivering step sets auto_release_days): an approval the owner has
// been told about for that many days releases itself.
async function autoReleaseWaitingApprovals(env, ctx) {
  const waiting = (await env.DB.prepare(`
      SELECT * FROM approvals
      WHERE approval_type = 'OWNER_RELEASE' AND status = 'PENDING'
        AND json_extract(metadata_json, '$.owner_notified_at') IS NOT NULL
      ORDER BY requested_at ASC LIMIT 50
    `).all()).results || [];
  let released = 0;
  for (const approval of waiting) {
    const metadata = parseJsonOrNull(approval.metadata_json) || {};
    if (!metadata.workflow_run_id) continue;
    const step = await loadStepContext(env, metadata.workflow_run_id, metadata.step_key || DEFAULT_STEP_KEY);
    const config = step ? await loadStepConfig(env, step.workflow_key, step.workflow_version, step.step_key) : null;
    if (!config?.autoReleaseDays) continue;
    if (Date.parse(metadata.owner_notified_at) + config.autoReleaseDays * 864e5 > Date.now()) continue;
    const result = await approveApproval(env, ctx, approval, "AUTO_RELEASE");
    if (result.changed) released += 1;
  }
  return released;
}

export {
  DEFAULT_STEP_KEY,
  requeueForNewApproval,
  approveApproval,
  requestChanges,
  loadRegenerationNote,
  autoReleaseWaitingApprovals
};
