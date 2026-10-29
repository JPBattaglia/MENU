// What the owner and the buyer read for a Nino design service (stage 10). Plugged into the shared deliver step.
// The buyer bought on ninobattaglia.com, so the emails speak as Nino Battaglia's design studio.
import { APPROVAL_TTL_DAYS, DELIVERY_LINK_TTL_DAYS } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { isTestOrder } from "../../approvals/release.js";
import { productForWorkflow } from "./products.js";

const NINO_SITE = "https://ninobattaglia.com";
const infoOf = (files) => parseJsonOrNull(files?.find((f) => f.deliverable_type === "NINO_DESIGN_PACK")?.metadata_json)?.nino_design || {};

function summary(product, info) {
  if (product.code === "NINO_SOCIAL_PACK") return `${info.posts || 9} posts, each as a feed and a story graphic, with captions.`;
  if (product.code === "NINO_LOGO") return `${info.options || 6} wordmark options, each transparent, on white and on dark.`;
  if (product.code === "NINO_MENU_DESIGN") return `${info.pages || ""} print-ready page${info.pages === 1 ? "" : "s"} (${info.paid_pages || ""} paid), ${info.items || 0} items.${info.unreadable ? ` Reader note: ${info.unreadable}` : ""}`;
  return "A letter-size print flyer (300 dpi) and a square version for social media.";
}

const ninoDesignOverrides = {
  name: "NINO_DESIGN",
  async ownerEmail({ context, files, previews, approveUrl }) {
    const product = productForWorkflow(context.workflow_key);
    const test = isTestOrder(context);
    const business = context.business_name || "A customer";
    const info = infoOf(files);
    const checks = product.code === "NINO_MENU_DESIGN"
      ? "Check every dish and price against the buyer's menu, and that nothing looks cramped."
      : product.code === "NINO_SOCIAL_PACK" ? "Check the wording on each graphic and that nothing is claimed the buyer didn't say."
      : "Check spelling and that the design looks right.";
    return {
      subject: `${test ? "[TEST] " : ""}Approve ${business}'s ${product.name}`,
      templateKey: "owner_approval_nino_design_v1",
      html: brandedEmailHtml({
        preheader: `${business}'s ${product.name} is ready to review.`,
        eyebrow: test ? "TEST · NINO DESIGN" : "NINO DESIGN",
        heading: `${business}'s ${product.name} is ready`,
        paragraphs: [escapeHtml(summary(product, info)), `${checks} Nothing goes to the buyer until you approve.`],
        rows: [["Product", product.name], ["Buyer", context.customer_email], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
        buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
        footnote: "Request changes with a note and it is redone once automatically (a new layout; for social posts the note goes to the writer)."
      }),
      text: [`${business}'s ${product.name} is ready for review.`, summary(product, info), "", ...previews.map((p) => `${p.label}: ${p.url}`), `Review and approve: ${approveUrl}`].join("\n")
    };
  },
  async buyerEmail({ context, files, linkFor }) {
    const product = productForWorkflow(context.workflow_key);
    const business = context.business_name || "your business";
    const info = infoOf(files);
    const preview = files.find((f) => f.deliverable_type === "NINO_DESIGN_PREVIEW");
    const pack = files.find((f) => f.deliverable_type === "NINO_DESIGN_PACK");
    const buttons = [];
    if (preview) buttons.push({ label: "See your designs", url: await linkFor(preview, { download: false }), primary: true });
    if (pack) buttons.push({ label: "Download all files (ZIP)", url: await linkFor(pack, { download: true }) });
    return {
      recipient: context.customer_email,
      subject: `${isTestOrder(context) ? "[TEST] " : ""}Your ${product.name} from Nino Battaglia is ready`,
      templateKey: "delivery_nino_design_v1",
      html: brandedEmailHtml({
        preheader: `Your ${product.name} for ${business} is ready.`,
        eyebrow: "NINO BATTAGLIA · DESIGN",
        heading: `${business}'s ${product.name}`,
        paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, it's ready. ${escapeHtml(summary(product, info))}`,
          `Want it on your team's shirts? Staff merch with Nino's designs (and your logo) is at https://menu-made.com/staff-merch.html. More of Nino's work: ${NINO_SITE}.`],
        buttons,
        footnote: `These links work for ${DELIVERY_LINK_TTL_DAYS} days, so save your files. Questions? Reply to this email.`
      }),
      text: [`Hi ${context.first_name || "there"},`, "", `Your ${product.name} for ${business} is ready. ${summary(product, info)}`, "", ...buttons.map((b) => `${b.label}: ${b.url}`), "",
        "Staff merch with Nino's designs: https://menu-made.com/staff-merch.html", `More of Nino's work: ${NINO_SITE}`, "", `These links work for ${DELIVERY_LINK_TTL_DAYS} days. Questions? Reply to this email.`].join("\n")
    };
  }
};

export { ninoDesignOverrides };
