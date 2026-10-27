// Conversion Fix PRODUCE step (stage 6, one-time $299). Audits the buyer's site, has the shared AI step rank and explain
// the findings, and stores a report page and a checklist as drafts. The owner approves before the buyer is emailed.
// An unreachable site or a recommendation that fails its checks twice is never delivered: the owner is told.
import { ownerEmailAddress } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { AiCapError } from "../../ai/generate.js";
import { loadRegenerationNote } from "../../approvals/actions.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { finishRun } from "../menu-care/care-step.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { GOALS, auditSite, goalKind } from "./audit.js";
import { recommend } from "./recommend.js";
import { checklistText, reportHtml } from "./report.js";

async function tellOwner(env, context, subject, reasons) {
  const business = context.business_name || "A customer";
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[Conversion Fix] ${subject} for ${business}`,
    html: brandedEmailHtml({ eyebrow: "CONVERSION FIX", heading: `${escapeHtml(business)}: ${escapeHtml(subject)}`, paragraphs: [`<ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`, "Nothing was sent to the customer."] }),
    text: `${business}: ${subject}\n- ${reasons.join("\n- ")}\nNothing was sent to the customer.`,
    idempotencyKey: `conversion-blocked/${context.id}/${reasons.join("|").length}`,
    purpose: "AUTOMATION_ALERT", templateKey: "conversion_blocked_v1"
  }).catch(() => null);
}

async function runConversionProduceStep(targetStep, env, deps = {}) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(context.id).first();
  const metadata = parseJsonOrNull(project?.metadata_json) || {};
  const input = async (key) => (await env.DB.prepare(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = ? AND status = 'VALID'`).bind(context.id, key).first())?.value_text || "";
  const url = await input("website_url");
  const goal = await input("main_goal");
  const business = context.business_name || "Your business";
  const blocked = async (subject, reasons) => {
    await tellOwner(env, context, subject, reasons);
    await finishRun(targetStep, context, { outcome: "NOT_PRODUCED", reasons }, env);
    return { outcome: "NOT_PRODUCED", reasons };
  };
  if (!url) return blocked("no website address on the order", ["The order has no website address, so nothing could be audited."]);

  const audit = await auditSite(url, goal, { fetcher: deps.fetch || fetch });
  if (!audit.ok) return blocked("the website could not be read", [`${url}: ${audit.error}. Ask the buyer to check the address.`]);
  const note = await loadRegenerationNote(env, context.id);
  const rec = await recommend(env, audit, { note: note?.note || "", scope: { entityType: "PROJECT", entityId: context.id, correlationId: targetStep.workflow_run_id } }, deps.generate)
    .catch((error) => (error instanceof AiCapError ? { capped: error.message } : Promise.reject(error)));
  if (rec.capped) return blocked("monthly AI limit reached", [rec.capped]);
  if (rec.problems.length) return blocked("the recommendations failed the quality checks", rec.problems);

  const goalLabel = GOALS.find((g) => g.key === goalKind(goal))?.label || goal;
  const date = new Date().toISOString().slice(0, 10);
  const info = { url: audit.url, goal, summary: rec.summary, fixes: rec.fixes.length, findings: audit.findings.length, attempts: rec.attempts, pages: audit.pagesChecked };
  const enc = new TextEncoder();
  const slug = business.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
  const report = await storeDeliverable(env, context, { type: "CONVERSION_REPORT", filename: `${slug}-conversion-fix-report.html`, mime: "text/html", bytes: enc.encode(reportHtml({ business, goalLabel, audit, rec, date })), folder: "conversion-report", metadata: { conversion: info } });
  const checklist = await storeDeliverable(env, context, { type: "CONVERSION_CHECKLIST", filename: `${slug}-conversion-fix-checklist.txt`, mime: "text/plain", bytes: enc.encode(checklistText({ business, audit, rec })), folder: "conversion-checklist", metadata: { conversion: info } });
  const output = { outcome: "PRODUCED", url: audit.url, fixes: rec.fixes.length, findings: audit.findings.length, report_deliverable: report.deliverableId, checklist_deliverable: checklist.deliverableId, version: report.version };
  await completeStep(targetStep, output, env);
  return output;
}

export { runConversionProduceStep };
