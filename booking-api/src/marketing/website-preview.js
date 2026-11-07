// Free Website Package preview (owner, Nov 5, 2026): like the free menu preview, a business sees its own phone-friendly
// website before paying $499. Built with the paid product's own builder (producers/website/build.js) and copy writer,
// from what we can read, never invented: their menu (uploaded, or the menu file on their site), their current website's
// text, or their public listing (prospects with no website). It can't stand in for the product: every page carries a
// "Preview, not live" watermark and a bar, it can't be printed, it's noindex, and it ends (public: PREVIEW_HOURS or
// MAX_OPENS opens; prospect emails: PROSPECT_DAYS). "Make it live" opens Website Package checkout with the business and
// email filled in; after payment the intake form starts filled in from the preview (prefillFromPreview).
//
//   POST /api/website-preview/create   { request_id, email, business, website?, phone?, address?, hours?, rep?, tracking? }
//                                      request_id = the menu upload made a moment earlier through /api/inquiry
//   GET  /api/website-preview/view/<token>/<page>.html     the preview pages (relative links between them)
//   GET  /api/website-preview/handoff/<token>              -> { ok, business, email } for checkout
//   POST /api/system/prospects/site-demo  { id }           (prospect-drafts.yml OIDC) -> { ok, url } | { ok:false, skip }
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { bytesToBase64 } from "../lib/util.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { readMenuWithClaude } from "../producers/menu-qr/claude-reader.js";
import { extractReadableText } from "../producers/menu-qr/inputs.js";
import { buildSite } from "../producers/website/build.js";
import { DESIGNS, buildDesignSite } from "../producers/website/templates/index.js";
import { writeCopy } from "../producers/website/copy.js";
import { generate } from "../ai/generate.js";
import { pausedForSale } from "../lib/switches.js";
import { verifyLinkToken } from "../lib/links.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";
import { DRAFTS_AUDIENCE, DRAFTS_WORKFLOW } from "./prospects.js";
import { readProspectMenu } from "./demo-menu.js";

const PREVIEW_HOURS = 72;
const PROSPECT_DAYS = 21;
const MAX_OPENS = 40;            // a whole site is clicked through: more page views than a one-page menu
const PER_DAY = 20;              // each build is 1 to 3 Claude calls
const PER_NETWORK_DAY = 2;
const EMAIL_DAYS = 30;
const REP_PER_DAY = 40;
const UPLOAD_MAX_AGE_SECONDS = 2 * 3600;
const HANDOFF_DAYS = 14;
const SITE = "https://menu-made.com";
const PRICE = "$499";
const MENU_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const SCANNER = /bot|crawl|spider|slurp|preview|scanner|proofpoint|mimecast|barracuda|safelinks|urldefense|headless|python|curl|wget|java\/|go-http|facebookexternalhit|slackbot|whatsapp|discord|skypeuripreview|outlook-ios-linkpreview/i;
const PAGE = /^(index|menu|services|about|gallery|contact)\.html$|^d\/[a-z]+\.html$/;
const SITE_FILES_PRICE = "$299";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
const cleanText = (value, max) => String(value || "").replace(/[\r\x00]/g, "").trim().slice(0, max);
const oneLine = (value, max) => cleanText(value, max).replace(/\n/g, " ");
const hoursFromNow = (hours, now) => new Date(now + hours * 3600000).toISOString();
const startUrl = (token) => `${SITE}/contact.html?service=website&wpreview=${token}`;
const viewUrl = (token) => `${SITE}/api/website-preview/view/${token}/d/${DESIGNS[0].key}.html`;
const designUrl = (token, key) => `${SITE}/api/website-preview/view/${token}/d/${key}.html`;
const chooseUrl = (token, key) => `${SITE}/contact.html?service=sitefiles&wpreview=${token}&design=${key}`;

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function count(env, sql, ...args) {
  return Number((await env.DB.prepare(sql).bind(...args).first())?.n || 0);
}

async function isRep(env, token) {
  if (!token || !env.PRODUCTION_RUNNER_SECRET) return false;
  const payload = await verifyLinkToken(env, String(token), ["menu-rep"], "owner").catch(() => null);
  return !!payload && !payload.expired;
}

