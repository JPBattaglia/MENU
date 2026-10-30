// Website & App Care (stage 7): apply a customer's change request to the live site's own details and copy.
//   applySiteChange(env, {site, copy, requestText, scope, deps}) -> { site, copy, summary, changes, problems, understood }
// The AI only proposes new values for named fields. Nothing it writes is trusted: every price, time, phone, email and
// address number must come from the request or the old site, copy must pass the same checks as a new site, and a change
// that removes most of the menu is refused. The caller rebuilds the pages from the result and runs the full site checks.
import { generate } from "../../ai/generate.js";
import { findUnsupportedFacts } from "../../ai/quality.js";
import { parseHours, parseOfferings } from "../website/build.js";
import { validateCopy } from "../website/copy.js";
import { STYLES, hexOk } from "../website/styles.js";

// field -> where it lives and what a customer calls it
const FIELDS = {
  offerings: { label: "menu or services", site: "offerings", max: 4000 },
  hours: { label: "opening hours", site: "hours", max: 400 },
  phone: { label: "phone number", site: "phone", max: 30 },
  address: { label: "address", site: "address", max: 160 },
  email: { label: "public email", site: "email", max: 120 },
  facebook: { label: "Facebook link", site: "facebook", max: 200 },
  instagram: { label: "Instagram link", site: "instagram", max: 200 },
  style: { label: "style", site: "style", max: 20 },
  brand: { label: "brand colour", site: "brand", max: 7 },
  about: { label: "About text", copy: "about", max: 1800 },
  tagline: { label: "tagline", copy: "tagline", max: 90 },
  intro: { label: "home page introduction", copy: "intro", max: 600 }
};
const digits = (v) => String(v ?? "").replace(/\D/g, "");

const SCHEMA = {
  type: "object",
  properties: {
    understood: { type: "boolean", description: "False if the request is not a clear change to the website (a question, a complaint, a request for a new photo or page)." },
    summary: { type: "string", description: "One plain sentence describing what you changed, or why you could not." },
    updates: {
      type: "array",
      items: { type: "object", properties: { field: { type: "string", enum: Object.keys(FIELDS) }, value: { type: "string", description: "The COMPLETE new value of that field (for offerings, the whole menu text in the same format)." } }, required: ["field", "value"] }
    }
  },
  required: ["understood", "summary", "updates"]
};
const SYSTEM = [
  "You update a small business's website for the owner. You receive the CURRENT DETAILS and the owner's CHANGE REQUEST.",
  "Return only the fields that must change, each with its complete new value. Leave every other field out.",
  "The offerings field uses the format: a line '# Section name' starts a section, then one item per line as 'Name | short description | $price'. When you change it, return the whole text with only the requested changes.",
  "The about field is the About page text: paragraphs separated by a blank line. Change copy only when asked to.",
  "Never invent a price, phone number, address, hour, email, link, award, year or claim. If the request needs a fact that is not in it, set understood to false.",
  "If the request is not a clear change to these fields (new photos, new pages, a redesign), set understood to false and explain in the summary."
].join(" ");

function currentDetails(site, copy) {
  const out = {};
  for (const [key, f] of Object.entries(FIELDS)) out[key] = f.site ? String(site[f.site] ?? "") : (key === "about" ? (copy.about || []).join("\n\n") : String(copy[f.copy] ?? ""));
  return out;
}

function applyUpdates(site, copy, updates) {
  const nextSite = { ...site };
  const nextCopy = { ...copy };
  for (const { field, value } of updates) {
    const f = FIELDS[field];
    const v = String(value ?? "").replace(/\r/g, "").trim().slice(0, f.max);
    if (f.site) nextSite[f.site] = v;
    else if (field === "about") nextCopy.about = v.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, 3);
    else nextCopy[f.copy] = v;
  }
  return { site: nextSite, copy: nextCopy };
}

const short = (v) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > 60 ? `${t.slice(0, 57)}...` : t || "(empty)"; };

