// Marketing plan v4 (Nov 3, 2026, owner-approved): each prospect email for Online Menu + QR links to the owner's own
// menu already built as a phone page, made from the PDF, photo or web menu on their website. The owner sees the
// finished product before paying, which is the whole pitch.
//
//   POST /api/system/prospects/demo       { id }   (prospect-drafts.yml OIDC) -> { ok, url, item_count } | { ok:false, skip }
//   GET  /api/menu-preview/view/<token>            the private preview: the menu generator (Nov 10, 2026, owner: prospect
//                                                     previews use the same multi-design generator as the free preview)
//   GET  /api/menu-preview/<token>                 previews made before Nov 10, 2026: one page (noindex, unlisted, expires)
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
import { MENU_PACKAGE_PRICING } from "../checkout/quote.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";
import { DRAFTS_AUDIENCE, DRAFTS_WORKFLOW } from "./prospects.js";
import { storeMenuDesigns, viewUrl as generatorUrl } from "./public-preview.js";

const PREVIEW_DAYS = 21; // same as PROSPECT_DAYS in public-preview.js (that module imports this one indirectly)
const FOLLOWUP_AFTER_DAYS = 3;
const MAX_MENU_BYTES = 10 * 1024 * 1024;
const MENU_GAPS = new Set(["menu_pdf", "menu_image"]);
const SITE = "https://menu-made.com";
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
    // The file itself comes back too: a prospect preview keeps it, so "Make it live" attaches it at checkout.
    return { ...(await readMenuWithClaude(block, env)), file: { bytes, type } };
  }
  if (type === "text/html" || type === "text/plain") {
    const text = type === "text/html" ? extractReadableText(await response.text()) : (await response.text()).trim();
    if (!text || text.length < 80) throw new Error("menu page has no readable menu text");
    return structureMenuText(text, env);
  }
  throw new Error(`menu link is ${type || "an unknown type"}, not a menu file or page`);
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
  const p = id ? await env.DB.prepare(`SELECT id, name, email, status, gaps_json, menu_url, offer_code FROM prospects WHERE id = ?`).bind(id).first() : null;
  if (!p) return json({ ok: false, skip: "unknown prospect" }, 404);
  const gaps = JSON.parse(p.gaps_json || "[]");
  if (p.offer_code !== "ONLINE_MENU_QR" || !p.menu_url || !gaps.some((g) => MENU_GAPS.has(g)) || !["NEW", "DRAFTED", "SENT"].includes(p.status)) {
    return json({ ok: false, skip: "not an Online Menu + QR prospect with a menu file" });
  }
  const t = new Date(now).toISOString();
  // Reuse a generator preview with a week or more left. Older one-page previews are replaced by a generator one.
  const existing = await env.DB.prepare(`SELECT d.token, d.item_count FROM prospect_demos d JOIN menu_previews m ON m.token = d.token
      WHERE d.prospect_id = ? AND d.kind = 'menu' AND d.status = 'READY' AND d.expires_at > ? ORDER BY d.created_at DESC LIMIT 1`).bind(id, daysFromNow(7, now)).first();
  if (existing) return json({ ok: true, url: generatorUrl(existing.token), item_count: existing.item_count, reused: true });
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "Menu reading is not configured" }, 503);
  const token = newToken();
  try {
    const read = await readProspectMenu(p.menu_url, env, fetcher);
    const requestId = await keepMenuFile(env, read.file, p, now);
    const expires = daysFromNow(PREVIEW_DAYS, now);
    // The free preview's generator (public-preview.js): every design, Generate menu, Customize, Make it live.
    await storeMenuDesigns(env, token, { business: p.name, menu: read.menu, colors: menuColors(read.menu), custom: {}, customized: 0, prospect: true });
    const itemCount = read.extraction?.item_count ?? null;
    await env.DB.prepare(`INSERT INTO menu_previews (token, request_id, email, business, ip_hash, campaign, status, item_count, created_at, expires_at) VALUES (?, ?, ?, ?, '', 'prospect', 'READY', ?, ?, ?)`)
      .bind(token, requestId, String(p.email || "").toLowerCase(), p.name, itemCount, t, expires).run();
    await env.DB.prepare(`INSERT INTO prospect_demos (token, prospect_id, status, kind, item_count, created_at, expires_at) VALUES (?, ?, 'READY', 'menu', ?, ?, ?)`)
      .bind(token, id, itemCount, t, expires).run();
    return json({ ok: true, url: generatorUrl(token), item_count: itemCount });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await env.DB.prepare(`INSERT INTO prospect_demos (token, prospect_id, status, error, created_at, expires_at) VALUES (?, ?, 'FAILED', ?, ?, ?)`)
      .bind(token, id, reason, t, t).run();
    return json({ ok: false, skip: reason });
  }
}

