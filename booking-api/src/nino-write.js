// Newsletter copy for the Nino shop (worker nino-printful-commerce-api, newsletter.mjs).
//
// Reached only through the service binding to the named entrypoint "NinoWrite" (no public route). It writes the
// words of one issue (subject, heading, intro, button label) with the shared AI step, under its own monthly token
// cap. The shop picks the designs, prices and offers itself and passes them in as facts; this never invents them.
// The owner approves every issue before it is sent (owner decision, Oct 31, 2026).
import { generate } from "./ai/generate.js";

export const NINO_WRITE_CAP_TOKENS = 300_000; // a few cents a month; an issue uses about 2,000

const SYSTEM = `You write short email newsletters for Nino Battaglia, a San Francisco graphic designer who sells his original artwork on shirts, sweatshirts, totes, stickers and aprons at ninobattaglia.com.
Voice: confident, warm, a little playful, plain words. No hype words (amazing, epic, must-have), no exclamation marks in the subject, no emoji, no arrows.
Only mention facts given to you: the design names and descriptions, the products, the offer. Never invent prices, dates, discounts, deadlines or quotes.
Keep it short: subject under 60 characters, heading under 45 characters, intro 1 to 2 sentences under 45 words, button label 2 to 4 words.`;

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" }, heading: { type: "string" }, intro: { type: "string" }, cta_label: { type: "string" }
  },
  required: ["subject", "heading", "intro", "cta_label"]
};

const clip = (value, max) => String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

export async function writeNinoNewsletter(env, brief, deps = {}) {
  const designs = Array.isArray(brief?.designs) ? brief.designs.slice(0, 6) : [];
  if (!designs.length) throw new Error("nino_write_no_designs");
  const lines = [
    `Issue type: ${brief.kind === "holiday" ? "holiday drop" : "monthly news"}.`,
    `Designs featured:\n${designs.map((d) => `- ${clip(d.title, 80)}: ${clip(d.description, 200)}`).join("\n")}`,
    brief.products ? `Products available: ${clip(brief.products, 300)}.` : "",
    brief.offer ? `Standing offer: ${clip(brief.offer, 200)}.` : "",
    brief.previousSubjects?.length ? `Don't reuse these recent subjects: ${brief.previousSubjects.slice(0, 6).map((s) => clip(s, 80)).join(" | ")}` : "",
    brief.ownerNote ? `The owner asked for these changes to the last draft, follow them: ${clip(brief.ownerNote, 1000)}` : ""
  ].filter(Boolean);
  const result = await generate(env, {
    purpose: "nino_newsletter", system: SYSTEM, prompt: lines.join("\n\n"), schema: SCHEMA, maxTokens: 800,
    scope: { entityType: "NINO", entityId: "nino-newsletter" }, capTokens: NINO_WRITE_CAP_TOKENS
  }, deps);
  const out = result.output || {};
  return { subject: clip(out.subject, 90), heading: clip(out.heading, 70), intro: clip(out.intro, 400), cta_label: clip(out.cta_label, 30) };
}
