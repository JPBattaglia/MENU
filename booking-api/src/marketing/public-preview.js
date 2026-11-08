// Free Online Menu + QR preview for anyone (owner decision Nov 4, 2026): a buyer uploads their menu on
// menu-made.com/online-menu, sees it as a phone menu, then pays to make it live. It must not be usable for free:
//   - no QR code, no hosted /api/menu/<slug> address, and a "Preview, not live" watermark on every screen;
//   - it ends after PREVIEW_HOURS (owner, Nov 7, 2026: no open limit; opens are still counted, for the stats);
//   - printing shows a notice instead of the menu;
//   - PER_EMAIL previews per email address every 30 days (the same file again reuses its preview), two per network a
//     day, PER_DAY in total a day (each build is one
//     Claude read, so the cap is also the cost ceiling).
// "Make it live" opens checkout with the same menu file already attached (no second upload).
//
//   POST /api/menu-preview/create   { request_id, email, business, tracking? }  -> { ok, url, token } | { ok:false, error }
//   GET  /api/menu-preview/view/<token>                                        the preview page (noindex, unlisted)
//   GET  /api/menu-preview/handoff/<token>                                     -> { ok, business, email, request_id }
//   GET  /api/menu-preview/view/<token>/<design>                               one of the generator's designs
//   POST /api/menu-preview/customize/<token>  multipart { design, logo?, logo_info?, logo_bg?, business_name?, hide_name?, brand? (highlight colour), use_brand?, subtitle? }
//   GET  /api/menu-preview/choose/<token>/<design>                             saves the design, then "Make it live"
//
// Menu generator (owner, Nov 7, 2026, like the site generator): the menu is read once, then shown in each of the
// MENU_DESIGNS (producers/menu-qr/menu-designs.js). "Generate menu" goes to the next design, "Customize" adds a logo,
// a brand colour and the line under the name (rebuilt from the stored read, no AI), and "Make it live" saves the
// design on the preview row and opens checkout. The paid menu is built in that design with the same customizing
// (draft-step.js finds the preview through the order's menu file). Previews made before this have one page,
// menu-previews/<token>.html, and are served as they were.
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
import { menuColors, readMenuWithClaude } from "../producers/menu-qr/claude-reader.js";
import { LOGO_MODES, buildDesignedMenuHtml, parseLogoInfo } from "../producers/menu-qr/design.js";
import { MENU_DESIGNS, designStyle, menuDesignFor } from "../producers/menu-qr/menu-designs.js";
import { sniffImage } from "../producers/website/intake.js";
import { MENU_PACKAGE_PRICING } from "../checkout/quote.js";
import { pausedForSale } from "../lib/switches.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { ownerEmailAddress } from "../lib/config.js";
import { simplePage } from "../lib/http.js";

const PREVIEW_HOURS = 72;
const PER_DAY = 30;
const REP_PER_DAY = 40;
const REP_KIND = "menu-rep";
const REP_TTL_DAYS = 120;
const PER_NETWORK_DAY = 2;
const EMAIL_DAYS = 30;
const PER_EMAIL = 3; // free previews per email per EMAIL_DAYS; the same file again reuses the last one
const UPLOAD_MAX_AGE_SECONDS = 2 * 3600;
const HANDOFF_DAYS = 14;
const SITE = "https://menu-made.com";
const MAX_CUSTOMIZE = 15;          // rebuilds per preview (no AI involved, just storage)
const MAX_LOGO_BYTES = 1572864;    // the page carries the logo inline (as the paid menu does), so it stays small
const MENU_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const SCANNER = /bot|crawl|spider|slurp|preview|scanner|proofpoint|mimecast|barracuda|safelinks|urldefense|headless|python|curl|wget|java\/|go-http|facebookexternalhit|slackbot|whatsapp|discord|skypeuripreview|outlook-ios-linkpreview/i;

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
const hoursFromNow = (hours, now) => new Date(now + hours * 3600000).toISOString();
const firstYearCents = () => MENU_PACKAGE_PRICING.setupCents + MENU_PACKAGE_PRICING.hostingFirstYearCents;
const dollars = (cents) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const cleanText = (value, max) => String(value || "").replace(/[\r\n\x00]/g, " ").trim().slice(0, max);
const startUrl = (token) => `${SITE}/contact.html?service=menu&preview=${token}`;
const viewUrl = (token) => `${SITE}/api/menu-preview/view/${token}`;
const designUrl = (token, key) => `${SITE}/api/menu-preview/view/${token}/${key}`;
const chooseUrl = (token, key) => `${SITE}/api/menu-preview/choose/${token}/${key}`;
const hexOk = (v) => /^#[0-9a-f]{6}$/.test(String(v || ""));
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

