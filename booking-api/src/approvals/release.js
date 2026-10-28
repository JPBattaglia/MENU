// Stage 4: the shared deliver step. Any workflow ends with it: Menu + QR through PACKAGE_DELIVERABLES, every
// later producer through DELIVER. The routing (routing.js) decides per deliverable whether it goes straight to
// the buyer or waits for the owner; what the emails say comes from a small per-product "presenter".
//
// A presenter provides:
//   loadFiles(context, targetStep, env)  -> [{ id, deliverable_type, original_filename, customer_visible, approval }]
//   ownerLabel(context)                  -> short text for the owner digest ("Proof Cafe - Online menu + QR")
//   ownerEmail({ context, files, previews, approveUrl, approval, targetStep, env })
//                                        -> { subject, html, text, templateKey }   (used when one item is waiting)
//   buyerEmail({ context, files, linkFor, targetStep, env })
//                                        -> { recipient, subject, html, text, templateKey }
import { APPROVAL_TTL_DAYS, addDaysIso, DELIVERY_LINK_TTL_DAYS, publicBaseUrl } from "../lib/config.js";
import { recordProjectEvent } from "../lib/db.js";
import { looksLikeEmail, sendTransactionalEmail } from "../lib/email.js";
import { jsonResponse, nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { completeStep, retryStepLater } from "../workflows/runner.js";
import { partitionFiles, resolveRouting } from "./routing.js";

async function loadDeliveryContext(projectId, env) {
  return env.DB.prepare(`
      SELECT
        p.id, p.order_id, p.order_item_id, p.customer_id, p.business_id, p.workflow_key, p.status,
        b.name AS business_name,
        c.email AS customer_email, c.first_name, c.last_name,
        o.stripe_checkout_session_id,
        (SELECT off.name FROM order_items oi JOIN offers off ON off.id = oi.offer_id WHERE oi.id = p.order_item_id) AS offer_name
      FROM projects p
      JOIN businesses b ON b.id = p.business_id
      JOIN customers c ON c.id = p.customer_id
      JOIN orders o ON o.id = p.order_id
      WHERE p.id = ?
      LIMIT 1
    `).bind(projectId).first();
}

function isTestOrder(context) {
  return String(context?.stripe_checkout_session_id || "").startsWith("cs_test_");
}

// The runner's step shape, rebuilt from a workflow run (used outside the runner, e.g. by the owner digest).
async function loadStepContext(env, workflowRunId, stepKey) {
  return env.DB.prepare(`
      SELECT ws.id AS workflow_step_id, ws.workflow_run_id, ws.step_key, ws.step_order, ws.status AS step_status,
             wr.project_id, wr.workflow_key, wr.workflow_version, wr.status AS workflow_status,
             p.order_id, p.customer_id, p.business_id, p.status AS project_status
      FROM workflow_steps ws
      JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
      JOIN projects p ON p.id = wr.project_id
      WHERE ws.workflow_run_id = ? AND ws.step_key = ?
      LIMIT 1
    `).bind(workflowRunId, stepKey).first();
}

async function parkForOwnerApproval(targetStep, context, approval, env) {
  const timestamp = nowIso();
  await env.DB.prepare(`
      UPDATE workflow_steps SET status = 'WAITING', error_message = NULL, output_json = ? WHERE id = ?
    `).bind(JSON.stringify({ waiting_for: "OWNER_APPROVAL", approval_id: approval.id }), targetStep.workflow_step_id).run();
  await env.DB.prepare(`
      UPDATE workflow_runs SET status = 'WAITING', error_code = 'OWNER_APPROVAL_REQUIRED', error_message = 'Waiting for owner approval' WHERE id = ?
    `).bind(targetStep.workflow_run_id).run();
  await env.DB.prepare(`
      UPDATE projects SET status = 'QC_REQUIRED', updated_at = ? WHERE id = ?
    `).bind(timestamp, context.id).run();
  await env.DB.prepare(`
      UPDATE orders SET status = 'QC_REQUIRED', updated_at = ?
      WHERE id = ? AND status NOT IN ('CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'DELIVERED', 'COMPLETED')
    `).bind(timestamp, context.order_id).run();
  await env.DB.prepare(`
      UPDATE order_items SET fulfillment_status = 'AWAITING_APPROVAL' WHERE id = ?
    `).bind(context.order_item_id).run();
  return {
    waiting: true,
    response: jsonResponse({
      ok: true,
      processed: true,
      status: "WAITING",
      waiting_for: "OWNER_APPROVAL",
      approval_id: approval.id,
      workflow_run_id: targetStep.workflow_run_id,
      workflow_step_id: targetStep.workflow_step_id,
      step_key: targetStep.step_key
    }, 202)
  };
}

// Emails the buyer their files, then (only after the email went out) makes them downloadable.
async function sendToBuyer(targetStep, context, files, approval, presenter, env) {
  const base = publicBaseUrl(env);
  const linkFor = async (file, { download = false } = {}) => {
    const token = await signLinkToken(env, { kind: "deliver", id: file.id, ttlDays: DELIVERY_LINK_TTL_DAYS });
    return `${base}/api/delivery/${file.id}?t=${token}${download ? "&download=1" : ""}`;
  };
  const mail = await presenter.buyerEmail({ context, files, linkFor, targetStep, env });
  if (!looksLikeEmail(mail.recipient)) throw new Error("No valid buyer email address for delivery");
  const sent = await sendTransactionalEmail(env, {
    to: String(mail.recipient).trim(),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    idempotencyKey: approval ? `delivery/${context.id}/${approval.id}` : `delivery/${context.id}/auto-${targetStep.workflow_run_id}-${files[0].id}`,
    purpose: "ORDER_DELIVERY",
    templateKey: mail.templateKey,
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id },
    bccInternal: true
  });
  if (!sent.ok) {
    return { retry: await retryStepLater(targetStep, env, `Delivery email failed: ${sent.error}`) };
  }
  const timestamp = nowIso();
  for (const file of files) {
    await env.DB.prepare(`
        UPDATE deliverables
        SET status = 'FINAL', customer_visible = 1, delivered_at = COALESCE(delivered_at, ?)
        WHERE id = ? AND status != 'SUPERSEDED'
      `).bind(timestamp, file.id).run();
  }
  return { recipient: String(mail.recipient).trim(), emailId: sent.id, deliveredAt: timestamp };
}

