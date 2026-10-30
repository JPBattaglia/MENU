// Website & App Care PRODUCE step (stage 7). Two kinds of run reach it:
//   - the monthly period run (trigger SUBSCRIPTION_PERIOD): emails the customer the monthly health report and their change link
//   - a change-request run (trigger SITE_CARE_REQUEST): applies the request to the live site's details and copy, rebuilds the
//     pages, runs the full site checks and stores the result as a draft SITE_BUILD. The shared DELIVER step asks the owner to
//     approve it; the approved build then replaces the old one at the same address.
// A request the AI cannot apply safely, or a rebuild that fails its checks, is never drafted: the customer and the owner are
// told, and the live site does not change.
import { ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { signLinkToken } from "../../lib/links.js";
import { loadRegenerationNote } from "../../approvals/actions.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { finishRun } from "../menu-care/care-step.js";
import { completeStep } from "../../workflows/runner.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { buildSite } from "../website/build.js";
import { checkSite } from "../website/check.js";
import { siteUrl } from "../website/presenter.js";
import { applySiteChange } from "./edit.js";
import { LINK_KIND } from "./intake.js";
import { loadLiveSite } from "./live.js";
import { monthlyReport } from "./report.js";

const LINK_TTL_DAYS = 400;

async function siteCareLink(env, subscriptionId) {
  const token = await signLinkToken(env, { kind: LINK_KIND, id: subscriptionId, ttlDays: LINK_TTL_DAYS });
  return `${publicBaseUrl(env)}/api/site-care/${subscriptionId}?t=${token}`;
}

async function runMonthOpening(targetStep, context, metadata, env) {
  const live = await loadLiveSite(env, context.business_id);
  if (!live?.build) {
    // Nothing to report or change yet (the Website Package is not live): say nothing rather than send an empty email.
    await finishRun(targetStep, context, { outcome: "NO_SITE_YET" }, env);
    return { outcome: "NO_SITE_YET" };
  }
  const link = await siteCareLink(env, metadata.subscription_id);
  const report = await monthlyReport(env, { slug: live.slug, build: live.build, subscriptionId: metadata.subscription_id });
  const url = siteUrl(env, live.slug);
  const business = context.business_name || "your business";
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `Website & App Care: your monthly report for ${business}`,
    html: brandedEmailHtml({
      preheader: "How your website did this month, and how to send changes.",
      eyebrow: "WEBSITE & APP CARE",
      heading: "Your website this month",
      paragraphs: [
        `Hi ${escapeHtml(context.first_name || "there")}, here is how <strong>${escapeHtml(url)}</strong> did:`,
        `<ul>${report.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`,
        escapeHtml(report.note),
        "Need to change your menu, hours, phone, address or wording? Tell us and we'll update the site. We check each update before it goes live."
      ],
      buttons: [{ label: "Send a website change", url: link, primary: true }, { label: "Open my website", url }],
      footnote: "Keep this email: the button works all month and every month while Website &amp; App Care is active."
    }),
    text: `Your website this month (${url}):\n- ${report.lines.join("\n- ")}\n\n${report.note}\n\nNeed a change? Tell us and we'll update the site (we check each update before it goes live): ${link}`,
    idempotencyKey: `site-care-open/${metadata.subscription_id}/${metadata.period_start}`,
    purpose: "WEBSITE_CARE_OPEN",
    templateKey: "website_care_open_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
  if (!sent.ok) throw new Error(`Website & App Care opening email failed: ${sent.error}`);
  await finishRun(targetStep, context, { outcome: "MONTH_OPENED", email_id: sent.id, checks: report.checks, answered: report.answered }, env);
  return { outcome: "MONTH_OPENED" };
}

async function tellBlocked(env, context, request, reasons) {
  const business = context.business_name || "A customer";
  const list = reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("");
  await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: "We need a little more detail for your website change",
    html: brandedEmailHtml({
      preheader: "We could not apply this change yet.", eyebrow: "WEBSITE & APP CARE", heading: "We need a little more detail",
      paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, we didn't change your website yet because:`, `<ul>${list}</ul>`,
        "Please send it again with the exact wording, prices or details you want, using the same link as before. Your live website has not changed."],
      footnote: "Or just reply to this email and we'll take care of it."
    }),
    text: `We didn't change your website yet because:\n- ${reasons.join("\n- ")}\n\nPlease send it again with the exact details you want. Your live website has not changed.`,
    idempotencyKey: `site-care-blocked/${request.id}`, purpose: "WEBSITE_CARE_BLOCKED", templateKey: "website_care_blocked_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[Website & App Care] Request not applied for ${business}`,
    html: brandedEmailHtml({ eyebrow: "WEBSITE & APP CARE", heading: `${escapeHtml(business)}: request not applied`, paragraphs: [`Request: ${escapeHtml(request.request_text)}`, `<ul>${list}</ul>`] }),
    text: `${business}: request not applied\n\nRequest: ${request.request_text}\n- ${reasons.join("\n- ")}`,
    idempotencyKey: `site-care-blocked-owner/${request.id}`, purpose: "WEBSITE_CARE_BLOCKED_OWNER", templateKey: "website_care_blocked_owner_v1"
  });
}

