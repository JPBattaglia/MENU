import { APPROVAL_TTL_DAYS, DELIVERABLE_LABELS, DELIVERY_LINK_TTL_DAYS } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, looksLikeEmail as looksLikeEmailValue } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { publicBaseUrl } from "../../lib/config.js";
import { getInputValue, loadPreparedPayload } from "./inputs.js";
import { isTestOrder, loadDeliveryContext, runDeliverStep } from "../../approvals/release.js";
import { pageBillingNote } from "./page-billing.js";
import { TRI_FOLD_NOTE, triFoldPossible } from "./trifold-check.js";

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
const AFTER_APPROVAL_NO_TRIFOLD = "The buyer gets five things: the live menu page, the QR code, a print-ready menu (PDF), a QR table tent (PDF) and a TV menu screen. Each has its own preview button here. To change anything, use Request changes on the review page and say what to change; the menu is redone from your words and comes back for approval.";

// Owner email for one waiting Menu + QR order (the shared digest uses this when a single item is waiting).
async function menuQrOwnerEmail({ context, files, previews, approveUrl, targetStep, env, approval }) {
  const test = isTestOrder(context);
  const business = context.business_name || "A customer";
  const buyer = [context.first_name, context.last_name].filter(Boolean).join(" ") || context.customer_email;
  // A redone version says so in the subject (owner, Nov 12, 2026: the new email had the same subject as the last
  // one, so his mail app filed it in the old conversation and it looked as if nothing had arrived).
  const version = Number(approval?.revision_number) || 1;
  const subject = `${test ? "[TEST] " : ""}Approve ${business}'s online menu + QR${version > 1 ? ` (version ${version})` : ""}`;
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
  // No tri-fold preview button means the menu is too long for one (digest.js): say so instead of listing it.
  const noTriFold = Array.isArray(previews) && previews.length > 0 && !previews.some((p) => /\/tri-fold\.pdf/.test(p.url || ""));
  const afterApproval = noTriFold ? `${AFTER_APPROVAL_NO_TRIFOLD} ${TRI_FOLD_NOTE}` : AFTER_APPROVAL;
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
      afterApproval
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
    afterApproval,
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
      label: file.deliverable_type === "MENU_DRAFT" ? "View your online menu" : hosted ? "QR code for a print shop (SVG)" : "Download your QR code",
      url: await linkFor(file, { download: file.deliverable_type === "QR_CODE" }),
      filename: file.original_filename
    });
  }
  // Hosted menus: every item in the order is its own button (owner, Nov 12, 2026: "I want it to be evident that they
  // receive several things"), and the QR code comes as a PNG image and a printable PDF as well as the SVG, which a
  // buyer who isn't technical can't use. The SVG moves to the end, for print shops.
  const printUrl = hosted ? `${qrDestination}/print.pdf` : null;
  const qrPngUrl = hosted ? `${qrDestination}/qr.png` : null;
  const triFold = hosted ? await triFoldPossible(env, context.id) : null;
  if (hosted) {
    const svg = links.filter((link) => link.type === "QR_CODE");
    const rest = links.filter((link) => link.type !== "QR_CODE");
    links.length = 0;
    links.push(...rest,
      { type: "QR_PNG", label: "Download your QR code (PNG image)", url: `${qrPngUrl}?download=1` },
      { type: "QR_PDF", label: "Print your QR code (PDF sheet)", url: `${qrDestination}/qr.pdf` },
      { type: "PRINT_PDF", label: "Download your print menu (PDF)", url: printUrl },
      ...(triFold === false ? [] : [{ type: "TRI_FOLD", label: "Download your tri-fold menu (PDF)", url: `${qrDestination}/tri-fold.pdf` }]),
      { type: "TABLE_TENT", label: "Download your QR table tent (PDF)", url: `${qrDestination}/table-tent.pdf` },
      { type: "TV", label: "Open your TV menu screen", url: `${qrDestination}/tv` },
      ...svg);
  }
  const INCLUDED = triFold === false
    ? `Your order includes five things, each with its own button below: your live menu page, your QR code, a print-ready menu, a QR table tent and a TV menu screen. ${TRI_FOLD_NOTE}`
    : "Your order includes six things, each with its own button below: your live menu page, your QR code, a print-ready menu, a tri-fold menu, a QR table tent and a TV menu screen.";
  const TIPS = triFold === false
    ? "Printing tips: fold the table tent in half; open the TV screen in a smart TV's browser."
    : "Printing tips: print the tri-fold double-sided and flip on the short edge; fold the table tent in half; open the TV screen in a smart TV's browser.";
  const business = context.business_name || "your business";
  const firstName = context.first_name || "there";
  const subject = `${isTestOrder(context) ? "[TEST] " : ""}Your online menu and QR code are ready`;
  const html = brandedEmailHtml({
    preheader: `Your MENU-MADE menu page and QR code for ${business} are ready.`,
    eyebrow: "YOUR ORDER IS READY",
    heading: `${business}'s menu and QR code are ready`,
    paragraphs: [
      `Hi ${escapeHtml(firstName)},`,
      hosted ? INCLUDED : "Your mobile-friendly menu page and QR code are finished. Use the buttons below to open and save them.",
      hosted ? `Your menu is live at <a href="${escapeHtml(qrDestination)}">${escapeHtml(qrDestination)}</a>, and your QR code opens it. Print the QR code for your tables; there's nothing else to set up.` : qrDestination ? `Your QR code opens <strong>${escapeHtml(qrDestination)}</strong>. Put the menu page at that address (or send it to whoever manages your website), then print the QR code for your tables.` : "Print the QR code for your tables and place the menu page where it points.",
      ...hosted ? [`<img src="${escapeHtml(qrPngUrl)}" width="180" height="180" alt="Your QR code" style="display:block;width:180px;height:180px;border:0;background-color:#ffffff;">`, TIPS] : []
    ],
    buttons: links.map((link, index) => ({ label: link.label, url: link.url, primary: index === 0 })),
    footnote: printUrl
      ? `The first and last buttons (your menu file and the SVG) work for ${DELIVERY_LINK_TTL_DAYS} days, so save those files. The rest keep working and always match your live menu. Questions or changes? Reply to this email.`
      : `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save both files. Questions or changes? Reply to this email.`
  });
  const text = [
    `Hi ${firstName},`,
    "",
    hosted ? INCLUDED : `Your menu page and QR code for ${business} are ready.`,
    "",
    ...links.map((link) => `${link.label}: ${link.url}`),
    "",
    hosted ? `Your menu is live at ${qrDestination}, and your QR code opens it. Print the QR code for your tables; there's nothing else to set up.` : qrDestination ? `Your QR code opens ${qrDestination}. Put the menu page at that address, then print the QR code for your tables.` : "",
    ...hosted ? ["", TIPS, ""] : [],
    printUrl ? `The first and last buttons (your menu file and the SVG) work for ${DELIVERY_LINK_TTL_DAYS} days, so save those files. The rest keep working and always match your live menu. Questions or changes? Reply to this email.` : `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save both files. Questions or changes? Reply to this email.`,
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
