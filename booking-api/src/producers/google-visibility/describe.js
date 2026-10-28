// Google Visibility: the new business description (250-750 characters), written by the shared AI step only from
// what Google already shows and what the business told Menu-Made. Google's rules for descriptions: no links, no
// phone numbers, no prices or offers. So the check treats any web address, phone number, email or price as invented
// (the facts handed to the check contain none), and a draft that still fails after one retry is not used.
import { generate } from "../../ai/generate.js";
import { qualityCheck } from "../../ai/quality.js";
import { hoursText } from "../google-care/post.js";
import { describeProblem } from "../review-replies/draft.js";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "./audit.js";

const HYPE = /\b(best|#1|number one|world[- ]class|award[- ]winning|guaranteed?|cheapest|lowest prices?)\b/i;

function descriptionFacts({ businessName, location = {}, about = "" }) {
  const a = location.storefrontAddress || {};
  const categories = [location.categories?.primaryCategory?.displayName, ...(location.categories?.additionalCategories || []).map((c) => c.displayName)].filter(Boolean);
  return [
    `Business: ${businessName}`,
    categories.length ? `Google categories: ${categories.join(", ")}` : "",
    a.locality ? `Location: ${[a.sublocality, a.locality, a.administrativeArea].filter(Boolean).join(", ")}` : "",
    hoursText(location.regularHours) ? `Opening hours: ${hoursText(location.regularHours)}` : "",
    location.profile?.description ? `Current Google description: ${location.profile.description}` : "",
    about ? `What the owner wrote about the business: ${about}` : ""
  ].filter(Boolean).join("\n");
}

const SCHEMA = { type: "object", properties: { description: { type: "string" } }, required: ["description"] };

// Returns { description, problems, facts }. problems is empty when the draft can be used.
async function draftDescription(env, { businessName, location, about, note = "", scope }, deps) {
  const facts = descriptionFacts({ businessName, location, about });
  const system = [
    `You write the "From the business" description on the Google Business Profile of "${businessName}".`,
    `${DESCRIPTION_MIN + 50} to ${DESCRIPTION_MAX - 50} characters, plain text, 2 to 5 sentences, third person or "we", no emoji, no hashtags, no lists.`,
    "Say what the business is, what it serves or does, what makes it different and where it is, using only the facts given.",
    "Never include a web address, phone number, email, price, discount, offer or opening hours. Never claim it is the best, award-winning or anything the facts don't say.",
    "If a current description is given, keep everything true from it and make it fuller."
  ].join("\n");
  const base = `Facts (the only facts you may use):\n${facts}${note ? `\n\nThe owner's note on the previous version: ${note}` : ""}`;
  // The check's source has no phones, links, emails or prices, so any of them in the draft is a problem.
  const checkSource = facts.replace(/^Opening hours:.*$/m, "");
  let best = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const extra = best ? `\n\nThe previous draft had these problems, fix them: ${best.problems.map(describeProblem).join("; ")}` : "";
    const result = await generate(env, { purpose: "google_description", system, prompt: base + extra, schema: SCHEMA, scope, maxTokens: 700 }, deps);
    const description = String(result.output.description || "").replace(/\s+/g, " ").trim();
    const problems = qualityCheck(description, { sourceText: checkSource, min: DESCRIPTION_MIN, max: DESCRIPTION_MAX }).problems;
    const hype = HYPE.exec(description);
    if (hype && !new RegExp(`\\b${hype[0].replace(/[#]/g, "\\#")}\\b`, "i").test(facts)) problems.push({ kind: "claim", value: hype[0] });
    if (/(?:^|\s)#\w/.test(description)) problems.push({ kind: "hashtag", value: description.match(/#\w+/)[0] });
    if (!best || problems.length < best.problems.length) best = { description, problems };
    if (problems.length === 0) break;
  }
  return { ...best, facts };
}

export { descriptionFacts, draftDescription };
