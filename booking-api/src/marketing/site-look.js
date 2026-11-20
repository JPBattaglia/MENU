// A business's own look from its current website (owner, Nov 19, 2026: "yes" to pulling the logo, photos and details
// into the website generator), so a walk-in owner sees a new site that already looks like theirs, not a template.
//
//   findSiteLook(url, env, { fetcher }) -> { logo, photos, brand, links } (any part may be empty), never throws
//     logo    { bytes, type: "image/png"|"image/jpeg"|"image/webp" }   the site's header logo (an SVG one is drawn to PNG
//                                                                       by Browser Run)
//     photos  [{ bytes, type, w, h }]   up to MAX_PHOTOS of their own food, drink, room and storefront photos, best first;
//                                       one quick claude-haiku-5-5 look (a fraction of a cent) keeps out menus, logos,
//                                       text graphics, maps and icons
//     brand   "#rrggbb" | ""           <meta name="theme-color">, when it isn't white, black or grey
//     links   { instagram, facebook, tiktok, yelp, order_url }   found on the page
// Phone, address, hours and the About text already come from the same website (website-preview.js factsFromWebsite).
import { get, readCapped, sniff, photoSize, browser, toBase64, scanPage, attr, decode, checkUrl, pageText } from "./menu-link.js";

const MAX_PHOTOS = 6;
const MAX_CANDIDATES = 10;
const MAX_IMAGE = 5 * 1024 * 1024;
const MIN_PHOTO_SIDE = 700;
const MAX_HTML = 3 * 1024 * 1024;
const CHECK_MODEL = "claude-haiku-5-5";
// Logos of other companies that sit on restaurant sites: never the restaurant's own.
const NOT_THEIRS = /(menu-?made|opentable|resy|yelp|tripadvisor|doordash|ubereats|grubhub|toast|squarespace|wix|godaddy|google|apple|visa|mastercard|amex|paypal|facebook|instagram|twitter|tiktok|michelin|zagat|eater|userway|accessibe)/i;
const ORDER_HOSTS = /(toasttab\.com|order\.online|doordash\.com|ubereats\.com|grubhub\.com|opentable\.com|resy\.com|exploretock\.com|tock\.com|chownow\.com|square\.site|squareup\.com|clover\.com|slicelife\.com|sevenrooms\.com|yelp\.com\/reservations)/i;

async function pageHtml(url, env, fetcher) {
  try {
    const response = await get(url, fetcher, "text/html");
    if (response.ok && /text\/html/i.test(response.headers.get("content-type") || "")) {
      const html = new TextDecoder().decode(await readCapped(response, MAX_HTML));
      // A page drawn by JavaScript has next to nothing in it before it runs.
      if (pageText(html).length >= 200 || /<img\b/i.test(html)) return { html, url: new URL(response.url || url.toString()) };
    }
  } catch { /* try the browser */ }
  const rendered = await browser(env, "content", { url: url.toString(), gotoOptions: { waitUntil: "networkidle2", timeout: 20000 } });
  return rendered ? { html: rendered, url } : null;
}