// The menu read by Claude (menu-qr structure) as the builder's offerings text: "# Section" then "Name | desc | $price".
function offeringsFromMenu(menu) {
  const lines = [];
  for (const section of menu?.sections || []) {
    const items = (section.items || []).filter((i) => i?.name);
    if (!items.length) continue;
    lines.push(`# ${String(section.name || "Menu").replace(/[|#\n]/g, " ").trim().slice(0, 60)}`);
    for (const i of items.slice(0, 40)) {
      const parts = [String(i.name).replace(/[|\n]/g, " ").trim().slice(0, 80)];
      const description = String(i.description || "").replace(/[|\n]/g, " ").trim();
      const price = String(i.price || "").replace(/[|\n]/g, " ").trim();
      if (description) parts.push(description.slice(0, 200));
      if (price) parts.push(price.slice(0, 20));
      lines.push(parts.join(" | "));
    }
  }
  return lines.join("\n").slice(0, 4000);
}

// Facts from the business's current website: only what the page says (the copy checks hold every fact to it).
const FACTS_SCHEMA = {
  type: "object",
  properties: {
    about: { type: "string", description: "What the page says about the business, 1-4 sentences, in its own facts only. Empty if nothing." },
    phone: { type: "string", description: "The phone number exactly as shown, or empty." },
    address: { type: "string", description: "The street address exactly as shown, or empty." },
    hours: { type: "string", description: "Opening hours, one line per day or range like 'Mon-Fri: 11am-9pm', or empty." },
    offerings: { type: "string", description: "Menu items or services listed on the page, one per line as 'Name | short description | $price', sections started with '# Section'. Empty if none are listed." }
  },
  required: ["about", "phone", "address", "hours", "offerings"]
};
const FACTS_SYSTEM = "You read a small business's web page and copy out facts. Use ONLY what the page text says. Never guess, never fill a gap, never add a price or a dish that isn't written. Leave a field empty when the page doesn't say it.";

async function factsFromWebsite(env, url, scope, deps = {}) {
  let target;
  try { target = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return null; }
  const fetcher = deps.fetcher || fetch;
  const response = await fetcher(target.toString(), { headers: { "User-Agent": "Menu-Made-Automation/1.0", Accept: "text/html" }, redirect: "follow" }).catch(() => null);
  if (!response?.ok || !/text\/html/i.test(response.headers.get("content-type") || "")) return null;
  const text = extractReadableText(await response.text()).slice(0, 12000);
  if (text.length < 80) return null;
  const result = await generate(env, { purpose: "website_preview_facts", system: FACTS_SYSTEM, prompt: `WEB PAGE TEXT (${target.hostname}):\n${text}`, schema: FACTS_SCHEMA, scope, maxTokens: 2500 }, deps.generate);
  const out = result.output || {};
  return { about: cleanText(out.about, 1500), phone: oneLine(out.phone, 30), address: oneLine(out.address, 160), hours: cleanText(out.hours, 400), offerings: cleanText(out.offerings, 4000), source_text: text };
}

// The preview bar, a watermark on every screen, no printing, noindex. Same rules as the menu preview.
function wrapPage(html, token, { prospect = false } = {}) {
  const mark = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><text x="130" y="90" text-anchor="middle" transform="rotate(-24 130 80)" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#071f2c" fill-opacity=".13">PREVIEW · NOT LIVE</text></svg>`);
  const bar = `<aside class="mm-preview" role="note" aria-label="About this preview">
  <p><strong>${prospect ? "A private preview made for you by Menu-made." : "Your free website preview."}</strong> It isn't live and ends ${prospect ? `in ${PROSPECT_DAYS} days` : `in ${PREVIEW_HOURS / 24} days`}. Live, it gets your own web address, your photos and your colours.</p>
  <a href="${escapeHtml(startUrl(token))}">Make it live: ${PRICE}</a>
</aside>`;
  const style = `<style>
  body { padding-bottom: 150px; }
  body::after { content: ""; position: fixed; inset: 0; z-index: 4; pointer-events: none; background-image: url("data:image/svg+xml,${mark}"); }
  .mm-preview { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 18px; padding: 14px 18px calc(14px + env(safe-area-inset-bottom)); background: #071f2c; color: #e8f6f7; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 -4px 18px rgba(0,0,0,.18); }
  .mm-preview p { margin: 0; max-width: 560px; }
  .mm-preview a { flex: none; padding: 11px 18px; border-radius: 6px; background: #00a7b5; color: #fff; font-weight: 700; text-decoration: none; }
  @media print { body > * { display: none !important; } body::before { content: "This is a preview from menu-made.com and can't be printed."; display: block; padding: 40px; font: 18px system-ui, sans-serif; } }
</style>`;
  return html.replace("</head>", () => `<meta name="robots" content="noindex,nofollow">\n${style}\n</head>`).replace(/<body([^>]*)>/, (match, attrs) => `<body${attrs}>\n${bar}`);
}

