// Free Online Menu + QR preview for anyone (owner decision Nov 4, 2026): a buyer uploads their menu on
// menu-made.com/online-menu, sees it as a phone menu, then pays to make it live. It must not be usable for free:
//   - no QR code, no hosted /api/menu/<slug> address, and a "Preview, not live" watermark on every screen;
//   - it ends after PREVIEW_HOURS or MAX_OPENS opens, whichever comes first (a table menu would be opened far more);
//   - printing shows a notice instead of the menu;
//   - one preview per email address every 30 days, two per network a day, PER_DAY in total a day (each build is one
//     Claude read, so the cap is also the cost ceiling).
// "Make it live" opens checkout with the same menu file already attached (no second upload).
//
//   POST /api/menu-preview/create   { request_id, email, business, tracking? }  -> { ok, url, token } | { ok:false, error }
//   GET  /api/menu-preview/view/<token>                                        the preview page (noindex, unlisted)
//   GET  /api/menu-preview/handoff/<token>                                     -> { ok, business, email, request_id }
//
// request_id is the upload made a moment earlier through /api/inquiry (purpose "checkout": stored, no emails).
//
// Rep mode (owner, Nov 5, 2026): for in-person visits (Shift4 from January), JP opens /online-menu?rep=<signed link>
// on his phone, photographs a paper menu and shows the owner their own phone menu on the spot. A valid rep token
// skips the per-email, per-network and daily public limits (REP_PER_DAY caps the cost instead); the restaurant's
// email is optional (blank = the preview link goes to the owner inbox). The link is emailed to the owner inbox:
//   GET/POST /api/menu-preview/rep-link   "Email me the rep link" (always goes to the owner inbox; REP_TTL_DAYS)
// and a fresh one is in every Friday numbers email, so there's no token to remember.
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { bytesToBase64 } from "../lib/util.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { readMenuWithClaude } from "../producers/menu-qr/claude-reader.js";
import { buildDesignedMenuHtml } from "../producers/menu-qr/design.js";
import { MENU_PACKAGE_PRICING } from "../checkout/quote.js";
import { pausedForSale } from "../lib/switches.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { ownerEmailAddress } from "../lib/config.js";
import { simplePage } from "../lib/http.js";

