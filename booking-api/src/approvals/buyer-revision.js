// Buyer change requests (owner decision Nov 4, 2026): custom design work includes 2 rounds of changes, not
// unlimited. The delivery email links here; the buyer writes what to change, production re-runs from the step the
// workflow names in regenerate_from (a fresh version, with the note for producers that read it), and the new version
// goes to the owner for approval like the first one. After the last round the link says how to buy more help.
//
//   GET|POST /api/revision/<project_id>?t=<signed token>
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { recordProjectEvent } from "../lib/db.js";
import { nowIso, parseJsonOrNull, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { loadStepConfig } from "./routing.js";

const KIND = "buyer_revision";
const INCLUDED_ROUNDS = 2;
const LINK_DAYS = 60;
const DELIVER_STEP = "DELIVER";

async function revisionLink(env, projectId) {
  const token = await signLinkToken(env, { kind: KIND, id: projectId, ttlDays: LINK_DAYS });
  return `${publicBaseUrl(env)}/api/revision/${projectId}?t=${encodeURIComponent(token)}`;
}

async function loadProject(env, projectId) {
  const project = await env.DB.prepare(`
      SELECT p.id, p.status, p.order_item_id, p.metadata_json, p.workflow_key, p.workflow_version, b.name AS business_name, c.email AS customer_email
      FROM projects p LEFT JOIN businesses b ON b.id = p.business_id LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?`).bind(projectId).first();
  if (!project) return null;
  const meta = parseJsonOrNull(project.metadata_json) || {};
  return { project, meta, used: Number(meta.buyer_revisions?.count || 0) };
}

// Re-run production for one change request. Returns { ok, left } or { ok:false, reason }.
async function requestBuyerRevision(env, projectId, note) {
  const cleanNote = String(note || "").trim().slice(0, 1000);
  if (cleanNote.length < 3) return { ok: false, reason: "Say what you'd like changed." };
  const loaded = await loadProject(env, projectId);
  if (!loaded) return { ok: false, reason: "We couldn't find this order." };
  const { project, meta, used } = loaded;
  if (!["DELIVERED", "COMPLETED"].includes(project.status)) return { ok: false, reason: "Your last change request is still being worked on. We'll email you when the new version is ready." };
  if (used >= INCLUDED_ROUNDS) return { ok: false, reason: `You've used both included rounds of changes.`, used };
  const run = await env.DB.prepare(`SELECT id FROM workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`).bind(projectId).first();
  const config = run ? await loadStepConfig(env, project.workflow_key, project.workflow_version, DELIVER_STEP) : null;
  const from = config?.regenerateFrom ? await env.DB.prepare(`SELECT step_order FROM workflow_steps WHERE workflow_run_id = ? AND step_key = ?`).bind(run.id, config.regenerateFrom).first() : null;
  if (!from) return { ok: false, reason: "Changes for this order are handled by email. Reply to your delivery email and we'll take care of it." };
  const t = nowIso();
  meta.buyer_revisions = { count: used + 1, requested: [...(meta.buyer_revisions?.requested || []), { at: t, note: cleanNote }] };
  // The note travels like an owner change request; the owner's one automatic redo is reset for the new round.
  meta.regeneration = { count: 0, note: `The buyer asked for these changes: ${cleanNote}`, requested_at: t, by: "BUYER" };
  await env.DB.prepare(`UPDATE workflow_steps SET status = 'QUEUED', output_json = NULL, error_message = NULL, started_at = NULL, completed_at = NULL WHERE workflow_run_id = ? AND step_order >= ?`).bind(run.id, from.step_order).run();
  await env.DB.prepare(`UPDATE workflow_runs SET status = 'QUEUED', error_code = NULL, error_message = NULL WHERE id = ?`).bind(run.id).run();
  await env.DB.prepare(`UPDATE projects SET status = 'READY', completed_at = NULL, blocked_reason = NULL, metadata_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(meta), t, projectId).run();
  await env.DB.prepare(`UPDATE order_items SET fulfillment_status = 'IN_PROGRESS' WHERE id = ?`).bind(project.order_item_id).run();
  await recordProjectEvent(env, projectId, "BUYER_CHANGES_REQUESTED", run.id, { round: used + 1, note: cleanNote }, "CUSTOMER", "BUYER").catch(() => null);
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject: `Change request (round ${used + 1} of ${INCLUDED_ROUNDS}): ${project.business_name || "a buyer"}`,
    html: brandedEmailHtml({ eyebrow: "CHANGE REQUEST", heading: `${escapeHtml(project.business_name || "A buyer")} asked for changes`, paragraphs: [`“${escapeHtml(cleanNote)}”`, "A new version is being made now and will come to you for approval like the first one. If it needs a hand-made fix, use Request changes on that approval."] }),
    text: `${project.business_name || "A buyer"} asked for changes (round ${used + 1} of ${INCLUDED_ROUNDS}): ${cleanNote}\nA new version is being made and will come to you for approval.`,
    idempotencyKey: `buyer-revision/${projectId}/${used + 1}`, purpose: "OWNER_CHANGE_REQUEST", templateKey: "buyer_revision_owner_v1"
  }).catch(() => null);
  return { ok: true, left: INCLUDED_ROUNDS - used - 1 };
}

async function handleBuyerRevision(request, env, projectId) {
  const token = new URL(request.url).searchParams.get("t") || "";
  const payload = await verifyLinkToken(env, token, [KIND], projectId);
  if (!payload || payload.expired) return simplePage(403, "This link has expired", `<p>Reply to your delivery email and we'll help.</p>`);
  const loaded = await loadProject(env, projectId);
  if (!loaded) return simplePage(404, "Order not found", "<p>Reply to your delivery email and we'll help.</p>");
  const left = INCLUDED_ROUNDS - loaded.used;
  if (request.method !== "POST") {
    if (left <= 0) return simplePage(200, "Both rounds of changes used", `<p>Your order included ${INCLUDED_ROUNDS} rounds of changes, and both have been used. For more changes, reply to your delivery email and we'll quote them.</p>`);
    return simplePage(200, "What should change?", `<p>You have <strong>${left} of ${INCLUDED_ROUNDS}</strong> rounds of changes left. Be specific (for example: “bigger name, darker blue, drop the tagline”). We'll send the new version, usually within 2 business days.</p>
<form method="post"><label for="note"><strong>Your changes</strong></label><br><textarea id="note" name="note" rows="5" maxlength="1000" required style="width:100%;margin:8px 0"></textarea><br><button type="submit">Send my changes</button></form>`);
  }
  const form = await request.formData().catch(() => null);
  const result = await requestBuyerRevision(env, projectId, form?.get("note"));
  if (!result.ok) return simplePage(result.used >= INCLUDED_ROUNDS ? 200 : 409, "We couldn't send that", `<p>${escapeHtml(result.reason)}</p>`);
  return simplePage(200, "Got it", `<p>Your changes are with Nino. You'll get the new version by email, usually within 2 business days. ${result.left ? `You have ${result.left} more round of changes after this one.` : "This was your last included round of changes."}</p>`);
}

export { INCLUDED_ROUNDS, handleBuyerRevision, requestBuyerRevision, revisionLink };