// The site generator (owner, Nov 6, 2026): the same business in each of the nine designs. "Generate site" goes to the
// next design, "Choose this site" goes to checkout with that design. Same watermark, noindex and no-print rules.
function wrapDesign(html, css, token, index, { prospect = false } = {}) {
  const d = DESIGNS[index];
  const next = DESIGNS[(index + 1) % DESIGNS.length];
  const mark = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><text x="130" y="90" text-anchor="middle" transform="rotate(-24 130 80)" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#071f2c" fill-opacity=".13">PREVIEW · NOT LIVE</text></svg>`);
  const bar = `<aside class="mm-gen" role="note" aria-label="Site generator">
  <p><strong>Design ${index + 1} of ${DESIGNS.length}: ${escapeHtml(d.label)}</strong><span> · ${escapeHtml(d.blurb)}. ${prospect ? `A private preview made for you by Menu-made, ends in ${PROSPECT_DAYS} days.` : `Free preview, ends in ${PREVIEW_HOURS / 24} days.`}</span></p>
  <a class="mm-gen-next" href="${escapeHtml(designUrl(token, next.key))}">Generate site</a>
  <a class="mm-gen-pick" href="${escapeHtml(chooseUrl(token, d.key))}">Choose this site: ${SITE_FILES_PRICE}</a>
</aside>`;
  const style = `<style>${css}
  body { padding-bottom: 170px; }
  body::after { content: ""; position: fixed; inset: 0; z-index: 40; pointer-events: none; background-image: url("data:image/svg+xml,${mark}"); }
  .mm-gen { position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 14px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: #071f2c; color: #e8f6f7; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 -4px 18px rgba(0,0,0,.25); }
  .mm-gen p { margin: 0; max-width: 520px; } .mm-gen a { flex: none; padding: 12px 18px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 15px; }
  .mm-gen-next { background: #ffffff1f; color: #fff; box-shadow: inset 0 0 0 2px #ffffff66; } .mm-gen-pick { background: #00a7b5; color: #fff; }
  @media (max-width: 600px) { .mm-gen p span { display: none; } }
  @media print { body > * { display: none !important; } body::before { content: "This is a preview from menu-made.com and can't be printed."; display: block; padding: 40px; font: 18px system-ui, sans-serif; } }
</style>`;
  return html.replace('<link rel="stylesheet" href="styles.css">', () => `<meta name="robots" content="noindex,nofollow">${style}`).replace(/<body([^>]*)>/, (match, attrs) => `<body${attrs}>\n${bar}`);
}

// Copy for when the AI copy fails its checks twice: plain, factual, nothing claimed.
function fallbackCopy(site, place) {
  const where = place ? ` in ${place}` : "";
  const what = site.kind === "services" ? "local business" : "food and drink business";
  return {
    tagline: `${site.kind === "services" ? "Local services" : "Food and drink"}${where}`.slice(0, 80),
    intro: `Welcome to ${site.name}. Find our ${site.offerings ? "menu, " : ""}hours and directions here, and call us with any questions.`,
    about: [`${site.name} is a ${what}${where}.`, ...(site.about && site.about.length < 600 && !site.about.startsWith(site.name) ? [site.about] : [])],
    meta_description: `${site.name}${where}: ${site.offerings ? "menu, " : ""}opening hours, address and phone number.`.slice(0, 160),
    meta_about: `About ${site.name}, a ${what}${where}.`.slice(0, 160)
  };
}

