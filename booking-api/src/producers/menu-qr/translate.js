// Menu translations (stage 15 "AI menu details", owner Nov 14, 2026: a one-tap translated menu in Spanish, Chinese
// and others the owner picks; "maybe that should be something that you only get when you pay for a plan").
//
// Who gets it: a business with any active paid plan (an ACTIVE entitlement that comes from a subscription: Starter,
// Growth, Pro, Menu Care, and MΞNU Plus once it exists). A one-time menu, a free menu or a lapsed plan shows English
// only; the chosen languages and translations are kept, so they come back the moment a plan starts again.
//
// How it shows: the live menu page (/api/menu/<slug>) gets a row of language links at the top; ?lang=<code> serves
// the same page with the section names, item names, descriptions, the line under the name, the note and "Sold out"
// in that language. Prices, the business name, logo and design never change. The page stays script-free (its CSP is
// "sandbox"), so the switch is plain links, not JavaScript.
//
// Owner comps (Nov 22, 2026, owner: "Make the my happy donut menu show all available languages"): a menu the owner
// comped under his own account counts as paid and may show every language, not just MAX_LANGUAGES.
//
// Translations are keyed by the original text, so a price change or a new special only translates what is new. The
// owner's own corrections (overrides) always win. Text with no translation yet falls back to the original.
import { generate } from "../../ai/generate.js";
import { escapeHtml2 } from "../../lib/util.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";

const LANGUAGES = [
  { code: "es", name: "Español", english: "Spanish", soldOut: "Agotado" },
  { code: "zh-Hans", name: "中文（简体）", english: "Chinese (Simplified)", soldOut: "已售完" },
  { code: "zh-Hant", name: "中文（繁體）", english: "Chinese (Traditional)", soldOut: "已售完" },
  { code: "vi", name: "Tiếng Việt", english: "Vietnamese", soldOut: "Hết hàng" },
  { code: "tl", name: "Tagalog", english: "Tagalog (Filipino)", soldOut: "Ubos na" },
  { code: "ko", name: "한국어", english: "Korean", soldOut: "품절" },
  { code: "ja", name: "日本語", english: "Japanese", soldOut: "売り切れ" },
  { code: "fr", name: "Français", english: "French", soldOut: "Épuisé" },
  { code: "de", name: "Deutsch", english: "German", soldOut: "Ausverkauft" },
  { code: "it", name: "Italiano", english: "Italian", soldOut: "Esaurito" },
  { code: "pt", name: "Português", english: "Portuguese", soldOut: "Esgotado" },
  { code: "ru", name: "Русский", english: "Russian", soldOut: "Нет в наличии" },
  { code: "hi", name: "हिन्दी", english: "Hindi", soldOut: "स्टॉक में नहीं" }
];
const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));
const COMP_SQL = (col) => `EXISTS (SELECT 1 FROM projects p WHERE p.business_id = ${col} AND p.project_type = 'MENU'
          AND json_extract(p.metadata_json, '$.comp.by') = 'owner')`;
const MAX_LANGUAGES = 5;
const CHUNK = 120;                       // strings per AI call
const RETRY_FILL_MS = 10 * 60 * 1000;    // a failed fill is not retried by guests' visits for 10 minutes

const unescape = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");

// The texts on a menu page that are translated, each with where it sits, in page order. Matches the markup of
// design.js buildDesignedMenuHtml (every design and holiday theme uses it).
const SLOTS = [
  { kind: "section", re: /(<h2 id="s\d+-h">)([^<]*)(<\/h2>)/g },
  { kind: "nav", re: /(<a href="#s\d+">)([^<]*)(<\/a>)/g },
  { kind: "item", re: /(<span class="item">)([^<]*)(<\/span>)/g },
  { kind: "desc", re: /(<p class="desc">)([^<]*)(<\/p>)/g },
  { kind: "notes", re: /(<p class="notes">)([^<]*)(<\/p>)/g },
  { kind: "key", re: /(<span class="key-label">)([^<]*)(<\/span>)/g },
  { kind: "keynote", re: /(<span class="key-note">)([^<]*)(<\/span>)/g },
  { kind: "line", re: /(<\/h1>\s*<p>)([^<]*)(<\/p>)/g }
];

function pageStrings(html) {
  const seen = new Set();
  const out = [];
  for (const slot of SLOTS) {
    if (slot.kind === "nav") continue; // same texts as the section headings
    for (const m of String(html).matchAll(slot.re)) {
      const text = unescape(m[2]).trim();
      if (text && !seen.has(text) && /\p{L}/u.test(text)) { seen.add(text); out.push(text); }
    }
  }
  return out;
}

