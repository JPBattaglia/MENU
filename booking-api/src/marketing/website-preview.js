// Free Website Package preview (owner, Nov 5, 2026): like the free menu preview, a business sees its own phone-friendly
// website before paying ($299 since Nov 6, 2026: the generator shows 9 designs and "Choose this site" opens checkout). Built with the paid product's own builder (producers/website/build.js) and copy writer,
// from what we can read, never invented: their menu (uploaded, or the menu file on their site), their current website's
// text, or their public listing (prospects with no website). It can't stand in for the product: every page carries a
// "Preview, not live" watermark and a bar, it can't be printed, it's noindex, and it ends (public: PREVIEW_HOURS,
// no open limit (owner, Nov 7, 2026); prospect emails: PROSPECT_DAYS). "Choose this site" opens Your Website checkout with the business and
// email filled in and the chosen design attached (site_choice).
//
//   POST /api/website-preview/create   { request_id, email, business, website?, phone?, address?, hours?, rep?, tracking? }
//                                      request_id = the menu upload made a moment earlier through /api/inquiry
//   GET  /api/website-preview/view/<token>/<page>.html     the preview pages (relative links between them)
//   GET  /api/website-preview/handoff/<token>              -> { ok, business, email } for checkout
//   POST /api/system/prospects/site-demo  { id }           (prospect-drafts.yml OIDC) -> { ok, url } | { ok:false, skip }
import { logoBgSelect, logoMeasureScript } from "./logo-measure.js";
import { frameAware, wantsJson, preflight } from "./framed.js";
import { LOGO_MODES, parseLogoInfo } from "../producers/menu-qr/design.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { bytesToBase64 } from "../lib/util.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { readMenuWithClaude } from "../producers/menu-qr/claude-reader.js";
import { extractReadableText } from "../producers/menu-qr/inputs.js";
import { buildSite } from "../producers/website/build.js";
import { DESIGNS, buildDesignSite } from "../producers/website/templates/index.js";
import { sniffImage } from "../producers/website/intake.js";
import { hexOk } from "../producers/website/styles.js";
import { writeCopy } from "../producers/website/copy.js";
import { generate } from "../ai/generate.js";
import { pausedForSale } from "../lib/switches.js";
import { verifyLinkToken } from "../lib/links.js";
import { ownerEmailAddress } from "../lib/config.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";
import { DRAFTS_AUDIENCE, DRAFTS_WORKFLOW } from "./prospects.js";
import { readProspectMenu } from "./demo-menu.js";
import { lookupListing } from "./listing-lookup.js";
import { addMoodPhotos, hasSamplePhotos, ownPhotoCount } from "../producers/website/mood.js";

const PREVIEW_HOURS = 72;
const PROSPECT_DAYS = 21;
const PER_DAY = 20;              // each build is 1 to 3 Claude calls
const PER_NETWORK_DAY = 2;
const EMAIL_DAYS = 30;
const REP_PER_DAY = 40;
const UPLOAD_MAX_AGE_SECONDS = 2 * 3600;
const HANDOFF_DAYS = 14;
const SITE = "https://menu-made.com";
const MENU_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const SCANNER = /bot|crawl|spider|slurp|preview|scanner|proofpoint|mimecast|barracuda|safelinks|urldefense|headless|python|curl|wget|java\/|go-http|facebookexternalhit|slackbot|whatsapp|discord|skypeuripreview|outlook-ios-linkpreview/i;
const PAGE = /^(index|menu|services|about|gallery|contact)\.html$|^d\/[a-z]+(\/(index|menu|about|contact))?\.html$/;
const SITE_FILES_PRICE = "$299";
// "Customize" (owner, Nov 6, 2026; was "Make it yours"): a logo, up to MAX_PHOTOS photos and a brand colour, applied to all nine designs.
const MAX_PHOTOS = 6;
const MAX_OWN_IMAGE = 5 * 1024 * 1024;
const MAX_CUSTOMIZE = 15;        // rebuilds per preview (no AI involved, just storage)
const IMG = /^(logo|photo-[1-6]|mood-[1-6])\.(png|jpg|webp)$/;
const IMG_MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
const cleanText = (value, max) => String(value || "").replace(/[\r\x00]/g, "").trim().slice(0, max);
const oneLine = (value, max) => cleanText(value, max).replace(/\n/g, " ");
const hoursFromNow = (hours, now) => new Date(now + hours * 3600000).toISOString();
const viewUrl = (token) => `${SITE}/api/website-preview/view/${token}/d/${DESIGNS[0].key}/index.html`;
const designUrl = (token, key) => `${SITE}/api/website-preview/view/${token}/d/${key}/index.html`;
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
  <p><strong>${prospect ? "A private preview made for you by Menu-made." : "Your free website preview."}</strong> It isn't live and ends ${prospect ? `in ${PROSPECT_DAYS} days` : `in ${PREVIEW_HOURS / 24} days`}. Pick the design you like: ${SITE_FILES_PRICE} for the whole site, or we host it.</p>
  <a href="${escapeHtml(viewUrl(token))}">See it in 9 designs</a>
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
// Customize details (owner, Nov 6, 2026): motto, About text, contact details, social links and an order/booking
// link, on top of the logo, photos and colour. Used in the generator's popup and on the after-purchase page.
const SOCIAL_FIELDS = [
  ["instagram", "Instagram", ["instagram.com"], "https://www.instagram.com/"],
  ["facebook", "Facebook", ["facebook.com", "fb.com"], ""],
  ["tiktok", "TikTok", ["tiktok.com"], "https://www.tiktok.com/@"],
  ["yelp", "Yelp", ["yelp.com"], ""]
];
const ORDER_LABELS = ["Order online", "Book a table", "Book now"];
const aboutText = (site, copy) => site.about_text || (copy?.about || []).join("\n\n");