// The paid product's own page design, plus the generator bar, a watermark on every screen, and no printing.
// index: which of MENU_DESIGNS is on screen; custom: what Customize set (for the popup's "now using" line).
function publicPreviewPage(menuHtml, token, { index = 0, custom = {}, business = "" } = {}) {
  const price = dollars(firstYearCents());
  const d = MENU_DESIGNS[index] || MENU_DESIGNS[0];
  const next = MENU_DESIGNS[(MENU_DESIGNS.indexOf(d) + 1) % MENU_DESIGNS.length];
  const mark = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><text x="130" y="90" text-anchor="middle" transform="rotate(-24 130 80)" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#071f2c" fill-opacity=".13">PREVIEW · NOT LIVE</text></svg>`);
  const brand = hexOk(custom.color) ? custom.color : "";
  const have = [custom.logo ? "your logo" : "", custom.name ? "your name" : "", custom.hide_name ? "the name hidden" : "", brand ? "your colour" : "", custom.subtitle ? "your line under the name" : ""].filter(Boolean);
  const bar = `<aside class="mm-preview" role="note" aria-label="Menu generator">
  <p><strong>Design ${MENU_DESIGNS.indexOf(d) + 1} of ${MENU_DESIGNS.length}: ${escapeHtml(d.label)}</strong><span> · ${escapeHtml(d.blurb)}. Free preview: no QR code, ends in ${PREVIEW_HOURS / 24} days.</span></p>
  <a class="mm-gen-next" href="${escapeHtml(designUrl(token, next.key))}">Generate menu</a>
  <button type="button" class="mm-gen-own" onclick="var x = document.getElementById('mm-own'); x.showModal ? x.showModal() : x.setAttribute('open', '')">Customize</button>
  <a class="mm-gen-pick" href="${escapeHtml(chooseUrl(token, d.key))}">Make it live: ${price} for the first year</a>
  <dialog class="mm-own" id="mm-own" aria-labelledby="mm-own-title" onclick="if (event.target === this) this.close()"><div class="mm-own-box">
  <div class="mm-own-head"><h2 id="mm-own-title">Customize your menu</h2><button type="button" class="mm-own-x" aria-label="Close" onclick="this.closest('dialog').close()">&times;</button></div>
  <form method="post" enctype="multipart/form-data" action="/api/menu-preview/customize/${token}" onsubmit="var b = this.parentNode; b.querySelector('.mm-own-busy').hidden = false; this.hidden = true;">
  <input type="hidden" name="design" value="${escapeHtml(d.key)}">
  <p class="mm-own-now">${have.length ? `Using ${escapeHtml(have.join(", "))}. A new logo replaces the old one.` : `Add your logo and colour. All ${MENU_DESIGNS.length} designs update.`}</p>
  <label>Logo <small>(PNG, JPG or WebP, up to 1.5 MB)</small><input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label>
  <input type="hidden" name="logo_info" value="">
  <label>Logo background <small>(Automatic picks one per design so the logo stands out)</small><select name="logo_bg">${[["auto", "Automatic"], ["none", "None"], ["light", "Light badge"], ["dark", "Dark badge"], ["accent", "Highlight colour badge"]].map(([v, t]) => `<option value="${v}"${(custom.logo_bg || "auto") === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
  <label>Business name <small>(as it shows on the menu)</small><input name="business_name" maxlength="80" value="${escapeHtml(custom.name || business || "")}"></label>
  <label class="mm-own-check"><input type="checkbox" name="hide_name" value="1"${custom.hide_name ? " checked" : ""}> Hide the name (my logo already shows it)</label>
  <label class="mm-own-colour">Highlight colour <input type="color" name="brand" value="${brand || "#00a7b5"}"></label>
  <label class="mm-own-check"><input type="checkbox" name="use_brand" value="1"${brand ? " checked" : ""}> Use it for lines, borders and accents</label>
  <label>Line under your name <small>(e.g. Dinner Menu, Est. 1998)</small><input name="subtitle" maxlength="60" value="${escapeHtml(custom.subtitle || "Menu")}"></label>
  <button type="submit">Update all ${MENU_DESIGNS.length} designs</button>
  </form>
  <div class="mm-own-busy" role="status" aria-live="polite" hidden><span class="mm-spin" aria-hidden="true"></span><p><strong>Updating your menu…</strong></p><p>This takes a few seconds; the page reloads by itself.</p></div>
  </div></dialog>
</aside>
<script>
// Measures a chosen logo here in the browser (nothing extra is uploaded): see-through parts, average brightness,
// how much of its outline box is ink, and whether it is a solid box. design.js logoTreatment uses it.
(function () {
  var input = document.querySelector('#mm-own input[name=logo]'); if (!input) return;
  input.addEventListener("change", function () {
    var out = input.form.elements.logo_info; out.value = "";
    var file = input.files && input.files[0]; if (!file || !window.createImageBitmap) return;
    createImageBitmap(file).then(function (bmp) {
      var k = Math.min(1, 160 / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d"); x.drawImage(bmp, 0, 0, w, h);
      var d = x.getImageData(0, 0, w, h).data, lin = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      var ink = 0, clear = 0, sum = 0, edge = 0, edgeSolid = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var y = 0; y < h; y++) for (var i = 0; i < w; i++) {
        var p = (y * w + i) * 4, a = d[p + 3];
        if (y === 0 || y === h - 1 || i === 0 || i === w - 1) { edge++; if (a > 200) edgeSolid++; }
        if (a < 16) { clear++; continue; }
        if (a > 128) { ink++; sum += 0.2126 * lin(d[p]) + 0.7152 * lin(d[p + 1]) + 0.0722 * lin(d[p + 2]); if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      var box = (x1 - x0 + 1) * (y1 - y0 + 1);
      out.value = "t=" + (clear / (w * h) > 0.05 ? 1 : 0) + ";l=" + (ink ? (sum / ink).toFixed(3) : "0.5") + ";c=" + (box > 0 ? (ink / box).toFixed(2) : "1") + ";b=" + (edge && edgeSolid / edge > 0.9 ? 1 : 0);
    }).catch(function () {});
  });
})();
window.addEventListener("pageshow", function () { var b = document.querySelector(".mm-own-box"); if (!b) return; b.querySelector("form").hidden = false; b.querySelector(".mm-own-busy").hidden = true; });</script>`;
  const style = `<style>
  body { padding-bottom: 170px; }
  body::after { content: ""; position: fixed; inset: 0; z-index: 4; pointer-events: none; background-image: url("data:image/svg+xml,${mark}"); }
  .mm-preview { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 14px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: #071f2c; color: #e8f6f7; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 -4px 18px rgba(0,0,0,.25); text-align: left; }
  .mm-preview p { margin: 0; max-width: 520px; }
  .mm-preview a, .mm-gen-own { flex: none; padding: 12px 18px; border: 0; border-radius: 8px; font: 700 15px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-decoration: none; cursor: pointer; text-transform: none; letter-spacing: 0; }
  .mm-gen-next, .mm-gen-own { background: #ffffff1f; color: #fff; box-shadow: inset 0 0 0 2px #ffffff66; } .mm-gen-pick { background: #00a7b5; color: #fff; }
  .mm-own { width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; margin: auto; padding: 0; border: 0; border-radius: 14px; background: #071f2c; color: #e8f6f7; box-shadow: 0 24px 60px rgba(0,0,0,.45); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: left; }
  .mm-own::backdrop { background: rgba(4,16,24,.62); } .mm-own[open]:not(:modal) { position: fixed; inset: 0; z-index: 50; }
  .mm-own-box { padding: 18px 20px 20px; } .mm-own-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
  .mm-own h2 { margin: 0; padding: 0; border: 0; font: 700 20px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; text-transform: none; letter-spacing: 0; text-align: left; } .mm-own h2::after { content: none; }
  .mm-own .mm-own-x { padding: 2px 10px; border: 0; background: none; color: #e8f6f7; font-size: 26px; line-height: 1; }
  .mm-own form { display: grid; gap: 14px; } .mm-own label { display: grid; gap: 4px; font-weight: 600; } .mm-own small { font-weight: 400; opacity: .8; }
  .mm-own select { font: 15px/1.4 system-ui, sans-serif; padding: 9px 10px; border: 1px solid #ffffff4d; border-radius: 8px; background: #0d2a38; color: #e8f6f7; }
  .mm-own input[name=subtitle], .mm-own input[name=business_name] { width: 100%; font: 15px/1.4 system-ui, sans-serif; padding: 10px 12px; border: 1px solid #ffffff4d; border-radius: 8px; background: #0d2a38; color: #e8f6f7; }
  .mm-own input[type=file]::file-selector-button { margin-right: 12px; padding: 10px 18px; border: 0; border-radius: 8px; background: #00a7b5; color: #fff; font: 700 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; cursor: pointer; } .mm-own input[type=file]::file-selector-button:hover { background: #00bccb; }
  .mm-own input[type=file] { color: #e8f6f7; max-width: 100%; } .mm-own .mm-own-colour, .mm-own .mm-own-check { display: flex; align-items: center; gap: 10px; } .mm-own input[type=color] { width: 52px; height: 36px; border: 0; padding: 0; background: none; }
  .mm-own p { margin: 0; color: #e8f6f7; } .mm-own button { padding: 12px 18px; border: 0; border-radius: 8px; background: #00a7b5; color: #fff; font: 700 15px system-ui, sans-serif; cursor: pointer; }
  .mm-own-busy { display: grid; justify-items: center; gap: 10px; padding: 28px 8px 12px; text-align: center; } .mm-own-busy[hidden], .mm-own form[hidden] { display: none; }
  .mm-spin { width: 52px; height: 52px; border: 5px solid #ffffff2e; border-top-color: #00a7b5; border-radius: 50%; animation: mm-spin .9s linear infinite; } @keyframes mm-spin { to { transform: rotate(360deg); } }
  @media (max-width: 600px) { .mm-preview p span { display: none; } .mm-preview a, .mm-gen-own { padding: 10px 12px; font-size: 14px; } }
  @media print { body > * { display: none !important; } body::before { content: "This is a preview from menu-made.com and can't be printed. Make it live to get your menu and QR code."; display: block; padding: 40px; font: 18px system-ui, sans-serif; } }
</style>`;
  return menuHtml
    // Function replacers: the bar holds a price like "$144", and "$1" in a replacement string means "group 1".
    .replace("</head>", () => `<meta name="robots" content="noindex,nofollow">\n${style}\n</head>`)
    .replace(/<body([^>]*)>/, (match, attrs) => `<body${attrs}>\n${bar}`);
}

// One design of the stored read. data: { business, menu, colors, custom: { logo, color, subtitle } }.
function renderMenuDesign(data, key, logoDataUri = null) {
  const design = menuDesignFor(key) || MENU_DESIGNS[0];
  const custom = data.custom || {};
  const brand = hexOk(custom.color) ? custom.color : "";
  return buildDesignedMenuHtml({
    businessName: custom.name || data.business,
    hideName: custom.hide_name === true,
    // The buyer's own design keeps the colours read from their menu; a Customize colour only changes highlights.
    brandColors: design.key === "yours" ? data.colors || "" : "",
    highlight: brand,
    menu: data.menu,
    logoDataUri,
    style: designStyle(design.key, data.menu),
    subtitle: custom.subtitle,
    logo: { info: custom.logo_info || null, mode: custom.logo_bg || "auto" }
  });
}

async function loadPreviewLogo(env, token, custom) {
  if (!custom?.logo?.mime || !/^image\/(png|jpeg|webp)$/.test(custom.logo.mime)) return null;
  const object = await env.ASSETS.get(`menu-previews/${token}/logo`);
  if (!object) return null;
  return `data:${custom.logo.mime};base64,${bytesToBase64(new Uint8Array(await object.arrayBuffer()))}`;
}

// Stores data.json and every design's page (already wrapped as a preview).
async function storeMenuDesigns(env, token, data) {
  const logo = await loadPreviewLogo(env, token, data.custom);
  for (const [index, design] of MENU_DESIGNS.entries()) {
    const page = publicPreviewPage(renderMenuDesign(data, design.key, logo), token, { index, custom: data.custom || {}, business: data.business });
    await env.ASSETS.put(`menu-previews/${token}/${design.key}.html`, page, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  }
  await env.ASSETS.put(`menu-previews/${token}/data.json`, JSON.stringify(data), { httpMetadata: { contentType: "application/json" } });
}

function plainPage(status, title, body) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#edf3f5;color:#26434f;"><main style="max-width:560px;margin:48px auto;padding:28px;background:#fff;border:1px solid #dce8ec;">
<h1 style="margin:0 0 12px;font-size:22px;color:#071f2c;">${escapeHtml(title)}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

// Two uploads are the same menu when the file has the same name, size and type (each upload is stored separately).
async function sameMenuFile(env, requestId, doc) {
  const row = await env.DB.prepare(`SELECT payload FROM mm_booking_requests WHERE id = ?`).bind(requestId).first();
  const before = parseJsonOrNull(row?.payload)?.document;
  return !!before && before.name === doc.name && Number(before.size) === Number(doc.size) && String(before.contentType).toLowerCase() === String(doc.contentType).toLowerCase();
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
  const since = new Date(now - EMAIL_DAYS * 86400000).toISOString();
  const existing = await env.DB.prepare(`SELECT token, request_id, business, status, expires_at FROM menu_previews WHERE email = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1`)
    .bind(email, since).first();
  if (existing) {
    if (existing.status === "BUILDING") return json({ ok: false, error: "Your preview is still being made. Give it a minute." }, 409);
    // The same file and name again gets the preview already made. A different menu file (or name) gets a new one,
    // up to PER_EMAIL a month (owner, Nov 5, 2026: re-uploading a different menu kept showing the first preview).
    const same = existing.status === "READY" && existing.business === business && await sameMenuFile(env, existing.request_id, doc);
    if (same && existing.expires_at > t) return json({ ok: true, url: viewUrl(existing.token), token: existing.token, reused: true });
    const made = await count(env, `SELECT COUNT(*) AS n FROM menu_previews WHERE email = ? AND status = 'READY' AND created_at > ?`, email, since);
    if (same || made >= PER_EMAIL) {
      const latest = await env.DB.prepare(`SELECT token FROM menu_previews WHERE email = ? AND status = 'READY' AND created_at > ? ORDER BY created_at DESC LIMIT 1`).bind(email, since).first();
      return json({ ok: false, used: true, error: same
        ? "You've already had a free preview of this menu. Start your order and we'll build your menu from your file."
        : `You've made ${made} free previews with this email this month. Start your order and we'll build your menu from your file.`, start: startUrl(latest?.token || existing.token) }, 409);
    }
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
    await storeMenuDesigns(env, token, { business, menu: read.menu, colors: menuColors(read.menu), custom: {}, customized: 0 });
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
        `Tap <strong>Generate menu</strong> to see it in ${MENU_DESIGNS.length} designs, and <strong>Customize</strong> to add your logo and colour.`,
        `Like it? <a href="${escapeHtml(startUrl(token))}">Make it live for ${dollars(firstYearCents())}</a> for the first year. Your menu file is already attached, so checkout takes a minute.`
      ]
    }),
    text: `Your menu preview: ${url}\nIt ends in ${PREVIEW_HOURS / 24} days and has no QR code.\nMake it live (${dollars(firstYearCents())} first year): ${startUrl(token)}`,
    idempotencyKey: `menu-preview/${token}`, purpose: "MENU_PREVIEW", templateKey: "menu_preview_v1"
  }).catch((error) => console.error("Preview email failed:", error instanceof Error ? error.message : String(error)));
  return json({ ok: true, url, token, seconds, ...(rep ? { start: startUrl(token) } : {}) });
}

// ---------- One reminder before the preview ends (owner, Nov 7, 2026) ----------
// A preview that hasn't become an order gets one email about 2 days in (REMINDER_AFTER_HOURS), sent between 9 am and
// 7 pm Pacific and only while there are at least REMINDER_MIN_LEFT_HOURS left. Never to the owner's own inbox (rep
// previews made without the business's email). Runs from the cron, hourly; once per preview (reminder_sent_at).
const REMINDER_AFTER_HOURS = 46;
const REMINDER_MIN_LEFT_HOURS = 3;
const pacificHour = (ms) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles" }).format(new Date(ms)));
const endsText = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

async function runPreviewReminders(env, { now = Date.now(), force = false } = {}) {
  if (!env.DB) return [];
  if (!force && (new Date(now).getUTCMinutes() >= 5 || pacificHour(now) < 9 || pacificHour(now) >= 19)) return [];
  const { results = [] } = await env.DB.prepare(`
      SELECT token, request_id, email, business, expires_at FROM menu_previews
      WHERE status = 'READY' AND reminder_sent_at IS NULL AND created_at <= ? AND expires_at > ?
      ORDER BY created_at ASC LIMIT 20
    `).bind(new Date(now - REMINDER_AFTER_HOURS * 3600000).toISOString(), new Date(now + REMINDER_MIN_LEFT_HOURS * 3600000).toISOString()).all();
  const owner = String(ownerEmailAddress(env) || "").toLowerCase();
  const sent = [];
  for (const row of results) {
    const mark = () => env.DB.prepare(`UPDATE menu_previews SET reminder_sent_at = ? WHERE token = ?`).bind(new Date(now).toISOString(), row.token).run();
    const email = String(row.email || "").trim().toLowerCase();
    // Already ordered from this menu file: nothing to remind about.
    const ordered = await env.DB.prepare(`SELECT 1 AS x FROM orders WHERE notes LIKE ? AND payment_status = 'PAID' LIMIT 1`).bind(`%Document ref: ${row.request_id}%`).first().catch(() => null);
    if (!email || email === owner || ordered) { await mark(); continue; }
    const url = viewUrl(row.token);
    const ends = endsText(row.expires_at);
    const result = await sendTransactionalEmail(env, {
      to: email,
      subject: `Your menu preview ends ${ends}`,
      html: brandedEmailHtml({
        preheader: `${MENU_DESIGNS.length} designs of your menu, free until ${ends}.`,
        eyebrow: "ONLINE MENU + QR",
        heading: `${row.business}'s menu preview ends soon`,
        paragraphs: [
          `Your free phone menu preview ends <strong>${escapeHtml(ends)}</strong> (Pacific time).`,
          `Haven't picked a design yet? Tap <strong>Generate menu</strong> to see all ${MENU_DESIGNS.length}, and <strong>Customize</strong> to add your logo and colour.`,
          `When one looks right, tap <strong>Make it live</strong> (${dollars(firstYearCents())} for the first year). It goes live with a QR code for your tables, and your menu file is already attached.`
        ],
        buttons: [{ label: "See my menu designs", url, primary: true }],
        footnote: "This is the only reminder we'll send about this preview."
      }),
      text: `Your menu preview ends ${ends} (Pacific).\nSee all ${MENU_DESIGNS.length} designs: ${url}\nMake it live (${dollars(firstYearCents())} first year): ${startUrl(row.token)}\nThis is the only reminder about this preview.`,
      idempotencyKey: `menu-preview-reminder/${row.token}`, purpose: "MENU_PREVIEW", templateKey: "menu_preview_reminder_v1"
    }).catch((error) => ({ ok: false, error }));
    if (result?.ok) { await mark(); sent.push(row.token); }
  }
  return sent;
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

async function handlePreviewView(request, env, token, { now = Date.now(), design = null } = {}) {
  const gone = () => plainPage(410, "This preview has ended", `Free previews last ${PREVIEW_HOURS / 24} days. To get your menu as a phone page with a QR code, see <a href="${escapeHtml(`${SITE}/online-menu`)}">Online Menu + QR</a>.`);
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB || !env.ASSETS) return gone();
  if (design && !menuDesignFor(design)) return gone();
  const row = await env.DB.prepare(`SELECT token, status, expires_at, open_count, design FROM menu_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return gone();
  const agent = request.headers.get("User-Agent") || "";
  const counted = request.method === "GET" && agent && !SCANNER.test(agent);
  // The generator's pages; a preview made before the generator has its one page.
  const key = design || (menuDesignFor(row.design) ? row.design : MENU_DESIGNS[0].key);
  const object = await env.ASSETS.get(`menu-previews/${token}/${key}.html`) || (design ? null : await env.ASSETS.get(`menu-previews/${token}.html`));
  if (!object) return gone();
  if (counted) {
    const t = new Date(now).toISOString();
    await env.DB.prepare(`UPDATE menu_previews SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ?) WHERE token = ?`).bind(t, token).run();
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } });
}

// "Customize": a logo (stored beside the preview), a brand colour and the line under the name, applied to every
// design from the stored read (no AI call); back to the design the buyer was on.
async function handlePreviewCustomize(request, env, token, { now = Date.now() } = {}) {
  const gone = () => plainPage(410, "This preview has ended", `<a href="${escapeHtml(`${SITE}/online-menu`)}">Start a new one</a>.`);
  const oops = (text) => plainPage(400, "That didn't work", `${escapeHtml(text)} <a href="javascript:history.back()">Go back</a> and try again.`);
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB || !env.ASSETS) return gone();
  const row = await env.DB.prepare(`SELECT status, expires_at FROM menu_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return gone();
  const data = parseJsonOrNull(await (await env.ASSETS.get(`menu-previews/${token}/data.json`))?.text());
  if (!data?.menu) return gone();
  if (Number(data.customized || 0) >= MAX_CUSTOMIZE) return oops("This preview has been updated as many times as a free preview allows.");
  const form = await request.formData().catch(() => null);
  if (!form) return oops("We couldn't read the upload.");
  const design = menuDesignFor(String(form.get("design") || "")) || MENU_DESIGNS[0];
  const custom = { ...(data.custom || {}) };
  const file = form.get("logo");
  if (file && typeof file === "object" && typeof file.arrayBuffer === "function" && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) return oops("That logo is over 1.5 MB. Try a smaller PNG or JPG.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type) return oops("The logo has to be a PNG, JPG or WebP image.");
    await env.ASSETS.put(`menu-previews/${token}/logo`, bytes, { httpMetadata: { contentType: type.mime } });
    custom.logo = { mime: type.mime };
    // The browser's measurement of this logo (none if its script didn't run: a JPEG is then treated as a solid box).
    custom.logo_info = parseLogoInfo(form.get("logo_info")) || (type.mime === "image/jpeg" ? { t: 0, l: null, c: null, b: 1 } : null);
  }
  const bg = String(form.get("logo_bg") || "");
  if (LOGO_MODES.includes(bg)) custom.logo_bg = bg;
  if (form.has("business_name")) {
    const name = cleanText(form.get("business_name"), 80);
    custom.name = name && name !== data.business ? name : "";
  }
  // Hiding the name only makes sense with a logo to show instead (design.js ignores it without one).
  custom.hide_name = form.get("hide_name") === "1";
  const brand = String(form.get("brand") || "").trim().toLowerCase();
  custom.color = form.get("use_brand") === "1" && hexOk(brand) ? brand : "";
  if (form.has("subtitle")) {
    const line = cleanText(form.get("subtitle"), 60);
    custom.subtitle = line && line.toLowerCase() !== "menu" ? line : "";
  }
  await storeMenuDesigns(env, token, { ...data, custom, customized: Number(data.customized || 0) + 1 });
  return new Response(null, { status: 303, headers: { Location: designUrl(token, design.key), "Cache-Control": "no-store" } });
}

// "Make it live" on a design: remember the design (the paid menu is built in it), then checkout.
async function handlePreviewChoose(env, token, key, { now = Date.now() } = {}) {
  const design = menuDesignFor(key);
  if (!/^[a-f0-9]{36}$/.test(token) || !design || !env.DB) return plainPage(404, "Preview not found", `See <a href="${escapeHtml(`${SITE}/online-menu`)}">Online Menu + QR</a>.`);
  const row = await env.DB.prepare(`SELECT status, created_at FROM menu_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || Date.parse(row.created_at) < now - HANDOFF_DAYS * 86400000) return plainPage(410, "This preview has ended", `See <a href="${escapeHtml(`${SITE}/online-menu`)}">Online Menu + QR</a>.`);
  await env.DB.prepare(`UPDATE menu_previews SET design = ? WHERE token = ?`).bind(design.key, token).run();
  return new Response(null, { status: 303, headers: { Location: startUrl(token), "Cache-Control": "no-store" } });
}

// The paid menu's design and customizing: the preview made from the same menu file as the order (the order's
// "Document ref"), its saved design (null if the buyer went to checkout without choosing one) and Customize settings.
async function menuPreviewChoice(env, orderId) {
  if (!orderId || !env.DB || !env.ASSETS) return null;
  const order = await env.DB.prepare(`SELECT notes FROM orders WHERE id = ?`).bind(orderId).first();
  const reference = /Document ref: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(order?.notes || "")?.[1];
  if (!reference) return null;
  const row = await env.DB.prepare(`SELECT token, design FROM menu_previews WHERE request_id = ? AND status = 'READY' ORDER BY created_at DESC LIMIT 1`).bind(reference.toLowerCase()).first();
  if (!row) return null;
  const data = parseJsonOrNull(await (await env.ASSETS.get(`menu-previews/${row.token}/data.json`))?.text());
  if (!data) return null;
  const custom = data.custom || {};
  return { token: row.token, design: menuDesignFor(row.design) ? row.design : null, custom, logoDataUri: await loadPreviewLogo(env, row.token, custom).catch(() => null) };
}

// Checkout prefill for "Make it live": the stored upload, so the buyer isn't asked for the file again.
async function handlePreviewHandoff(env, token, { now = Date.now() } = {}) {
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB) return json({ ok: false }, 404);
  const row = await env.DB.prepare(`SELECT request_id, email, business, status, created_at FROM menu_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || Date.parse(row.created_at) < now - HANDOFF_DAYS * 86400000) return json({ ok: false }, 404);
  return json({ ok: true, business: row.business, email: row.email, request_id: row.request_id });
}

export { handleRepLink, repUrl, REP_PER_DAY };
export { runPreviewReminders, handlePreviewCreate, handlePreviewView, handlePreviewHandoff, handlePreviewCustomize, handlePreviewChoose, menuPreviewChoice, publicPreviewPage, renderMenuDesign, loadPreviewLogo, PREVIEW_HOURS, PER_DAY, PER_NETWORK_DAY, PER_EMAIL };
