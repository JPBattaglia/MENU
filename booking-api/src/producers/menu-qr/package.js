import { APPROVAL_TTL_DAYS, DELIVERABLE_LABELS, DELIVERY_LINK_TTL_DAYS } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, looksLikeEmail as looksLikeEmailValue } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { publicBaseUrl } from "../../lib/config.js";
import { getInputValue, loadPreparedPayload } from "./inputs.js";
import { isTestOrder, loadDeliveryContext, runDeliverStep } from "../../approvals/release.js";
import { pageBillingNote } from "./page-billing.js";

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

const AFTER_APPROVAL = "The buyer gets six things: the live menu page, the QR code, a print-ready menu (PDF), a tri-fold menu (PDF), a QR table tent (PDF) and a TV menu screen. Each has its own preview button here. To change anything, use Request changes on the review page and say what to change; the menu is redone from your words and comes back for approval.";

// Owner email for one waiting Menu + QR order (the shared digest uses this when a single item is waiting).
async function menuQrOwnerEmail({ context, files, previews, approveUrl, targetStep, env }) {
  const test = isTestOrder(context);
  const business = context.business_name || "A customer";
  const buyer = [context.first_name, context.last_name].filter(Boolean).join(" ") || context.customer_email;
  const subject = `${test ? "[TEST] " : ""}Approve ${business}'s online menu + QR`;
  const draftStep = await env.DB.prepare(`
      SELECT output_json FROM workflow_steps
      WHERE workflow_run_id = ? AND step_key = 'GENERATE_MENU_DRAFT' AND status = 'SUCCEEDED' LIMIT 1
    `).bind(targetStep.workflow_run_id).first();
  const drafted = parseJsonOrNull(draftStep?.output_json)?.source || null;
  const extraction = drafted?.extraction || null;
  const ownerChange = drafted?.owner_change || null;
  const changeNote = !ownerChange ? ""
    : ownerChange.applied ? `Your change was made: ${ownerChange.summary || ownerChange.note}`
    : `Your change could NOT be made automatically (${ownerChange.reason}). You asked: "${ownerChange.note}". Request it again in other words, or approve as it is.`;
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
      ...changeNote ? [`<strong>${escapeHtml(changeNote)}</strong>`] : [],
      ...readingNote ? [escapeHtml(readingNote)] : [],
      ...pagesNote ? [escapeHtml(`Menu pages: ${pagesNote}`)] : [],
      "Preview everything the buyer will get with the buttons below, then approve to send it.",
      // Owner, Nov 12, 2026: "Where are the other things ... like PDF, table tents". They are made from the live
      // menu page, so they exist once it is approved; the buyer's email links each one.
      AFTER_APPROVAL
    ],
    rows: [["Business", business], ["Buyer", buyer], ["Order", context.order_id], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
    buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
    footnote: "On the review page you can approve, or request changes."
  });
  const text = [
    `${business}'s online menu and QR code are ready for your review. Nothing goes to the buyer until you approve.`,
    ...changeNote ? ["", changeNote] : [],
    ...readingNote ? ["", readingNote] : [],
    ...pagesNote ? ["", `Menu pages: ${pagesNote}`] : [],
    "",
    AFTER_APPROVAL,
    "",
    ...previews.map((p) => `${p.label}: ${p.url}`),
    "",
    `Review and approve: ${approveUrl}`,
    "",
    `Buyer: ${buyer}`,
    `Order: ${context.order_id}`,
    `This link expires in ${APPROVAL_TTL_DAYS} days.`
  ].join("\n");
  return { subject, html, text, templateKey: "owner_approval_menu_qr_v1" };
}