function detailFields(site = {}, copy = {}) {
  const v = (x) => escapeHtml(x || "");
  const field = (name, label, value, attrs = "", hint = "") => `<label>${label}${hint ? ` <small>${hint}</small>` : ""}<input name="${name}" value="${v(value)}" ${attrs}></label>`;
  return `<details class="mm-own-group" name="mm-own-g"><summary>Motto and About</summary>
  ${field("motto", "Motto", site.motto || copy.tagline, 'maxlength="80"', "(the line under your name)")}
  <label>About your business <small>(blank line between paragraphs)</small><textarea name="about" rows="5" maxlength="1500">${v(aboutText(site, copy))}</textarea></label></details>
  <details class="mm-own-group" name="mm-own-g"><summary>Contact details</summary>
  ${field("phone", "Phone", site.phone, 'type="tel" maxlength="30"')}
  ${field("email", "Email", site.email, 'type="email" maxlength="150"', "(shown on your Contact page)")}
  ${field("address", "Address", site.address, 'maxlength="150"')}
  <label>Hours <small>(one line per day or group, e.g. Mon-Fri: 8am-3pm)</small><textarea name="hours" rows="4" maxlength="400">${v(site.hours)}</textarea></label></details>
  <details class="mm-own-group" name="mm-own-g"><summary>Social and order links</summary>
  ${SOCIAL_FIELDS.map(([name, label]) => field(name, label, site[name], 'inputmode="url" maxlength="300"', name === "instagram" || name === "tiktok" ? "(link or @name)" : "(link)")).join("\n  ")}
  ${field("order_url", "Order or booking link", site.order_url, 'type="url" inputmode="url" maxlength="300"', "(DoorDash, Toast, OpenTable…)")}
  <label>Button says <select name="order_label">${ORDER_LABELS.map((l) => `<option${(site.order_label || ORDER_LABELS[0]) === l ? " selected" : ""}>${l}</option>`).join("")}</select></label></details>`;
}

