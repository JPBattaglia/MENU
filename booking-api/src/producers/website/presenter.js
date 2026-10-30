// What the owner and the customer read for a Website Package (stage 7). Plugged into the shared deliver step.
import { APPROVAL_TTL_DAYS, DELIVERY_LINK_TTL_DAYS, publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { signLinkToken } from "../../lib/links.js";
import { isTestOrder } from "../../approvals/release.js";

const infoOf = (files) => parseJsonOrNull(files?.find((f) => f.deliverable_type === "SITE_BUILD")?.metadata_json)?.website || {};

// Subdomain hosting needs a wildcard DNS record and route; until the owner switches it on (SITE_WILDCARD=1) every site
// is served from the checkout domain's /api/site/<slug>/ path, which already works.
function siteUrl(env, slug) {
  return String(env.SITE_WILDCARD) === "1" ? `https://${slug}.menu-made.com/` : `${publicBaseUrl(env)}/api/site/${slug}/`;
}

async function previewUrl(env, buildId, ttlDays) {
  const token = await signLinkToken(env, { kind: "sitepreview", id: buildId, ttlDays });
  return `${publicBaseUrl(env)}/api/site-preview/${buildId}/${token}/`;
}

async function customDomainOf(env, projectId) {
  return (await env.DB.prepare(`SELECT custom_domain FROM website_sites WHERE project_id = ?`).bind(projectId).first())?.custom_domain || null;
}

const websiteOverrides = {
  name: "WEBSITE_PACKAGE",
  ownerLabel(context) { return `${context.business_name || "A customer"} - Website`; },
  async previewLinks({ files, env }) {
    const build = files.find((f) => f.deliverable_type === "SITE_BUILD");
    return build ? [{ label: "Preview the website", url: await previewUrl(env, build.id, APPROVAL_TTL_DAYS) }] : [];
  },
  async ownerEmail({ context, files, previews, approveUrl, env }) {
    const test = isTestOrder(context);
    const business = context.business_name || "A customer";
    const info = infoOf(files);
    const domain = await customDomainOf(env, context.id);
    return {
      subject: `${test ? "[TEST] " : ""}Approve ${business}'s website`,
      templateKey: "owner_approval_website_v1",
      html: brandedEmailHtml({
        preheader: `${business}'s ${info.style || ""} website is built and passed its checks.`,
        eyebrow: test ? "TEST · WEBSITE PACKAGE" : "WEBSITE PACKAGE",
        heading: `${business}'s website is ready to review`,
        paragraphs: [`${info.pages || 0} pages, ${info.style || "modern"} style, ${info.images || 0} images. It passed the automated checks: accessibility scan, links, image sizes and contact details. Click through every page before approving. Nothing is live until you approve.`,
          ...(domain ? [`The buyer also wants to use <strong>${escapeHtml(domain)}</strong>. Attaching their own domain is a manual step for now.`] : [])],
        rows: [["Address", `${info.slug || ""}.menu-made.com`], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
        buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
        footnote: "If something is off, choose request changes and say what to fix; the site is rebuilt once automatically."
      }),
      text: [`${business}'s website is ready for review. Nothing is live until you approve.`, "", ...previews.map((p) => `${p.label}: ${p.url}`), `Review and approve: ${approveUrl}`, ...(domain ? ["", `The buyer wants to use ${domain} (manual for now).`] : [])].join("\n")
    };
  },
  async buyerEmail({ context, files, env }) {
    const business = context.business_name || "your business";
    const info = infoOf(files);
    const url = siteUrl(env, info.slug);
    const domain = await customDomainOf(env, context.id);
    const extra = domain ? [`You asked to use your own domain, <strong>${escapeHtml(domain)}</strong>. We'll email you the exact steps to point it at your site.`] : [];
    return {
      recipient: context.customer_email,
      subject: `${isTestOrder(context) ? "[TEST] " : ""}Your website is live`,
      templateKey: "delivery_website_v1",
      html: brandedEmailHtml({
        preheader: `${business}'s website is live.`,
        eyebrow: "YOUR WEBSITE IS LIVE",
        heading: `${business} is on the web`,
        paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, your website is live at <strong>${escapeHtml(url)}</strong>.`, "Your plan includes two rounds of changes: reply to this email with what to change. Your Website &amp; App Care trial keeps the site hosted and updated.", ...extra],
        buttons: [{ label: "Open my website", url, primary: true }],
        footnote: `Questions or changes? Reply to this email.`
      }),
      text: [`Hi ${context.first_name || "there"},`, "", `Your website is live: ${url}`, "", "Your plan includes two rounds of changes: reply to this email with what to change. Your Website & App Care trial keeps the site hosted and updated.", ...(domain ? ["", `You asked to use your own domain, ${domain}. We'll email you the exact steps to point it at your site.`] : [])].join("\n")
    };
  }
};

export { previewUrl, siteUrl, websiteOverrides };