function describeChanges(before, after) {
  const lines = [];
  for (const [key, f] of Object.entries(FIELDS)) {
    const a = before[key]; const b = after[key];
    if (a === b) continue;
    if (key === "offerings") {
      const old = new Map(parseOfferings(a).flatMap((s) => s.items.map((i) => [`${s.name}|${i.name}`.toLowerCase(), i])));
      const now = new Map(parseOfferings(b).flatMap((s) => s.items.map((i) => [`${s.name}|${i.name}`.toLowerCase(), i])));
      for (const [k, i] of now) { const o = old.get(k); if (!o) lines.push(`Added ${i.name}${i.price ? ` ${i.price}` : ""}`); else if (o.price !== i.price || o.description !== i.description) lines.push(`Changed ${i.name}: ${o.price !== i.price ? `price ${o.price || "none"} → ${i.price || "none"}` : "description updated"}`); }
      for (const [k, i] of old) if (!now.has(k)) lines.push(`Removed ${i.name}`);
      if (!lines.length) lines.push("Reorganised the menu");
    } else if (key === "about" || key === "intro") lines.push(`Rewrote the ${f.label}`);
    else lines.push(`Changed the ${f.label}: ${short(a)} → ${short(b)}`);
  }
  return lines;
}

function checkChange({ before, after, afterSite, afterCopy, requestText, updates }) {
  const problems = [];
  const changed = Object.keys(FIELDS).filter((k) => before[k] !== after[k]);
  if (!changed.length) problems.push("The request did not change anything on the website");
  for (const { field } of updates) if (!FIELDS[field]) problems.push(`Unknown field ${field}`);
  const known = `${Object.values(before).join("\n")}\n${requestText}`;
  const written = changed.map((k) => after[k]).join("\n");
  for (const fact of findUnsupportedFacts(written, known)) problems.push(`${fact.kind} "${fact.value}" is not in the current website or the request`);
  if (changed.includes("phone") && !digits(requestText).includes(digits(after.phone))) problems.push("The new phone number is not in the request");
  if (changed.includes("address")) for (const n of String(after.address).match(/\d{2,}/g) || []) if (!requestText.includes(n) && !before.address.includes(n)) problems.push(`Address number ${n} is not in the request`);
  if (changed.includes("style") && !STYLES[after.style]) problems.push(`"${after.style}" is not one of our styles (${Object.keys(STYLES).join(", ")})`);
  if (changed.includes("brand") && after.brand && !hexOk(after.brand)) problems.push("The brand colour must look like #b3261e");
  const beforeItems = parseOfferings(before.offerings).reduce((n, s) => n + s.items.length, 0);
  const afterItems = parseOfferings(after.offerings).reduce((n, s) => n + s.items.length, 0);
  if (afterItems === 0) problems.push("The updated menu or services list has no items");
  if (beforeItems >= 4 && afterItems < beforeItems / 2) problems.push(`The change removes most of the menu (${beforeItems} items down to ${afterItems})`);
  if (!parseHours(after.hours).length) problems.push("The opening hours are empty");
  if (changed.some((k) => FIELDS[k].copy)) problems.push(...validateCopy(afterCopy, afterSite).problems);
  return problems;
}

async function applySiteChange(env, { site, copy, requestText, scope, deps }) {
  const request = String(requestText ?? "").trim().slice(0, 4000);
  if (request.length < 3) return { understood: false, summary: "The change request is empty", changes: [], problems: ["The change request is empty"], site, copy };
  const before = currentDetails(site, copy);
  const result = await generate(env, {
    purpose: "website_care_edit", system: SYSTEM,
    prompt: `CURRENT DETAILS:\n${JSON.stringify(before)}\n\nCHANGE REQUEST:\n${request}`,
    schema: SCHEMA, scope, maxTokens: 6000
  }, deps);
  const summary = String(result.output.summary || "").slice(0, 300);
  const updates = (Array.isArray(result.output.updates) ? result.output.updates : []).filter((u) => u && FIELDS[u.field]);
  if (!result.output.understood) return { site, copy, summary, changes: [], problems: [`Not applied: ${summary || "the request is not a clear website change"}`], understood: false };
  const next = applyUpdates(site, copy, updates);
  const after = currentDetails(next.site, next.copy);
  const problems = checkChange({ before, after, afterSite: next.site, afterCopy: next.copy, requestText: request, updates });
  return { ...next, summary, changes: describeChanges(before, after), problems, understood: true, usage: result.usage };
}

export { FIELDS, applySiteChange, checkChange, currentDetails, describeChanges };
