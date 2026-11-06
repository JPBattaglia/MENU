// Marketing plan v4 (Nov 3, 2026, owner-approved): each prospect email for Online Menu + QR links to the owner's own
// menu already built as a phone page, made from the PDF, photo or web menu on their website. The owner sees the
// finished product before paying, which is the whole pitch.
//
//   POST /api/system/prospects/demo       { id }   (prospect-drafts.yml OIDC) -> { ok, url, item_count } | { ok:false, skip }
//   GET  /api/menu-preview/<token>                 the private preview page (noindex, unlisted, expires)
//   POST /api/system/prospects/followups  { }      -> sent prospects due a day-3 follow-up, no follow-up yet:
//                                                     kind "opened": opened their preview 3+ days after the send;
//                                                     kind "no_preview": emailed before previews existed (Nov 2 to 3
//                                                     batch, fix Nov 5); the job builds the preview then if it can
//                                         { mark }  -> record that a follow-up draft now exists (one per prospect, ever)
//
// One prospect per request (each build is one menu fetch plus one Claude read). Pages are kept in R2 under
// prospect-demos/<token>.html; the prospect_demos table tracks expiry and opens (migration 0033). Opens count only
// GET requests from a browser, not link scanners, and never record who opened or from where.
import { nowIso } from "../lib/http.js";
import { bytesToBase64 } from "../lib/util.js";
import { escapeHtml } from "../lib/email.js";
import { menuColors, readMenuWithClaude, structureMenuText } from "../producers/menu-qr/claude-reader.js";
import { extractReadableText } from "../producers/menu-qr/inputs.js";
import { buildDesignedMenuHtml } from "../producers/menu-qr/design.js";
import { MENU_PACKAGE_PRICING } from "../checkout/quote.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";
import { DRAFTS_AUDIENCE, DRAFTS_WORKFLOW } from "./prospects.js";

const PREVIEW_DAYS = 21;
const FOLLOWUP_AFTER_DAYS = 3;
const MAX_MENU_BYTES = 10 * 1024 * 1024;
const MENU_GAPS = new Set(["menu_pdf", "menu_image"]);
const SITE = "https://menu-made.com";
const START_URL = `${SITE}/online-menu?utm_source=outreach&utm_medium=email&utm_campaign=demo-menu`;
const SCANNER = /bot|crawl|spider|slurp|preview|scanner|proofpoint|mimecast|barracuda|safelinks|urldefense|headless|python|curl|wget|java\/|go-http|facebookexternalhit|slackbot|whatsapp|discord|skypeuripreview|outlook-ios-linkpreview/i;

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const daysFromNow = (days, now = Date.now()) => new Date(now + days * 86400000).toISOString();
const firstYearCents = () => MENU_PACKAGE_PRICING.setupCents + MENU_PACKAGE_PRICING.hostingFirstYearCents;
const dollars = (cents) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The prospect's menu, read into the same structure the paid producer uses. Throws with a plain reason.
async function readProspectMenu(menuUrl, env, fetcher = fetch) {
  let url;
  try { url = new URL(menuUrl); } catch { throw new Error("menu link is not a valid address"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("menu link is not a web address");
  const response = await fetcher(url.toString(), { headers: { "User-Agent": "Menu-Made-Automation/1.0", Accept: "application/pdf,image/*,text/html;q=0.9,*/*;q=0.5" }, redirect: "follow" });
  if (!response.ok) throw new Error(`menu link answered HTTP ${response.status}`);
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_MENU_BYTES) throw new Error("menu file is too large to read");
  if (type === "application/pdf" || ["image/png", "image/jpeg", "image/webp"].includes(type)) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_MENU_BYTES) throw new Error("menu file is empty or too large");
    const data = bytesToBase64(bytes);
    const block = type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: type, data } }
      : { type: "image", source: { type: "base64", media_type: type, data } };
    return readMenuWithClaude(block, env);
  }
  if (type === "text/html" || type === "text/plain") {
    const text = type === "text/html" ? extractReadableText(await response.text()) : (await response.text()).trim();
    if (!text || text.length < 80) throw new Error("menu page has no readable menu text");
    return structureMenuText(text, env);
  }
  throw new Error(`menu link is ${type || "an unknown type"}, not a menu file or page`);
}