const PREVIEW_HOURS = 72;
const MAX_OPENS = 25;
const PER_DAY = 30;
const REP_PER_DAY = 40;
const REP_KIND = "menu-rep";
const REP_TTL_DAYS = 120;
const PER_NETWORK_DAY = 2;
const EMAIL_DAYS = 30;
const UPLOAD_MAX_AGE_SECONDS = 2 * 3600;
const HANDOFF_DAYS = 14;
const SITE = "https://menu-made.com";
const MENU_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const SCANNER = /bot|crawl|spider|slurp|preview|scanner|proofpoint|mimecast|barracuda|safelinks|urldefense|headless|python|curl|wget|java\/|go-http|facebookexternalhit|slackbot|whatsapp|discord|skypeuripreview|outlook-ios-linkpreview/i;

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
const hoursFromNow = (hours, now) => new Date(now + hours * 3600000).toISOString();
const firstYearCents = () => MENU_PACKAGE_PRICING.setupCents + MENU_PACKAGE_PRICING.hostingFirstYearCents;
const dollars = (cents) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const cleanText = (value, max) => String(value || "").replace(/[\r\n\x00]/g, " ").trim().slice(0, max);
const startUrl = (token) => `${SITE}/contact.html?service=menu&preview=${token}`;
const viewUrl = (token) => `${SITE}/api/menu-preview/view/${token}`;
const repUrl = async (env) => `${SITE}/online-menu?rep=${encodeURIComponent(await signLinkToken(env, { kind: REP_KIND, id: "owner", ttlDays: REP_TTL_DAYS }))}#try-free`;
async function isRep(env, token) {
  if (!token || !env.PRODUCTION_RUNNER_SECRET) return false;
  const payload = await verifyLinkToken(env, String(token), [REP_KIND], "owner").catch(() => null);
  return !!payload && !payload.expired;
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The paid product's own page design, plus the preview bar, a watermark on every screen, and no printing.
function publicPreviewPage(menuHtml, token) {
  const price = dollars(firstYearCents());
  const mark = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><text x="130" y="90" text-anchor="middle" transform="rotate(-24 130 80)" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#071f2c" fill-opacity=".13">PREVIEW · NOT LIVE</text></svg>`);
  const bar = `<aside class="mm-preview" role="note" aria-label="About this preview">
  <p><strong>Your free preview.</strong> This is how your menu looks to guests. It isn't live: there's no QR code, and this page ends in ${PREVIEW_HOURS / 24} days.</p>
  <a href="${escapeHtml(startUrl(token))}">Make it live: ${price} for the first year</a>
</aside>`;
  const style = `<style>
  body { padding-bottom: 150px; }
  body::after { content: ""; position: fixed; inset: 0; z-index: 4; pointer-events: none; background-image: url("data:image/svg+xml,${mark}"); }
  .mm-preview { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 18px; padding: 14px 18px calc(14px + env(safe-area-inset-bottom)); background: #071f2c; color: #e8f6f7; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 -4px 18px rgba(0,0,0,.18); }
  .mm-preview p { margin: 0; max-width: 520px; }
  .mm-preview a { flex: none; padding: 11px 18px; border-radius: 6px; background: #00a7b5; color: #fff; font-weight: 700; text-decoration: none; }
  @media print { body > * { display: none !important; } body::before { content: "This is a preview from menu-made.com and can't be printed. Make it live to get your menu and QR code."; display: block; padding: 40px; font: 18px system-ui, sans-serif; } }
</style>`;
  return menuHtml
    .replace("</head>", `<meta name="robots" content="noindex,nofollow">\n${style}\n</head>`)
    .replace(/<body([^>]*)>/, `<body$1>\n${bar}`);
}

function plainPage(status, title, body) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#edf3f5;color:#26434f;"><main style="max-width:560px;margin:48px auto;padding:28px;background:#fff;border:1px solid #dce8ec;">
<h1 style="margin:0 0 12px;font-size:22px;color:#071f2c;">${escapeHtml(title)}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

async function count(env, sql, ...args) {
  return Number((await env.DB.prepare(sql).bind(...args).first())?.n || 0);
}

async function handlePreviewCreate(request, env, { now = Date.now() } = {}) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
  if (!env.DB || !env.ASSETS) return json({ ok: false, error: "Previews aren't available right now. Please try again later." }, 503);
  if (await pausedForSale(env, ["ONLINE_MENU_QR"]).catch(() => null)) return json({ ok: false, error: "Online Menu + QR is paused right now, so previews are too." }, 409);
  const body = await request.json().catch(() => null);
  const requestId = String(body?.request_id || "").toLowerCase();
  const email = cleanText(body?.email, 150).toLowerCase();
  const business = cleanText(body?.business, 150);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !business) {
    return json({ ok: false, error: "Add your business name, email and menu file." }, 400);
  }
  const upload = await env.DB.prepare(`SELECT id, payload, ip_hash, created_at FROM mm_booking_requests WHERE id = ?`).bind(requestId).first();
  const data = parseJsonOrNull(upload?.payload);
  const doc = data?.document;
  if (!upload || data?.purpose !== "checkout" || String(data.email || "").toLowerCase() !== email || !doc?.storageKey) {
    return json({ ok: false, error: "We couldn't find your menu file. Please choose it again." }, 404);
  }
  if (Math.floor(now / 1000) - Number(upload.created_at || 0) > UPLOAD_MAX_AGE_SECONDS) return json({ ok: false, error: "That upload is too old. Please choose your menu file again." }, 410);
  if (!MENU_TYPES.has(String(doc.contentType || "").toLowerCase())) return json({ ok: false, error: "Previews work from a PDF or a photo (PNG, JPEG or WebP) of your menu." }, 415);

  const t = new Date(now).toISOString();
  const dayAgo = new Date(now - 86400000).toISOString();
  const rep = await isRep(env, body?.rep);
  if (rep && await count(env, `SELECT COUNT(*) AS n FROM menu_previews WHERE campaign = 'rep' AND created_at > ?`, dayAgo) >= REP_PER_DAY) {
    return json({ ok: false, error: `Rep mode has made ${REP_PER_DAY} previews today, its daily limit.` }, 429);
  }
  if (!rep) {
  const existing = await env.DB.prepare(`SELECT token, request_id, status, expires_at FROM menu_previews WHERE email = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1`)
    .bind(email, new Date(now - EMAIL_DAYS * 86400000).toISOString()).first();
  if (existing) {
    if (existing.status === "BUILDING") return json({ ok: false, error: "Your preview is still being made. Give it a minute." }, 409);
    if (existing.status === "READY" && existing.expires_at > t) return json({ ok: true, url: viewUrl(existing.token), token: existing.token, reused: true });
    if (existing.status === "READY") return json({ ok: false, used: true, error: "You've already had a free preview with this email. Start your order and we'll build your menu from your file.", start: startUrl(existing.token) }, 409);
  }
  if (await count(env, `SELECT COUNT(*) AS n FROM menu_previews WHERE ip_hash = ? AND created_at > ?`, upload.ip_hash || "", dayAgo) >= PER_NETWORK_DAY) {
    return json({ ok: false, error: "This connection has made its free previews for today. Please try again tomorrow." }, 429);
  }
  if (await count(env, `SELECT COUNT(*) AS n FROM menu_previews WHERE created_at > ?`, dayAgo) >= PER_DAY) {
    return json({ ok: false, error: "We've made all of today's free previews. Please try again tomorrow, or start your order now." }, 429);
  }
  }
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "Previews aren't available right now. Please try again later." }, 503);

  const token = newToken();
  const tracking = body?.tracking && typeof body.tracking === "object" ? body.tracking : {};
  const campaign = rep ? "rep" : cleanText(tracking.campaign, 100) || null;
  const started = Date.now();
  // Claim the slot first, so two quick submits can't both start a build.
  await env.DB.prepare(`INSERT INTO menu_previews (token, request_id, email, business, ip_hash, campaign, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'BUILDING', ?, ?)`)
    .bind(token, requestId, email, business, upload.ip_hash || "", campaign, t, hoursFromNow(PREVIEW_HOURS, now)).run();
  try {
    const object = await env.ASSETS.get(doc.storageKey);
    if (!object) throw new Error("menu file is not stored");
    const bytes = new Uint8Array(await object.arrayBuffer());
    const mime = String(doc.contentType).toLowerCase();
    const block = mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mime, data: bytesToBase64(bytes) } }
      : { type: "image", source: { type: "base64", media_type: mime, data: bytesToBase64(bytes) } };
    const read = await readMenuWithClaude(block, env);
    const page = publicPreviewPage(buildDesignedMenuHtml({ businessName: business, brandColors: null, menu: read.menu, logoDataUri: null }), token);
    await env.ASSETS.put(`menu-previews/${token}.html`, page, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    await env.DB.prepare(`UPDATE menu_previews SET status = 'READY', item_count = ? WHERE token = ?`).bind(read.extraction?.item_count ?? null, token).run();
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    // A failed read doesn't use up the buyer's preview: the row is marked FAILED, which the email check ignores.
    await env.DB.prepare(`UPDATE menu_previews SET status = 'FAILED', error = ?, expires_at = ? WHERE token = ?`).bind(reason, t, token).run();
    return json({ ok: false, error: "We couldn't read that menu file. Try a clearer PDF or photo, or start your order and we'll handle it." }, 422);
  }
  const url = viewUrl(token);
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`Menu preview ${rep ? "(rep) " : ""}made in ${seconds}s`);
  await sendTransactionalEmail(env, {
    to: email,
    subject: "Your free menu preview",
    html: brandedEmailHtml({
      preheader: "See your menu as guests will on their phones.",
      eyebrow: "ONLINE MENU + QR",
      heading: `Here's ${business}'s menu on a phone`,
      paragraphs: [
        `Open it on your phone: <a href="${escapeHtml(url)}">see your menu preview</a>. It's only a preview, with no QR code, and it ends in ${PREVIEW_HOURS / 24} days.`,
        `Like it? <a href="${escapeHtml(startUrl(token))}">Make it live for ${dollars(firstYearCents())}</a> for the first year. Your menu file is already attached, so checkout takes a minute.`
      ]
    }),
    text: `Your menu preview: ${url}\nIt ends in ${PREVIEW_HOURS / 24} days and has no QR code.\nMake it live (${dollars(firstYearCents())} first year): ${startUrl(token)}`,
    idempotencyKey: `menu-preview/${token}`, purpose: "MENU_PREVIEW", templateKey: "menu_preview_v1"
  }).catch((error) => console.error("Preview email failed:", error instanceof Error ? error.message : String(error)));
  return json({ ok: true, url, token, seconds, ...(rep ? { start: startUrl(token) } : {}) });
}

