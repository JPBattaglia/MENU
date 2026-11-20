// A menu from a link instead of a file (owner, Nov 19, 2026: "is there a way that a current website can be entered
// for the menu ... rather than always uploading a pdf or image"; "the photo inside a page will likely be frequent").
//
//   POST /api/menu-preview/link  { url }  -> the menu as a file (PDF or photo), or { ok:false, error }
//
// The site and the app turn the answer into the same file an owner would have chosen, and carry on exactly as with
// an upload (/api/inquiry, then /create), so limits, "same menu again", and the file attached at checkout all work
// unchanged. findMenuAtLink is also what the prospect emails use when a menu page has no menu text of its own.
//
// What a link can be, and what comes back:
//   - a PDF or a photo                      -> that file
//   - a page whose text is the menu         -> the page printed to PDF by Browser Run (text menus print as they look)
//   - a page that shows the menu as photos  -> the photos themselves at full size (one photo as is; several put
//     (Squarespace/Wix/WordPress galleries)    together as one PDF, a page each)
//   - a page that links to a menu PDF       -> that PDF
//   - a home page                           -> its "Menu" link is followed (one step) and read the same way
//   - a page drawn by JavaScript (Toast, Square, BentoBox...) -> read again as Browser Run sees it after loading
// Running cost: plain fetches are free; when a page shows big photos, one small-model look (a fraction of a cent)
// picks which are the menu; Browser Run (Workers Paid includes 10 browser hours a month) is used only to
// print a text menu, to put several photos together, or for a JavaScript page, a few seconds each. The AI read
// afterwards is the same one an uploaded file gets.
import { PDFDocument } from "pdf-lib";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // what /api/inquiry takes for a photo
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_PHOTOS = 6;
const MIN_PHOTO_SIDE = 500; // a menu photo is big; icons, logos and thumbnails are not
const MIN_PRICES = 6; // a page with this many prices on it is a text menu
const FETCH_TIMEOUT_MS = 12000;
const BROWSER_TIMEOUT_MS = 25000;
const LINKS_PER_HOUR = 30;
const UA = "Mozilla/5.0 (compatible; Menu-Made/1.0; +https://menu-made.com)";
const ORIGINS = new Set(["https://menu-made.com", "https://www.menu-made.com", "capacitor://localhost", "https://localhost"]);
const PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

class LinkError extends Error {}