// Builds and stores the pages. Facts: { kind, about, offerings, phone, address, hours, city, cuisine }.
async function buildAndStore(env, token, business, facts, { scope, prospect = false, deps = {} }) {
  const place = facts.city || "";
  const kindWords = facts.cuisine ? `${facts.cuisine} ${facts.kind === "services" ? "business" : "spot"}` : "";
  const site = {
    name: business, kind: facts.kind === "services" ? "services" : "restaurant",
    about: facts.about || `${business}${kindWords ? ` is a ${kindWords}` : " is a local business"}${place ? ` in ${place}` : ""}.`,
    offerings: facts.offerings || "", phone: facts.phone || "", address: facts.address || "", hours: facts.hours || "",
    email: "", style: facts.style || "modern", brand: "", facebook: "", instagram: "", photos: [], logo: null
  };
  let copy = null;
  const written = await writeCopy(env, site, { scope }, deps.generate).catch(() => null);
  if (written && !written.problems?.length) copy = written.copy;
  if (!copy) copy = fallbackCopy(site, place);
  const pages = buildSite(site, copy);
  for (const [file, html] of Object.entries(pages)) {
    await env.ASSETS.put(`website-previews/${token}/${file}`, wrapPage(html, token, { prospect }), { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  }
  // The generator's nine designs, and what they were built from (the paid site is rebuilt from this after checkout).
  for (const [i, design] of DESIGNS.entries()) {
    const files = buildDesignSite(site, copy, design.key);
    await env.ASSETS.put(`website-previews/${token}/d/${design.key}.html`, wrapDesign(files["index.html"], files["styles.css"], token, i, { prospect }), { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  }
  await env.ASSETS.put(`website-previews/${token}/data.json`, JSON.stringify({ site, copy }), { httpMetadata: { contentType: "application/json" } });
  return { pages: Object.keys(pages).length, site };
}

const factsJson = (site) => JSON.stringify({ kind: site.kind, about: site.about, offerings: site.offerings, phone: site.phone, address: site.address, hours: site.hours });

async function handleWebsitePreviewCreate(request, env, { now = Date.now(), deps = {} } = {}) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
  if (!env.DB || !env.ASSETS) return json({ ok: false, error: "Previews aren't available right now. Please try again later." }, 503);
  if (await pausedForSale(env, ["WEBSITE_PACKAGE"]).catch(() => null)) return json({ ok: false, error: "The Website Package is paused right now, so previews are too." }, 409);
  const body = await request.json().catch(() => null);
  const requestId = String(body?.request_id || "").toLowerCase();
  const email = oneLine(body?.email, 150).toLowerCase();
  const business = oneLine(body?.business, 150);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !business) {
    return json({ ok: false, error: "Add your business name, email and menu file." }, 400);
  }
  const upload = await env.DB.prepare(`SELECT id, payload, ip_hash, created_at FROM mm_booking_requests WHERE id = ?`).bind(requestId).first();
  const data = parseJsonOrNull(upload?.payload);
  const doc = data?.document;
  if (!upload || data?.purpose !== "checkout" || String(data.email || "").toLowerCase() !== email || !doc?.storageKey) return json({ ok: false, error: "We couldn't find your menu file. Please choose it again." }, 404);
  if (Math.floor(now / 1000) - Number(upload.created_at || 0) > UPLOAD_MAX_AGE_SECONDS) return json({ ok: false, error: "That upload is too old. Please choose your menu file again." }, 410);
  if (!MENU_TYPES.has(String(doc.contentType || "").toLowerCase())) return json({ ok: false, error: "Previews work from a PDF or a photo (PNG, JPEG or WebP) of your menu." }, 415);

  const t = new Date(now).toISOString();
  const dayAgo = new Date(now - 86400000).toISOString();
  const rep = await isRep(env, body?.rep);
  if (rep) {
    if (await count(env, `SELECT COUNT(*) AS n FROM website_previews WHERE source = 'rep' AND created_at > ?`, dayAgo) >= REP_PER_DAY) return json({ ok: false, error: `Rep mode has made ${REP_PER_DAY} website previews today, its daily limit.` }, 429);
  } else {
    const existing = await env.DB.prepare(`SELECT token, status, expires_at FROM website_previews WHERE email = ? AND source = 'public' AND created_at > ? ORDER BY created_at DESC LIMIT 1`)
      .bind(email, new Date(now - EMAIL_DAYS * 86400000).toISOString()).first();
    if (existing?.status === "BUILDING") return json({ ok: false, error: "Your website preview is still being made. Give it a minute." }, 409);
    if (existing?.status === "READY" && existing.expires_at > t) return json({ ok: true, url: viewUrl(existing.token), token: existing.token, reused: true });
    if (existing?.status === "READY") return json({ ok: false, used: true, error: "You've already had a free website preview with this email. Start your order and we'll build the real thing.", start: startUrl(existing.token) }, 409);
    if (await count(env, `SELECT COUNT(*) AS n FROM website_previews WHERE ip_hash = ? AND created_at > ?`, upload.ip_hash || "", dayAgo) >= PER_NETWORK_DAY) return json({ ok: false, error: "This connection has made its free previews for today. Please try again tomorrow." }, 429);
    if (await count(env, `SELECT COUNT(*) AS n FROM website_previews WHERE source = 'public' AND created_at > ?`, dayAgo) >= PER_DAY) return json({ ok: false, error: "We've made all of today's free website previews. Please try again tomorrow, or start your order now." }, 429);
  }
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "Previews aren't available right now. Please try again later." }, 503);

  const token = newToken();
  const tracking = body?.tracking && typeof body.tracking === "object" ? body.tracking : {};
  await env.DB.prepare(`INSERT INTO website_previews (token, source, request_id, email, business, ip_hash, campaign, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'BUILDING', ?, ?)`)
    .bind(token, rep ? "rep" : "public", requestId, email, business, upload.ip_hash || "", rep ? "rep" : oneLine(tracking.campaign, 100) || null, t, hoursFromNow(PREVIEW_HOURS, now)).run();
  const started = Date.now();
  const scope = { entityType: "WEBSITE_PREVIEW", entityId: token };
  let built;
  try {
    const object = await env.ASSETS.get(doc.storageKey);
    if (!object) throw new Error("menu file is not stored");
    const bytes = new Uint8Array(await object.arrayBuffer());
    const mime = String(doc.contentType).toLowerCase();
    const block = mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mime, data: bytesToBase64(bytes) } }
      : { type: "image", source: { type: "base64", media_type: mime, data: bytesToBase64(bytes) } };
    const site = body?.website ? await factsFromWebsite(env, oneLine(body.website, 300), scope, deps).catch(() => null) : null;
    const read = await readMenuWithClaude(block, env);
    const facts = {
      kind: "restaurant",
      offerings: offeringsFromMenu(read.menu) || site?.offerings || "",
      about: site?.about || "",
      phone: oneLine(body?.phone, 30) || site?.phone || "",
      address: oneLine(body?.address, 160) || site?.address || "",
      hours: cleanText(body?.hours, 400) || site?.hours || ""
    };
    if (!facts.offerings) throw new Error("no menu items could be read");
    built = await buildAndStore(env, token, business, facts, { scope, deps });
    await env.DB.prepare(`UPDATE website_previews SET status = 'READY', page_count = ?, facts_json = ? WHERE token = ?`).bind(built.pages, factsJson(built.site), token).run();
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await env.DB.prepare(`UPDATE website_previews SET status = 'FAILED', error = ?, expires_at = ? WHERE token = ?`).bind(reason, t, token).run();
    return json({ ok: false, error: "We couldn't read that menu file. Try a clearer PDF or photo, or start your order and we'll handle it." }, 422);
  }
  const url = viewUrl(token);
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`Website preview ${rep ? "(rep) " : ""}made in ${seconds}s, ${built.pages} pages`);
  await sendTransactionalEmail(env, {
    to: email,
    subject: "Your free website preview",
    html: brandedEmailHtml({
      preheader: "See your business as a phone-friendly website.",
      eyebrow: "WEBSITE PACKAGE",
      heading: `Here's ${business} as a website`,
      paragraphs: [
        `Open it on your phone: <a href="${escapeHtml(url)}">see your website preview</a>. It's only a preview and ends in ${PREVIEW_HOURS / 24} days.`,
        `Like it? <a href="${escapeHtml(startUrl(token))}">Make it live for ${PRICE}</a>: up to 5 pages on your own web address, with your photos, your colours and 3 months of updates. Your details carry over, so checkout takes a minute.`
      ]
    }),
    text: `Your website preview: ${url}\nIt ends in ${PREVIEW_HOURS / 24} days.\nMake it live (${PRICE}): ${startUrl(token)}`,
    idempotencyKey: `website-preview/${token}`, purpose: "WEBSITE_PREVIEW", templateKey: "website_preview_v1"
  }).catch((error) => console.error("Website preview email failed:", error instanceof Error ? error.message : String(error)));
  return json({ ok: true, url, token, seconds, pages: built.pages, ...(rep ? { start: startUrl(token) } : {}) });
}

