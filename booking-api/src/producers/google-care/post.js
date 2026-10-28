// The weekly Google post (Google Profile Care, stage 5): written by the shared AI step from what the business told us
// (plan settings: voice and specials) and its Google profile (description, hours, phone, website), then checked so it
// never states a price, time, phone number, email or web address the business did not give us. A post that still fails
// after one retry is not published (the owner is told); nothing invented goes public.
import { generate } from "../../ai/generate.js";
import { qualityCheck } from "../../ai/quality.js";
import { formatAddress } from "../../google/api.js";
import { describeProblem } from "../review-replies/draft.js";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MIN_POST = 80;
const MAX_POST = 1400; // Google allows 1,500 characters

function clock(t) {
  const h = Number(t?.hours || 0);
  const m = Number(t?.minutes || 0);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "am" : "pm"}`;
}

function hoursText(regularHours) {
  const periods = regularHours?.periods || [];
  return DAYS.map((day) => {
    const open = periods.filter((p) => p.openDay === day);
    const name = day[0] + day.slice(1).toLowerCase();
    return open.length ? `${name} ${open.map((p) => `${clock(p.openTime)} to ${clock(p.closeTime)}`).join(", ")}` : null;
  }).filter(Boolean).join("; ");
}

function profileFacts({ businessName, location = {}, settings = {} }) {
  const phones = [location.phoneNumbers?.primaryPhone, ...(location.phoneNumbers?.additionalPhones || [])].filter(Boolean);
  return [
    `Business: ${businessName}`,
    location.profile?.description ? `About: ${location.profile.description}` : "",
    location.storefrontAddress ? `Address: ${formatAddress(location.storefrontAddress)}` : "",
    hoursText(location.regularHours) ? `Opening hours: ${hoursText(location.regularHours)}` : "",
    phones.length ? `Phone: ${phones.join(", ")}` : "",
    location.websiteUri ? `Website: ${location.websiteUri}` : "",
    settings.specials ? `Specials, events or dates to feature: ${settings.specials}` : "",
    settings.voice ? `How posts should sound: ${settings.voice}` : ""
  ].filter(Boolean).join("\n");
}

const SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };

async function draftWeeklyPost(env, { businessName, location, settings, recentPosts = [], now = new Date(), scope }, deps) {
  const facts = profileFacts({ businessName, location, settings });
  const system = [
    `You write one short Google Business Profile post ("What's new") for "${businessName}".`,
    "2 to 4 sentences, 150 to 600 characters, plain text, no hashtags, at most one emoji. Make people want to visit this week.",
    "Feature the specials or events given, if any; otherwise something seasonal or about what the business is known for, using only the facts given.",
    "Never state a price, time, phone number, email, web address, dish or event that is not in the facts. Never promise anything free unless the facts say so.",
    "Do not repeat the topic of the recent posts listed."
  ].join("\n");
  const base = [`Facts (the only facts you may use):\n${facts}`, `This week starts ${now.toISOString().slice(0, 10)} (${MONTHS[now.getUTCMonth()]}).`,
    recentPosts.length ? `Recent posts (do not repeat):\n${recentPosts.map((p) => `- ${p}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
  let best = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const extra = best ? `\n\nThe previous draft had these problems, fix them: ${best.problems.map(describeProblem).join("; ")}` : "";
    const result = await generate(env, { purpose: "google_post", system, prompt: base + extra, schema: SCHEMA, scope, maxTokens: 600 }, deps);
    const summary = String(result.output.summary || "").trim();
    const problems = qualityCheck(summary, { sourceText: facts, min: MIN_POST, max: MAX_POST }).problems;
    if (!best || problems.length < best.problems.length) best = { summary, problems };
    if (problems.length === 0) break;
  }
  return { ...best, facts };
}

export { hoursText, profileFacts, draftWeeklyPost };
