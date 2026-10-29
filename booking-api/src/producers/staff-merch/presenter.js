// Staff merch DELIVER (stage 10). The shared deliver step routes the proof: straight on without a logo, to the owner
// for one-click approval with one. Releasing it places the Printful order (through the Nino shop's NinoMerch
// entrypoint) and emails the buyer the proof with "in production". Printful briefly unavailable or still pricing the
// order -> the step is retried on the next tick; Printful costing more than the buyer paid -> the step fails and the
// owner is alerted, and nothing is printed.
import { APPROVAL_TTL_DAYS, DELIVERY_LINK_TTL_DAYS } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml } from "../../lib/email.js";
import { isTestOrder, runDeliverStep } from "../../approvals/release.js";
import { retryStepLater } from "../../workflows/runner.js";
import { merchOf, placePrintfulOrder } from "./order.js";

const money = (c) => `$${(Number(c) / 100).toFixed(2)}`;

const staffMerchOverrides = {
  name: "STAFF_MERCH",
  async ownerEmail({ context, previews, approveUrl, env }) {
    const merch = await merchOf(env, context);
    const test = isTestOrder(context);
    const business = context.business_name || "A customer";
    return {
      subject: `${test ? "[TEST] " : ""}Approve ${business}'s staff shirts (logo proof)`,
      templateKey: "owner_approval_merch_v1",
      html: brandedEmailHtml({
        preheader: `${merch?.pricing?.shirts || ""} shirts with ${business}'s logo are waiting for your OK.`,
        eyebrow: test ? "TEST · STAFF MERCH" : "STAFF MERCH",
        heading: `${business}'s logo shirts need your OK`,
        paragraphs: ["Check the logo looks right on the back and that the business can use it (it's their own logo, not someone else's brand). Approving places the Printful order; nothing is printed before that."],
        rows: [["Shirts", String(merch?.pricing?.shirts || "")], ["Paid", money((merch?.pricing?.subtotal_cents || 0) + (merch?.rate?.amount_cents || 0))], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
        buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
        footnote: "If the logo can't be printed, request changes with a note: the order is held for you to sort out with the buyer."
      }),
      text: [`${business}'s staff shirts with their logo are waiting for your OK.`, ...previews.map((p) => `${p.label}: ${p.url}`), `Review and approve: ${approveUrl}`].join("\n")
    };
  },
  async buyerEmail({ context, files, linkFor, env }) {
    const ordered = await placePrintfulOrder(env, context);
    const business = context.business_name || "your team";
    const proof = files.find((f) => f.deliverable_type === "MERCH_PROOF");
    const link = proof ? await linkFor(proof, { download: false }) : null;
    return {
      recipient: context.customer_email,
      subject: `${isTestOrder(context) ? "[TEST] " : ""}Your staff shirts are being printed`,
      templateKey: "delivery_merch_v1",
      html: brandedEmailHtml({
        preheader: `${ordered.pricing.shirts} shirts for ${business} are in production.`,
        eyebrow: "STAFF MERCH",
        heading: "Your shirts are being printed",
        paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, ${ordered.pricing.shirts} shirt${ordered.pricing.shirts === 1 ? "" : "s"} for ${escapeHtml(business)} are now in production with Printful. We'll email the tracking link as soon as they ship (usually 3-7 days for printing, then ${escapeHtml(ordered.rate.name)}).`,
          "Want the rest of your look to match? Nino's design studio does logos, flyers, menus and social graphics: https://ninobattaglia.com/services.html"],
        buttons: link ? [{ label: "See your order proof", url: link, primary: true }] : [],
        footnote: `This link works for ${DELIVERY_LINK_TTL_DAYS} days. Questions or a size swap? Reply to this email today, before the shirts ship.`
      }),
      text: [`Hi ${context.first_name || "there"},`, "", `${ordered.pricing.shirts} shirts for ${business} are in production with Printful. We'll email tracking when they ship.`, link ? `Order proof: ${link}` : "", "", "Nino's design studio: https://ninobattaglia.com/services.html"].join("\n")
    };
  }
};

// The deliver step with Printful's temporary refusals turned into a retry instead of a failed order.
staffMerchOverrides.runDeliver = async (targetStep, env) => {
  const { presenterFor } = await import("../../approvals/presenters.js");
  try {
    return await runDeliverStep(targetStep, env, presenterFor(targetStep.workflow_key));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!error?.review && /merch_unavailable|printful_cost_not_ready|printful_request_failed|printful_confirmation_not_ready|shipping_quote_failed/.test(message)) {
      return retryStepLater(targetStep, env, message);
    }
    throw error;
  }
};

export { staffMerchOverrides };