async function plainGone(status, title, body) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#edf3f5;color:#26434f;"><main style="max-width:560px;margin:48px auto;padding:28px;background:#fff;border:1px solid #dce8ec;">
<h1 style="margin:0 0 12px;font-size:22px;color:#071f2c;">${escapeHtml(title)}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

async function handleWebsitePreviewView(request, env, token, page, { now = Date.now() } = {}) {
  const gone = () => plainGone(410, "This preview has ended", `To get your business a website, see the <a href="${escapeHtml(`${SITE}/website-design.html`)}">Website Package</a>.`);
  if (!/^[a-f0-9]{36}$/.test(token) || !PAGE.test(page) || !env.DB || !env.ASSETS) return gone();
  const row = await env.DB.prepare(`SELECT token, source, prospect_id, status, expires_at, open_count FROM website_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return gone();
  const agent = request.headers.get("User-Agent") || "";
  const counted = request.method === "GET" && agent && !SCANNER.test(agent) && (page === "index.html" || page.startsWith("d/"));
  if (counted && row.source !== "prospect" && Number(row.open_count || 0) >= MAX_OPENS) {
    return plainGone(410, "This preview has ended", `It's been opened ${MAX_OPENS} times, which is the limit for a free preview. <a href="${escapeHtml(startUrl(token))}">Make it live</a> to keep it.`);
  }
  const object = await env.ASSETS.get(`website-previews/${token}/${page}`);
  if (!object) return gone();
  if (counted) {
    const t = new Date(now).toISOString();
    await env.DB.prepare(`UPDATE website_previews SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ?) WHERE token = ?`).bind(t, token).run();
    if (row.source === "prospect") await env.DB.prepare(`UPDATE prospect_demos SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ? WHERE token = ?`).bind(t, t, token).run();
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } });
}

