// Accessibility Monitoring PRODUCE step (stage 6, monthly): scan the buyer's website, explain what was found, and deliver
// a report straight to the buyer (no owner step, as in the service spec). Every report says what a static scan cannot check
// and that it does not guarantee legal compliance. The AI writes only a short plain-language summary; all findings and
// fixes come from the scanner's rule table, so nothing in the list of issues can be invented.
import { escapeHtml } from "../../lib/email.js";
import { jsonResponse, parseJsonOrNull } from "../../lib/http.js";
import { generate } from "../../ai/generate.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { getSettings, settingsLink } from "../../subscriptions/settings.js";
import { sendTransactionalEmail, brandedEmailHtml } from "../../lib/email.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { scanSite, summarize } from "./scan.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DISCLAIMER = "This report comes from an automated scan of your pages' HTML. It cannot check colour contrast, keyboard use, content added by scripts, or video and audio, and no automated scan can guarantee that a website meets the law or the WCAG standard. Treat it as a prioritised list of real problems to fix, not as a certificate.";
const BAD_PROMISE = /\b(fully|legally|ada|wcag)[ -]compliant\b|\bguarantee/i;
const e = escapeHtml;

async function previousReport(env, businessId) {
  const row = await env.DB.prepare(`
      SELECT a.metadata_json FROM deliverables d JOIN assets a ON a.id = d.asset_id JOIN projects p ON p.id = d.project_id
      WHERE p.business_id = ? AND d.deliverable_type = 'ACCESSIBILITY_REPORT' AND d.customer_visible = 1
      ORDER BY d.delivered_at DESC LIMIT 1
    `).bind(businessId).first();
  return parseJsonOrNull(row?.metadata_json)?.accessibility || null;
}

async function plainSummary(env, { site, summary, previous, scope }, deps) {
  const fallback = summary.total === 0
    ? "We found no problems that a scan of your page markup can detect. Keep checking new content as you add it."
    : `We found ${summary.total} problem${summary.total === 1 ? "" : "s"} across ${summary.rules} type${summary.rules === 1 ? "" : "s"} on ${site.scanned} page${site.scanned === 1 ? "" : "s"}. The most important are listed first below.`;
  if (!env.ANTHROPIC_API_KEY) return fallback;
  try {
    const result = await generate(env, {
      purpose: "accessibility_summary",
      system: "You write a 2-3 sentence plain-language summary of a website accessibility scan for a restaurant owner. Use ONLY the numbers and issue titles provided. Do not say the site is compliant, certified, safe from lawsuits, or guaranteed anything. No jargon.",
      prompt: `Pages scanned: ${site.scanned}. Total problems: ${summary.total}. Previous month total: ${previous ? previous.total : "none (first report)"}.\nIssues, most important first:\n${summary.issues.map((i) => `- ${i.title} (${i.impact}, ${i.count} found)`).join("\n") || "- none"}`,
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      scope, maxTokens: 500
    }, deps);
    const text = String(result.output.summary || "").trim();
    return text.length >= 30 && text.length <= 700 && !BAD_PROMISE.test(text) ? text : fallback;
  } catch { return fallback; } // the findings do not depend on the AI; a failure here must not stop the report
}