function linkFrom(raw, hosts, handleBase) {
  let v = String(raw || "").trim();
  if (!v) return { value: "" };
  if (v.length > 300) return { error: "That link is too long." };
  if (handleBase && /^@?[A-Za-z0-9._]{1,30}$/.test(v)) return { value: handleBase + v.replace(/^@/, "") };
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  let url;
  try { url = new URL(v); } catch { return { error: `"${String(raw).slice(0, 60)}" isn't a web link.` }; }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return { error: `"${String(raw).slice(0, 60)}" isn't a web link.` };
  url.protocol = "https:";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hosts.length && !hosts.some((h) => host === h || host.endsWith(`.${h}`))) return { error: `That doesn't look like a ${hosts[0].split(".")[0]} link.` };
  return { value: url.toString() };
}
const oneLineText = (v, max) => String(v ?? "").replace(/[\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const multiLineText = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0b-\x1f]/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

// Text fields from a Customize form, set on `site` in place; fields not in the form are left alone.
function applyDetails(site, form) {
  if (form.has("motto")) site.motto = oneLineText(form.get("motto"), 80);
  if (form.has("about")) site.about_text = multiLineText(form.get("about"), 1500);
  if (form.has("phone")) site.phone = oneLineText(form.get("phone"), 30);
  if (form.has("address")) site.address = oneLineText(form.get("address"), 150);
  if (form.has("hours")) site.hours = multiLineText(form.get("hours"), 400);
  if (form.has("email")) {
    const email = oneLineText(form.get("email"), 150).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address doesn't look right." };
    site.email = email;
  }
  for (const [name, label, hosts, handleBase] of SOCIAL_FIELDS) {
    if (!form.has(name)) continue;
    const r = linkFrom(form.get(name), hosts, handleBase);
    if (r.error) return { error: `${label}: ${r.error}` };
    site[name] = r.value;
  }
  if (form.has("order_url")) {
    const r = linkFrom(form.get("order_url"), [], "");
    if (r.error) return { error: `Order or booking link: ${r.error}` };
    site.order_url = r.value;
  }
  if (form.has("order_label")) site.order_label = ORDER_LABELS.includes(form.get("order_label")) ? form.get("order_label") : ORDER_LABELS[0];
  return {};
}

// "Hide the name" (owner, Nov 7, 2026): many logos are the name, so the name showed twice. The hidden "0" tells a form
// that has the box apart from one that doesn't, since an unticked box sends nothing.
function hideNameField(site = {}, { style = "", boxStyle = "" } = {}) {
  return `<input type="hidden" name="hide_name" value="0"><label class="mm-own-check"${style ? ` style="${style}"` : ""}><input type="checkbox" name="hide_name" value="1"${site.hide_name ? " checked" : ""}${boxStyle ? ` style="${boxStyle}"` : ""}> Hide the business name (my logo shows it)</label>`;
}

function ownPanel(token, key, site = {}, copy = {}) {
  const n = ownPhotoCount(site), brand = hexOk(site.brand) ? String(site.brand).toLowerCase() : "";
  const have = [site.logo ? "your logo" : "", n ? `${n} photo${n === 1 ? "" : "s"}` : "", brand ? "your colour" : ""].filter(Boolean);
  const sample = hasSamplePhotos(site) ? " The photos are samples until you add yours." : "";
  // A popup in the middle of the screen, opened by the "Customize" button in the bar (owner, Nov 6, 2026). Rebuilding
  // nine designs takes a while, so sending shows a "please wait" panel in place of the form until the page reloads.
  return `<dialog class="mm-own" id="mm-own" aria-labelledby="mm-own-title" onclick="if (event.target === this) this.close()"><div class="mm-own-box">
  <div class="mm-own-head"><h2 id="mm-own-title">Customize your site</h2><button type="button" class="mm-own-x" aria-label="Close" onclick="this.closest('dialog').close()">&times;</button></div>
  <form method="post" enctype="multipart/form-data" action="/api/website-preview/customize/${token}" onsubmit="var b = this.parentNode; b.classList.add('busy'); b.querySelector('.mm-own-busy').hidden = false; this.hidden = true; b.closest('dialog').addEventListener('cancel', function (e) { e.preventDefault(); });">
  <input type="hidden" name="design" value="${escapeHtml(key)}">
  <p class="mm-own-now">${have.length ? `Using ${escapeHtml(have.join(", "))}. New files replace them.` : "Add your logo, photos, colour and details. Every design updates."}${sample}</p>
  <details class="mm-own-group" name="mm-own-g" open><summary>Logo and name</summary>
  <label>Logo <small>(PNG, JPG or WebP)</small><input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label>
  <input type="hidden" name="logo_info" value="">
  <label>Logo background <small>(Automatic picks one per design so the logo stands out)</small>${logoBgSelect(site.logo_bg)}</label>
  ${hideNameField(site)}</details>
  <details class="mm-own-group" name="mm-own-g"><summary>Photos and colour</summary>
  <label>Photos <small>(up to ${MAX_PHOTOS}, 5 MB each)</small><input type="file" name="photos" accept="image/png,image/jpeg,image/webp" multiple></label>
  <label class="mm-own-colour">Brand colour <input type="color" name="brand" value="${brand || "#00a7b5"}"></label>
  <label class="mm-own-check"><input type="checkbox" name="use_brand" value="1"${brand ? " checked" : ""}> Use this colour</label></details>
  ${detailFields(site, copy)}
  <button type="submit">Update all 9 designs</button>
  </form>
  <div class="mm-own-busy" role="status" aria-live="polite" hidden><span class="mm-spin" aria-hidden="true"></span><p><strong>Updating all 9 designs…</strong></p><p>Adding your logo, photos and colour to every design. This can take up to a minute. Keep this page open: it reloads by itself when they're ready.</p></div>
  </div></dialog>
  ${logoMeasureScript("#mm-own input[name=logo]")}
  <script>window.addEventListener("pageshow", function () { var b = document.querySelector(".mm-own-box"); if (!b) return; b.classList.remove("busy"); b.querySelector("form").hidden = false; b.querySelector(".mm-own-busy").hidden = true; });</script>`;
}

function wrapDesign(html, css, token, index, { prospect = false, site = null, copy = null } = {}) {
  const d = DESIGNS[index];
  const next = DESIGNS[(index + 1) % DESIGNS.length];
  const mark = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><text x="130" y="90" text-anchor="middle" transform="rotate(-24 130 80)" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#071f2c" fill-opacity=".13">PREVIEW · NOT LIVE</text></svg>`);
  const bar = `<aside class="mm-gen" role="note" aria-label="Site generator">
  <p><strong>Design ${index + 1} of ${DESIGNS.length}: ${escapeHtml(d.label)}</strong><span> · ${escapeHtml(d.blurb)}. ${prospect ? `A private preview made for you by Menu-made, ends in ${PROSPECT_DAYS} days.` : `Free preview, ends in ${PREVIEW_HOURS / 24} days.`}${hasSamplePhotos(site) ? " Sample photos: add your own with Customize." : ""}</span></p>
  <a class="mm-gen-next" href="${escapeHtml(designUrl(token, next.key))}">Generate site</a>
  <button type="button" class="mm-gen-own" onclick="var d = document.getElementById('mm-own'); d.showModal ? d.showModal() : d.setAttribute('open', '')">Customize</button>
  <a class="mm-gen-pick" href="${escapeHtml(chooseUrl(token, d.key))}">Choose this site: ${SITE_FILES_PRICE}</a>
  ${ownPanel(token, d.key, site || {}, copy || {})}
</aside>`;
  const style = `<style>${css}
  body { padding-bottom: 170px; }
  body::after { content: ""; position: fixed; inset: 0; z-index: 40; pointer-events: none; background-image: url("data:image/svg+xml,${mark}"); }
  .mm-gen { position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 14px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: #071f2c; color: #e8f6f7; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 -4px 18px rgba(0,0,0,.25); }
  .mm-gen p { margin: 0; max-width: 520px; } .mm-gen a, .mm-gen-own { flex: none; padding: 12px 18px; border: 0; border-radius: 8px; font: 700 15px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-decoration: none; cursor: pointer; }
  .mm-gen-next, .mm-gen-own { background: #ffffff1f; color: #fff; box-shadow: inset 0 0 0 2px #ffffff66; } .mm-gen-pick { background: #00a7b5; color: #fff; }
  .mm-own { width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 48px); margin: auto; padding: 0; border: 0; border-radius: 14px; background: #071f2c; color: #e8f6f7; box-shadow: 0 24px 60px rgba(0,0,0,.45); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .mm-own::backdrop { background: rgba(4,16,24,.62); } .mm-own[open]:not(:modal) { position: fixed; inset: 0; z-index: 50; }
  .mm-own-box { padding: 18px 20px 20px; } .mm-own-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
  .mm-own h2 { margin: 0; font: 700 20px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; } .mm-own .mm-own-x { padding: 2px 10px; background: none; color: #e8f6f7; font-size: 26px; line-height: 1; }
  .mm-own form { display: grid; gap: 12px; } .mm-own { overflow: auto; overscroll-behavior: contain; }
  .mm-own-group { display: grid; gap: 10px; border-top: 1px solid #ffffff26; padding-top: 10px; } .mm-own-group > summary { cursor: pointer; font-weight: 700; color: #9eeef3; padding: 4px 0; } .mm-own-group[open] { gap: 12px; }
  .mm-own-group:not([open]) > :not(summary) { display: none; } .mm-own-group label { margin-top: 10px; }
  .mm-own input:not([type]), .mm-own input[type=tel], .mm-own input[type=email], .mm-own input[type=url], .mm-own textarea, .mm-own select { width: 100%; font: 15px/1.4 system-ui, sans-serif; padding: 10px 12px; border: 1px solid #ffffff4d; border-radius: 8px; background: #0d2a38; color: #e8f6f7; font-weight: 400; } .mm-own textarea { resize: vertical; } .mm-own-busy { display: grid; justify-items: center; gap: 10px; padding: 28px 8px 12px; text-align: center; } .mm-own-busy[hidden], .mm-own form[hidden] { display: none; } .mm-own-box.busy .mm-own-x { display: none; }
  .mm-spin { width: 52px; height: 52px; border: 5px solid #ffffff2e; border-top-color: #00a7b5; border-radius: 50%; animation: mm-spin .9s linear infinite; } @keyframes mm-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .mm-spin { animation: mm-spin 2.4s linear infinite !important; } }
  .mm-own label { display: grid; gap: 4px; font-weight: 600; } .mm-own small { font-weight: 400; opacity: .8; } .mm-own input[type=file] { color: #e8f6f7; max-width: 100%; } .mm-own input[type=file]::file-selector-button { margin-right: 12px; padding: 10px 18px; border: 0; border-radius: 8px; background: #00a7b5; color: #fff; font: 700 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; cursor: pointer; } .mm-own input[type=file]::file-selector-button:hover { background: #00bccb; }
  .mm-own .mm-own-colour, .mm-own .mm-own-check { display: flex; align-items: center; gap: 10px; } .mm-own input[type=color] { width: 52px; height: 36px; border: 0; padding: 0; background: none; }
  .mm-own p { margin: 0; } .mm-own button { padding: 12px 18px; border: 0; border-radius: 8px; background: #00a7b5; color: #fff; font: 700 15px system-ui, sans-serif; cursor: pointer; }
  @media (max-width: 600px) { .mm-gen p span { display: none; } .mm-gen a, .mm-gen-own { padding: 10px 13px; font-size: 14px; } }
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
  // No photos given: free-licence mood photos that suit the menu, marked sample (owner, Nov 6, 2026).
  if (!site.photos.length) site.photos = await addMoodPhotos(env, token, site, { cuisine: facts.cuisine, fetcher: deps.moodFetch });
  await storeDesigns(env, token, site, copy, { prospect });
  return { pages: Object.keys(pages).length, site };
}

// The generator's nine designs, and what they were built from (the paid site is rebuilt from this after checkout).
async function storeDesigns(env, token, site, copy, { prospect = false, extra = {} } = {}) {
  for (const [i, design] of DESIGNS.entries()) {
    const files = buildDesignSite(site, copy, design.key);
    for (const [file, html] of Object.entries(files)) {
      if (!file.endsWith(".html")) continue;
      await env.ASSETS.put(`website-previews/${token}/d/${design.key}/${file}`, wrapDesign(html, files["styles.css"], token, i, { prospect, site, copy }), { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    }
  }
  await env.ASSETS.put(`website-previews/${token}/data.json`, JSON.stringify({ ...extra, site, copy }), { httpMetadata: { contentType: "application/json" } });
}

const factsJson = (site) => JSON.stringify({ kind: site.kind, about: site.about, offerings: site.offerings, phone: site.phone, address: site.address, hours: site.hours });

async function handleWebsitePreviewCreate(request, env, { now = Date.now(), deps = {} } = {}) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
  if (!env.DB || !env.ASSETS) return json({ ok: false, error: "Previews aren't available right now. Please try again later." }, 503);
  if (await pausedForSale(env, ["SITE_FILES"]).catch(() => null)) return json({ ok: false, error: "The site generator is paused right now. Please try again later." }, 409);
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
    if (existing?.status === "READY") return json({ ok: false, used: true, error: "You've already had a free website preview with this email. Open the link in our email to pick your design.", start: viewUrl(existing.token) }, 409);
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
    // Auto-fill: with a city, the public listing fills what was left blank, and its website is read when none was given.
    const city = oneLine(body?.city, 80);
    const needsListing = city && !(body?.phone && body?.address && body?.hours && body?.website);
    const listing = needsListing ? await lookupListing(business, city).catch(() => null) : null;
    const website = oneLine(body?.website, 300) || listing?.website || "";
    const site = website ? await factsFromWebsite(env, website, scope, deps).catch(() => null) : null;
    const read = await readMenuWithClaude(block, env);
    const facts = {
      kind: "restaurant", city, cuisine: listing?.cuisine || "",
      offerings: offeringsFromMenu(read.menu) || site?.offerings || "",
      about: site?.about || "",
      phone: oneLine(body?.phone, 30) || site?.phone || listing?.phone || "",
      address: oneLine(body?.address, 160) || site?.address || listing?.address || "",
      hours: cleanText(body?.hours, 400) || site?.hours || listing?.hours || ""
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
      eyebrow: "YOUR WEBSITE",
      heading: `Here's ${business} as a website`,
      paragraphs: [
        `Open it on your phone: <a href="${escapeHtml(url)}">see your website preview</a>. It's only a preview and ends in ${PREVIEW_HOURS / 24} days.`,
        `Tap <strong>Generate site</strong> to see it in the next of 9 designs. When one feels right, tap <strong>Choose this site</strong>: ${SITE_FILES_PRICE} for the whole site as files you own, or add Website Care and we host it for you.`
      ]
    }),
    text: `Your website preview: ${url}\nIt ends in ${PREVIEW_HOURS / 24} days.\nTap Generate site to see the next of 9 designs, then Choose this site (${SITE_FILES_PRICE}) on the one you want.`,
    idempotencyKey: `website-preview/${token}`, purpose: "WEBSITE_PREVIEW", templateKey: "website_preview_v1"
  }).catch((error) => console.error("Website preview email failed:", error instanceof Error ? error.message : String(error)));
  return json({ ok: true, url, token, seconds, pages: built.pages, ...(rep ? { start: url } : {}) });
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
  // Only a design's home page counts as an open (not its menu, about and contact pages); prospect and rep previews
  // (shown by the owner on visits) have no cap.
  const counted = request.method === "GET" && agent && !SCANNER.test(agent) && (page === "index.html" || /^d\/[a-z]+\/index\.html$/.test(page));
  // A preview first built with one design (before Nov 6, 2026) and rebuilt since: its emailed link opens the generator.
  if (row.source === "prospect" && !page.startsWith("d/")) {
    const base = page.replace(/\.html$/, "");
    const target = `d/${DESIGNS[0].key}/${["index", "menu", "about", "contact"].includes(base) ? base : "index"}.html`;
    if (await env.ASSETS.head?.(`website-previews/${token}/${target}`) ?? await env.ASSETS.get(`website-previews/${token}/${target}`)) {
      return new Response(null, { status: 302, headers: { Location: `${SITE}/api/website-preview/view/${token}/${target}`, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
    }
  }
  const object = await env.ASSETS.get(`website-previews/${token}/${page}`);
  if (!object) return gone();
  if (counted) {
    const t = new Date(now).toISOString();
    await env.DB.prepare(`UPDATE website_previews SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ?) WHERE token = ?`).bind(t, token).run();
    if (row.source === "prospect") await env.DB.prepare(`UPDATE prospect_demos SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ? WHERE token = ?`).bind(t, t, token).run();
  }
  return new Response(request.method === "HEAD" ? null : frameAware(await object.text()), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } });
}

