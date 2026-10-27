// Presenters decide what the owner and the buyer read for each product (see release.js). Menu + QR has its
// own wording; every later producer starts from the generic one below and adds its own when it needs to.
import { APPROVAL_TTL_DAYS, DELIVERABLE_LABELS, DELIVERY_LINK_TTL_DAYS } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml } from "../lib/email.js";
import { itemApprovalFlag } from "./routing.js";
import { isTestOrder } from "./release.js";
import { menuQrPresenter } from "../producers/menu-qr/package.js";
import { menuCareOverrides } from "../producers/menu-care/presenter.js";

function humanize(type) {
  return String(type || "File").toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

const labelFor = (file) => DELIVERABLE_LABELS[file.deliverable_type] || humanize(file.deliverable_type);

const genericPresenter = {
  name: "GENERIC",
  // Newest version of each deliverable type that has not been superseded.
  async loadFiles(context, targetStep, env) {
    const rows = (await env.DB.prepare(`
        SELECT d.id, d.deliverable_type, d.version, d.status, d.customer_visible,
          a.original_filename, a.mime_type, a.size_bytes, a.storage_key, a.metadata_json
        FROM deliverables d
        JOIN assets a ON a.id = d.asset_id
        WHERE d.project_id = ? AND d.status != 'SUPERSEDED'
        ORDER BY d.deliverable_type ASC, d.version DESC
      `).bind(context.id).all()).results || [];
    const newest = new Map();
    for (const row of rows) {
      if (!newest.has(row.deliverable_type)) newest.set(row.deliverable_type, row);
    }
    if (newest.size === 0) throw new Error(`${targetStep.step_key}: this project has nothing to deliver`);
    return [...newest.values()].map((row) => ({ ...row, approval: itemApprovalFlag(row.metadata_json) }));
  },
  ownerLabel(context) {
    return `${context.business_name || "A customer"} - ${context.offer_name || "order"}`;
  },
  async ownerEmail({ context, previews, approveUrl }) {
    const test = isTestOrder(context);
    const business = context.business_name || "A customer";
    const product = context.offer_name || "order";
    const buyer = [context.first_name, context.last_name].filter(Boolean).join(" ") || context.customer_email;
    const subject = `${test ? "[TEST] " : ""}Approve ${business}'s ${product}`;
    return {
      subject,
      templateKey: "owner_approval_generic_v1",
      html: brandedEmailHtml({
        preheader: `${business}'s ${product} is ready for your review.`,
        eyebrow: test ? "TEST ORDER · OWNER APPROVAL" : "OWNER APPROVAL",
        heading: `${business}'s ${product} is ready to review`,
        paragraphs: ["This was produced automatically. Nothing goes to the buyer until you approve."],
        rows: [["Business", business], ["Product", product], ["Buyer", buyer], ["Order", context.order_id], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
        buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
        footnote: "On the review page you can approve, or request changes."
      }),
      text: [
        `${business}'s ${product} is ready for your review. Nothing goes to the buyer until you approve.`,
        "",
        ...previews.map((p) => `${p.label}: ${p.url}`),
        "",
        `Review and approve: ${approveUrl}`,
        "",
        `Buyer: ${buyer}`,
        `Order: ${context.order_id}`,
        `This link expires in ${APPROVAL_TTL_DAYS} days.`
      ].join("\n")
    };
  },
  async buyerEmail({ context, files, linkFor }) {
    const product = context.offer_name || "order";
    const business = context.business_name || "your business";
    const firstName = context.first_name || "there";
    const links = [];
    for (const [index, file] of files.entries()) {
      links.push({ label: `${index === 0 ? "Open" : "Download"} ${labelFor(file).toLowerCase()}`, url: await linkFor(file, { download: index > 0 }) });
    }
    return {
      recipient: context.customer_email,
      subject: `${isTestOrder(context) ? "[TEST] " : ""}Your ${product} is ready`,
      templateKey: "delivery_generic_v1",
      html: brandedEmailHtml({
        preheader: `Your MENU-MADE ${product} for ${business} is ready.`,
        eyebrow: "YOUR ORDER IS READY",
        heading: `${business}'s ${product} is ready`,
        paragraphs: [`Hi ${escapeHtml(firstName)},`, "It's finished. Use the buttons below to open and save your files."],
        buttons: links.map((link, index) => ({ ...link, primary: index === 0 })),
        footnote: `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save your files. Questions or changes? Reply to this email.`
      }),
      text: [`Hi ${firstName},`, "", `Your ${product} for ${business} is ready.`, "", ...links.map((link) => `${link.label}: ${link.url}`), "",
        `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save your files. Questions or changes? Reply to this email.`, "", "The MENU-MADE team"].join("\n")
    };
  }
};

// Looked up at call time, not module load: these modules import each other in a cycle.
function presenterFor(workflowKey) {
  if (workflowKey === "MENU_QR_V1") return menuQrPresenter;
  if (workflowKey === "MENU_CARE_V1") return { ...genericPresenter, ...menuCareOverrides };
  return genericPresenter;
}

export { genericPresenter, presenterFor, labelFor };