function lookup(row, lang) {
  const auto = row?.strings?.[lang] || {};
  const own = row?.overrides?.[lang] || {};
  return (text) => own[text] ?? auto[text];
}

const languageLinks = (hostedUrl, chosen, current) => {
  const link = (code, label, href) => `<a href="${escapeHtml2(href)}" lang="${code}" hreflang="${code}"${code === current ? ' aria-current="page"' : ""}>${escapeHtml2(label)}</a>`;
  return `<nav class="mm-langs" aria-label="Language">${[link("en", "English", hostedUrl), ...chosen.map((code) => link(code, BY_CODE.get(code).name, `${hostedUrl}?lang=${code}`))].join("")}</nav>`;
};
const LANG_CSS = `<style>.mm-langs{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid var(--rule,#e6dfd3);font:600 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}.mm-langs a{padding:5px 11px;border:1px solid var(--rule,#e6dfd3);border-radius:999px;color:var(--primary,#1f2a2e);text-decoration:none}.mm-langs a[aria-current]{background:var(--primary,#1f2a2e);border-color:var(--primary,#1f2a2e);color:#fff}</style>`;

// The page in one language (or the original with the language links when lang is null).
function translateMenuHtml(html, { lang = null, chosen = [], row = null, hostedUrl }) {
  let page = String(html);
  if (lang) {
    const find = lookup(row, lang);
    for (const slot of SLOTS) {
      page = page.replace(slot.re, (all, open, text, close) => {
        const hit = find(unescape(text).trim());
        return hit ? `${open}${escapeHtml2(hit)}${close}` : all;
      });
    }
    const soldOut = BY_CODE.get(lang)?.soldOut;
    if (soldOut) page = page.replace(/(<span class="sold-tag">)Sold out(<\/span>)/g, `$1${escapeHtml2(soldOut)}$2`);
    page = page.replace(/<html lang="en">/, `<html lang="${lang}">`);
  }
  if (chosen.length) {
    page = page.replace(/<\/head>/, `${LANG_CSS}</head>`).replace(/<body([^>]*)>/, (m) => `${m}\n  ${languageLinks(hostedUrl, chosen, lang || "en")}`);
  }
  return page;
}

// ---- Storage --------------------------------------------------------------------------------------------------

async function loadTranslations(env, businessId) {
  const row = await env.DB.prepare(`
      SELECT t.languages_json, t.strings_json, t.overrides_json, t.fill_attempt_at,
        EXISTS (SELECT 1 FROM entitlements e WHERE e.business_id = t.business_id AND e.status = 'ACTIVE' AND e.subscription_id IS NOT NULL
          AND e.entitlement_type IN ('MENU_PRO', 'MENU_CARE')) AS paid,
        ${COMP_SQL("t.business_id")} AS comp
      FROM menu_translations t WHERE t.business_id = ?
    `).bind(businessId).first();
  if (!row) return null;
  const languages = (parseJsonOrNull(row.languages_json) || []).filter((c) => BY_CODE.has(c));
  return { languages, strings: parseJsonOrNull(row.strings_json) || {}, overrides: parseJsonOrNull(row.overrides_json) || {},
    fillAttemptAt: row.fill_attempt_at || null, paid: Boolean(row.paid || row.comp), comp: Boolean(row.comp) };
}

// Languages come with MΞNU Pro and Max (owner, Nov 19, 2026: "$29 for languages, trifold, table tents"), not Plus.
async function hasPaidPlan(env, businessId) {
  return Boolean(await env.DB.prepare(`
      SELECT 1 AS ok FROM entitlements WHERE business_id = ? AND status = 'ACTIVE' AND subscription_id IS NOT NULL
        AND entitlement_type IN ('MENU_PRO', 'MENU_CARE') LIMIT 1
    `).bind(businessId).first()) || await isOwnerComp(env, businessId);
}

async function isOwnerComp(env, businessId) {
  return Boolean((await env.DB.prepare(`SELECT ${COMP_SQL("?")} AS ok`).bind(businessId).first())?.ok);
}

// How many languages a business may show: all of them for an owner comp, MAX_LANGUAGES otherwise.
async function languageCap(env, businessId) {
  return await isOwnerComp(env, businessId).catch(() => false) ? LANGUAGES.length : MAX_LANGUAGES;
}

async function saveTranslations(env, businessId, row) {
  const t = nowIso();
  await env.DB.prepare(`
      INSERT INTO menu_translations (business_id, languages_json, strings_json, overrides_json, fill_attempt_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (business_id) DO UPDATE SET languages_json = excluded.languages_json, strings_json = excluded.strings_json,
        overrides_json = excluded.overrides_json, fill_attempt_at = excluded.fill_attempt_at, updated_at = excluded.updated_at
    `).bind(businessId, JSON.stringify(row.languages || []), JSON.stringify(row.strings || {}), JSON.stringify(row.overrides || {}),
    row.fillAttemptAt || null, t).run();
}