// The Menu-made app's site generator screen (app-shell/www/hybrid.js): the designs, the three buttons and what
// Customize holds now, so the app draws its own controls and form. GET /api/website-preview/state/<token>.
async function handleWebsitePreviewState(request, env, token, { now = Date.now() } = {}) {
  if (request.method === "OPTIONS") return preflight();
  const gone = () => json({ ok: false, ended: true, error: `This preview has ended. Free previews last ${PREVIEW_HOURS / 24} days.` }, 410);
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB || !env.ASSETS) return gone();
  const row = await env.DB.prepare(`SELECT status, expires_at FROM website_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return gone();
  const data = parseJsonOrNull(await (await env.ASSETS.get(`website-previews/${token}/data.json`))?.text());
  if (!data?.site || !data?.copy) return gone();
  const site = data.site, copy = data.copy;
  const brand = hexOk(site.brand) ? String(site.brand).toLowerCase() : "";
  const photos = ownPhotoCount(site);
  const text = (name, label, value, extra = {}) => ({ name, type: "text", label, value: value || "", ...extra });
  return json({
    ok: true, kind: "site", business: site.name || "", ends_at: row.expires_at, design: DESIGNS[0].key,
    designs: DESIGNS.map((d) => ({ key: d.key, label: d.label, blurb: d.blurb, url: designUrl(token, d.key), choose_url: chooseUrl(token, d.key) })),
    next_label: "Generate site", choose_label: `Choose this site: ${SITE_FILES_PRICE}`,
    note: `Free preview: ends in ${PREVIEW_HOURS / 24} days.${hasSamplePhotos(site) ? " The photos are samples until you add yours." : ""}`,
    customize: {
      url: `${SITE}/api/website-preview/customize/${token}`, title: "Customize your site", submit: `Update all ${DESIGNS.length} designs`,
      busy: `Updating all ${DESIGNS.length} designs. This can take up to a minute; keep the app open.`, left: Math.max(0, MAX_CUSTOMIZE - Number(data.customized || 0)),
      fields: [
        { group: "Logo and name" },
        { name: "logo", type: "file", label: "Logo", hint: site.logo ? "A new logo replaces the one in use. PNG, JPG or WebP" : "PNG, JPG or WebP", accept: "image/png,image/jpeg,image/webp", measure: true },
        { name: "logo_bg", type: "select", label: "Logo background", hint: "Automatic picks one per design so the logo stands out", value: site.logo_bg || "auto", options: LOGO_MODES.map((m) => [m, { auto: "Automatic", none: "None", light: "Light badge", dark: "Dark badge", accent: "Brand colour badge" }[m] || m]) },
        { name: "hide_name", type: "checkbox", label: "Hide the business name (my logo shows it)", value: site.hide_name === true, off: "0" },
        { group: "Photos and colour" },
        { name: "photos", type: "file", label: "Photos", hint: `${photos ? `${photos} in use; new ones replace them. ` : ""}Up to ${MAX_PHOTOS}, 5 MB each`, accept: "image/png,image/jpeg,image/webp", multiple: true, max_files: MAX_PHOTOS },
        { name: "brand", type: "color", label: "Brand colour", value: brand || "#00a7b5" },
        { name: "use_brand", type: "checkbox", label: "Use this colour", value: Boolean(brand) },
        { group: "Motto and About" },
        text("motto", "Motto", site.motto || copy.tagline, { hint: "The line under your name", max: 80 }),
        { name: "about", type: "textarea", label: "About your business", hint: "Blank line between paragraphs", max: 1500, value: aboutText(site, copy) },
        { group: "Contact details" },
        text("phone", "Phone", site.phone, { input: "tel", max: 30 }),
        text("email", "Email", site.email, { input: "email", hint: "Shown on your Contact page", max: 150 }),
        text("address", "Address", site.address, { max: 150 }),
        { name: "hours", type: "textarea", label: "Hours", hint: "One line per day or group, like Mon-Fri: 8am-3pm", max: 400, value: site.hours || "" },
        { group: "Social and order links" },
        ...SOCIAL_FIELDS.map(([name, label]) => text(name, label, site[name], { input: "url", hint: name === "instagram" || name === "tiktok" ? "Link or @name" : "Link", max: 300 })),
        text("order_url", "Order or booking link", site.order_url, { input: "url", hint: "DoorDash, Toast, OpenTable…", max: 300 }),
        { name: "order_label", type: "select", label: "Button says", value: site.order_label || ORDER_LABELS[0], options: ORDER_LABELS.map((l) => [l, l]) }
      ]
    }
  });
}

// The logo, photos and colour from a "Customize" form, stored beside the preview and set on `site` (in place).
// Also used after payment (site-files/own.js), when the buyer adds them from the link in the delivery email.
async function applyOwnForm(env, token, site, form) {
  const details = applyDetails(site, form);   // text first: a bad link stops the update before any file is stored
  if (details.error) return details;
  const files = (name) => form.getAll(name).filter((f) => f && typeof f === "object" && typeof f.arrayBuffer === "function" && f.size > 0);
  const read = async (file) => {
    if (file.size > MAX_OWN_IMAGE) return { error: `${file.name || "An image"} is over 5 MB.` };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImage(bytes);
    return type ? { bytes, type } : { error: `${file.name || "A file"} isn't a PNG, JPG or WebP image.` };
  };
  const logoFile = files("logo")[0];
  const photoFiles = files("photos");
  if (photoFiles.length > MAX_PHOTOS) return { error: `Choose up to ${MAX_PHOTOS} photos.` };
  const logo = logoFile ? await read(logoFile) : null;
  if (logo?.error) return { error: logo.error };
  const photos = [];
  for (const f of photoFiles) { const r = await read(f); if (r.error) return { error: r.error }; photos.push(r); }
  const put = (name, img) => env.ASSETS.put(`website-previews/${token}/img/${name}.${img.type.ext}`, img.bytes, { httpMetadata: { contentType: img.type.mime } });
  if (logo) {
    await put("logo", logo);
    // The browser's measurement of the logo (Customize; none on the after-purchase page): a JPEG is a solid box.
    const info = parseLogoInfo(form.get("logo_info")) || (logo.type.mime === "image/jpeg" ? { t: 0, l: null, c: null, b: 1 } : null);
    site.logo = { path: `img/logo.${logo.type.ext}`, ...(info ? { info } : {}) };
  }
  if (LOGO_MODES.includes(String(form.get("logo_bg") || ""))) site.logo_bg = String(form.get("logo_bg"));
  if (form.has("hide_name")) site.hide_name = form.getAll("hide_name").includes("1");
  if (photos.length) {
    for (const [i, p] of photos.entries()) await put(`photo-${i + 1}`, p);
    site.photos = photos.map((p, i) => ({ path: `img/photo-${i + 1}.${p.type.ext}`, alt: `Photo ${i + 1} of ${site.name}` }));
  }
  const brand = String(form.get("brand") || "").trim().toLowerCase();
  if (form.get("use_brand") === "1" && hexOk(brand)) site.brand = brand;
  else if (form.get("use_brand") !== "1") site.brand = "";
  return { site };
}