// The prospect's menu file, stored the way a checkout upload is (mm_booking_requests, purpose "checkout", no emails),
// so "Make it live" attaches it and the paid menu is built from it in the chosen design. A menu read from a web page
// has no file: the id then points at nothing and checkout asks for the menu.
async function keepMenuFile(env, file, p, now) {
  const requestId = crypto.randomUUID();
  if (!file?.bytes?.length) return requestId;
  const checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", file.bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const ext = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type] || "bin";
  const document = { name: `${String(p.name || "menu").replace(/[^\w .-]+/g, "").trim().slice(0, 60) || "menu"} menu.${ext}`, contentType: file.type, size: file.bytes.length, checksum,
    storageKey: `private/inquiries/${requestId}/${checksum}` };
  await env.ASSETS.put(document.storageKey, file.bytes, { httpMetadata: { contentType: file.type }, customMetadata: { requestId, checksum, originalFilename: document.name } });
  const payload = { type: "inquiry", purpose: "checkout", requestId, email: String(p.email || "").toLowerCase(), business: p.name, service: "Online Menu + QR", notes: "Prospect preview", document };
  await env.DB.prepare(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at, owner_sent, customer_sent) VALUES (?, ?, 'prospect', ?, 1, 1)`)
    .bind(requestId, JSON.stringify(payload), Math.floor(now / 1000)).run();
  return requestId;
}

// Previews already emailed before the generator (Nov 10, 2026, owner): each one-page prospect preview still running is
// rebuilt as the menu generator under the same token, so the link in the email opens every design. A few per cron
// tick (each is one menu fetch and one Claude read); one that can't be read keeps its page and isn't tried again.
async function upgradeProspectMenus(env, { fetcher = fetch, now = Date.now(), limit = 2 } = {}) {
  if (!env.DB || !env.ASSETS || !env.ANTHROPIC_API_KEY) return [];
  const t = new Date(now).toISOString();
  const { results = [] } = await env.DB.prepare(`
      SELECT d.token, d.created_at, d.expires_at, p.id, p.name, p.email, p.menu_url FROM prospect_demos d JOIN prospects p ON p.id = d.prospect_id
      WHERE d.kind = 'menu' AND d.status = 'READY' AND d.error IS NULL AND d.expires_at > ? AND p.menu_url IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM menu_previews m WHERE m.token = d.token)
      ORDER BY d.created_at LIMIT ?`).bind(t, limit).all();
  const done = [];
  for (const row of results) {
    try {
      const read = await readProspectMenu(row.menu_url, env, fetcher);
      const requestId = await keepMenuFile(env, read.file, row, now);
      await storeMenuDesigns(env, row.token, { business: row.name, menu: read.menu, colors: menuColors(read.menu), custom: {}, customized: 0, prospect: true });
      await env.DB.prepare(`INSERT INTO menu_previews (token, request_id, email, business, ip_hash, campaign, status, item_count, created_at, expires_at) VALUES (?, ?, ?, ?, '', 'prospect', 'READY', ?, ?, ?)`)
        .bind(row.token, requestId, String(row.email || "").toLowerCase(), row.name, read.extraction?.item_count ?? null, row.created_at, row.expires_at).run();
      done.push({ token: row.token, ok: true });
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      await env.DB.prepare(`UPDATE prospect_demos SET error = ? WHERE token = ?`).bind(`upgrade: ${reason}`, row.token).run();
      done.push({ token: row.token, ok: false, reason });
    }
  }
  return done;
}

async function handleMenuPreview(request, env, token, { now = Date.now() } = {}) {
  const gone = () => plainPage(410, "This preview has ended", `It was a private preview made for one business. To get your own menu as a phone page with a QR code, see <a href="${escapeHtml(`${SITE}/online-menu`)}">Online Menu + QR</a>.`);
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB || !env.ASSETS) return gone();
  const row = await env.DB.prepare(`SELECT token, status, expires_at FROM prospect_demos WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return gone();
  // Rebuilt as the generator (upgradeProspectMenus): the emailed link opens it.
  const generator = await env.DB.prepare(`SELECT token FROM menu_previews WHERE token = ? AND status = 'READY'`).bind(token).first();
  if (generator) return new Response(null, { status: 302, headers: { Location: generatorUrl(token), "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
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
      SELECT p.id, p.name, p.city, p.email, p.website, p.sent_at, d.token, d.kind, d.open_count, d.expires_at, m.token AS generator
      FROM prospects p JOIN prospect_demos d ON d.prospect_id = p.id AND d.status = 'READY'
      LEFT JOIN menu_previews m ON m.token = d.token
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
      url: r.kind === "website" ? `${SITE}/api/website-preview/view/${r.token}/d/bistro/index.html` : r.generator ? generatorUrl(r.token) : `${SITE}/api/menu-preview/${r.token}`, opens: r.open_count })),
    ...previewless.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({ kind: "no_preview", id: r.id, name: r.name, city: r.city, email: r.email, website: r.website, gaps_json: r.gaps_json, menu_url: r.menu_url, offer_code: r.offer_code }))
  ].slice(0, 50);
  return json({ ok: true, prospects, price: dollars(firstYearCents()) });
}

export { handleProspectDemo, handleMenuPreview, handleProspectFollowups, upgradeProspectMenus, readProspectMenu, PREVIEW_DAYS };
