import { DELIVERABLE_LABELS } from "../lib/config.js";
import { recordProjectEvent } from "../lib/db.js";
import { escapeHtml } from "../lib/email.js";
import { nowIso, parseJsonOrNull, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { isTestOrder, loadDeliveryContext } from "../producers/menu-qr/package.js";
import { internalRunnerRequest, runNextProductionStep } from "../workflows/runner.js";

async function requeueForNewApproval(approval, env) {
  const metadata = parseJsonOrNull(approval.metadata_json) || {};
  await env.DB.prepare(`UPDATE approvals SET status = 'EXPIRED', responded_at = ? WHERE id = ? AND status = 'PENDING'`).bind(nowIso(), approval.id).run();
  if (metadata.workflow_run_id) {
    await env.DB.prepare(`
        UPDATE workflow_steps SET status = 'QUEUED', error_message = NULL
        WHERE workflow_run_id = ? AND step_key = 'PACKAGE_DELIVERABLES' AND status = 'WAITING'
      `).bind(metadata.workflow_run_id).run();
    await env.DB.prepare(`
        UPDATE workflow_runs SET status = 'RUNNING', error_code = NULL, error_message = NULL
        WHERE id = ? AND status = 'WAITING'
      `).bind(metadata.workflow_run_id).run();
  }
}

async function handleApprovalRequest(request, env, ctx, approvalId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  let token = new URL(request.url).searchParams.get("t");
  if (request.method === "POST") {
    try {
      const form = await request.formData();
      token = form.get("t");
    } catch {
      token = null;
    }
  }
  const payload = await verifyLinkToken(env, token, ["approve"], approvalId);
  if (!payload) {
    return simplePage(403, "This link isn't valid", "<p>Open the approval link from your most recent approval email.</p>");
  }
  const approval = await env.DB.prepare(`SELECT * FROM approvals WHERE id = ? AND approval_type = 'OWNER_RELEASE' LIMIT 1`).bind(approvalId).first();
  if (!approval) return simplePage(404, "Approval not found", "<p>This approval no longer exists.</p>");
  const context = await loadDeliveryContext(approval.project_id, env);
  const business = context?.business_name || "This order";
  const pastExpiry = approval.expires_at && approval.expires_at < nowIso();
  if (approval.status === "PENDING" && (payload.expired || pastExpiry)) {
    await requeueForNewApproval(approval, env);
    return simplePage(410, "This approval link expired", "<p>A fresh approval email will arrive within a few minutes.</p>");
  }
  if (approval.status === "APPROVED") {
    return simplePage(200, "Already approved", `<p>${escapeHtml(business)}'s files were approved${approval.approved_at ? ` on ${escapeHtml(approval.approved_at.slice(0, 10))}` : ""}. The buyer's delivery email is sent automatically.</p>`);
  }
  if (approval.status !== "PENDING") {
    return simplePage(409, "Nothing to approve", `<p>This approval is ${escapeHtml(approval.status.toLowerCase())}.</p>`);
  }
  if (request.method !== "POST") {
    const metadata = parseJsonOrNull(approval.metadata_json) || {};
    const previews = [];
    for (const deliverableId of metadata.deliverable_ids || []) {
      const row = await env.DB.prepare(`SELECT deliverable_type FROM deliverables WHERE id = ?`).bind(deliverableId).first();
      if (!row) continue;
      const previewToken = await signLinkToken(env, { kind: "preview", id: deliverableId, ttlDays: 1 });
      previews.push(`<a class="btn" href="/api/delivery/${escapeHtml(deliverableId)}?t=${escapeHtml(previewToken)}" target="_blank" rel="noopener">Preview ${escapeHtml(DELIVERABLE_LABELS[row.deliverable_type] || row.deliverable_type)}</a>`);
    }
    return simplePage(200, `Approve ${business}'s menu + QR`, `
<p>Check both files. Approving sends them to the buyer right away.</p>
<dl><dt>Business</dt><dd>${escapeHtml(business)}</dd><dt>Buyer</dt><dd>${escapeHtml(context?.customer_email || "")}</dd><dt>Order</dt><dd>${escapeHtml(context?.order_id || "")}${isTestOrder(context) ? " (test order)" : ""}</dd></dl>
<p>${previews.join("")}</p>
<form method="post" action="/api/approvals/${escapeHtml(approvalId)}"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">Approve and send to buyer</button></form>`);
  }
  const respondedAt = nowIso();
  const updated = await env.DB.prepare(`
      UPDATE approvals
      SET status = 'APPROVED', responded_at = ?, approved_at = ?, approved_by = 'OWNER'
      WHERE id = ? AND status = 'PENDING'
    `).bind(respondedAt, respondedAt, approvalId).run();
  if (Number(updated.meta?.changes || 0) === 0) {
    return simplePage(200, "Already handled", "<p>This approval was already answered.</p>");
  }
  const metadata = parseJsonOrNull(approval.metadata_json) || {};
  if (metadata.workflow_run_id) {
    await env.DB.prepare(`
        UPDATE workflow_steps SET status = 'QUEUED', error_message = NULL
        WHERE workflow_run_id = ? AND step_key = 'PACKAGE_DELIVERABLES' AND status = 'WAITING'
      `).bind(metadata.workflow_run_id).run();
    await env.DB.prepare(`
        UPDATE workflow_runs SET status = 'RUNNING', error_code = NULL, error_message = NULL
        WHERE id = ? AND status = 'WAITING'
      `).bind(metadata.workflow_run_id).run();
  }
  await recordProjectEvent(env, approval.project_id, "OWNER_APPROVAL_GRANTED", metadata.workflow_run_id || null, { approval_id: approvalId }, "ADMIN", "OWNER");
  if (metadata.workflow_run_id && env.PRODUCTION_RUNNER_SECRET) {
    const deliverNow = runNextProductionStep(internalRunnerRequest(env, { workflow_run_id: metadata.workflow_run_id, step_key: "PACKAGE_DELIVERABLES" }), env)
      .catch((error) => console.error("Immediate delivery failed; the scheduled runner will retry:", error instanceof Error ? error.message : String(error)));
    if (ctx?.waitUntil) ctx.waitUntil(deliverNow);
  }
  return simplePage(200, "Approved", `<p>${escapeHtml(business)}'s menu and QR code are on their way to the buyer. You'll see the delivery email in your BCC copy within a minute.</p>`);
}

export {
  requeueForNewApproval,
  handleApprovalRequest
};
