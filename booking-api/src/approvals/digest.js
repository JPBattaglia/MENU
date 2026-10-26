// One owner email per runner tick for everything newly waiting for approval. A single waiting item gets the
// product's own detailed email; two or more share a digest with one "approve all" page and a link per item.
import { APPROVAL_TTL_DAYS, ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { DELIVERABLE_LABELS } from "../lib/config.js";
import { presenterFor, labelFor } from "./presenters.js";
import { DEFAULT_STEP_KEY } from "./actions.js";
import { isTestOrder, loadDeliveryContext, loadStepContext } from "./release.js";

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Same approvals always give the same digest id, so a retried send never produces a second email.
async function digestIdFor(approvalIds) {
  const hex = await sha256Hex([...approvalIds].sort().join(","));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function filesFor(approval, env) {
  const metadata = parseJsonOrNull(approval.metadata_json) || {};
  const files = [];
  for (const id of metadata.deliverable_ids || []) {
    const row = await env.DB.prepare(`
        SELECT d.id, d.deliverable_type, a.original_filename FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.id = ?
      `).bind(id).first();
    if (row) files.push(row);
  }
  return files;
}

async function describeApproval(env, approval) {
  const metadata = parseJsonOrNull(approval.metadata_json) || {};
  const base = publicBaseUrl(env);
  const context = await loadDeliveryContext(approval.project_id, env);
  if (!context || !metadata.workflow_run_id) throw new Error(`Approval ${approval.id} has no project or workflow run`);
  const stepKey = metadata.step_key || DEFAULT_STEP_KEY;
  const targetStep = await loadStepContext(env, metadata.workflow_run_id, stepKey);
  const presenter = presenterFor(context.workflow_key);
  const files = await filesFor(approval, env);
  const previews = [];
  for (const file of files) {
    const token = await signLinkToken(env, { kind: "preview", id: file.id, ttlDays: APPROVAL_TTL_DAYS });
    previews.push({ label: `Preview ${DELIVERABLE_LABELS[file.deliverable_type] || labelFor(file)}`, url: `${base}/api/delivery/${file.id}?t=${token}` });
  }
  const approveToken = await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: APPROVAL_TTL_DAYS });
  const approveUrl = `${base}/api/approvals/${approval.id}?t=${approveToken}`;
  return { approval, metadata, context, targetStep, presenter, files, previews, approveUrl, label: presenter.ownerLabel(context) };
}

async function markNotified(env, entry, extra = {}) {
  const metadata = { ...entry.metadata, ...extra, owner_notified_at: nowIso() };
  await env.DB.prepare(`UPDATE approvals SET metadata_json = ? WHERE id = ?`).bind(JSON.stringify(metadata), entry.approval.id).run();
}

async function sendSingle(env, entry) {
  const mail = await entry.presenter.ownerEmail({
    context: entry.context, files: entry.files, previews: entry.previews, approveUrl: entry.approveUrl,
    approval: entry.approval, targetStep: entry.targetStep, env
  });
  const to = entry.context.customer_email === SELF_TEST_EMAIL ? SELF_TEST_EMAIL : ownerEmailAddress(env);
  const sent = await sendTransactionalEmail(env, {
    to, subject: mail.subject, html: mail.html, text: mail.text,
    idempotencyKey: `owner-approval/${entry.approval.id}`,
    purpose: "OWNER_APPROVAL_REQUEST", templateKey: mail.templateKey,
    context: { orderId: entry.context.order_id, projectId: entry.context.id, businessId: entry.context.business_id }
  });
  if (sent.ok) await markNotified(env, entry);
  return sent.ok;
}

async function sendDigest(env, entries, selfTest) {
  const base = publicBaseUrl(env);
  const digestId = await digestIdFor(entries.map((e) => e.approval.id));
  const token = await signLinkToken(env, { kind: "approve_batch", id: digestId, ttlDays: APPROVAL_TTL_DAYS });
  const batchUrl = `${base}/api/approvals/batch/${digestId}?t=${token}`;
  const anyTest = entries.some((e) => isTestOrder(e.context));
  const subject = `${anyTest ? "[TEST] " : ""}${entries.length} items waiting for your approval`;
  const html = brandedEmailHtml({
    preheader: `${entries.length} finished items are waiting for your approval.`,
    eyebrow: anyTest ? "TEST ORDERS · OWNER APPROVAL" : "OWNER APPROVAL",
    heading: `${entries.length} items are ready to review`,
    paragraphs: ["These were produced automatically. Nothing goes to a buyer until you approve it."],
    rows: entries.map((e) => [e.label, `Order ${e.context.order_id}`]),
    buttons: [{ label: `Review and approve all ${entries.length}`, url: batchUrl, primary: true }, ...entries.map((e) => ({ label: `Review: ${e.label}`, url: e.approveUrl }))],
    footnote: `Links expire in ${APPROVAL_TTL_DAYS} days.`
  });
  const text = [
    `${entries.length} items are waiting for your approval. Nothing goes to a buyer until you approve it.`,
    "",
    `Review and approve all: ${batchUrl}`,
    "",
    ...entries.map((e) => `${e.label}: ${e.approveUrl}`),
    "",
    `Links expire in ${APPROVAL_TTL_DAYS} days.`
  ].join("\n");
  const sent = await sendTransactionalEmail(env, {
    to: selfTest ? SELF_TEST_EMAIL : ownerEmailAddress(env), subject, html, text,
    idempotencyKey: `owner-digest/${digestId}`,
    purpose: "OWNER_APPROVAL_REQUEST", templateKey: "owner_approval_digest_v1"
  });
  if (sent.ok) for (const entry of entries) await markNotified(env, entry, { digest_id: digestId });
  return sent.ok;
}

// Called at the end of every scheduled tick. Safe to call repeatedly: only never-notified approvals are sent.
async function sendOwnerDigests(env) {
  if (!env.DB) return { sent: 0 };
  const waiting = (await env.DB.prepare(`
      SELECT * FROM approvals
      WHERE approval_type = 'OWNER_RELEASE' AND status = 'PENDING'
        AND json_extract(metadata_json, '$.owner_notified_at') IS NULL
      ORDER BY requested_at ASC LIMIT 40
    `).all()).results || [];
  const groups = { owner: [], selfTest: [] };
  for (const approval of waiting) {
    try {
      const entry = await describeApproval(env, approval);
      (entry.context.customer_email === SELF_TEST_EMAIL ? groups.selfTest : groups.owner).push(entry);
    } catch (error) {
      console.error("Could not prepare owner approval email:", error instanceof Error ? error.message : String(error));
    }
  }
  let sent = 0;
  for (const [name, entries] of Object.entries(groups)) {
    if (entries.length === 0) continue;
    const ok = entries.length === 1 ? await sendSingle(env, entries[0]) : await sendDigest(env, entries, name === "selfTest");
    if (ok) sent += 1;
  }
  return { sent };
}

export { digestIdFor, describeApproval, sendOwnerDigests };
