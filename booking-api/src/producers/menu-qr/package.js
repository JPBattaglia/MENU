import { APPROVAL_TTL_DAYS, DELIVERABLE_LABELS, DELIVERY_LINK_TTL_DAYS, addDaysIso, ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { recordProjectEvent } from "../../lib/db.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, escapeHtml, looksLikeEmail, sendTransactionalEmail } from "../../lib/email.js";
import { jsonResponse, nowIso, parseJsonOrNull } from "../../lib/http.js";
import { signLinkToken } from "../../lib/links.js";
import { getInputValue, loadPreparedPayload } from "./inputs.js";
import { completeStep, retryStepLater } from "../../workflows/runner.js";
import { pageBillingNote } from "./page-billing.js";

async function loadDeliveryContext(projectId, env) {
  return env.DB.prepare(`
      SELECT
        p.id, p.order_id, p.order_item_id, p.customer_id, p.business_id, p.workflow_key, p.status,
        b.name AS business_name,
        c.email AS customer_email, c.first_name, c.last_name,
        o.stripe_checkout_session_id
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

async function loadPackageDeliverables(projectId, env) {
  const rows = (await env.DB.prepare(`
      SELECT d.id, d.deliverable_type, d.version, d.status, d.customer_visible,
        a.original_filename, a.mime_type, a.size_bytes, a.storage_key
      FROM deliverables d
      JOIN assets a ON a.id = d.asset_id
      WHERE d.project_id = ?
        AND d.deliverable_type IN ('MENU_DRAFT', 'QR_CODE')
        AND d.status != 'SUPERSEDED'
      ORDER BY d.deliverable_type ASC, d.version DESC
    `).bind(projectId).all()).results || [];
  const newest = {};
  for (const row of rows) {
    if (!newest[row.deliverable_type]) newest[row.deliverable_type] = row;
  }
  if (!newest.MENU_DRAFT || !newest.QR_CODE) {
    throw new Error("PACKAGE_DELIVERABLES: a menu draft and a QR code are required");
  }
  return [newest.MENU_DRAFT, newest.QR_CODE];
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

async function notifyOwnerForApproval(targetStep, context, files, approval, env) {
  const base = publicBaseUrl(env);
  const approveToken = await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: APPROVAL_TTL_DAYS });
  const approveUrl = `${base}/api/approvals/${approval.id}?t=${approveToken}`;
  const previews = [];
  for (const file of files) {
    const token = await signLinkToken(env, { kind: "preview", id: file.id, ttlDays: APPROVAL_TTL_DAYS });
    previews.push({ label: `Preview ${DELIVERABLE_LABELS[file.deliverable_type] || file.deliverable_type}`, url: `${base}/api/delivery/${file.id}?t=${token}` });
  }
  const test = isTestOrder(context);
  const business = context.business_name || "A customer";
  const buyer = [context.first_name, context.last_name].filter(Boolean).join(" ") || context.customer_email;
  const subject = `${test ? "[TEST] " : ""}Approve ${business}'s online menu + QR`;
  const draftStep = await env.DB.prepare(`
      SELECT output_json FROM workflow_steps
      WHERE workflow_run_id = ? AND step_key = 'GENERATE_MENU_DRAFT' AND status = 'SUCCEEDED' LIMIT 1
    `).bind(targetStep.workflow_run_id).first();
  const extraction = parseJsonOrNull(draftStep?.output_json)?.source?.extraction || null;
  const pagesNote = pageBillingNote((await loadPreparedPayload(targetStep, env).catch(() => null))?.page_billing);
  const readingNote = extraction
    ? `Read from the uploaded menu file: ${extraction.item_count} items.${extraction.unreadable ? ` Check carefully: ${extraction.unreadable}` : ""}`
    : "";
  const html = brandedEmailHtml({
    preheader: `${business}'s menu and QR code are ready for your review.`,
    eyebrow: test ? "TEST ORDER · OWNER APPROVAL" : "OWNER APPROVAL",
    heading: `${business}'s menu is ready to review`,
    paragraphs: [
      "The menu page and QR code were produced automatically. Nothing goes to the buyer until you approve.",
      ...readingNote ? [escapeHtml(readingNote)] : [],
      ...pagesNote ? [escapeHtml(`Menu pages: ${pagesNote}`)] : [],
      "Preview both files, then approve to send them to the buyer."
    ],
    rows: [["Business", business], ["Buyer", buyer], ["Order", context.order_id], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
    buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
    footnote: "If the files need changes, reply to this email. Change requests from this email arrive in a later update."
  });
  const text = [
    `${business}'s online menu and QR code are ready for your review. Nothing goes to the buyer until you approve.`,
    ...readingNote ? ["", readingNote] : [],
    ...pagesNote ? ["", `Menu pages: ${pagesNote}`] : [],
    "",
    ...previews.map((p) => `${p.label}: ${p.url}`),
    "",
    `Review and approve: ${approveUrl}`,
    "",
    `Buyer: ${buyer}`,
    `Order: ${context.order_id}`,
    `This link expires in ${APPROVAL_TTL_DAYS} days.`
  ].join("\n");
  return sendTransactionalEmail(env, {
    // Self-test orders keep their approval request out of the owner's inbox.
    to: context.customer_email === SELF_TEST_EMAIL ? SELF_TEST_EMAIL : ownerEmailAddress(env),
    subject,
    html,
    text,
    idempotencyKey: `owner-approval/${approval.id}`,
    purpose: "OWNER_APPROVAL_REQUEST",
    templateKey: "owner_approval_menu_qr_v1",
    context: { orderId: context.order_id, projectId: context.id, businessId: context.business_id }
  });
}

async function deliverPackageToBuyer(targetStep, context, files, approval, env) {
  const timestamp = nowIso();
  for (const file of files) {
    await env.DB.prepare(`
        UPDATE deliverables
        SET status = 'FINAL', customer_visible = 1, delivered_at = COALESCE(delivered_at, ?)
        WHERE id = ? AND status != 'SUPERSEDED'
      `).bind(timestamp, file.id).run();
  }
  const prepared = await loadPreparedPayload(targetStep, env);
  const contactEmail = getInputValue(prepared.inputs, "contact_email");
  const recipient = looksLikeEmail(contactEmail) ? String(contactEmail).trim() : String(context.customer_email || "").trim();
  if (!looksLikeEmail(recipient)) {
    throw new Error("No valid buyer email address for delivery");
  }
  const qrDestination = getInputValue(prepared.inputs, "qr_destination");
  const base = publicBaseUrl(env);
  const hosted = typeof qrDestination === "string" && qrDestination.startsWith(`${base}/api/menu/`);
  const links = [];
  for (const file of files) {
    const token = await signLinkToken(env, { kind: "deliver", id: file.id, ttlDays: DELIVERY_LINK_TTL_DAYS });
    links.push({
      type: file.deliverable_type,
      label: file.deliverable_type === "MENU_DRAFT" ? "View your online menu" : "Download your QR code",
      url: `${base}/api/delivery/${file.id}?t=${token}${file.deliverable_type === "QR_CODE" ? "&download=1" : ""}`,
      filename: file.original_filename
    });
  }
  const business = context.business_name || "your business";
  const firstName = context.first_name || "there";
  const subject = `${isTestOrder(context) ? "[TEST] " : ""}Your online menu and QR code are ready`;
  const html = brandedEmailHtml({
    preheader: `Your MENU-MADE menu page and QR code for ${business} are ready.`,
    eyebrow: "YOUR ORDER IS READY",
    heading: `${business}'s menu and QR code are ready`,
    paragraphs: [
      `Hi ${escapeHtml(firstName)},`,
      "Your mobile-friendly menu page and QR code are finished. Use the buttons below to open and save them.",
      hosted ? `Your menu is live at <a href="${escapeHtml(qrDestination)}">${escapeHtml(qrDestination)}</a>, and your QR code opens it. Print the QR code for your tables; there's nothing else to set up.` : qrDestination ? `Your QR code opens <strong>${escapeHtml(qrDestination)}</strong>. Put the menu page at that address (or send it to whoever manages your website), then print the QR code for your tables.` : "Print the QR code for your tables and place the menu page where it points."
    ],
    buttons: links.map((link, index) => ({ label: link.label, url: link.url, primary: index === 0 })),
    footnote: `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save both files. Questions or changes? Reply to this email.`
  });
  const text = [
    `Hi ${firstName},`,
    "",
    `Your menu page and QR code for ${business} are ready.`,
    "",
    ...links.map((link) => `${link.label}: ${link.url}`),
    "",
    hosted ? `Your menu is live at ${qrDestination}, and your QR code opens it. Print the QR code for your tables; there's nothing else to set up.` : qrDestination ? `Your QR code opens ${qrDestination}. Put the menu page at that address, then print the QR code for your tables.` : "",
    `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save both files. Questions or changes? Reply to this email.`,
    "",
    "The MENU-MADE team"
  ].join("\n");
  const sent = await sendTransactionalEmail(env, {
    to: recipient,
    subject,
    html,
    text,
    idempotencyKey: `delivery/${context.id}/${approval.id}`,
    purpose: "ORDER_DELIVERY",
    templateKey: "delivery_menu_qr_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id },
    bccInternal: true
  });
  if (!sent.ok) {
    return retryStepLater(targetStep, env, `Delivery email failed: ${sent.error}`);
  }
  const output = {
    delivered_at: timestamp,
    recipient,
    approval_id: approval.id,
    email_id: sent.id,
    link_ttl_days: DELIVERY_LINK_TTL_DAYS,
    files: files.map((f) => ({ deliverable_id: f.id, type: f.deliverable_type, filename: f.original_filename }))
  };
  await completeStep(targetStep, output, env);
  await env.DB.prepare(`
      UPDATE workflow_runs
      SET status = 'SUCCEEDED', completed_at = ?, output_json = ?, error_code = NULL, error_message = NULL
      WHERE id = ?
    `).bind(timestamp, JSON.stringify(output), targetStep.workflow_run_id).run();
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
    approval_id: approval.id,
    recipient,
    deliverable_ids: files.map((f) => f.id)
  });
  return { waiting: false, output };
}

async function runPackageDeliverablesStep(targetStep, env) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const files = await loadPackageDeliverables(context.id, env);
  let approval = await env.DB.prepare(`
      SELECT * FROM approvals
      WHERE project_id = ? AND approval_type = 'OWNER_RELEASE'
      ORDER BY requested_at DESC, rowid DESC
      LIMIT 1
    `).bind(context.id).first();
  if (!approval || approval.status === "EXPIRED" || approval.status === "CANCELLED") {
    const requestedAt = nowIso();
    approval = {
      id: crypto.randomUUID(),
      status: "PENDING",
      metadata_json: JSON.stringify({
        workflow_run_id: targetStep.workflow_run_id,
        deliverable_ids: files.map((f) => f.id),
        owner_notified_at: null
      })
    };
    await env.DB.prepare(`
        INSERT INTO approvals (
          id, project_id, approval_type, status, revision_number, revision_limit,
          requested_at, expires_at, metadata_json
        )
        VALUES (?, ?, 'OWNER_RELEASE', 'PENDING', 1, 2, ?, ?, ?)
      `).bind(approval.id, context.id, requestedAt, addDaysIso(APPROVAL_TTL_DAYS), approval.metadata_json).run();
    await recordProjectEvent(env, context.id, "OWNER_APPROVAL_REQUESTED", targetStep.workflow_run_id, { approval_id: approval.id });
  }
  if (approval.status === "PENDING") {
    const metadata = parseJsonOrNull(approval.metadata_json) || {};
    if (!metadata.owner_notified_at) {
      const sent = await notifyOwnerForApproval(targetStep, context, files, approval, env);
      if (!sent.ok) {
        return retryStepLater(targetStep, env, `Owner approval email failed: ${sent.error}`);
      }
      metadata.owner_notified_at = nowIso();
      await env.DB.prepare(`UPDATE approvals SET metadata_json = ? WHERE id = ?`).bind(JSON.stringify(metadata), approval.id).run();
    }
    return parkForOwnerApproval(targetStep, context, approval, env);
  }
  if (approval.status === "APPROVED") {
    return deliverPackageToBuyer(targetStep, context, files, approval, env);
  }
  throw new Error(`Owner approval is ${approval.status}; revisions are handled in a later stage`);
}

export {
  loadDeliveryContext,
  isTestOrder,
  loadPackageDeliverables,
  parkForOwnerApproval,
  notifyOwnerForApproval,
  deliverPackageToBuyer,
  runPackageDeliverablesStep
};