// ---- AI ---------------------------------------------------------------------------------------------------------

const SYSTEM = `You translate restaurant and food business menus for guests reading them on their phones.
Rules:
- Translate every text in the list into the target language, naturally, the way a local menu would say it.
- Dish names that are proper names or well known in their own language (Margherita, Pad Thai, Banh Mi, Tiramisu, Pho, Carnitas) keep the familiar name, written in the target script only where that is usual; never invent a new dish name.
- Keep prices, numbers, sizes, units and diet or allergen marks such as (V), (GF), (VG), [vegan] exactly as written.
- Never add, drop, explain or correct anything. Same meaning, similar length.
- Return exactly one translation per input text, in the same order.`;

async function translateStrings(env, { businessId, lang, texts }, deps) {
  const language = BY_CODE.get(lang);
  const out = {};
  for (let i = 0; i < texts.length; i += CHUNK) {
    const part = texts.slice(i, i + CHUNK);
    const result = await generate(env, {
      purpose: "menu_translation",
      system: SYSTEM,
      prompt: `Target language: ${language.english}.\nTexts (JSON array, ${part.length} items):\n${JSON.stringify(part)}`,
      schema: { type: "object", properties: { translations: { type: "array", items: { type: "string" } } }, required: ["translations"] },
      scope: { entityType: "BUSINESS", entityId: businessId },
      maxTokens: 8000
    }, deps);
    const got = result.output.translations;
    if (!Array.isArray(got) || got.length !== part.length) continue; // misaligned answer: leave these in English
    part.forEach((text, j) => {
      const tr = String(got[j] ?? "").replace(/\s+/g, " ").trim().slice(0, 700);
      if (tr) out[text] = tr;
    });
  }
  return out;
}

// Translates whatever on this page has no translation yet, for each chosen language. Saves and returns the row.
// force: run even if a fill was tried in the last 10 minutes (owner actions); guests' visits never force.
async function fillMissing(env, businessId, html, row, { force = false, only = null, deps } = {}) {
  if (!row?.languages?.length || !env.ANTHROPIC_API_KEY) return row;
  const texts = pageStrings(html);
  const wanted = (only ? [only] : row.languages).filter((c) => row.languages.includes(c));
  const todo = wanted.map((lang) => [lang, texts.filter((t) => row.strings?.[lang]?.[t] === undefined && row.overrides?.[lang]?.[t] === undefined)])
    .filter(([, missing]) => missing.length);
  if (!todo.length) return row;
  if (!force && row.fillAttemptAt && Date.now() - Date.parse(row.fillAttemptAt) < RETRY_FILL_MS) return row;
  row.fillAttemptAt = nowIso();
  const results = await Promise.allSettled(todo.map(([lang, missing]) => translateStrings(env, { businessId, lang, texts: missing }, deps)));
  row.strings = row.strings || {};
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const lang = todo[i][0];
    row.strings[lang] = { ...(row.strings[lang] || {}), ...r.value };
  });
  // Translations of text that is no longer on the page are dropped, so the row doesn't grow forever.
  const keep = new Set(texts);
  for (const lang of Object.keys(row.strings)) {
    if (!row.languages.includes(lang)) { delete row.strings[lang]; continue; }
    for (const key of Object.keys(row.strings[lang])) if (!keep.has(key)) delete row.strings[lang][key];
  }
  await saveTranslations(env, businessId, row);
  return row;
}

// For the live menu route: the page to serve. Any problem serves the original page unchanged.
async function localizedMenuPage(env, { html, businessId, lang, hostedUrl }) {
  if (!businessId) return html;
  let row = null;
  try { row = await loadTranslations(env, businessId); } catch { return html; }
  if (!row || !row.paid || !row.languages.length) return html;
  const want = lang && row.languages.includes(lang) ? lang : null;
  if (want) row = await fillMissing(env, businessId, html, row, { only: want }).catch(() => row);
  return translateMenuHtml(html, { lang: want, chosen: row.languages, row, hostedUrl });
}

function cleanLanguages(list, max = MAX_LANGUAGES) {
  const out = [];
  for (const code of Array.isArray(list) ? list : []) if (BY_CODE.has(code) && !out.includes(code)) out.push(code);
  return out.slice(0, max);
}

export {
  LANGUAGES, MAX_LANGUAGES, cleanLanguages, fillMissing, hasPaidPlan, isOwnerComp, languageCap, loadTranslations, localizedMenuPage, pageStrings,
  saveTranslations, translateMenuHtml, translateStrings
};