function reportHtml({ business, month, site, summary, previous, intro }) {
  const trend = previous ? (summary.total < previous.total ? `Down from ${previous.total} problems last month.` : summary.total === previous.total ? `Same as last month (${previous.total}).` : `Up from ${previous.total} problems last month.`) : "This is your first report, so there is no trend yet.";
  const issues = summary.issues.map((i, n) => `<section class="issue ${i.impact}"><h3>${n + 1}. ${e(i.title)} <span>${e(i.impact)} · ${i.count} found</span></h3><p>${e(i.why)}</p><p><strong>How to fix:</strong> ${e(i.fix)}</p>
    ${i.examples.length ? `<p class="ex">Examples: ${i.examples.map((x) => `<code>${e(x)}</code>`).join(" ")}</p>` : ""}<p class="ex">Found on: ${[...new Set(i.pages)].slice(0, 5).map(e).join(", ")}</p></section>`).join("");
  const pages = site.pages.map((p) => `<li>${e(p.url)} - ${p.error ? `<em>${e(p.error)}</em>` : `${p.findings.reduce((n, f) => n + f.count, 0)} problem(s)`}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(business)} accessibility report - ${e(month)}</title>
<style>body{margin:0;background:#f4f1ec;font:16px/1.55 system-ui,sans-serif;color:#1d1d1b}main{max-width:780px;margin:0 auto;padding:24px 18px 48px}h1{font-size:28px;margin:0 0 4px}.big{font-size:44px;font-weight:700;margin:8px 0}.issue{background:#fff;border:1px solid #e3ddd2;border-left:6px solid #888;border-radius:8px;padding:6px 16px;margin:14px 0}.critical{border-left-color:#b3261e}.serious{border-left-color:#d2691e}.moderate{border-left-color:#c9a227}.minor{border-left-color:#4a6a7a}h3 span{font-size:13px;font-weight:400;color:#6b675f;margin-left:8px}.ex{font-size:14px;color:#4a4a45}code{background:#f0ece4;padding:1px 5px;border-radius:4px}.note{background:#fff;border:1px solid #e3ddd2;padding:12px 16px;border-radius:8px;font-size:14px}</style></head>
<body><main><h1>${e(business)}</h1><p>Website accessibility report · ${e(month)}</p><div class="big">${summary.total} problem${summary.total === 1 ? "" : "s"}</div><p>${e(trend)}</p><p>${e(intro)}</p>${issues || "<p>No problems were found by this scan.</p>"}
<h2>Pages scanned</h2><ul>${pages}</ul><p class="note">${e(DISCLAIMER)}</p></main></body></html>`;
}

async function runAccessibilityProduceStep(targetStep, env, deps = {}) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(context.id).first();
  const metadata = parseJsonOrNull(project?.metadata_json) || {};
  const subscriptionId = metadata.subscription_id;
  const settings = subscriptionId ? await getSettings(env, subscriptionId) : {};

  if (!settings.website_url) {
    // Park until the buyer saves their website; saving settings releases this step.
    const link = await settingsLink(env, subscriptionId);
    const sent = await sendTransactionalEmail(env, {
      to: context.customer_email,
      subject: "Accessibility Monitoring: tell us which website to scan",
      html: brandedEmailHtml({ preheader: "One quick step to start your monthly accessibility report.", eyebrow: "ACCESSIBILITY MONITORING", heading: "Which website should we scan?",
        paragraphs: [`Hi ${e(context.first_name || "there")}, we need your website address to start your monthly accessibility report.`], buttons: [{ label: "Enter my website", url: link, primary: true }], footnote: "It takes a few seconds, and your report is made as soon as you save it." }),
      text: `We need your website address to start your monthly accessibility report.\n\nEnter my website: ${link}`,
      idempotencyKey: `access-settings/${subscriptionId}`, purpose: "ACCESSIBILITY_SETTINGS", templateKey: "access_settings_v1",
      context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
    });
    if (!sent.ok) throw new Error(`Settings email failed: ${sent.error}`);
    await env.DB.prepare(`UPDATE workflow_steps SET status = 'WAITING', error_message = NULL, output_json = ? WHERE id = ?`).bind(JSON.stringify({ waiting_for: "SETTINGS" }), targetStep.workflow_step_id).run();
    await env.DB.prepare(`UPDATE workflow_runs SET status = 'WAITING', error_code = 'SETTINGS_REQUIRED', error_message = 'Waiting for the website address' WHERE id = ?`).bind(targetStep.workflow_run_id).run();
    return { waiting: true, response: jsonResponse({ ok: true, processed: true, status: "WAITING", waiting_for: "SETTINGS", workflow_run_id: targetStep.workflow_run_id, step_key: targetStep.step_key }, 202) };
  }

  const date = new Date(metadata.period_start || Date.now());
  const month = `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  const site = await scanSite(settings.website_url, { maxPages: 10, fetcher: deps.fetch || fetch });
  if (site.scanned === 0) {
    // The home page itself could not be read: no report is better than an empty one the buyer would trust.
    throw new Error(`Could not scan ${settings.website_url}: ${site.pages[0]?.error || "no pages"}`);
  }
  const summary = summarize(site);
  const previous = await previousReport(env, context.business_id);
  const intro = await plainSummary(env, { site, summary, previous, scope: { entityType: "SUBSCRIPTION", entityId: subscriptionId, correlationId: targetStep.workflow_run_id } }, deps.generate);
  const html = new TextEncoder().encode(reportHtml({ business: context.business_name || "Your business", month, site, summary, previous, intro }));
  const stored = await storeDeliverable(env, context, {
    type: "ACCESSIBILITY_REPORT", filename: `accessibility-report-${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}.html`, mime: "text/html", bytes: html, folder: "accessibility",
    metadata: { accessibility: { total: summary.total, rules: summary.rules, scanned: site.scanned, failed: site.failed, url: settings.website_url, month } }
  });
  const output = { outcome: "REPORTED", url: settings.website_url, pages_scanned: site.scanned, pages_failed: site.failed, problems: summary.total, deliverable_id: stored.deliverableId };
  await completeStep(targetStep, output, env);
  return output;
}

export { DISCLAIMER, reportHtml, runAccessibilityProduceStep };
