// The owner's own menu editor (stage 15, owner Nov 14, 2026: owners change a price, mark an item sold out or add a
// daily special in seconds, the way every competitor allows, instead of sending a Menu Care request).
//   GET  /api/account/menu?business=<id>  -> { ok, business, menu_url, menu: { sections, notes }, updated_at }
//   POST /api/account/menu                 { business, sections, notes } -> { ok, menu_url, changes }
// Signed-in account only (the account cookie, Path=/api/account), and only for a business the customer owns.
// A save renders the same design the live page has (theme, logo and colours are read from the page itself) and
// publishes it at once as the newest final menu of the business's Online Menu + QR project: the same address and QR
// code, and the print PDF, tri-fold, table tent and TV menu follow because they are built from the live page.
// No owner approval: the business is editing its own menu. Prices are not checked against anything (they are the
// business's own); the page check still makes sure everything typed is on the page.
import { nowIso } from "../lib/http.js";
import { sanitizeFilename, sha256Hex } from "../lib/util.js";
import { buildDesignedMenuHtml, assertMenuRendered } from "../producers/menu-qr/design.js";
import { cleanMenu, describeDiff, diffMenus, parseMenuHtml } from "../producers/menu-care/menu-edit.js";
import { freePlanUpgradeUrl, menuHostingState } from "../producers/menu-qr/hosting-renewal.js";
import { hostedMenu } from "../producers/google-visibility/sources.js";
import { currentSession, privateJson } from "./account.js";
import { LANGUAGES, MAX_LANGUAGES, cleanLanguages, fillMissing, hasPaidPlan, loadTranslations, pageStrings, saveTranslations } from "../producers/menu-qr/translate.js";

const SAVES_PER_DAY = 60;

async function ownsBusiness(env, customerId, businessId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(businessId || ""))) return null;
  return env.DB.prepare(`
      SELECT b.id, b.name FROM businesses b WHERE b.id = ?
        AND (b.id IN (SELECT business_id FROM customer_businesses WHERE customer_id = ?)
          OR b.id IN (SELECT business_id FROM orders WHERE customer_id = ? AND business_id IS NOT NULL)
          OR b.id IN (SELECT business_id FROM subscriptions WHERE customer_id = ?))
    `).bind(businessId, customerId, customerId, customerId).first();
}

// The live regular menu (never a Holiday Menu) and the Online Menu + QR project new versions are filed under.
async function liveMenuRow(env, businessId) {
  return env.DB.prepare(`
      SELECT a.storage_key, d.delivered_at, d.project_id, p.customer_id
      FROM projects p
      JOIN deliverables d ON d.project_id = p.id
      JOIN assets a ON a.id = d.asset_id
      WHERE p.business_id = ? AND p.workflow_key IN ('MENU_QR_V1', 'MENU_CARE_V1')
        AND d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1
        AND json_extract(COALESCE(p.metadata_json, '{}'), '$.holiday_menu') IS NULL
      ORDER BY d.delivered_at DESC, d.version DESC
      LIMIT 1
    `).bind(businessId).first();
}

async function menuQrProject(env, businessId) {
  return env.DB.prepare(`
      SELECT p.id, p.customer_id FROM projects p
      WHERE p.business_id = ? AND p.workflow_key = 'MENU_QR_V1'
        AND json_extract(COALESCE(p.metadata_json, '{}'), '$.holiday_menu') IS NULL
        AND EXISTS (SELECT 1 FROM deliverables d WHERE d.project_id = p.id AND d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1)
      ORDER BY p.created_at DESC LIMIT 1
    `).bind(businessId).first();
}

async function loadEditable(env, businessId) {
  const row = await liveMenuRow(env, businessId);
  const object = row ? await env.ASSETS.get(row.storage_key) : null;
  if (!object) return null;
  return { row, page: parseMenuHtml(await object.text()) };
}