async function menuQrBuyerEmail({ context, files, linkFor, targetStep, env }) {
  const prepared = await loadPreparedPayload(targetStep, env);
  const contactEmail = getInputValue(prepared.inputs, "contact_email");
  const recipient = looksLikeEmailValue(contactEmail) ? String(contactEmail).trim() : String(context.customer_email || "").trim();
  const qrDestination = getInputValue(prepared.inputs, "qr_destination");
  const base = publicBaseUrl(env);
  const hosted = typeof qrDestination === "string" && qrDestination.startsWith(`${base}/api/menu/`);
  const links = [];
  for (const file of files) {
    links.push({
      type: file.deliverable_type,
      label: file.deliverable_type === "MENU_DRAFT" ? "View your online menu" : "Download your QR code",
      url: await linkFor(file, { download: file.deliverable_type === "QR_CODE" }),
      filename: file.original_filename
    });
  }
  // Hosted menus also get a print-ready PDF with the QR code on it (owner, Nov 5, 2026).
  const printUrl = hosted ? `${qrDestination}/print.pdf` : null;
  if (printUrl) links.push({ type: "PRINT_PDF", label: "Download your print menu (PDF)", url: printUrl });
  // More formats from the same live menu: a tri-fold, a QR table tent and a menu screen for a TV (owner, Nov 5, 2026).
  const extras = hosted ? [
    { label: "Tri-fold menu (PDF, print double-sided, flip on the short edge)", url: `${qrDestination}/tri-fold.pdf` },
    { label: "QR table tent (PDF, fold in half)", url: `${qrDestination}/table-tent.pdf` },
    { label: "TV menu screen (open on a smart TV's browser)", url: `${qrDestination}/tv` }
  ] : [];
  const business = context.business_name || "your business";
  const firstName = context.first_name || "there";
  const subject = `${isTestOrder(context) ? "[TEST] " : ""}Your online menu and QR code are ready`;
  const html = brandedEmailHtml({
    preheader: `Your MENU-MADE menu page and QR code for ${business} are ready.`,
    eyebrow: "YOUR ORDER IS READY",
    heading: `${business}'s menu and QR code are ready`,
    paragraphs: [
      `Hi ${escapeHtml(firstName)},`,
      printUrl ? "Your mobile-friendly menu page, QR code and print-ready menu PDF are finished. Use the buttons below to open and save them." : "Your mobile-friendly menu page and QR code are finished. Use the buttons below to open and save them.",
      hosted ? `Your menu is live at <a href="${escapeHtml(qrDestination)}">${escapeHtml(qrDestination)}</a>, and your QR code opens it. Print the QR code for your tables; there's nothing else to set up.` : qrDestination ? `Your QR code opens <strong>${escapeHtml(qrDestination)}</strong>. Put the menu page at that address (or send it to whoever manages your website), then print the QR code for your tables.` : "Print the QR code for your tables and place the menu page where it points.",
      ...extras.length ? [`Also made from your live menu: ${extras.map((e) => `<a href="${escapeHtml(e.url)}">${escapeHtml(e.label)}</a>`).join(" · ")}.`] : []
    ],
    buttons: links.map((link, index) => ({ label: link.label, url: link.url, primary: index === 0 })),
    footnote: printUrl
      ? `The menu and QR code links work for ${DELIVERY_LINK_TTL_DAYS} days, so save both files. The print links keep working and always match your live menu. Questions or changes? Reply to this email.`
      : `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save both files. Questions or changes? Reply to this email.`
  });
  const text = [
    `Hi ${firstName},`,
    "",
    `Your menu page and QR code for ${business} are ready.`,
    "",
    ...links.map((link) => `${link.label}: ${link.url}`),
    "",
    hosted ? `Your menu is live at ${qrDestination}, and your QR code opens it. Print the QR code for your tables; there's nothing else to set up.` : qrDestination ? `Your QR code opens ${qrDestination}. Put the menu page at that address, then print the QR code for your tables.` : "",
    ...extras.length ? ["", "Also made from your live menu:", ...extras.map((e) => `${e.label}: ${e.url}`), ""] : [],
    printUrl ? `The menu and QR code links work for ${DELIVERY_LINK_TTL_DAYS} days, so save both files. The print links keep working and always match your live menu. Questions or changes? Reply to this email.` : `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save both files. Questions or changes? Reply to this email.`,
    "",
    "The MENU-MADE team"
  ].join("\n");
  return { recipient, subject, html, text, templateKey: "delivery_menu_qr_v1" };
}

const menuQrPresenter = {
  name: "MENU_QR",
  async loadFiles(context, targetStep, env) {
    return (await loadPackageDeliverables(context.id, env)).map((file) => ({ ...file, approval: null }));
  },
  ownerLabel(context) {
    return `${context.business_name || "A customer"} - Online menu + QR`;
  },
  ownerEmail: menuQrOwnerEmail,
  buyerEmail: menuQrBuyerEmail
};

function runPackageDeliverablesStep(targetStep, env) {
  return runDeliverStep(targetStep, env, menuQrPresenter);
}

export {
  loadDeliveryContext,
  isTestOrder,
  loadPackageDeliverables,
  menuQrPresenter,
  runPackageDeliverablesStep
};