async function finishDelivery(targetStep, context, output, routingLabel, approval, files, env) {
  const timestamp = output.delivered_at || nowIso();
  const fullOutput = { ...output, routing: routingLabel };
  await completeStep(targetStep, fullOutput, env);
  await env.DB.prepare(`
      UPDATE workflow_runs
      SET status = 'SUCCEEDED', completed_at = ?, output_json = ?, error_code = NULL, error_message = NULL
      WHERE id = ?
    `).bind(timestamp, JSON.stringify(fullOutput), targetStep.workflow_run_id).run();
  await env.DB.prepare(`
      UPDATE projects
      SET status = 'DELIVERED', completed_at = COALESCE(completed_at, ?), blocked_reason = NULL, updated_at = ?
      WHERE id = ?
    `).bind(timestamp, timestamp, context.id).run();
  await env.DB.prepare(`
      UPDATE order_items SET fulfillment_status = 'FULFILLED' WHERE id = ?
    `).bind(context.order_item_id).run();
  const open = await env.DB.prepare(`
      SELECT COUNT(*) AS remaining FROM projects
      WHERE order_id = ? AND status NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED')
    `).bind(context.order_id).first();
  if (Number(open?.remaining || 0) === 0) {
    await env.DB.prepare(`
        UPDATE orders SET status = 'DELIVERED', updated_at = ?
        WHERE id = ? AND status NOT IN ('CANCELLED', 'REFUND_PENDING', 'REFUNDED')
      `).bind(timestamp, context.order_id).run();
  }
  await recordProjectEvent(env, context.id, "PROJECT_DELIVERED", targetStep.workflow_run_id, {
    approval_id: approval?.id || null,
    routing: routingLabel,
    recipient: output.recipient || null,
    deliverable_ids: files.map((f) => f.id)
  });
  return { waiting: false, output: fullOutput };
}