// "Email me the rep link": always to the owner inbox, so asking for it reveals nothing.
async function handleRepLink(request, env) {
  const inbox = ownerEmailAddress(env);
  if (request.method === "GET") {
    return simplePage(200, "Rep mode", `<p>Rep mode lets you photograph a menu on a visit and show the owner their phone menu on the spot. We'll email a link to <strong>${escapeHtml(inbox)}</strong>; open it on your phone and keep it (it works for ${REP_TTL_DAYS} days).</p>
<form method="post" action="/api/menu-preview/rep-link"><button type="submit">Email me the rep link</button></form>`);
  }
  const link = await repUrl(env);
  const sent = await sendTransactionalEmail(env, {
    to: inbox,
    subject: "Your rep mode link for on-the-spot menu previews",
    html: brandedEmailHtml({ preheader: "Show a business its own phone menu during a visit.", eyebrow: "OWNER", heading: "Rep mode",
      paragraphs: ["Open this on your phone during a visit. Take a photo of their menu (or upload their PDF), add the business name and, if they want it, their email. About a minute later you can hand them the phone with their menu on it.",
        `No daily limits for you (up to ${REP_PER_DAY} a day), and the preview link is emailed to them, or to you if you leave their email blank. Add it to your home screen so it's always one tap away. The link works for ${REP_TTL_DAYS} days; a fresh one comes in every Friday numbers email.`],
      buttons: [{ label: "Open rep mode", url: link, primary: true }] }),
    text: `Rep mode (works for ${REP_TTL_DAYS} days):\n${link}`,
    idempotencyKey: `rep-link/${Math.floor(Date.now() / 600000)}`, purpose: "OWNER_ACTION", templateKey: "rep_link_v1"
  }).catch((error) => ({ ok: false, error }));
  if (!sent?.ok) return simplePage(502, "The email didn't send", "<p>Please try again in a minute.</p>");
  return simplePage(200, "Check your email", `<p>We sent the rep mode link to <strong>${escapeHtml(inbox)}</strong>.</p>`);
}

