// Menu Care PRODUCE step (stage 6). Two kinds of run reach it:
//   - the monthly period run (trigger SUBSCRIPTION_PERIOD): opens the month and emails the customer their change link
//   - a change-request run (trigger MENU_CARE_REQUEST): applies the customer's request to the live menu and stores
//     the result as a draft MENU_DRAFT. The shared DELIVER step then asks the owner to approve it; the approved
//     version replaces the old one at the same hosted menu address.
// A request the AI cannot apply safely (unclear, an invented price, most of the menu removed) is never drafted:
// the customer and the owner are told, and nothing changes on the live menu.
import { ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { signLinkToken } from "../../lib/links.js";
import { sanitizeFilename, sha256Hex } from "../../lib/util.js";
import { loadRegenerationNote } from "../../approvals/actions.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { buildDesignedMenuHtml, assertMenuRendered } from "../menu-qr/design.js";
import { MenuCareError, applyMenuChange, describeDiff, parseMenuHtml } from "./menu-edit.js";

const LINK_KIND = "menucare";
const LINK_TTL_DAYS = 400;

async function menuCareLink(env, subscriptionId) {
  const token = await signLinkToken(env, { kind: LINK_KIND, id: subscriptionId, ttlDays: LINK_TTL_DAYS });
  return `${publicBaseUrl(env)}/api/menu-care/${subscriptionId}?t=${token}`;
}

// The menu the public is looking at now: newest approved menu page of any project of this business.
async function loadLiveMenu(env, businessId) {
  const row = await env.DB.prepare(`
      SELECT a.storage_key
      FROM projects p
      JOIN deliverables d ON d.project_id = p.id
      JOIN assets a ON a.id = d.asset_id
      WHERE p.business_id = ? AND d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1
      ORDER BY d.delivered_at DESC, d.version DESC
      LIMIT 1
    `).bind(businessId).first();
  const object = row ? await env.ASSETS.get(row.storage_key) : null;
  return object ? await object.text() : null;
}

async function skipRemainingSteps(targetStep, reason, env) {
  await env.DB.prepare(`
      UPDATE workflow_steps SET status = 'SUCCEEDED', completed_at = ?, output_json = ?
      WHERE workflow_run_id = ? AND step_order > ? AND status = 'QUEUED'
    `).bind(nowIso(), JSON.stringify({ skipped: reason }), targetStep.workflow_run_id, targetStep.step_order).run();
}

async function finishRun(targetStep, context, output, env) {
  await completeStep(targetStep, output, env);
  await skipRemainingSteps(targetStep, output.outcome, env);
  const t = nowIso();
  await env.DB.prepare(`UPDATE workflow_runs SET status = 'SUCCEEDED', completed_at = ? WHERE id = ?`).bind(t, targetStep.workflow_run_id).run();
  await env.DB.prepare(`UPDATE projects SET status = 'DELIVERED', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?`).bind(t, t, context.id).run();
  await env.DB.prepare(`UPDATE order_items SET fulfillment_status = 'FULFILLED' WHERE id = ?`).bind(context.order_item_id).run();
}

async function runMonthOpening(targetStep, context, metadata, env) {
  const link = await menuCareLink(env, metadata.subscription_id);
  const business = context.business_name || "your business";
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `Menu Care: send your menu changes for ${business}`,
    html: brandedEmailHtml({
      preheader: "Price change? New dish? Tell us and we'll update your menu.",
      eyebrow: "MENU CARE",
      heading: "Need a change to your menu?",
      paragraphs: [
        `Hi ${escapeHtml(context.first_name || "there")},`,
        "Type what should change - a new price, a dish added or removed, a new description - and we'll update your online menu. The new version appears at the same address and QR code. We check each update before it goes live."
      ],
      buttons: [{ label: "Send a menu change", url: link, primary: true }],
      footnote: "Keep this email: the button works all month and every month while Menu Care is active."
    }),
    text: `Need a change to your menu?\n\nType what should change and we'll update your online menu at the same address and QR code. We check each update before it goes live.\n\nSend a menu change: ${link}`,
    idempotencyKey: `menu-care-open/${metadata.subscription_id}/${metadata.period_start}`,
    purpose: "MENU_CARE_OPEN",
    templateKey: "menu_care_open_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
  if (!sent.ok) throw new Error(`Menu Care opening email failed: ${sent.error}`);
  await finishRun(targetStep, context, { outcome: "MONTH_OPENED", email_id: sent.id }, env);
  return { outcome: "MONTH_OPENED" };
}

async function tellBlocked(env, context, request, reasons) {
  const business = context.business_name || "A customer";
  const list = reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("");
  await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `We need a little more detail for your menu change`,
    html: brandedEmailHtml({
      preheader: "We could not apply this change yet.",
      eyebrow: "MENU CARE",
      heading: "We need a little more detail",
      paragraphs: [
        `Hi ${escapeHtml(context.first_name || "there")}, we didn't change your menu yet because:`,
        `<ul>${list}</ul>`,
        "Please send it again with the exact wording and prices you want, using the same link as before. Your live menu has not changed."
      ],
      footnote: "Or just reply to this email and we'll take care of it."
    }),
    text: `We didn't change your menu yet because:\n- ${reasons.join("\n- ")}\n\nPlease send it again with the exact wording and prices you want. Your live menu has not changed.`,
    idempotencyKey: `menu-care-blocked/${request.id}`,
    purpose: "MENU_CARE_BLOCKED",
    templateKey: "menu_care_blocked_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[Menu Care] Request not applied for ${business}`,
    html: brandedEmailHtml({ eyebrow: "MENU CARE", heading: `${escapeHtml(business)}: request not applied`,
      paragraphs: [`Request: ${escapeHtml(request.request_text)}`, `<ul>${list}</ul>`] }),
    text: `${business}: request not applied\n\nRequest: ${request.request_text}\n- ${reasons.join("\n- ")}`,
    idempotencyKey: `menu-care-blocked-owner/${request.id}`,
    purpose: "MENU_CARE_BLOCKED_OWNER",
    templateKey: "menu_care_blocked_owner_v1"
  });
}