// "Customize": POST multipart { design, logo?, logo_info?, logo_bg?, hide_name?, photos?[], brand?, use_brand? } -> stores the images beside the
// preview, rebuilds all nine designs from the stored copy (no AI call) and returns to the design the buyer was on.
// New photos replace the old set; no new files keeps what was there. The paid site is built from the same data.json.
async function handleWebsitePreviewCustomize(request, env, token, { now = Date.now() } = {}) {
  if (request.method === "OPTIONS") return preflight();
  const app = wantsJson(request);   // the Menu-made app's own Customize form reads the answer; the web form follows the redirect
  const gone = () => app ? json({ ok: false, ended: true, error: "This preview has ended." }, 410) : plainGone(410, "This preview has ended", `<a href="${escapeHtml(`${SITE}/website-design.html#try-free`)}">Start a new one</a>.`);
  const oops = (text) => app ? json({ ok: false, error: text }, 400) : plainGone(400, "That didn't work", `${escapeHtml(text)} <a href="javascript:history.back()">Go back</a> and try again.`);
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB || !env.ASSETS) return gone();
  const row = await env.DB.prepare(`SELECT token, source, status, expires_at FROM website_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return gone();
  const data = parseJsonOrNull(await (await env.ASSETS.get(`website-previews/${token}/data.json`))?.text());
  if (!data?.site || !data?.copy) return gone();
  if (Number(data.customized || 0) >= MAX_CUSTOMIZE) return oops("This preview has been updated as many times as a free preview allows.");
  const form = await request.formData().catch(() => null);
  if (!form) return oops("We couldn't read the upload.");
  const design = DESIGNS.find((d) => d.key === form.get("design")) || DESIGNS[0];
  const site = { ...data.site };
  const applied = await applyOwnForm(env, token, site, form);
  if (applied.error) return oops(applied.error);
  await storeDesigns(env, token, site, data.copy, { prospect: row.source === "prospect", extra: { customized: Number(data.customized || 0) + 1 } });
  if (app) return json({ ok: true, design: design.key });
  return new Response(null, { status: 303, headers: { Location: designUrl(token, design.key), "Cache-Control": "no-store" } });
}

// The logo and photos added with "Customize", served beside each design's pages (img/<name> from any page).
async function handleWebsitePreviewImage(env, token, file, { now = Date.now() } = {}) {
  const m = IMG.exec(file);
  if (!/^[a-f0-9]{36}$/.test(token) || !m || !env.DB || !env.ASSETS) return new Response("Not found", { status: 404 });
  const row = await env.DB.prepare(`SELECT status, expires_at FROM website_previews WHERE token = ?`).bind(token).first();
  if (!row || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return new Response("Not found", { status: 404 });
  const object = await env.ASSETS.get(`website-previews/${token}/img/${file}`);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { status: 200, headers: { "Content-Type": IMG_MIME[m[2]], "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" } });
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

// Previews already emailed to prospects (Nov 10, 2026, owner): pages are frozen when built, so ones made before the
// generator (one design) or before later template changes are rebuilt in place, same token, with today's designs.
// From the stored site and copy when there is one (no AI, keeps anything customized); otherwise from what the
// preview was built from. A few per cron tick; rebuilt_at marks each one done.
async function rebuildProspectSites(env, { now = Date.now(), limit = 4, deps = {} } = {}) {
  if (!env.DB || !env.ASSETS) return [];
  const { results = [] } = await env.DB.prepare(`
      SELECT token, business, facts_json FROM website_previews
      WHERE source = 'prospect' AND status = 'READY' AND rebuilt_at IS NULL AND expires_at > ?
      ORDER BY created_at LIMIT ?`).bind(new Date(now).toISOString(), limit).all();
  const done = [];
  for (const row of results) {
    try {
      const data = parseJsonOrNull(await (await env.ASSETS.get(`website-previews/${row.token}/data.json`))?.text());
      if (data?.site && data?.copy) {
        const { site, copy, ...extra } = data;
        await storeDesigns(env, row.token, site, copy, { prospect: true, extra });
      } else {
        const facts = parseJsonOrNull(row.facts_json) || {};
        await buildAndStore(env, row.token, row.business, facts, { scope: { entityType: "WEBSITE_PREVIEW", entityId: row.token }, prospect: true, deps });
      }
      await env.DB.prepare(`UPDATE website_previews SET rebuilt_at = ? WHERE token = ?`).bind(new Date(now).toISOString(), row.token).run();
      done.push({ token: row.token, ok: true });
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      await env.DB.prepare(`UPDATE website_previews SET rebuilt_at = ?, error = ? WHERE token = ?`).bind(new Date(now).toISOString(), `rebuild: ${reason}`, row.token).run();
      done.push({ token: row.token, ok: false, reason });
    }
  }
  return done;
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

// ---------- One reminder before the preview ends (owner, Nov 7, 2026) ----------
// Same rule as menu previews (public-preview.js runPreviewReminders): one email about 2 days in, 9 am to 7 pm Pacific,
// only with 3+ hours left, never to the owner's inbox, and not when a paid order already uses this preview. Prospect
// demos have their own outreach and are left out. Runs on the half-hour cron tick (the menu one runs on the hour), up
// to 10 previews a tick, so the two never share a tick's D1 budget.
const REMINDER_AFTER_HOURS = 46;
const REMINDER_MIN_LEFT_HOURS = 3;
const pacificHour = (ms) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles" }).format(new Date(ms)));
const endsText = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

async function runWebsitePreviewReminders(env, { now = Date.now(), force = false } = {}) {
  if (!env.DB) return [];
  const minute = new Date(now).getUTCMinutes();
  if (!force && (minute < 30 || minute >= 35 || pacificHour(now) < 9 || pacificHour(now) >= 19)) return [];
  const { results = [] } = await env.DB.prepare(`
      SELECT token, email, business, expires_at FROM website_previews
      WHERE status = 'READY' AND source IN ('public', 'rep') AND reminder_sent_at IS NULL AND created_at <= ? AND expires_at > ?
      ORDER BY created_at ASC LIMIT 10
    `).bind(new Date(now - REMINDER_AFTER_HOURS * 3600000).toISOString(), new Date(now + REMINDER_MIN_LEFT_HOURS * 3600000).toISOString()).all();
  const owner = String(ownerEmailAddress(env) || "").toLowerCase();
  const sent = [];
  for (const row of results) {
    const mark = () => env.DB.prepare(`UPDATE website_previews SET reminder_sent_at = ? WHERE token = ?`).bind(new Date(now).toISOString(), row.token).run();
    const email = String(row.email || "").trim().toLowerCase();
    // Already bought from this preview (checkout stores site_preview on the order item): nothing to remind about.
    const ordered = await env.DB.prepare(`SELECT 1 AS x FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.metadata_json LIKE ? AND o.payment_status = 'PAID' LIMIT 1`)
      .bind(`%"site_preview":"${row.token}"%`).first().catch(() => null);
    if (!email || email === owner || ordered) { await mark(); continue; }
    const url = viewUrl(row.token);
    const ends = endsText(row.expires_at);
    const result = await sendTransactionalEmail(env, {
      to: email,
      subject: `Your website preview ends ${ends}`,
      html: brandedEmailHtml({
        preheader: `${DESIGNS.length} designs of your website, free until ${ends}.`,
        eyebrow: "YOUR WEBSITE",
        heading: `${row.business}'s website preview ends soon`,
        paragraphs: [
          `Your free website preview ends <strong>${escapeHtml(ends)}</strong> (Pacific time).`,
          `Haven't picked a design yet? Tap <strong>Generate site</strong> to see all ${DESIGNS.length}, and <strong>Customize</strong> to add your logo, photos, colour and details.`,
          `When one looks right, tap <strong>Choose this site</strong>: ${SITE_FILES_PRICE} for the whole site as files you own, or add Website Care and we host it for you.`
        ],
        buttons: [{ label: "See my website designs", url, primary: true }],
        footnote: "This is the only reminder we'll send about this preview."
      }),
      text: `Your website preview ends ${ends} (Pacific).\nSee all ${DESIGNS.length} designs: ${url}\nTap Choose this site (${SITE_FILES_PRICE}) on the one you want.\nThis is the only reminder about this preview.`,
      idempotencyKey: `website-preview-reminder/${row.token}`, purpose: "WEBSITE_PREVIEW", templateKey: "website_preview_reminder_v1"
    }).catch((error) => ({ ok: false, error }));
    if (result?.ok) { await mark(); sent.push(row.token); }
  }
  return sent;
}

export { runWebsitePreviewReminders, rebuildProspectSites, detailFields, hideNameField, designUrl, chooseUrl, wrapDesign, storeDesigns, handleWebsitePreviewCreate, handleWebsitePreviewView, handleWebsitePreviewState, handleWebsitePreviewHandoff, handleWebsitePreviewCustomize, handleWebsitePreviewImage, applyOwnForm, MAX_PHOTOS, handleProspectSiteDemo, prefillFromPreview, offeringsFromMenu, wrapPage, fallbackCopy, PREVIEW_HOURS, PER_NETWORK_DAY };