async function latestOwnerApproval(projectId, env) {
  return env.DB.prepare(`
      SELECT * FROM approvals
      WHERE project_id = ? AND approval_type = 'OWNER_RELEASE'
      ORDER BY requested_at DESC, rowid DESC
      LIMIT 1
    `).bind(projectId).first();
}

async function createOwnerApproval(targetStep, context, ownerFiles, routing, previous, env) {
  const requestedAt = nowIso();
  const metadata = {
    workflow_run_id: targetStep.workflow_run_id,
    step_key: targetStep.step_key,
    deliverable_ids: ownerFiles.map((f) => f.id),
    owner_notified_at: null,
    routing: { mode: routing.mode, source: routing.source }
  };
  const approval = { id: crypto.randomUUID(), status: "PENDING", metadata_json: JSON.stringify(metadata) };
  await env.DB.prepare(`
      INSERT INTO approvals (
        id, project_id, approval_type, status, revision_number, revision_limit,
        requested_at, expires_at, metadata_json
      )
      VALUES (?, ?, 'OWNER_RELEASE', 'PENDING', ?, 2, ?, ?, ?)
    `).bind(approval.id, context.id, Number(previous?.revision_number || 0) + 1, requestedAt, addDaysIso(APPROVAL_TTL_DAYS), approval.metadata_json).run();
  await recordProjectEvent(env, context.id, "OWNER_APPROVAL_REQUESTED", targetStep.workflow_run_id, {
    approval_id: approval.id,
    routing: metadata.routing,
    revision: Number(previous?.revision_number || 0) + 1
  });
  return approval;
}

async function runDeliverStep(targetStep, env, presenter) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const files = await presenter.loadFiles(context, targetStep, env);
  const pending = files.filter((file) => !Number(file.customer_visible));
  const approval = await latestOwnerApproval(context.id, env);
  if (pending.length === 0) {
    return finishDelivery(targetStep, context, { already_delivered: true }, approval ? "OWNER" : "AUTO", approval, files, env);
  }

  const routing = await resolveRouting(env, {
    projectId: context.id,
    workflowKey: targetStep.workflow_key,
    workflowVersion: targetStep.workflow_version,
    stepKey: targetStep.step_key
  });
  const { auto, owner } = partitionFiles(routing, pending);

  let delivered = null;
  if (auto.length > 0) {
    const sent = await sendToBuyer(targetStep, context, auto, null, presenter, env);
    if (sent.retry) return sent.retry;
    delivered = sent;
  }
  if (owner.length === 0) {
    return finishDelivery(targetStep, context, {
      delivered_at: delivered.deliveredAt,
      recipient: delivered.recipient,
      email_id: delivered.emailId,
      files: auto.map((f) => ({ deliverable_id: f.id, type: f.deliverable_type, filename: f.original_filename }))
    }, "AUTO", null, auto, env);
  }

  let current = approval;
  if (!current || !["PENDING", "APPROVED"].includes(current.status)) {
    current = await createOwnerApproval(targetStep, context, owner, routing, approval, env);
  }
  if (current.status === "PENDING") {
    return parkForOwnerApproval(targetStep, context, current, env);
  }
  const sent = await sendToBuyer(targetStep, context, owner, current, presenter, env);
  if (sent.retry) return sent.retry;
  return finishDelivery(targetStep, context, {
    delivered_at: sent.deliveredAt,
    recipient: sent.recipient,
    approval_id: current.id,
    email_id: sent.emailId,
    link_ttl_days: DELIVERY_LINK_TTL_DAYS,
    files: owner.map((f) => ({ deliverable_id: f.id, type: f.deliverable_type, filename: f.original_filename }))
  }, "OWNER", current, owner, env);
}

export {
  loadDeliveryContext,
  isTestOrder,
  loadStepContext,
  parkForOwnerApproval,
  latestOwnerApproval,
  createOwnerApproval,
  finishDelivery,
  runDeliverStep
};
