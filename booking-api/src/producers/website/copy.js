// Website copy (stage 7): the shared AI step writes a tagline, an intro and the About text from the buyer's own intake.
// Every number, time, phone, email and web address it writes must already be in the intake, and unverifiable boasts
// ("best", "award-winning", "since 1990") are refused unless the buyer wrote them. One retry with the problems listed.
import { generate } from "../../ai/generate.js";
import { findUnsupportedFacts } from "../../ai/quality.js";

const SCHEMA = {
  type: "object",
  properties: {
    tagline: { type: "string", description: "A short line under the business name, 4-10 words." },
    intro: { type: "string", description: "Two or three sentences for the home page." },
    about: { type: "array", items: { type: "string" }, description: "1-3 paragraphs for the About page." },
    meta_description: { type: "string", description: "Search description for the home page, 80-155 characters." },
    meta_about: { type: "string", description: "Search description for the About page, 60-155 characters." }
  },
  required: ["tagline", "intro", "about", "meta_description", "meta_about"]
};
const SYSTEM = [
  "You write the words for a small local business's website, in warm, plain, specific language.",
  "Use ONLY facts the owner gave you below. Do not invent a founding year, awards, ingredients, staff names, locations, hours, prices or claims.",
  "Do not use superlatives such as best, finest, number one, famous or award-winning unless the owner wrote them. No placeholder text. No exclamation marks."
].join(" ");
const BOASTS = /\b(best|finest|#1|number one|award[- ]winning|world[- ]famous|famous|legendary|world[- ]class|since (?:19|20)\d\d|established (?:in )?(?:19|20)\d\d)\b/i;

function intakeText(site) {
  return [site.name, site.about, site.offerings, site.hours, site.address, site.phone, site.email, site.facebook, site.instagram].filter(Boolean).join("\n");
}

function validateCopy(output, site) {
  const problems = [];
  const source = intakeText(site);
  const about = (Array.isArray(output.about) ? output.about : []).map((p) => String(p).trim()).filter(Boolean).slice(0, 3);
  const copy = { tagline: String(output.tagline ?? "").trim(), intro: String(output.intro ?? "").trim(), about, meta_description: String(output.meta_description ?? "").trim(), meta_about: String(output.meta_about ?? "").trim() };
  const words = copy.tagline.split(/\s+/).filter(Boolean).length;
  if (words < 2 || words > 14 || copy.tagline.length > 90) problems.push("The tagline must be 2-14 words");
  if (copy.intro.length < 40 || copy.intro.length > 600) problems.push("The intro must be 40-600 characters");
  if (!about.length || about.join(" ").length < 80 || about.join(" ").length > 1800) problems.push("The About text must be 80-1800 characters");
  if (copy.meta_description.length < 50 || copy.meta_description.length > 170) problems.push("meta_description must be 50-170 characters");
  if (copy.meta_about.length < 40 || copy.meta_about.length > 170) problems.push("meta_about must be 40-170 characters");
  const all = [copy.tagline, copy.intro, ...about, copy.meta_description, copy.meta_about].join("\n");
  for (const fact of findUnsupportedFacts(all, source)) problems.push(`${fact.kind} "${fact.value}" is not in the owner's details`);
  const boast = BOASTS.exec(all);
  if (boast && !BOASTS.test(source)) problems.push(`"${boast[0]}" is a claim the owner did not make`);
  if (/!|lorem ipsum|\[[^\]]+\]/.test(all)) problems.push("Remove exclamation marks and placeholder text");
  return { copy, problems };
}

async function writeCopy(env, site, { note = "", scope }, deps) {
  const prompt = `BUSINESS: ${site.name}\nTYPE: ${site.kind === "services" ? "services business" : "restaurant or food business"}\nSTYLE: ${site.style}\n\nOWNER'S DESCRIPTION:\n${site.about}\n\nOFFERINGS (menu or services):\n${site.offerings}\n\nADDRESS: ${site.address}\nHOURS:\n${site.hours}${note ? `\n\nREVIEWER CORRECTION FROM A PREVIOUS ATTEMPT: ${note}` : ""}`;
  let feedback = "";
  let last = { copy: null, problems: ["No attempt was made"] };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generate(env, { purpose: "website_copy", system: SYSTEM, prompt: prompt + feedback, schema: SCHEMA, scope, maxTokens: 2500 }, deps);
    last = validateCopy(result.output, site);
    if (last.problems.length === 0) return { ...last, attempts: attempt };
    feedback = `\n\nYour previous answer had these problems; fix them all:\n- ${last.problems.slice(0, 10).join("\n- ")}`;
  }
  return { ...last, attempts: 2 };
}

export { validateCopy, writeCopy };
