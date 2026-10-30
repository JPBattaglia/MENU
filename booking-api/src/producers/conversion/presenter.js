// What the owner and the customer read for a Conversion Fix (stage 6). Plugged into the shared deliver step.
import { APPROVAL_TTL_DAYS, DELIVERY_LINK_TTL_DAYS } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { isTestOrder } from "../../approvals/release.js";

const infoOf = (files) => parseJsonOrNull(files?.find((f) => f.deliverable_type === "CONVERSION_REPORT")?.metadata_json)?.conversion || {};

const conversionOverrides = {
  name: "CONVERSION_FIX",
  async ownerEmail({ context, files, previews, approveUrl }) {
    const test = isTestOrder(context);
    const business = context.business_name || "A customer";
    const info = infoOf(files);
    return {
      subject: `${test ? "[TEST] " : ""}Approve ${business}'s Conversion Fix report`,
      templateKey: "owner_approval_conversion_v1",
      html: brandedEmailHtml({
        preheader: `${info.fixes || "Several"} fixes found for ${business}.`,
        eyebrow: test ? "TEST · CONVERSION FIX" : "CONVERSION FIX",
        heading: `${business}'s report is ready to review`,
        paragraphs: [escapeHtml(info.summary || "The report was produced automatically."), `${info.fixes || 0} fixes, ${info.findings || 0} findings, goal: ${escapeHtml(info.goal || "")}. Check the suggested wording makes sense for the business. Nothing goes to the buyer until you approve.`],
        rows: [["Site", info.url || ""], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
        buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
        footnote: "If something is off, choose request changes and say what to fix; the report is redone once automatically."
      }),
      text: [`${business}'s Conversion Fix report is ready for review.`, "", info.summary || "", "", ...previews.map((p) => `${p.label}: ${p.url}`), `Review and approve: ${approveUrl}`].join("\n")
    };
  },
  async buyerEmail({ context, files, linkFor }) {
    const business = context.business_name || "your business";
    const info = infoOf(files);
    const links = [];
    for (const [i, file] of files.entries()) links.push({ label: file.deliverable_type === "CONVERSION_REPORT" ? "Open your report" : "Download your checklist", url: await linkFor(file, { download: i > 0 }), primary: file.deliverable_type === "CONVERSION_REPORT" });
    links.sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
    return {
      recipient: context.customer_email,
      subject: `${isTestOrder(context) ? "[TEST] " : ""}Your Conversion Fix report is ready`,
      templateKey: "delivery_conversion_v1",
      html: brandedEmailHtml({
        preheader: `${info.fixes || "Your"} prioritized fixes for ${business}'s website.`,
        eyebrow: "YOUR ORDER IS READY",
        heading: `${business}'s Conversion Fix report`,
        paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, ${escapeHtml(info.summary || "your report is ready.")}`,
          "Want us to make these changes for you? <strong>Website &amp; App Care</strong> keeps your site updated on request, and a <strong>Website Package</strong> gives you a new site built around what works. See both at https://menu-made.com/services.html."],
        buttons: links,
        footnote: `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save your files. Questions? Reply to this email.`
      }),
      text: [`Hi ${context.first_name || "there"},`, "", info.summary || "Your Conversion Fix report is ready.", "", ...links.map((l) => `${l.label}: ${l.url}`), "",
        "Want us to make these changes for you? Website & App Care and the Website Package are at https://menu-made.com/services.html", "",
        `These links work for ${DELIVERY_LINK_TTL_DAYS} days. Questions? Reply to this email.`].join("\n")
    };
  }
};

export { conversionOverrides };
