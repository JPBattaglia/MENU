// The owner's approval pages. One item: preview, approve, or request changes. A digest batch: approve everything
// still waiting in one click. GET only shows a page (so email link scanners can't approve anything); POST acts.
import { APPROVAL_TTL_DAYS } from "../lib/config.js";
import { escapeHtml } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { verifyLinkToken } from "../lib/links.js";
import { approveApproval, requestChanges, requeueForNewApproval } from "./actions.js";
import { describeApproval } from "./digest.js";
import { isTestOrder, loadDeliveryContext } from "./release.js";

async function readForm(request) {
  if (request.method !== "POST") return new URLSearchParams(new URL(request.url).search);
  try {
    const form = await request.formData();
    return new URLSearchParams([...form.entries()].filter(([, v]) => typeof v === "string"));
  } catch {
    return new URLSearchParams();
  }
}

const previewButtons = (previews) => previews.map((p) => `<a class="btn" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.label)}</a>`).join("");

async function handleApprovalRequest(request, env, ctx, approvalId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const form = await readForm(request);
  const token = form.get("t");
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
  if (approval.status === "CHANGES_REQUESTED") {
    return simplePage(200, "Changes requested", `<p>${escapeHtml(business)}: your note was recorded${approval.customer_comments ? ` (“${escapeHtml(approval.customer_comments)}”)` : ""}. A new version arrives as a fresh approval email, or the item is flagged in your queue.</p>`);
  }
  if (approval.status !== "PENDING") {
    return simplePage(409, "Nothing to approve", `<p>This approval is ${escapeHtml(approval.status.toLowerCase())}.</p>`);
  }
  if (request.method !== "POST") {
    const entry = await describeApproval(env, approval);
    const product = context?.offer_name || "order";
    const revision = Number(approval.revision_number) > 1 ? `<p><strong>Revision ${Number(approval.revision_number)}</strong> (redone after your change request)</p>` : "";
    return simplePage(200, `Approve ${business}'s ${product}`, `
${revision}<p>Check the files. Approving sends them to the buyer right away.</p>
<dl><dt>Business</dt><dd>${escapeHtml(business)}</dd><dt>Buyer</dt><dd>${escapeHtml(context?.customer_email || "")}</dd><dt>Order</dt><dd>${escapeHtml(context?.order_id || "")}${isTestOrder(context) ? " (test order)" : ""}</dd></dl>
<p>${previewButtons(entry.previews)}</p>
<form method="post" action="/api/approvals/${escapeHtml(approvalId)}"><input type="hidden" name="t" value="${escapeHtml(token)}"><input type="hidden" name="action" value="approve"><button type="submit">Approve and send to buyer</button></form>
<hr>
<form method="post" action="/api/approvals/${escapeHtml(approvalId)}"><input type="hidden" name="t" value="${escapeHtml(token)}"><input type="hidden" name="action" value="changes">
<label for="note"><strong>Something wrong?</strong> Say what to change:</label><br>
<textarea id="note" name="note" rows="4" maxlength="1000" required style="width:100%;margin:8px 0"></textarea><br>
<button type="submit">Request changes</button></form>`);
  }

  if (form.get("action") === "changes") {
    const note = String(form.get("note") || "").trim();
    if (note.length < 3) return simplePage(400, "Add a note", "<p>Say what should change, then submit again.</p>");
    const result = await requestChanges(env, approval, note);
    if (!result.changed) return simplePage(200, "Already handled", "<p>This approval was already answered.</p>");
    return simplePage(200, "Changes requested", result.regenerating
      ? `<p>Got it. ${escapeHtml(business)}'s ${escapeHtml(context?.offer_name || "order")} is being redone with your note. You'll get a fresh approval email within about 10 minutes.</p>`
      : `<p>Noted. ${escapeHtml(business)}'s order can't be redone automatically, so it's flagged in your queue as needing a manual fix. Nothing was sent to the buyer.</p>`);
  }

  const result = await approveApproval(env, ctx, approval, "OWNER");
  if (!result.changed) return simplePage(200, "Already handled", "<p>This approval was already answered.</p>");
  return simplePage(200, "Approved", `<p>${escapeHtml(business)}'s files are on their way to the buyer. You'll see the delivery email in your BCC copy within a minute.</p>`);
}

async function handleBatchApprovalRequest(request, env, ctx, digestId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const form = await readForm(request);
  const token = form.get("t");
  const payload = await verifyLinkToken(env, token, ["approve_batch"], digestId);
  if (!payload) return simplePage(403, "This link isn't valid", "<p>Open the link from your most recent approval email.</p>");
  if (payload.expired) return simplePage(410, "This link expired", "<p>Open the newest approval email, or review items one by one from your queue.</p>");
  const items = (await env.DB.prepare(`
      SELECT * FROM approvals WHERE approval_type = 'OWNER_RELEASE' AND json_extract(metadata_json, '$.digest_id') = ? ORDER BY requested_at ASC
    `).bind(digestId).all()).results || [];
  if (items.length === 0) return simplePage(404, "Nothing here", "<p>This batch no longer exists.</p>");
  const pending = items.filter((item) => item.status === "PENDING");

  if (request.method === "POST") {
    if (pending.length === 0) return simplePage(200, "Nothing waiting", "<p>Everything in this batch was already answered.</p>");
    let approved = 0;
    for (const item of pending) {
      if ((await approveApproval(env, ctx, item, "OWNER")).changed) approved += 1;
    }
    return simplePage(200, "Approved", `<p>${approved} item${approved === 1 ? "" : "s"} approved and on the way to the buyers.</p>`);
  }

  const rows = [];
  for (const item of items) {
    const entry = await describeApproval(env, item);
    const single = item.status === "PENDING" ? `<a class="btn" href="${escapeHtml(entry.approveUrl)}">Open to approve or request changes</a>` : `<em>${escapeHtml(item.status.toLowerCase().replaceAll("_", " "))}</em>`;
    rows.push(`<dt>${escapeHtml(entry.label)}</dt><dd>${previewButtons(entry.previews)} ${single}</dd>`);
  }
  return simplePage(200, `Approve ${pending.length} item${pending.length === 1 ? "" : "s"}`, `
<p>Look through each item, then approve everything still waiting in one click. For anything that needs changes, open it and request them instead (it stays out of the batch).</p>
<dl>${rows.join("")}</dl>
${pending.length ? `<form method="post" action="/api/approvals/batch/${escapeHtml(digestId)}"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">Approve all ${pending.length} waiting</button></form>` : "<p>Nothing is waiting any more.</p>"}
<p><small>Links in this batch expire in ${APPROVAL_TTL_DAYS} days.</small></p>`);
}

export {
  requeueForNewApproval,
  handleApprovalRequest,
  handleBatchApprovalRequest
};
