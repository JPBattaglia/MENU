// What the owner and the customer read for a Menu Care update (stage 6). Plugged into the shared deliver step.
import { APPROVAL_TTL_DAYS } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { isTestOrder } from "../../approvals/release.js";

const careOf = (files) => parseJsonOrNull(files?.[0]?.metadata_json)?.care || {};

async function liveMenuUrl(env, businessId) {
  const row = await env.DB.prepare(`
      SELECT pi.value_text FROM projects p JOIN project_inputs pi ON pi.project_id = p.id
      WHERE p.business_id = ? AND pi.input_key = 'qr_destination' LIMIT 1
    `).bind(businessId).first();
  return row?.value_text || null;
}

const menuCareOverrides = {
  name: "MENU_CARE",
  ownerLabel(context) {
    return `${context.business_name || "A customer"} - Menu change`;
  },
  async ownerEmail({ context, files, previews, approveUrl }) {
    const test = isTestOrder(context);
    const business = context.business_name || "A customer";
    const care = careOf(files);
    const changes = care.changes || [];
    return {
      subject: `${test ? "[TEST] " : ""}Approve ${business}'s menu change`,
      templateKey: "owner_approval_menu_care_v1",
      html: brandedEmailHtml({
        preheader: care.summary || `${business} sent a menu change.`,
        eyebrow: test ? "TEST · MENU CARE" : "MENU CARE",
        heading: `${business}'s menu change is ready to review`,
        paragraphs: [
          escapeHtml(care.summary || "A menu change was applied automatically."),
          `<ul>${changes.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
          "Nothing changes on the live menu until you approve."
        ],
        rows: [["Business", business], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
        buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
        footnote: "If something is off, choose request changes and say what to fix; it is redone once automatically."
      }),
      text: [`${business}'s menu change is ready for review.`, "", care.summary || "", ...changes.map((line) => `- ${line}`), "",
        ...previews.map((p) => `${p.label}: ${p.url}`), `Review and approve: ${approveUrl}`].join("\n")
    };
  },
  async buyerEmail({ context, files, env }) {
    const business = context.business_name || "your business";
    const care = careOf(files);
    const url = await liveMenuUrl(env, context.business_id);
    const changes = care.changes || [];
    return {
      recipient: context.customer_email,
      subject: `${isTestOrder(context) ? "[TEST] " : ""}Your menu is updated`,
      templateKey: "delivery_menu_care_v1",
      html: brandedEmailHtml({
        preheader: `${business}'s online menu now has your changes.`,
        eyebrow: "MENU CARE",
        heading: "Your menu is updated",
        paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, your online menu now shows:`, `<ul>${changes.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
          "Your QR code and menu address stay the same."],
        buttons: url ? [{ label: "See your menu", url, primary: true }] : [],
        footnote: "Something not right? Reply to this email."
      }),
      text: [`Hi ${context.first_name || "there"},`, "", "Your online menu now shows:", ...changes.map((line) => `- ${line}`), "", url ? `See your menu: ${url}` : "",
        "Something not right? Reply to this email."].join("\n")
    };
  }
};

export { menuCareOverrides };