// ---------- the address ----------
function checkUrl(raw) {
  let text = String(raw || "").trim();
  if (text && !/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`; // "joescafe.com/menu" works too
  let url;
  try { url = new URL(text); } catch { throw new LinkError("That doesn't look like a web address. Paste the whole link, like https://yourplace.com/menu."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkError("Paste a web address that starts with https://.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") || host === "localhost" || /\.(local|internal|localhost|lan|home)$/.test(host)
    || /^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^(::1?|f[cd][0-9a-f]{2}:|fe80:)/.test(host) || /^\d+$/.test(host)) {
    throw new LinkError("That address isn't a public website.");
  }
  url.hash = "";
  return url;
}

async function get(url, fetcher, accept) {
  checkUrl(url.toString());
  const response = await fetcher(url.toString(), {
    headers: { "User-Agent": UA, Accept: accept || "text/html,application/pdf,image/*;q=0.9,*/*;q=0.5" },
    redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  return response;
}

async function readCapped(response, cap) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > cap) throw new LinkError("too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > cap) throw new LinkError("too large");
  return bytes;
}

// ---------- what the bytes are ----------
function sniff(bytes) {
  const s = (i, list) => list.every((v, k) => bytes[i + k] === v);
  if (s(0, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (s(0, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (s(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (s(0, [0x52, 0x49, 0x46, 0x46]) && s(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

// Width and height from the file's header (PNG, JPEG, WebP), so logos and thumbnails are skipped without decoding.
function photoSize(bytes, type) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (type === "image/png") return { w: dv.getUint32(16), h: dv.getUint32(20) };
    if (type === "image/webp") {
      const kind = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      if (kind === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
      if (kind === "VP8L") { const b = dv.getUint32(21, true); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (kind === "VP8X") return { w: 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16), h: 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16) };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
        i += 2 + dv.getUint16(i + 2);
      }
    }
  } catch { /* fall through */ }
  return { w: 0, h: 0 };
}

// ---------- reading a page ----------
const decode = (text) => String(text || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x2F;/gi, "/").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag); return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : ""; };

function pageText(html) {
  return decode(String(html)
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")).replace(/&nbsp;|&#160;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

// Prices on a page: "$12", "12.50", and the bare "18" many menus end a dish line with ("Roast chicken for two 64").
const priceCount = (text) => {
  const marked = (String(text).match(/(^|[\s(])(\$\s?\d{1,3}(\.\d{2})?|\d{1,3}\.\d{2})(?=$|[\s),])/gm) || []).length;
  const bare = String(text).split("\n").filter((line) => /[a-z]{3}/i.test(line) && /[a-z.)]\s*[-–|·.]*\s*\$?\d{1,3}(\.\d{1,2})?\s*$/i.test(line.trim()) && !/\b(suite|ste|no|unit|apt|floor|#)\s*\d+\s*$/i.test(line.trim())).length;
  // A page of prose with a few numbers at line ends isn't a menu: bare prices must be a fair share of the lines.
  const lines = String(text).split("\n").filter((line) => line.trim()).length || 1;
  return Math.max(marked, bare / lines >= 0.15 ? bare : 0);
};
const menuWord = /\b(menus?|carta|speisekarte|menú|menù|drinks?|food|dinner|lunch|brunch|breakfast|dessert|wine|cocktails?|happy[\s-]?hour|specials?)\b/i;
const strongMenuWord = /menu|menú|menù|carta|speisekarte/i;
const notMenuPhoto = /(logo|icon|favicon|sprite|avatar|badge|banner-ad|placeholder|spinner|loader|pixel|tracking|emoji|social|facebook|instagram|twitter|tiktok|yelp|google|apple|play-store|app-store|payment|visa|mastercard|award|map)/i;

// Every address a page offers: menu PDFs, photos (with any menu hint around them), and links that sound like a menu.
function scanPage(html, base) {
  const abs = (href) => { try { const u = new URL(decode(href).trim(), base); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };
  const pdfs = []; const photos = new Map(); const links = [];
  const addPhoto = (href, hint, size = 0) => {
    const u = abs(href); if (!u || /\.(svg|gif|ico)(\?|$)/i.test(u.pathname)) return;
    const key = u.toString(); const s = `${key} ${hint}`;
    if (notMenuPhoto.test(u.pathname.split("/").pop() || "") && !strongMenuWord.test(s)) return;
    const score = (strongMenuWord.test(s) ? 10 : 0) + (menuWord.test(s) ? 2 : 0) + Math.min(size, 4000) / 1000;
    photos.set(key, Math.max(photos.get(key) ?? -1, score));
  };
  const bestFromSrcset = (set) => {
    let best = ""; let width = 0;
    for (const part of String(set).split(/,\s+(?=\S)/)) {
      const [src, d] = part.trim().split(/\s+/); const n = parseFloat(d) || 1;
      if (n >= width) { width = n; best = src; }
    }
    return { best, width };
  };
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = m[0].slice(0, m[0].indexOf(">") + 1); const href = attr(tag, "href"); if (!href || /^(mailto|tel|javascript):/i.test(href)) continue;
    const u = abs(href); if (!u) continue;
    if (u.hash && u.origin === base.origin && u.pathname === base.pathname && u.search === base.search) continue; // this same page
    u.hash = "";
    const words = `${pageText(m[1])} ${attr(tag, "title")} ${attr(tag, "aria-label")}`.trim();
    if (/\.pdf(\?|$)/i.test(u.pathname)) pdfs.push({ url: u, score: (strongMenuWord.test(`${u} ${words}`) ? 10 : 0) + (menuWord.test(`${u} ${words}`) ? 2 : 0) });
    else if (/\.(jpe?g|png|webp)(\?|$)/i.test(u.pathname)) addPhoto(href, words, 0);
    else if (strongMenuWord.test(words) || strongMenuWord.test(u.pathname)) links.push({ url: u, score: (strongMenuWord.test(words) ? 5 : 0) + (strongMenuWord.test(u.pathname) ? 3 : 0) + (/order|cart|delivery|doordash|ubereats|grubhub/i.test(`${u} ${words}`) ? -4 : 0) });
  }
  for (const m of html.matchAll(/<(img|source)\b[^>]*>/gi)) {
    const tag = m[0];
    const hint = `${attr(tag, "alt")} ${attr(tag, "title")} ${attr(tag, "data-image-caption")} ${attr(tag, "class")}`;
    const declared = Math.max(Number(attr(tag, "width")) || 0, Number(attr(tag, "data-image-dimensions").split("x")[0]) || 0);
    if (declared && declared < 200 && !/data-src|srcset/i.test(tag)) continue;
    const set = attr(tag, "srcset") || attr(tag, "data-srcset");
    if (set) { const { best, width } = bestFromSrcset(set); if (best) addPhoto(best, hint, width > 10 ? width : declared); }
    for (const name of ["data-src", "data-image", "data-lazy-src", "data-original", "data-full-src", "src"]) {
      const v = attr(tag, name); if (v && !v.startsWith("data:")) { addPhoto(v.replace(/\?format=\d+w$/, "?format=2500w"), hint, declared); break; }
    }
  }
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+\.(?:jpe?g|png|webp)[^'")]*)['"]?\s*\)/gi)) addPhoto(m[1], "", 0);
  const og = /<meta[^>]+property=["']og:image["'][^>]*>/i.exec(html); if (og) addPhoto(attr(og[0], "content"), "og", 0);
  for (const m of html.matchAll(/"(https?:\\?\/\\?\/[^"]+\.(?:jpe?g|png|webp|pdf)(?:\?[^"]*)?)"/gi)) { // JSON in the page (Wix, Toast)
    const href = m[1].replace(/\\\//g, "/");
    if (/\.pdf/i.test(href)) { const u = abs(href); if (u && strongMenuWord.test(href)) pdfs.push({ url: u, score: 8 }); }
    else if (strongMenuWord.test(href)) addPhoto(href, "", 0);
  }
  const seen = new Set();
  const uniq = (list) => list.filter((x) => { const k = x.url.toString(); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.score - a.score);
  return {
    pdfs: uniq(pdfs),
    photos: [...photos.entries()].map(([url, score]) => ({ url: new URL(url), score })).sort((a, b) => b.score - a.score),
    links: uniq(links).filter((l) => l.url.toString() !== base.toString() && l.score > 0)
  };
}

// ---------- Browser Run ----------
async function browser(env, action, options) {
  if (typeof env?.BROWSER?.quickAction !== "function") return null;
  try {
    const response = await Promise.race([
      env.BROWSER.quickAction(action, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error("browser timed out")), BROWSER_TIMEOUT_MS))
    ]);
    if (!response?.ok) return null;
    if (action === "content") {
      const text = await response.text();
      try { const j = JSON.parse(text); return typeof j?.result === "string" ? j.result : null; } catch { return text; }
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return sniff(bytes) ? bytes : null;
  } catch (error) {
    console.warn("menu link browser", action, error instanceof Error ? error.message : String(error));
    return null;
  }
}

// ---------- the menu's photos ----------
async function fetchPhotos(candidates, fetcher, { needHint }) {
  const kept = [];
  for (const c of candidates.slice(0, MAX_PHOTOS * 3)) {
    if (kept.length >= MAX_PHOTOS) break;
    if (needHint && c.score < 2) continue;
    try {
      const response = await get(c.url, fetcher, "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.5");
      if (!response.ok) continue;
      const bytes = await readCapped(response, MAX_FILE_BYTES);
      const type = sniff(bytes); if (!type || type === "application/pdf") continue;
      const { w, h } = photoSize(bytes, type);
      if (Math.max(w, h) < MIN_PHOTO_SIDE || Math.min(w, h) < 300 || bytes.length < 25000) continue;
      // A wide, short picture is a banner or a food shot more often than a menu, unless it says it's the menu.
      if (c.score < 10 && w > h * 2.2) continue;
      if (kept.some((k) => k.bytes.length === bytes.length)) continue; // the same photo at another address
      kept.push({ bytes, type, w, h, url: c.url, score: c.score });
    } catch { /* skip this one */ }
  }
  // A strong "menu" photo beats food pictures that happened to be bigger.
  const strong = kept.filter((k) => k.score >= 10);
  return strong.length ? strong : kept;
}

// Which of the page's big photos are the menu and which are food, the room or the team (owner's live test, Nov 19,
// 2026: a chicken photo and a grilled cheese came back as "the menu"). One quick look by a small model at all of them
// together (a fraction of a cent); without a key, only photos that call themselves the menu are kept.
const CHECK_MODEL = "claude-haiku-5-5";
async function menuPhotosOnly(photos, env) {
  if (!photos.length) return photos;
  const fit = photos.filter((p) => p.bytes.length <= MAX_PHOTO_BYTES);
  if (!env?.ANTHROPIC_API_KEY || !fit.length) return photos.filter((p) => p.score >= 10);
  try {
    const content = [];
    fit.forEach((p, i) => { content.push({ type: "text", text: `Image ${i + 1}:` }); content.push({ type: "image", source: { type: "base64", media_type: p.type, data: toBase64(p.bytes) } }); });
    content.push({ type: "text", text: "Which of these images show a restaurant or cafe MENU: a printed or written list of dishes or drinks you could order from, usually with prices (a menu board counts)? Photos of food, drinks, rooms, people or logos are not menus. Answer with only the image numbers that are menus, comma-separated, or NONE." });
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.MENU_CHECK_MODEL || CHECK_MODEL, max_tokens: 1024, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`check answered ${response.status}`);
    const reply = await response.json();
    const answer = (reply?.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join(" ");
    if (!answer.trim()) console.warn(`photo check: no answer (stop: ${reply?.stop_reason}, blocks: ${(reply?.content || []).map((c) => c.type).join(",")})`);
    const keep = new Set((answer.match(/\d+/g) || []).map(Number));
    return fit.filter((p, i) => keep.has(i + 1)).map((p) => ({ ...p, checked: true }));
  } catch (error) {
    console.warn("menu photo check", error instanceof Error ? error.message : String(error));
    return photos.filter((p) => p.score >= 10);
  }
}

async function photosAsFile(photos, env, name) {
  if (photos.length === 1 && photos[0].bytes.length <= MAX_PHOTO_BYTES) {
    const p = photos[0];
    return { bytes: p.bytes, contentType: p.type, name: `${name}.${{ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[p.type]}` };
  }
  // Several photos (or one too big to send as a photo): one PDF, a page per photo, at the photo's own size.
  const pdf = await PDFDocument.create();
  const webp = [];
  for (const p of photos) {
    if (p.type === "image/webp") { webp.push(p); continue; }
    const image = p.type === "image/png" ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const page = pdf.addPage([image.width * scale, image.height * scale]);
    page.drawImage(image, { x: 0, y: 0, width: image.width * scale, height: image.height * scale });
  }
  if (webp.length) {
    // pdf-lib can't draw WebP, so a browser prints those pages.
    const html = `<!doctype html><html><head><style>@page{margin:0}body{margin:0}img{display:block;width:100%;page-break-after:always}</style></head><body>${
      webp.map((p) => `<img src="data:${p.type};base64,${toBase64(p.bytes)}">`).join("")}</body></html>`;
    const printed = await browser(env, "pdf", { html, pdfOptions: { printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } } });
    if (printed) {
      const other = await PDFDocument.load(printed);
      for (const page of await pdf.copyPages(other, other.getPageIndices())) pdf.addPage(page);
    } else if (!pdf.getPageCount()) {
      const p = webp[0];
      return { bytes: p.bytes, contentType: p.type, name: `${name}.webp` };
    }
  }
  const bytes = await pdf.save();
  if (bytes.length > MAX_FILE_BYTES) throw new LinkError("too large");
  return { bytes, contentType: "application/pdf", name: `${name}.pdf` };
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

const fileName = (url) => (url.hostname.replace(/^www\./, "").split(".")[0] || "menu").replace(/[^a-z0-9-]/gi, "").slice(0, 40) + "-menu";

// ---------- the whole search ----------
// Returns { bytes, contentType, name, from } or throws LinkError with words a restaurant owner can act on.
async function findMenuAtLink(raw, env, { fetcher = fetch } = {}) {
  const start = checkUrl(raw);
  const name = fileName(start);
  const tried = new Set();
  let reason = "We couldn't find a menu at that link.";

  async function readPage(url, depth) {
    if (tried.has(url.toString()) || tried.size >= 5) return null;
    tried.add(url.toString());
    let response;
    try { response = await get(url, fetcher); } catch (error) {
      if (error instanceof LinkError) throw error;
      reason = "That website didn't answer. Check the link, or upload a photo or PDF of the menu instead."; return null;
    }
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      // Some sites turn away anything that isn't a browser; Browser Run is one.
      const rendered = await browser(env, "content", { url: url.toString(), gotoOptions: { waitUntil: "networkidle2", timeout: 20000 } });
      if (rendered && rendered.length > 500) {
        const found = await fromHtml(rendered, url, depth, true);
        if (found) return found;
      }
    }
    if (!response.ok) {
      reason = [401, 403, 406, 429, 503].includes(response.status)
        ? "That website doesn't let other sites read its pages. Upload a photo or PDF of the menu instead."
        : `That link answered "${response.status}" (page not found or not public). Check the link, or upload a photo or PDF instead.`;
      return null;
    }
    const finalUrl = (() => { try { return new URL(response.url || url.toString()); } catch { return url; } })();
    const declaredType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (declaredType === "application/pdf" || PHOTO_TYPES.has(declaredType) || /\.(pdf|jpe?g|png|webp)(\?|$)/i.test(finalUrl.pathname)) {
      let bytes;
      try { bytes = await readCapped(response, MAX_FILE_BYTES); } catch { reason = "That menu file is over 20 MB. Upload a smaller copy instead."; return null; }
      const type = sniff(bytes);
      if (type === "application/pdf") return { bytes, contentType: type, name: `${name}.pdf`, from: "pdf" };
      if (type) return { ...(await photosAsFile([{ bytes, type, ...photoSize(bytes, type), score: 10 }], env, name)), from: "photo" };
    }
    let html;
    try { html = new TextDecoder().decode(await readCapped(response, MAX_HTML_BYTES)); } catch { return null; }
    const found = await fromHtml(html, finalUrl, depth, false);
    if (found) return found;
    // Little or nothing in the raw page: it's drawn by JavaScript, so read it as a browser sees it once loaded.
    const rendered = await browser(env, "content", { url: finalUrl.toString(), gotoOptions: { waitUntil: "networkidle2", timeout: 20000 } });
    if (rendered && rendered.length > html.length * 0.8) return fromHtml(rendered, finalUrl, depth, true);
    return null;
  }

  // The page's words, printed clean: a print of the page itself carries cookie banners and pop-ups over the menu.
  async function printText(text, url, from) {
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:12pt/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans CJK SC",sans-serif;margin:36px 46px;color:#111}p{margin:0 0 3px}</style></head><body>${
      text.split("\n").map((line) => `<p>${esc(line.trim()) || "&nbsp;"}</p>`).join("")}</body></html>`;
    const printed = await browser(env, "pdf", { html, pdfOptions: { printBackground: false, format: "letter" } });
    if (printed && printed.length <= MAX_FILE_BYTES) return { bytes: printed, contentType: "application/pdf", name: `${name}.pdf`, from };
    return { bytes: await textPdf(text, url), contentType: "application/pdf", name: `${name}.pdf`, from: "text" };
  }

  async function fromHtml(html, url, depth, rendered) {
    const text = pageText(html);
    const prices = priceCount(text);
    const scan = scanPage(html, url);
    const isMenuPage = depth > 0 || strongMenuWord.test(`${url.pathname} ${url.search} ${(/<title>([^<]*)/i.exec(html) || [])[1] || ""}`);
    // 1. The page's own text is the menu (prices on it): printed clean.
    if (prices >= MIN_PRICES) return printText(text, url, "page");
    // 2. A menu PDF linked from the page.
    for (const p of scan.pdfs.filter((x) => x.score > 0 || isMenuPage).slice(0, 3)) {
      try {
        const response = await get(p.url, fetcher, "application/pdf");
        if (!response.ok) continue;
        const bytes = await readCapped(response, MAX_FILE_BYTES);
        if (sniff(bytes) === "application/pdf") return { bytes, contentType: "application/pdf", name: `${name}.pdf`, from: "linked pdf" };
      } catch { /* next */ }
    }
    // 3. The menu shown as photos in the page. On a menu page any big picture counts; elsewhere only one that says
    //    it's the menu (its file name, alt text or caption), so food photos on a home page aren't taken for a menu.
    const photos = await menuPhotosOnly(await fetchPhotos(scan.photos, fetcher, { needHint: !isMenuPage }), env);
    if (photos.length && (isMenuPage || photos.some((p) => p.score >= 10 || p.checked))) return { ...(await photosAsFile(photos, env, name)), from: "photos" };
    // 4. A home page: follow its "Menu" link once.
    if (depth === 0) {
      for (const link of scan.links.slice(0, 3)) {
        const found = await readPage(link.url, 1);
        if (found) return found;
      }
    }
    // 5. A menu written out with no prices (Zuni, House of Prime Rib): on a menu page, or a page with a menu section
    //    of its own (#menu), and only when nothing better turned up. The read afterwards keeps the dishes, no prices.
    const inPageMenu = /href=["'][^"']*#[^"']*menu|\bid=["'][^"']*menu/i.test(html);
    const dishLines = text.split("\n").filter((line) => /[a-z]{3}/i.test(line) && line.trim().length >= 12).length;
    if ((isMenuPage || inPageMenu) && dishLines >= 8 && text.length >= 300) return printText(text, url, "page text");
    if (rendered || text.length > 400) reason = isMenuPage
      ? "We found the page but no menu on it we could read. Upload a photo or PDF of the menu instead."
      : "We couldn't find a menu on that page. Paste the link to the menu page itself, or upload a photo or PDF.";
    return null;
  }

  const found = await readPage(start, 0);
  if (!found) throw new LinkError(reason);
  return found;
}

// Text-only fallback when no browser is free: the menu's words on plain pages (WinAnsi letters only).
async function textPdf(text, url) {
  const { StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const safe = (line) => line.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7e\xa0-\xff]/g, "");
  const lines = [url.hostname, "", ...String(text).split("\n")].flatMap((line) => {
    const words = safe(line).split(" "); const out = []; let cur = "";
    for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (font.widthOfTextAtSize(next, 10) > 520) { out.push(cur); cur = w; } else cur = next; }
    out.push(cur); return out;
  }).slice(0, 2400);
  let page = null; let y = 0;
  for (const line of lines) {
    if (!page || y < 40) { page = pdf.addPage([612, 792]); y = 752; }
    page.drawText(line, { x: 46, y, size: 10, font }); y -= 13;
  }
  return pdf.save();
}