// ---------- the logo ----------
function logoCandidates(html, base) {
  const abs = (href) => { try { const u = new URL(decode(href).trim(), base); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };
  const out = [];
  const add = (href, score) => { const u = href && !href.startsWith("data:") ? abs(href) : null; if (u && !NOT_THEIRS.test(u.pathname.split("/").pop() || "")) out.push({ url: u, score }); };
  const header = (/<header\b[\s\S]*?<\/header>/i.exec(html) || [""])[0];
  for (const [chunk, bonus] of [[header, 4], [html, 0]]) {
    // Partner names are judged on the file name, alt text and class, never the host (Squarespace and Wix serve
    // every client's own logo from their CDN).
    const own = (tag) => `${(attr(tag, "data-src") || attr(tag, "src")).split("?")[0].split("/").pop()} ${attr(tag, "alt")} ${attr(tag, "class")} ${attr(tag, "id")}`;
    for (const m of chunk.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const words = own(tag);
      if (!/logo/i.test(words) || NOT_THEIRS.test(words)) continue;
      add(attr(tag, "data-src") || attr(tag, "src") || (attr(tag, "srcset").split(/\s+/)[0]), 10 + bonus);
    }
    // <a class="logo"><img ...> or <div class="site-logo">...<img>
    for (const m of chunk.matchAll(/<[a-z]+[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>\s*(?:<a\b[^>]*>\s*)?(?:<picture>\s*(?:<source[^>]*>\s*)*)?(<img\b[^>]*>)/gi)) {
      if (!NOT_THEIRS.test(own(m[1]))) add(attr(m[1], "data-src") || attr(m[1], "src"), 9 + bonus);
    }
  }
  // Shared-link images (og:image and friends) named as the logo.
  for (const m of html.matchAll(/<(?:meta|link)\b[^>]*(?:og:image|twitter:image|itemprop=["']image|image_src)[^>]*>/gi)) {
    const href = attr(m[0], "content") || attr(m[0], "href");
    if (/logo/i.test(href.split("?")[0].split("/").pop() || "")) add(href, 7);
  }
  for (const m of html.matchAll(/"logo"\s*:\s*(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/g)) add(m[1].replace(/\\\//g, "/"), 8); // JSON-LD
  for (const m of html.matchAll(/<link\b[^>]*rel=["'][^"']*(apple-touch-icon|icon)[^"']*["'][^>]*>/gi)) {
    const size = Number((attr(m[0], "sizes").match(/\d+/) || [0])[0]);
    if (size >= 180 || m[1].startsWith("apple")) add(attr(m[0], "href"), 2);
  }
  const seen = new Set();
  return out.sort((a, b) => b.score - a.score).filter((c) => !seen.has(c.url.toString()) && seen.add(c.url.toString()));
}

async function svgToPng(bytes, env) {
  const svg = new TextDecoder().decode(bytes);
  if (!/<svg[\s>]/i.test(svg)) return null;
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block;height:320px;width:auto}</style></head><body><img src="data:image/svg+xml;base64,${toBase64(bytes)}"></body></html>`;
  const png = await browser(env, "screenshot", { html, selector: "img", screenshotOptions: { omitBackground: true, type: "png" } });
  return png && sniff(png) === "image/png" ? png : null;
}

async function findLogo(html, base, env, fetcher) {
  for (const c of logoCandidates(html, base).slice(0, 4)) {
    try {
      const response = await get(c.url, fetcher, "image/png,image/webp,image/jpeg,image/svg+xml,*/*;q=0.5");
      if (!response.ok) continue;
      let bytes = await readCapped(response, MAX_IMAGE);
      let type = sniff(bytes);
      if (!type && (/svg/i.test(response.headers.get("content-type") || "") || /\.svg(\?|$)/i.test(c.url.pathname))) {
        bytes = await svgToPng(bytes, env); type = bytes ? "image/png" : null;
      }
      if (!type || type === "application/pdf") continue;
      const { w, h } = photoSize(bytes, type);
      if (Math.max(w, h) < 64 || Math.max(w, h) > 4000) continue;
      return { bytes, type };
    } catch { /* next */ }
  }
  return null;
}

// ---------- their photos ----------
async function findPhotos(htmls, env, fetcher, logo) {
  const seen = new Set(); const candidates = [];
  for (const { html, url } of htmls) {
    for (const p of scanPage(html, url).photos) {
      const key = p.url.toString();
      // A photo that calls itself the menu (menu-link.js scores those 10+) is the menu, not a picture of the place.
      if (seen.has(key) || p.score >= 10 || /logo/i.test(key) || NOT_THEIRS.test(p.url.pathname.split("/").pop() || "")) continue;
      seen.add(key); candidates.push(p);
    }
  }
  const kept = [];
  for (const c of candidates) {
    if (kept.length >= MAX_CANDIDATES) break;
    try {
      const response = await get(c.url, fetcher, "image/webp,image/jpeg,image/png,*/*;q=0.5");
      if (!response.ok) { console.log(`site look photo ${response.status}: ${c.url.hostname}`); continue; }
      const bytes = await readCapped(response, MAX_IMAGE);
      const type = sniff(bytes);
      if (!type || type === "application/pdf") continue;
      const { w, h } = photoSize(bytes, type);
      if (Math.max(w, h) < MIN_PHOTO_SIDE || Math.min(w, h) < 400 || bytes.length < 30000) continue;
      if (kept.some((k) => k.bytes.length === bytes.length) || (logo && logo.bytes.length === bytes.length)) continue;
      // The check request stays well under the API's 32 MB (base64 adds a third).
      if (kept.reduce((n, k) => n + k.bytes.length, 0) + bytes.length > 18 * 1024 * 1024) break;
      kept.push({ bytes, type, w, h });
    } catch (error) { console.log(`site look photo skipped: ${error instanceof Error ? error.message : error}`); }
  }
  console.log(`site look photos: ${candidates.length} candidates, ${kept.length} big enough`);
  if (!kept.length || !env?.ANTHROPIC_API_KEY) return [];
  try {
    const content = [];
    kept.forEach((p, i) => { content.push({ type: "text", text: `Image ${i + 1}:` }); content.push({ type: "image", source: { type: "base64", media_type: p.type, data: toBase64(p.bytes) } }); });
    content.push({ type: "text", text: "These images are from a restaurant's own website. Which would work as photos on its new website: its food, drinks, dining room, bar, kitchen, team or storefront? Leave out menus, logos, graphics with words on them, maps, screenshots, icons and blurry or tiny-looking images. Answer with the image numbers that work, best first (the best one will be the big photo at the top), comma-separated, or NONE." });
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.MENU_CHECK_MODEL || CHECK_MODEL, max_tokens: 40, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`photo check answered ${response.status}`);
    const answer = ((await response.json())?.content || []).map((c) => c.text || "").join(" ");
    const order = [...new Set((answer.match(/\d+/g) || []).map(Number))].filter((n) => n >= 1 && n <= kept.length);
    console.log(`site look photo check: "${answer.trim().slice(0, 60)}"`);
    return order.slice(0, MAX_PHOTOS).map((n) => kept[n - 1]);
  } catch (error) {
    console.warn("site photo check", error instanceof Error ? error.message : String(error));
    return [];
  }
}

// ---------- colour and links ----------
function brandColor(html) {
  const m = /<meta[^>]+name=["']theme-color["'][^>]*>/i.exec(html);
  const value = m ? attr(m[0], "content").trim().toLowerCase() : "";
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(value) ? (value.length === 4 ? `#${[...value.slice(1)].map((c) => c + c).join("")}` : value) : "";
  if (!hex) return "";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 24 ? "" : hex; // white, black and greys say nothing about a brand
}

function findLinks(html, base) {
  const links = {};
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(decode(m[1]), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    if (!links.instagram && host === "instagram.com" && /^\/[A-Za-z0-9._]{2,30}$/.test(path) && !/^\/(p|explore|reel|accounts)$/.test(path)) links.instagram = `https://www.instagram.com${path}/`;
    else if (!links.facebook && /(^|\.)facebook\.com$/.test(host) && path.length > 1 && !/sharer|share\.php|dialog|plugins/.test(u.pathname)) links.facebook = `https://www.facebook.com${path}`;
    else if (!links.tiktok && host === "tiktok.com" && /^\/@[A-Za-z0-9._]{2,30}$/.test(path)) links.tiktok = `https://www.tiktok.com${path}`;
    else if (!links.yelp && host === "yelp.com" && path.startsWith("/biz/")) links.yelp = `https://www.yelp.com${path}`;
    else if (!links.order_url && path.length > 1 && ORDER_HOSTS.test(`${host}${u.pathname}`)) {
      links.order_url = u.toString();
      links.order_label = /opentable|resy|tock|sevenrooms|reservations/i.test(host + u.pathname) ? "Book a table" : "Order online";
    }
  }
  return links;
}

async function findSiteLook(raw, env, { fetcher = fetch } = {}) {
  const empty = { logo: null, photos: [], brand: "", links: {} };
  let start;
  try { start = checkUrl(raw); } catch { return empty; }
  try {
    const home = await pageHtml(start, env, fetcher);
    if (!home) return empty;
    const pages = [home];
    // A gallery or about page usually has more of their own photos than the home page.
    const more = [...home.html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)]
      .map((m) => { try { return { url: new URL(decode(m[1]), home.url), words: m[2].replace(/<[^>]+>/g, " ") }; } catch { return null; } })
      .find((l) => l && l.url.origin === home.url.origin && /gallery|photos|our space|about/i.test(`${l.words} ${l.url.pathname}`));
    if (more) { const page = await pageHtml(more.url, env, fetcher); if (page) pages.push(page); }
    const logo = await findLogo(home.html, home.url, env, fetcher);
    const photos = await findPhotos(pages, env, fetcher, logo);
    return { logo, photos, brand: brandColor(home.html), links: findLinks(home.html, home.url) };
  } catch (error) {
    console.warn("site look", error instanceof Error ? error.message : String(error));
    return empty;
  }
}

export { findSiteLook, logoCandidates, brandColor, findLinks };