async function savesToday(env, businessId) {
  const since = `${nowIso().slice(0, 10)}T00:00:00.000Z`;
  const row = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM assets WHERE business_id = ? AND uploaded_at >= ?
        AND json_extract(COALESCE(metadata_json, '{}'), '$.self_edit') IS NOT NULL
    `).bind(businessId, since).first();
  return Number(row?.n || 0);
}

async function handleMenuEditor(request, env) {
  if (!env.DB || !env.ASSETS) return privateJson({ ok: false, error: "Temporarily unavailable. Try again in a minute." }, 503);
  const session = await currentSession(request, env);
  if (!session) return privateJson({ ok: false, signed_in: false, error: "Sign in to edit your menu." }, 401);
  const url = new URL(request.url);
  let body = null;
  if (request.method === "POST") {
    try { body = await request.json(); } catch { return privateJson({ ok: false, error: "That didn't come through. Try again." }, 400); }
  }
  const business = await ownsBusiness(env, session.customer_id, request.method === "POST" ? body?.business : url.searchParams.get("business"));
  if (!business) return privateJson({ ok: false, error: "That business isn't on your account." }, 404);
  const live = await loadEditable(env, business.id).catch(() => null);
  if (!live) return privateJson({ ok: false, error: "There's no live menu for this business yet." }, 404);
  const menuUrl = await hostedMenu(env, business.id).catch(() => null);

  if (request.method === "GET") {
    return privateJson({ ok: true, business: { id: business.id, name: business.name }, menu_url: menuUrl,
      menu: { sections: live.page.menu.sections, notes: live.page.menu.notes }, updated_at: live.row.delivered_at,
      languages: await languageState(env, business.id), plan: await planState(env, business.id) });
  }

  const state = await menuHostingState(env, business.id).catch(() => ({ live: true }));
  if (state && state.live === false) return privateJson({ ok: false, error: "This menu is offline. Bring it back from your account first." }, 409);
  if (await savesToday(env, business.id) >= SAVES_PER_DAY) return privateJson({ ok: false, error: "That's a lot of saves today. Try again tomorrow, or reply to any Menu-Made email." }, 429);
  const { menu, problems } = cleanMenu(body);
  if (problems.length) return privateJson({ ok: false, error: problems[0] }, 400);
  const changes = describeDiff(diffMenus(live.page.menu, menu));
  const soldBefore = new Set(live.page.menu.sections.flatMap((s) => s.items.filter((i) => i.sold_out).map((i) => `${s.name}\u0000${i.name}`)));
  for (const section of menu.sections) for (const item of section.items) {
    const key = `${section.name}\u0000${item.name}`;
    if (item.sold_out && !soldBefore.has(key)) changes.push(`Sold out: ${item.name}`);
    if (!item.sold_out && soldBefore.has(key)) changes.push(`Back on: ${item.name}`);
  }
  if (!changes.length) return privateJson({ ok: true, menu_url: menuUrl, changes: [], unchanged: true });

  const p = live.page;
  const html = buildDesignedMenuHtml({ businessName: p.businessName || business.name, brandColors: [p.primary, p.accent].filter(Boolean).join(", "),
    menu, logoDataUri: p.logoDataUri, style: p.style, subtitle: p.subtitle, logo: p.logo, hideName: p.hideName });
  assertMenuRendered(html, menu);
  const project = await menuQrProject(env, business.id) || { id: live.row.project_id, customer_id: live.row.customer_id };
  const bytes = new TextEncoder().encode(html);
  const checksum = await sha256Hex(bytes);
  const assetId = crypto.randomUUID();
  const t = nowIso();
  const storageKey = ["customers", project.customer_id, "projects", project.id, "deliverables", "self-edit", `${assetId}.html`].join("/");
  const top = await env.DB.prepare(`SELECT MAX(version) AS v FROM deliverables WHERE project_id = ? AND deliverable_type = 'MENU_DRAFT'`).bind(project.id).first();
  await env.ASSETS.put(storageKey, bytes, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type,
        size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, ?, 'text/html', ?, ?, 'VALID', ?, ?, 1, 1, 1, ?)
    `).bind(assetId, business.id, project.customer_id, project.id, storageKey, `${sanitizeFilename(business.name || "menu")}-menu.html`, bytes.byteLength, checksum, t, t,
    JSON.stringify({ generated_by: "OWNER_MENU_EDITOR", self_edit: { customer_id: session.customer_id, changes: changes.slice(0, 50) } })).run();
  await env.DB.prepare(`
      INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at)
      VALUES (?, ?, ?, 'MENU_DRAFT', ?, 'FINAL', 1, ?, ?)
    `).bind(crypto.randomUUID(), project.id, assetId, Number(top?.v || 0) + 1, t, t).run();
  // Translated menus: what this edit added is translated now, so guests never see it in English first.
  const translations = await loadTranslations(env, business.id).catch(() => null);
  if (translations?.paid && translations.languages.length) await fillMissing(env, business.id, html, translations, { force: true }).catch(() => null);
  return privateJson({ ok: true, menu_url: menuUrl, changes, updated_at: t });
}

// ---- MΞNU free plan (stage 15 task 2, Nov 14, 2026) ----------------------------------------------------------

// free: the live menu is on the free plan right now (Classic, badge). upgrade_url: the business's own preview, where
// every design is and "Make it live" upgrades at the same address and QR code.
async function planState(env, businessId) {
  const state = await menuHostingState(env, businessId).catch(() => null);
  if (state?.reason !== "free_plan") return { free: false };
  return { free: true, upgrade_url: await freePlanUpgradeUrl(env, businessId) };
}

// ---- Translated menus (stage 15; paid plans only, owner Nov 14, 2026) ---------------------------------------

