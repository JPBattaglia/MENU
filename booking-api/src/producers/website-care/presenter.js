// What the owner and the customer read for a Website Care update (stage 7). Reuses the Website Package preview links.
import { APPROVAL_TTL_DAYS } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { isTestOrder } from "../../approvals/release.js";
import { siteUrl } from "../website/presenter.js";
import { websiteOverrides } from "../website/presenter.js";

const careOf = (files) => parseJsonOrNull(files?.find((f) => f.deliverable_type === "SITE_BUILD")?.metadata_json) || {};

const websiteCareOverrides = {
  ...websiteOverrides,
  name: "WEBSITE_CARE",
  ownerLabel(context) { return `${context.business_name || "A customer"} - Website change`; },
  async ownerEmail({ context, files, previews, approveUrl }) {
    const test = isTestOrder(context);
    const business = context.business_name || "A customer";
    const care = careOf(files).care || {};
    const changes = care.changes || [];
    return {
      subject: `${test ? "[TEST] " : ""}Approve ${business}'s website change`,
      templateKey: "owner_approval_website_care_v1",
      html: brandedEmailHtml({
        preheader: care.summary || `${business} sent a website change.`,
        eyebrow: test ? "TEST · WEBSITE CARE" : "WEBSITE CARE",
        heading: `${business}'s website change is ready to review`,
        paragraphs: [escapeHtml(care.summary || "A website change was applied automatically."), `<ul>${changes.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`,
          "The rebuilt site passed the automated checks. Nothing changes on the live website until you approve."],
        rows: [["Business", business], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
        buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
        footnote: "If something is off, choose request changes and say what to fix; it is redone once automatically."
      }),
      text: [`${business}'s website change is ready for review.`, "", care.summary || "", ...changes.map((l) => `- ${l}`), "", ...previews.map((p) => `${p.label}: ${p.url}`), `Review and approve: ${approveUrl}`].join("\n")
    };
  },
  async buyerEmail({ context, files, env }) {
    const business = context.business_name || "your business";
    const info = careOf(files);
    const changes = info.care?.changes || [];
    const url = siteUrl(env, info.website?.slug);
    return {
      recipient: context.customer_email,
      subject: `${isTestOrder(context) ? "[TEST] " : ""}Your website is updated`,
      templateKey: "delivery_website_care_v1",
      html: brandedEmailHtml({
        preheader: `${business}'s website now has your changes.`, eyebrow: "WEBSITE CARE", heading: "Your website is updated",
        paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, your website now shows:`, `<ul>${changes.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`, "Your web address stays the same."],
        buttons: [{ label: "See my website", url, primary: true }],
        footnote: "Something not right? Reply to this email."
      }),
      text: [`Hi ${context.first_name || "there"},`, "", "Your website now shows:", ...changes.map((l) => `- ${l}`), "", `See your website: ${url}`, "Something not right? Reply to this email."].join("\n")
    };
  }
};

export { websiteCareOverrides };
