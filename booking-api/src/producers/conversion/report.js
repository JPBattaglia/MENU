// Conversion Fix deliverables: a printable report page and a plain-text checklist.
import { escapeHtml } from "../../lib/email.js";

const e = escapeHtml;
const LIMITS = "This review is based on the public pages of your site as our server saw them once, plus the wording on your home page. It cannot see your visitor numbers, scripts that build the page after it loads, or how your site looks on every device, and speed was measured from one location, so treat the timings as a guide. The suggestions are based on common practice, not a promise of a particular result.";
const IMPACT = { high: "High impact", medium: "Medium impact", low: "Smaller win" };
const EFFORT = { quick: "Quick (under an hour)", moderate: "Moderate (an afternoon)", larger: "Larger project" };

function reportHtml({ business, goalLabel, audit, rec, date }) {
  const byId = new Map(audit.findings.map((f) => [f.id, f]));
  const fixes = rec.fixes.map((fix, i) => `<section class="fix ${e(fix.impact)}"><h3>${i + 1}. ${e(fix.title)}</h3><p class="tags">${e(IMPACT[fix.impact])} · ${e(EFFORT[fix.effort])}</p>
    <p>${e(fix.why)}</p><ol>${fix.steps.map((s) => `<li>${e(s)}</li>`).join("")}</ol>
    ${fix.snippet ? `<pre><code>${e(fix.snippet)}</code></pre>` : ""}
    <p class="ev">What we saw: ${fix.finding_ids.map((id) => e(byId.get(id)?.evidence || "")).filter(Boolean).join(" ")}</p></section>`).join("");
  const copy = rec.copy.length ? `<h2>Suggested wording</h2><table><tr><th>Where</th><th>Now</th><th>Try</th></tr>${rec.copy.map((c) => `<tr><td>${e(c.where)}</td><td>${e(c.current)}</td><td><strong>${e(c.suggested)}</strong></td></tr>`).join("")}</table>` : "";
  const checks = audit.findings.length === 0 ? "<p>Every check passed.</p>" : `<ul>${audit.findings.map((f) => `<li><strong>${e(f.title)}</strong> <span class="tags">(${e(f.severity)})</span> - ${e(f.evidence)}</li>`).join("")}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(business)} - Conversion Fix report</title>
<style>body{margin:0;background:#f4f1ec;font:16px/1.55 system-ui,sans-serif;color:#1d1d1b}main{max-width:820px;margin:0 auto;padding:24px 18px 48px}h1{font-size:28px;margin:0 0 4px}.fix{background:#fff;border:1px solid #e3ddd2;border-left:6px solid #888;border-radius:8px;padding:6px 18px;margin:16px 0}.fix.high{border-left-color:#b3261e}.fix.medium{border-left-color:#c9a227}.fix.low{border-left-color:#4a6a7a}.tags{color:#6b675f;font-size:14px}.ev{font-size:14px;color:#4a4a45}pre{background:#f0ece4;padding:12px;border-radius:6px;overflow:auto;white-space:pre-wrap}table{width:100%;border-collapse:collapse;background:#fff}td,th{border:1px solid #e3ddd2;padding:8px;text-align:left;vertical-align:top}.note{background:#fff;border:1px solid #e3ddd2;padding:12px 16px;border-radius:8px;font-size:14px}@media print{body{background:#fff}.fix{break-inside:avoid}}</style></head>
<body><main><h1>${e(business)}</h1><p class="tags">Conversion Fix report · ${e(date)} · ${e(audit.url)}</p><p>Your main goal: <strong>${e(goalLabel)}</strong></p><p>${e(rec.summary)}</p>
<h2>Fixes, in the order to do them</h2>${fixes}${copy}<h2>What we checked</h2>${checks}<p class="note">${e(LIMITS)}</p></main></body></html>`;
}

function checklistText({ business, audit, rec }) {
  return [`${business} - Conversion Fix checklist`, audit.url, "", ...rec.fixes.map((f, i) => `[ ] ${i + 1}. ${f.title} (${IMPACT[f.impact]}, ${EFFORT[f.effort]})\n${f.steps.map((s) => `      - ${s}`).join("\n")}`), "", LIMITS].join("\n");
}

export { LIMITS, checklistText, reportHtml };