async function setRequest(env, id, status, result) {
  await env.DB.prepare(`UPDATE menu_change_requests SET status = ?, result_json = ?, updated_at = ? WHERE id = ?`)
    .bind(status, JSON.stringify(result || {}), nowIso(), id).run();
}

async function runMenuCareProduceStep(targetStep, env, deps = {}) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(context.id).first();
  const metadata = parseJsonOrNull(project?.metadata_json) || {};
  if (metadata.source !== "MENU_CARE_REQUEST") return runMonthOpening(targetStep, context, metadata, env);

  const request = await env.DB.prepare(`SELECT * FROM menu_change_requests WHERE id = ?`).bind(metadata.request_id).first();
  if (!request) throw new Error("Menu change request not found");
  const note = await loadRegenerationNote(env, context.id);
  const requestText = note ? `${request.request_text}\n\nCorrection from the reviewer on a previous attempt: ${note.note}` : request.request_text;

  const blockedBy = async (reasons) => {
    await tellBlocked(env, context, request, reasons);
    await setRequest(env, request.id, "NOT_APPLIED", { reasons });
    await finishRun(targetStep, context, { outcome: "NOT_APPLIED", reasons }, env);
    return { outcome: "NOT_APPLIED", reasons };
  };

  const liveHtml = await loadLiveMenu(env, context.business_id);
  if (!liveHtml) return blockedBy(["We could not find your published menu yet"]);
  let live;
  try {
    live = parseMenuHtml(liveHtml);
  } catch (error) {
    if (error instanceof MenuCareError) return blockedBy([error.message]);
    throw error;
  }
  const change = await applyMenuChange(env, {
    menu: live.menu, requestText,
    scope: { entityType: "SUBSCRIPTION", entityId: request.subscription_id, correlationId: targetStep.workflow_run_id },
    deps
  });
  if (!change.understood || change.problems.length) return blockedBy(change.problems);

  const html = buildDesignedMenuHtml({
    businessName: live.businessName || context.business_name,
    brandColors: [live.primary, live.accent].filter(Boolean).join(", "),
    menu: change.menu,
    logoDataUri: live.logoDataUri
  });
  assertMenuRendered(html, change.menu);
  const bytes = new TextEncoder().encode(html);
  const checksum = await sha256Hex(bytes);
  const assetId = crypto.randomUUID();
  const deliverableId = crypto.randomUUID();
  const filename = `${sanitizeFilename(context.business_name || "menu")}-menu-update.html`;
  const storageKey = ["customers", context.customer_id, "projects", context.id, "deliverables", "menu-care", `${assetId}.html`].join("/");
  const t = nowIso();
  const diffLines = describeDiff(change.diff);
  const existing = await env.DB.prepare(`SELECT d.id, d.version FROM deliverables d WHERE d.project_id = ? AND d.deliverable_type = 'MENU_DRAFT' ORDER BY d.version DESC LIMIT 1`).bind(context.id).first();
  const version = Number(existing?.version || 0) + 1;
  await env.ASSETS.put(storageKey, bytes, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type,
        size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, ?, 'text/html', ?, ?, 'VALID', ?, ?, 1, 0, 1, ?)
    `).bind(assetId, context.business_id || null, context.customer_id, context.id, storageKey, filename, bytes.byteLength, checksum, t, t,
    JSON.stringify({ generated_by: "MENU_MADE_AUTOMATION", care: { request_id: request.id, summary: change.summary, changes: diffLines } })).run();
  await env.DB.prepare(`
      INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, created_at)
      VALUES (?, ?, ?, 'MENU_DRAFT', ?, 'DRAFT', 0, ?)
    `).bind(deliverableId, context.id, assetId, version, t).run();
  await setRequest(env, request.id, "DRAFTED", { summary: change.summary, changes: diffLines, deliverable_id: deliverableId });
  const output = { outcome: "DRAFTED", summary: change.summary, changes: diffLines, deliverable_id: deliverableId, version };
  await completeStep(targetStep, output, env);
  return output;
}

export { LINK_KIND, finishRun, loadLiveMenu, menuCareLink, runMenuCareProduceStep };
