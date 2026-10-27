// Menu Care's monthly seasonal-special suggestion (stage 6). The month-opening email includes one idea written from the
// buyer's own menu; accepting it opens a page that asks only for the price, then sends the normal change request
// (so the usual checks and owner approval apply). The idea never contains a price, hours or claims: the owner sets those.
import { generate } from "../../ai/generate.js";
import { findUnsupportedFacts } from "../../ai/quality.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Dish name, 2-5 words." },
    description: { type: "string", description: "One appetizing sentence, under 140 characters, using only ingredients already on this menu." },
    section: { type: "string", description: "An existing section name from the menu, or 'Seasonal Specials'." }
  },
  required: ["name", "description", "section"]
};
const SYSTEM = "You suggest one seasonal special for a restaurant, for the month given. Build it from ingredients and dishes already on the menu so the kitchen needs nothing new. Do not write a price, hours, health claims or superlatives. Do not repeat a dish already on the menu.";
const keyOf = (periodStart) => `special_${String(periodStart || "").slice(0, 7)}`;

function menuText(menu) {
  return (menu.sections || []).map((s) => `${s.name}: ${(s.items || []).map((i) => `${i.name}${i.description ? ` (${i.description})` : ""}`).join("; ")}`).join("\n");
}

async function suggestSpecial(env, { menu, monthLabel, periodStart, subscriptionId, scope }, deps) {
  const text = menuText(menu);
  if (!text.trim()) return null;
  const existing = new Set((menu.sections || []).flatMap((s) => (s.items || []).map((i) => i.name.toLowerCase())));
  const result = await generate(env, { purpose: "menu_care_special", system: SYSTEM, prompt: `MONTH: ${monthLabel}\n\nCURRENT MENU:\n${text}`, schema: SCHEMA, scope, maxTokens: 600 }, deps);
  const name = String(result.output.name ?? "").trim();
  const description = String(result.output.description ?? "").trim();
  const sections = new Set((menu.sections || []).map((s) => s.name));
  const section = sections.has(result.output.section) ? result.output.section : "Seasonal Specials";
  if (name.length < 3 || name.length > 50 || description.length < 10 || description.length > 160 || existing.has(name.toLowerCase())) return null;
  if (findUnsupportedFacts(`${name} ${description}`, text).length || /[$\d]/.test(`${name}${description}`)) return null;
  const suggestion = { name, description, section };
  await env.DB.prepare(`
      INSERT INTO subscription_settings (subscription_id, setting_key, value_text, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (subscription_id, setting_key) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at
    `).bind(subscriptionId, keyOf(periodStart), JSON.stringify(suggestion), nowIso()).run();
  return suggestion;
}

async function loadSuggestion(env, subscriptionId, month) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) return null;
  const row = await env.DB.prepare(`SELECT value_text FROM subscription_settings WHERE subscription_id = ? AND setting_key = ?`).bind(subscriptionId, `special_${month}`).first();
  return parseJsonOrNull(row?.value_text);
}

const validPrice = (value) => /^\$?\s?\d{1,3}(\.\d{2})?$/.test(String(value ?? "").trim());
const priceText = (value) => `$${String(value).replace(/[^\d.]/g, "")}`;

function requestText(suggestion, price) {
  return `Add a new item "${suggestion.name}" to the "${suggestion.section}" section at ${priceText(price)}, with the description: ${suggestion.description}`;
}

export { keyOf, loadSuggestion, priceText, requestText, suggestSpecial, validPrice };