async function handleWebsitePreviewHandoff(env, token, { now = Date.now() } = {}) {
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB) return json({ ok: false }, 404);
  const row = await env.DB.prepare(`SELECT email, business, status, created_at FROM website_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || Date.parse(row.created_at) < now - Math.max(HANDOFF_DAYS, PROSPECT_DAYS) * 86400000) return json({ ok: false }, 404);
  return json({ ok: true, business: row.business, email: row.email || "" });
}

// Prospect emails (owner, Nov 5, 2026): no-website businesses get a site built from their public listing (and their
// menu file if they have one); businesses whose site is poor on phones get their own site's content rebuilt for phones.
const SITE_GAPS = new Set(["no_website", "no_phone_layout", "no_tap_to_call", "site_down"]);
async function handleProspectSiteDemo(request, env, { fetcher = fetch, now = Date.now(), deps = {} } = {}) {
  const auth = await verifyRenderer(request, env, { audience: DRAFTS_AUDIENCE, workflow: DRAFTS_WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.DB || !env.ASSETS) return json({ ok: false, error: "Storage is not available" }, 503);
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const p = id ? await env.DB.prepare(`SELECT id, name, kind, cuisine, city, address, phone, website, email, status, gaps_json, menu_url, offer_code FROM prospects WHERE id = ?`).bind(id).first() : null;
  if (!p) return json({ ok: false, skip: "unknown prospect" }, 404);
  const gaps = JSON.parse(p.gaps_json || "[]");
  if (!["WEBSITE_PACKAGE", "CONVERSION_FIX"].includes(p.offer_code) || !gaps.some((g) => SITE_GAPS.has(g)) || !["NEW", "DRAFTED", "SENT"].includes(p.status)) {
    return json({ ok: false, skip: "not a website prospect" });
  }
  const t = new Date(now).toISOString();
  const existing = await env.DB.prepare(`SELECT token FROM prospect_demos WHERE prospect_id = ? AND kind = 'website' AND status = 'READY' AND expires_at > ? ORDER BY created_at DESC LIMIT 1`).bind(id, new Date(now + 7 * 86400000).toISOString()).first();
  if (existing) return json({ ok: true, url: viewUrl(existing.token), reused: true });
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "Reading is not configured" }, 503);
  const token = newToken();
  const scope = { entityType: "WEBSITE_PREVIEW", entityId: token };
  const expires = new Date(now + PROSPECT_DAYS * 86400000).toISOString();
  try {
    const site = p.website && !gaps.includes("site_down") ? await factsFromWebsite(env, p.website, scope, { ...deps, fetcher }).catch(() => null) : null;
    let offerings = site?.offerings || "";
    if (p.menu_url && (gaps.includes("menu_pdf") || gaps.includes("menu_image") || !offerings)) {
      const read = await readProspectMenu(p.menu_url, env, fetcher).catch(() => null);
      if (read?.menu) offerings = offeringsFromMenu(read.menu) || offerings;
    }
    const facts = { kind: "restaurant", cuisine: oneLine(p.cuisine, 40).replace(/[_;]/g, " "), city: p.city || "", about: site?.about || "", offerings,
      phone: site?.phone || p.phone || "", address: site?.address || p.address || "", hours: site?.hours || "" };
    // A preview with nothing but a name would sell nothing: it needs the menu or at least phone or address.
    if (!facts.offerings && !facts.phone && !facts.address) throw new Error("not enough public details to build a preview");
    await env.DB.prepare(`INSERT INTO website_previews (token, source, prospect_id, email, business, status, created_at, expires_at) VALUES (?, 'prospect', ?, ?, ?, 'BUILDING', ?, ?)`).bind(token, id, p.email, p.name, t, expires).run();
    const built = await buildAndStore(env, token, p.name, facts, { scope, prospect: true, deps });
    await env.DB.prepare(`UPDATE website_previews SET status = 'READY', page_count = ?, facts_json = ? WHERE token = ?`).bind(built.pages, factsJson(built.site), token).run();
    await env.DB.prepare(`INSERT INTO prospect_demos (token, prospect_id, status, kind, item_count, created_at, expires_at) VALUES (?, ?, 'READY', 'website', ?, ?, ?)`).bind(token, id, built.pages, t, expires).run();
    return json({ ok: true, url: viewUrl(token), pages: built.pages, from: site ? "their website" : "their listing" });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await env.DB.prepare(`UPDATE website_previews SET status = 'FAILED', error = ? WHERE token = ?`).bind(reason, token).run().catch(() => null);
    await env.DB.prepare(`INSERT INTO prospect_demos (token, prospect_id, status, kind, error, created_at, expires_at) VALUES (?, ?, 'FAILED', 'website', ?, ?, ?)`).bind(token, id, reason, t, t).run();
    return json({ ok: false, skip: reason });
  }
}

// After a Website Package purchase: the intake form starts filled in from the buyer's latest preview (same email).
async function prefillFromPreview(env, email) {
  if (!email || !env.DB) return {};
  const row = await env.DB.prepare(`SELECT facts_json FROM website_previews WHERE email = ? AND status = 'READY' ORDER BY created_at DESC LIMIT 1`).bind(String(email).toLowerCase()).first().catch(() => null);
  const facts = parseJsonOrNull(row?.facts_json) || {};
  const out = {};
  for (const key of ["kind", "about", "offerings", "phone", "address", "hours"]) if (typeof facts[key] === "string" && facts[key]) out[key] = facts[key];
  return out;
}

export { designUrl, chooseUrl, wrapDesign, handleWebsitePreviewCreate, handleWebsitePreviewView, handleWebsitePreviewHandoff, handleProspectSiteDemo, prefillFromPreview, offeringsFromMenu, wrapPage, fallbackCopy, PREVIEW_HOURS, PER_NETWORK_DAY };
