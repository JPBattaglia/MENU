// Conversion Fix recommendations (stage 6): the AI ranks and explains the audit's findings and rewrites a few lines of
// the buyer's own copy. Everything it says is checked afterwards: it may only cite findings the audit produced, every
// high-severity finding must be addressed, and it may not promise results or write phone numbers, prices or hours the
// site does not already show. One retry with the problems listed; after that the owner is told and nothing is sent.
import { generate } from "../../ai/generate.js";
import { findUnsupportedFacts } from "../../ai/quality.js";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 plain sentences: the biggest opportunity and what to do first." },
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding_ids: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          why: { type: "string", description: "Why this costs the business customers, in one or two sentences." },
          steps: { type: "array", items: { type: "string" } },
          impact: { type: "string", enum: ["high", "medium", "low"] },
          effort: { type: "string", enum: ["quick", "moderate", "larger"] },
          snippet: { type: "string", description: "Optional ready-to-paste HTML or CSS. Empty string if none." }
        },
        required: ["finding_ids", "title", "why", "steps", "impact", "effort", "snippet"]
      }
    },
    copy: {
      type: "array",
      items: {
        type: "object",
        properties: { where: { type: "string" }, current: { type: "string" }, suggested: { type: "string" } },
        required: ["where", "current", "suggested"]
      }
    }
  },
  required: ["summary", "fixes", "copy"]
};

const SYSTEM = [
  "You are a conversion consultant for small restaurants and local businesses. You receive an audit of a business's website: a list of findings, each with an id, plus a sample of the site's own wording and the owner's main goal.",
  "Write a prioritized fix list. Every fix must cite the finding id(s) it addresses and may only describe problems that appear in the findings. Address every high-severity finding. Merge related findings into one fix. Order by impact, then effort.",
  "Also suggest rewritten wording (headline, main button, a short description line) using only facts that appear in the site sample or the goal. Never invent phone numbers, addresses, prices, hours, awards, review counts or statistics.",
  "Never promise results: no percentages, no 'will increase', no guarantees. Plain, specific, friendly language a restaurant owner understands. Snippets must be small and safe to paste (no scripts from other sites)."
].join(" ");

const PROMISES = /\d+\s?%|\bguarantee|\bwill (increase|boost|double|triple|grow)|\b(double|triple) your\b|\bskyrocket/i;

function validate(output, audit) {
  const problems = [];
  const known = new Set(audit.findings.map((f) => f.id));
  const fixes = Array.isArray(output.fixes) ? output.fixes : [];
  const copy = Array.isArray(output.copy) ? output.copy : [];
  const high = audit.findings.filter((f) => f.severity === "high").map((f) => f.id);
  if (audit.findings.length > 0 && (fixes.length < 1 || fixes.length > 12)) problems.push(`Provide between 1 and 12 fixes (got ${fixes.length})`);
  const covered = new Set();
  const source = `${audit.sample.text}\n${audit.sample.title}\n${audit.sample.description}\n${audit.sample.headlines.join("\n")}\n${audit.goal}`;
  const clean = [];
  fixes.forEach((fix, i) => {
    const label = `Fix ${i + 1}`;
    const ids = (Array.isArray(fix.finding_ids) ? fix.finding_ids : []).map(String);
    if (!ids.length || ids.some((id) => !known.has(id))) problems.push(`${label}: finding_ids must be ids from the audit (${ids.filter((id) => !known.has(id)).join(", ") || "none given"})`);
    ids.forEach((id) => covered.add(id));
    const title = String(fix.title ?? "").trim(); const why = String(fix.why ?? "").trim();
    const steps = (Array.isArray(fix.steps) ? fix.steps : []).map((s) => String(s).trim()).filter(Boolean);
    const snippet = String(fix.snippet ?? "").trim();
    if (!title || !why || steps.length < 1) problems.push(`${label}: needs a title, a reason and at least one step`);
    if (snippet.length > 1500) problems.push(`${label}: snippet is longer than 1500 characters`);
    if (/<script[^>]+src\s*=\s*["']?https?:\/\//i.test(snippet)) problems.push(`${label}: snippet must not load outside scripts`);
    const all = [title, why, ...steps].join(" ");
    if (PROMISES.test(all)) problems.push(`${label}: do not promise results or give percentages`);
    for (const fact of findUnsupportedFacts(all, source)) problems.push(`${label}: ${fact.kind} "${fact.value}" is not on the site or in the goal`);
    clean.push({ finding_ids: ids, title, why, steps, impact: ["high", "medium", "low"].includes(fix.impact) ? fix.impact : "medium", effort: ["quick", "moderate", "larger"].includes(fix.effort) ? fix.effort : "moderate", snippet });
  });
  for (const id of high) if (!covered.has(id)) problems.push(`The high-severity finding "${id}" is not addressed by any fix`);
  const copyClean = [];
  copy.slice(0, 8).forEach((c, i) => {
    const suggested = String(c.suggested ?? "").trim();
    if (!suggested) return;
    if (PROMISES.test(suggested)) problems.push(`Copy ${i + 1}: do not promise results or give percentages`);
    for (const fact of findUnsupportedFacts(suggested, source)) problems.push(`Copy ${i + 1}: ${fact.kind} "${fact.value}" is not on the site or in the goal`);
    copyClean.push({ where: String(c.where ?? "").trim().slice(0, 80), current: String(c.current ?? "").trim().slice(0, 300), suggested: suggested.slice(0, 400) });
  });
  const summary = String(output.summary ?? "").trim();
  if (summary.length < 20) problems.push("Write a summary of 2-3 sentences");
  if (PROMISES.test(summary)) problems.push("The summary must not promise results or give percentages");
  return { fixes: clean, copy: copyClean, summary, problems };
}

async function recommend(env, audit, { note = "", scope }, deps) {
  const prompt = `OWNER'S MAIN GOAL: ${audit.goal}\n\nSITE SAMPLE (the site's own wording):\nTitle: ${audit.sample.title}\nDescription: ${audit.sample.description}\nHeadlines: ${audit.sample.headlines.join(" | ")}\nButtons and links: ${audit.sample.buttons.join(" | ")}\nParagraphs: ${audit.sample.paragraphs.join(" | ")}\n\nMEASUREMENTS: ${JSON.stringify(audit.facts)}\n\nAUDIT FINDINGS:\n${audit.findings.map((f) => `- [${f.id}] (${f.severity}, ${f.area}) ${f.title}: ${f.evidence}`).join("\n") || "(none - the site passed every check; suggest 2-3 small improvements toward the goal using only the sample)"}${note ? `\n\nREVIEWER CORRECTION FROM A PREVIOUS ATTEMPT: ${note}` : ""}`;
  let feedback = "";
  let last = { fixes: [], copy: [], summary: "", problems: ["No attempt was made"] };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generate(env, { purpose: "conversion_fix_recommend", system: SYSTEM, prompt: prompt + feedback, schema: SCHEMA, scope, maxTokens: 8000 }, deps);
    last = validate(result.output, audit);
    if (last.problems.length === 0) return { ...last, attempts: attempt };
    feedback = `\n\nYour previous answer had these problems; fix them all:\n- ${last.problems.slice(0, 12).join("\n- ")}`;
  }
  return { ...last, attempts: 2 };
}

export { recommend, validate };