// The paid product's own page design, plus a preview bar and noindex. Exported for the tests.
function previewPage(menuHtml, name) {
  const price = dollars(firstYearCents());
  const bar = `<aside class="mm-preview" role="note" aria-label="About this preview">
  <p><strong>Preview for ${escapeHtml(name)}</strong>, made by Menu-made from the menu on your website. Only people with this link can see it.</p>
  <a href="${escapeHtml(START_URL)}">Make it live: ${price} for the first year</a>
</aside>`;
  const style = `<style>
  body { padding-bottom: 132px; }
  .mm-preview { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 18px; padding: 14px 18px calc(14px + env(safe-area-inset-bottom)); background: #071f2c; color: #e8f6f7; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 -4px 18px rgba(0,0,0,.18); }
  .mm-preview p { margin: 0; max-width: 520px; }
  .mm-preview a { flex: none; padding: 11px 18px; border-radius: 6px; background: #00a7b5; color: #fff; font-weight: 700; text-decoration: none; }
</style>`;
  return menuHtml
    .replace("</head>", () => `<meta name="robots" content="noindex,nofollow">\n${style}\n</head>`)
    .replace(/<body>/, () => `<body>\n${bar}`);
}

function plainPage(status, title, body) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#edf3f5;color:#26434f;"><main style="max-width:560px;margin:48px auto;padding:28px;background:#fff;border:1px solid #dce8ec;">
<h1 style="margin:0 0 12px;font-size:22px;color:#071f2c;">${escapeHtml(title)}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

async function handleProspectDemo(request, env, { fetcher = fetch, now = Date.now() } = {}) {
  const auth = await verifyRenderer(request, env, { audience: DRAFTS_AUDIENCE, workflow: DRAFTS_WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.DB || !env.ASSETS) return json({ ok: false, error: "Storage is not available" }, 503);
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const p = id ? await env.DB.prepare(`SELECT id, name, status, gaps_json, menu_url, offer_code FROM prospects WHERE id = ?`).bind(id).first() : null;
  if (!p) return json({ ok: false, skip: "unknown prospect" }, 404);
  const gaps = JSON.parse(p.gaps_json || "[]");
  if (p.offer_code !== "ONLINE_MENU_QR" || !p.menu_url || !gaps.some((g) => MENU_GAPS.has(g)) || !["NEW", "DRAFTED", "SENT"].includes(p.status)) {
    return json({ ok: false, skip: "not an Online Menu + QR prospect with a menu file" });
  }
  const t = new Date(now).toISOString();
  const existing = await env.DB.prepare(`SELECT token, item_count FROM prospect_demos WHERE prospect_id = ? AND status = 'READY' AND expires_at > ? ORDER BY created_at DESC LIMIT 1`).bind(id, daysFromNow(7, now)).first();
  if (existing) return json({ ok: true, url: `${SITE}/api/menu-preview/${existing.token}`, item_count: existing.item_count, reused: true });
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "Menu reading is not configured" }, 503);
  const token = newToken();
  try {
    const read = await readProspectMenu(p.menu_url, env, fetcher);
    const page = previewPage(buildDesignedMenuHtml({ businessName: p.name, brandColors: menuColors(read.menu), menu: read.menu, logoDataUri: null }), p.name);
    await env.ASSETS.put(`prospect-demos/${token}.html`, page, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    const itemCount = read.extraction?.item_count ?? null;
    await env.DB.prepare(`INSERT INTO prospect_demos (token, prospect_id, status, item_count, created_at, expires_at) VALUES (?, ?, 'READY', ?, ?, ?)`)
      .bind(token, id, itemCount, t, daysFromNow(PREVIEW_DAYS, now)).run();
    return json({ ok: true, url: `${SITE}/api/menu-preview/${token}`, item_count: itemCount });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await env.DB.prepare(`INSERT INTO prospect_demos (token, prospect_id, status, error, created_at, expires_at) VALUES (?, ?, 'FAILED', ?, ?, ?)`)
      .bind(token, id, reason, t, t).run();
    return json({ ok: false, skip: reason });
  }
}