async function languageState(env, businessId) {
  const [row, paid] = await Promise.all([loadTranslations(env, businessId).catch(() => null), hasPaidPlan(env, businessId).catch(() => false)]);
  return { paid, max: MAX_LANGUAGES, chosen: row?.languages || [], available: LANGUAGES.map(({ code, name, english }) => ({ code, name, english })) };
}

async function languageContext(request, env, body) {
  if (!env.DB || !env.ASSETS) return { error: privateJson({ ok: false, error: "Temporarily unavailable. Try again in a minute." }, 503) };
  const session = await currentSession(request, env);
  if (!session) return { error: privateJson({ ok: false, signed_in: false, error: "Sign in to edit your menu." }, 401) };
  const url = new URL(request.url);
  const business = await ownsBusiness(env, session.customer_id, body ? body.business : url.searchParams.get("business"));
  if (!business) return { error: privateJson({ ok: false, error: "That business isn't on your account." }, 404) };
  if (!await hasPaidPlan(env, business.id)) {
    return { error: privateJson({ ok: false, needs_plan: true, error: "Translated menus come with any paid plan. See Plans to add one." }, 402) };
  }
  const live = await loadEditable(env, business.id).catch(() => null);
  if (!live) return { error: privateJson({ ok: false, error: "There's no live menu for this business yet." }, 404) };
  const object = await env.ASSETS.get(live.row.storage_key);
  const html = object ? await object.text() : "";
  const row = await loadTranslations(env, business.id).catch(() => null) || { languages: [], strings: {}, overrides: {}, fillAttemptAt: null, paid: true };
  return { business, html, row, menuUrl: await hostedMenu(env, business.id).catch(() => null) };
}

const readJson = async (request) => { try { return await request.json(); } catch { return null; } };

// POST /api/account/menu/languages { business, languages: ["es", "zh-Hans"] } -> picks the languages and translates
// the menu into each new one at once.
async function handleMenuLanguages(request, env) {
  const body = await readJson(request);
  if (!body) return privateJson({ ok: false, error: "That didn't come through. Try again." }, 400);
  const ctx = await languageContext(request, env, body);
  if (ctx.error) return ctx.error;
  const { business, html, row } = ctx;
  row.languages = cleanLanguages(body.languages);
  await saveTranslations(env, business.id, row);
  const filled = await fillMissing(env, business.id, html, row, { force: true }).catch(() => row);
  const total = pageStrings(html).length;
  const done = Object.fromEntries(row.languages.map((code) => [code, Object.keys({ ...(filled.strings?.[code] || {}), ...(filled.overrides?.[code] || {}) }).length >= total]));
  return privateJson({ ok: true, chosen: row.languages, translated: done,
    links: Object.fromEntries(row.languages.map((code) => [code, ctx.menuUrl ? `${ctx.menuUrl}?lang=${code}` : null])) });
}

// GET  /api/account/menu/translations?business=<id>&lang=es -> { pairs: [{ source, text, own }] }
// POST /api/account/menu/translations { business, lang, edits: { "<original>": "<fixed>" } }: the owner's fixes
// (an empty one goes back to the automatic translation).
async function handleMenuTranslations(request, env) {
  const body = request.method === "POST" ? await readJson(request) : null;
  if (request.method === "POST" && !body) return privateJson({ ok: false, error: "That didn't come through. Try again." }, 400);
  const ctx = await languageContext(request, env, body);
  if (ctx.error) return ctx.error;
  const { business, html, row } = ctx;
  const lang = body ? body.lang : new URL(request.url).searchParams.get("lang");
  if (!row.languages.includes(lang)) return privateJson({ ok: false, error: "Pick that language first." }, 400);
  const texts = pageStrings(html);
  if (request.method === "POST") {
    const own = { ...(row.overrides?.[lang] || {}) };
    for (const [source, value] of Object.entries(body.edits && typeof body.edits === "object" ? body.edits : {})) {
      if (!texts.includes(source)) continue;
      const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 700);
      if (text && text !== row.strings?.[lang]?.[source]) own[source] = text; else delete own[source];
    }
    row.overrides = { ...(row.overrides || {}), [lang]: own };
    await saveTranslations(env, business.id, row);
  } else {
    await fillMissing(env, business.id, html, row, { only: lang, force: true }).catch(() => null);
  }
  const pairs = texts.map((source) => {
    const own = row.overrides?.[lang]?.[source];
    return { source, text: own ?? row.strings?.[lang]?.[source] ?? "", own: own !== undefined };
  });
  return privateJson({ ok: true, lang, pairs, link: ctx.menuUrl ? `${ctx.menuUrl}?lang=${lang}` : null });
}

export { cleanMenu, handleMenuEditor, handleMenuLanguages, handleMenuTranslations, ownsBusiness };