const setRequest = (env, id, status, result) => env.DB.prepare(`UPDATE site_change_requests SET status = ?, result_json = ?, updated_at = ? WHERE id = ?`).bind(status, JSON.stringify(result || {}), nowIso(), id).run();

async function runWebsiteCareProduceStep(targetStep, env, deps = {}) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(context.id).first();
  const metadata = parseJsonOrNull(project?.metadata_json) || {};
  if (metadata.source !== "SITE_CARE_REQUEST") return runMonthOpening(targetStep, context, metadata, env);

  const request = await env.DB.prepare(`SELECT * FROM site_change_requests WHERE id = ?`).bind(metadata.request_id).first();
  if (!request) throw new Error("Website change request not found");
  const note = await loadRegenerationNote(env, context.id);
  const requestText = note ? `${request.request_text}\n\nCorrection from the reviewer on a previous attempt: ${note.note}` : request.request_text;
  const blockedBy = async (reasons) => {
    await tellBlocked(env, context, request, reasons);
    await setRequest(env, request.id, "NOT_APPLIED", { reasons });
    await finishRun(targetStep, context, { outcome: "NOT_APPLIED", reasons }, env);
    return { outcome: "NOT_APPLIED", reasons };
  };

  const live = await loadLiveSite(env, context.business_id);
  if (!live?.build?.site || !live.build.copy) return blockedBy(["We could not find your published website, or it was built before changes could be applied automatically"]);
  const change = await applySiteChange(env, {
    site: live.build.site, copy: live.build.copy, requestText,
    scope: { entityType: "SUBSCRIPTION", entityId: request.subscription_id, correlationId: targetStep.workflow_run_id }, deps: deps.generate
  });
  if (!change.understood || change.problems.length) return blockedBy(change.problems);

  const pages = buildSite(change.site, change.copy);
  const images = live.build.images || [];
  const problems = checkSite({ pages, images: Object.fromEntries(images.map((i) => [i.path, i.size])), site: change.site });
  if (problems.length) return blockedBy([`The updated website failed our automated checks: ${problems.slice(0, 5).join("; ")}`]);

  const build = { version: 1, slug: live.slug, style: change.site.style, built_at: new Date().toISOString(), pages, images, site: change.site, copy: change.copy };
  const stored = await storeDeliverable(env, context, { type: "SITE_BUILD", filename: `${live.slug}-site-update.json`, mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify(build)), folder: "site-build",
    metadata: { website: { slug: live.slug, style: change.site.style, pages: Object.keys(pages).length, images: images.length }, care: { request_id: request.id, summary: change.summary, changes: change.changes } } });
  await setRequest(env, request.id, "DRAFTED", { summary: change.summary, changes: change.changes, deliverable_id: stored.deliverableId });
  const output = { outcome: "DRAFTED", summary: change.summary, changes: change.changes, deliverable_id: stored.deliverableId, version: stored.version };
  await completeStep(targetStep, output, env);
  return output;
}

export { LINK_KIND, runWebsiteCareProduceStep, siteCareLink };