async function handleMenuPreview(request, env, token, { now = Date.now() } = {}) {
  const gone = () => plainPage(410, "This preview has ended", `It was a private preview made for one business. To get your own menu as a phone page with a QR code, see <a href="${escapeHtml(`${SITE}/online-menu`)}">Online Menu + QR</a>.`);
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB || !env.ASSETS) return gone();
  const row = await env.DB.prepare(`SELECT token, status, expires_at FROM prospect_demos WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return gone();
  const object = await env.ASSETS.get(`prospect-demos/${token}.html`);
  if (!object) return gone();
  const agent = request.headers.get("User-Agent") || "";
  if (request.method === "GET" && agent && !SCANNER.test(agent)) {
    const t = new Date(now).toISOString();
    await env.DB.prepare(`UPDATE prospect_demos SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ? WHERE token = ?`).bind(t, t, token).run();
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } });
}

async function handleProspectFollowups(request, env, { now = Date.now() } = {}) {
  const auth = await verifyRenderer(request, env, { audience: DRAFTS_AUDIENCE, workflow: DRAFTS_WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const body = await request.json().catch(() => ({}));
  const t = new Date(now).toISOString();
  if (Array.isArray(body?.mark)) {
    const ids = body.mark.filter((id) => typeof id === "string").slice(0, 50);
    if (!ids.length) return json({ ok: true, changed: 0 });
    const result = await env.DB.prepare(`UPDATE prospects SET followup_drafted_at = ?, updated_at = ? WHERE status = 'SENT' AND followup_drafted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).bind(t, t, ...ids).run();
    return json({ ok: true, changed: result?.meta?.changes || 0 });
  }
  // Sent at least 3 days ago (and within 3 weeks), no reply / opt-out / bounce (those change status), no follow-up yet.
  // With a preview: only when it was opened. Without one (sent before previews existed): every such prospect.
  // { via: "getmenumade" }: only prospects the auto-sender emailed (their follow-up is sent the same way); otherwise only
  // prospects the owner sent from iCloud (their follow-up is a draft).
  const viaSql = body?.via === "getmenumade" ? "p.sent_via = 'getmenumade'" : "p.sent_via IS NULL";
  const range = [daysFromNow(-FOLLOWUP_AFTER_DAYS, now), daysFromNow(-21, now)];
  const opened = (await env.DB.prepare(`
      SELECT p.id, p.name, p.city, p.email, p.website, p.sent_at, d.token, d.kind, d.open_count, d.expires_at
      FROM prospects p JOIN prospect_demos d ON d.prospect_id = p.id AND d.status = 'READY'
      WHERE p.status = 'SENT' AND p.followup_drafted_at IS NULL AND p.email IS NOT NULL AND ${viaSql}
        AND p.sent_at <= ? AND p.sent_at >= ? AND d.open_count > 0 AND d.expires_at > ?
      ORDER BY p.sent_at LIMIT 50`).bind(...range, daysFromNow(2, now)).all()).results || [];
  // A preview built for the follow-up itself (created after the send) doesn't count as one the prospect was sent.
  const previewless = (await env.DB.prepare(`
      SELECT p.id, p.name, p.city, p.email, p.website, p.gaps_json, p.menu_url, p.offer_code, p.sent_at FROM prospects p
      WHERE p.status = 'SENT' AND p.followup_drafted_at IS NULL AND p.email IS NOT NULL AND p.offer_code IS NOT NULL AND ${viaSql}
        AND p.sent_at <= ? AND p.sent_at >= ?
        AND NOT EXISTS (SELECT 1 FROM prospect_demos d WHERE d.prospect_id = p.id AND d.status = 'READY' AND d.created_at <= p.sent_at)
      ORDER BY p.sent_at LIMIT 50`).bind(...range).all()).results || [];
  const seen = new Set();
  const prospects = [
    ...opened.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({ kind: "opened", demo_kind: r.kind || "menu", id: r.id, name: r.name, city: r.city, email: r.email, website: r.website,
      url: r.kind === "website" ? `${SITE}/api/website-preview/view/${r.token}/index.html` : `${SITE}/api/menu-preview/${r.token}`, opens: r.open_count })),
    ...previewless.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({ kind: "no_preview", id: r.id, name: r.name, city: r.city, email: r.email, website: r.website, gaps_json: r.gaps_json, menu_url: r.menu_url, offer_code: r.offer_code }))
  ].slice(0, 50);
  return json({ ok: true, prospects, price: dollars(firstYearCents()) });
}

export { handleProspectDemo, handleMenuPreview, handleProspectFollowups, previewPage, readProspectMenu, PREVIEW_DAYS, START_URL };