// ---------- the endpoint ----------
function cors(request) {
  const origin = request.headers.get("Origin") || "";
  return ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Expose-Headers": "X-Menu-Name, X-Menu-From" } : {};
}

async function handleMenuLink(request, env, { fetcher = fetch, now = Date.now() } = {}) {
  const headers = cors(request);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const origin = request.headers.get("Origin");
  if (origin && !ORIGINS.has(origin)) return json({ ok: false }, 403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.url !== "string" || body.url.length > 2000) return json({ ok: false, error: "Paste the link to your menu." }, 400);
  if (env.DB) {
    const salt = env.BOOKING_RATE_SALT || env.PRODUCTION_RUNNER_SECRET || env.RESEND_API_KEY || "";
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:link:${ip}`));
    const ipHash = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
    const t = Math.floor(now / 1000);
    const result = await env.DB.prepare(`INSERT INTO menu_link_fetches (ip_hash, created_at) SELECT ?, ? WHERE (SELECT COUNT(*) FROM menu_link_fetches WHERE ip_hash = ? AND created_at > ?) < ?`)
      .bind(ipHash, t, ipHash, t - 3600, LINKS_PER_HOUR).run().catch(() => null);
    if (result && !result.meta?.changes) return json({ ok: false, error: "Too many links from this connection. Please wait an hour, or upload a photo or PDF." }, 429);
  }
  try {
    const file = await findMenuAtLink(body.url, env, { fetcher });
    return new Response(file.bytes, { headers: { ...headers, "Content-Type": file.contentType, "Cache-Control": "no-store", "X-Menu-Name": file.name, "X-Menu-From": file.from } });
  } catch (error) {
    if (error instanceof LinkError) return json({ ok: false, error: error.message }, 422);
    console.error("menu link failed", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "We couldn't read that link. Upload a photo or PDF of the menu instead." }, 422);
  }
}

export { findMenuAtLink, handleMenuLink, scanPage, priceCount, photoSize, checkUrl, LinkError, get, readCapped, sniff, browser, toBase64, pageText, attr, decode };