async function handlePreviewView(request, env, token, { now = Date.now() } = {}) {
  const gone = () => plainPage(410, "This preview has ended", `Free previews last ${PREVIEW_HOURS / 24} days. To get your menu as a phone page with a QR code, see <a href="${escapeHtml(`${SITE}/online-menu`)}">Online Menu + QR</a>.`);
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB || !env.ASSETS) return gone();
  const row = await env.DB.prepare(`SELECT token, status, expires_at, open_count FROM menu_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return gone();
  const agent = request.headers.get("User-Agent") || "";
  const counted = request.method === "GET" && agent && !SCANNER.test(agent);
  if (counted && Number(row.open_count || 0) >= MAX_OPENS) {
    return plainPage(410, "This preview has ended", `It's been opened ${MAX_OPENS} times, which is the limit for a free preview. <a href="${escapeHtml(startUrl(token))}">Make it live</a> to keep it, with a QR code for your tables.`);
  }
  const object = await env.ASSETS.get(`menu-previews/${token}.html`);
  if (!object) return gone();
  if (counted) {
    const t = new Date(now).toISOString();
    await env.DB.prepare(`UPDATE menu_previews SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ?) WHERE token = ?`).bind(t, token).run();
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } });
}

// Checkout prefill for "Make it live": the stored upload, so the buyer isn't asked for the file again.
async function handlePreviewHandoff(env, token, { now = Date.now() } = {}) {
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB) return json({ ok: false }, 404);
  const row = await env.DB.prepare(`SELECT request_id, email, business, status, created_at FROM menu_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || Date.parse(row.created_at) < now - HANDOFF_DAYS * 86400000) return json({ ok: false }, 404);
  return json({ ok: true, business: row.business, email: row.email, request_id: row.request_id });
}

export { handleRepLink, repUrl, REP_PER_DAY };
export { handlePreviewCreate, handlePreviewView, handlePreviewHandoff, publicPreviewPage, PREVIEW_HOURS, MAX_OPENS, PER_DAY, PER_NETWORK_DAY };
