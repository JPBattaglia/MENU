// Marketing (Nov 1, 2026): weekly prospect finder, run by .github/workflows/prospects.yml. No dependencies (Node 22).
//
// 1. OpenStreetMap (Overpass API, free): restaurants, cafes, bars, pubs, fast food, ice cream, bakeries, delis and
//    coffee shops in San Francisco and nearby cities. Chains (anything with a brand tag) are skipped.
// 2. Each business's own website is checked the way a guest would meet it (plain HTTP, a few pages at most):
//      menu_pdf        the menu link opens a PDF
//      menu_image      the menu page is photos with almost no text (unreadable on a phone, invisible to Google)
//      menu_missing    no menu link and no prices on the home page
//      no_phone_layout no mobile viewport tag (the site shows desktop-size on a phone)
//      site_down       the site doesn't load (bad address, 404, server error)
//      no_https        the site is not served over https
//      no_tap_to_call  no tap-to-call (tel:) link on the home page
//      no_website      no website at all (only kept when OpenStreetMap lists an email)
//    Sites that run on an ordering platform (Toast, Square, ChowNow ...) have a working menu: no menu gap.
// 3. A contact email: OpenStreetMap's tag, else mailto links (Cloudflare-protected ones decoded) on the home, menu and
//    contact pages, preferring an address on the business's own domain.
// 4. Each business gets the ONE offer that fixes its biggest gap (a menu gap leads, it's the cheap way in) and a score.
//
// The repository is public: the log shows counts only. Rows go to menu-made.com/api/system/prospects over this job's
// OIDC token and are kept in the private database.
//
//   node tools/prospects/find.mjs            (in GitHub Actions; DRY_RUN=1 prints counts without posting)

const UA = "Mozilla/5.0 (compatible; MenuMadeCheck/1.0; +https://menu-made.com)";
const CITIES = ["San Francisco", "Oakland", "Berkeley", "Emeryville", "Alameda", "Daly City", "South San Francisco", "San Bruno", "Sausalito"];
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const PLATFORMS = /(^|\.)(toasttab\.com|squareup\.com|square\.site|chownow\.com|clover\.com|popmenu\.com|bentobox\.com|spothopper\.com|olo\.com|doordash\.com|ubereats\.com|grubhub\.com|menufy\.com|order\.online|slicelife\.com|beyondmenu\.com|menusifu\.com|owner\.com|getbento\.com|resy\.com|opentable\.com|sevenrooms\.com|tock\.com|exploretock\.com)$/i;
const BAD_EMAIL_DOMAINS = /(sentry|wixpress|example\.|domain\.com|email\.com|yourdomain|godaddy|squarespace|schema\.org|sentry\.io|wix\.com|mysite\.com|company\.com|test\.com|placeholder)/i;
const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|me|msn|comcast|sbcglobal|att|live)\.(com|net)$/i;
const WEIGHTS = { menu_pdf: 5, menu_image: 5, menu_missing: 3, no_phone_layout: 4, site_down: 2, no_https: 1, no_tap_to_call: 2, no_website: 3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(city) {
  const q = `[out:json][timeout:180];area["name"="${city}"]["boundary"="administrative"]["admin_level"="8"]->.c;
(nwr(area.c)["amenity"~"^(restaurant|cafe|bar|pub|fast_food|ice_cream|biergarten)$"];
 nwr(area.c)["shop"~"^(bakery|deli|pastry|coffee|tea|confectionery)$"];);out center tags;`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": UA }, signal: AbortSignal.timeout(200000) });
      if (res.ok) return (await res.json()).elements || [];
    } catch { /* retry */ }
    await sleep(15000);
  }
  throw new Error(`Overpass failed for ${city}`);
}

async function get(url, ms = 12000) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    const type = res.headers.get("content-type") || "";
    const text = /html|text/i.test(type) ? (await res.text()).slice(0, 1500000) : "";
    return { status: res.status, url: res.url || url, type, text };
  } catch (e) { return { status: 0, url, type: "", text: "", error: String(e?.cause?.code || e?.name || e) }; }
}

const decodeEntities = (s) => s.replace(/&amp;/g, "&").replace(/&#64;|&commat;/g, "@").replace(/&#46;|&period;/g, ".");
function cfDecode(hex) {
  try { const k = parseInt(hex.slice(0, 2), 16); let out = ""; for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k); return out; } catch { return ""; }
}
function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1];
    if (!href) continue;
    let abs = null; try { abs = new URL(decodeEntities(href.trim()), base).href; } catch { /* skip */ }
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    out.push({ href: decodeEntities(href.trim()), abs, text, attrs: m[1] });
  }
  return out;
}
function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function emailsIn(html) {
  const found = [];
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) found.push(cfDecode(m[1]));
  for (const m of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) found.push(decodeURIComponent(decodeEntities(m[1])));
  for (const m of decodeEntities(visibleText(html)).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi)) found.push(m[0]);
  return found.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,24}$/.test(e) && !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !BAD_EMAIL_DOMAINS.test(e));
}
function pickEmail(list, host) {
  const uniq = [...new Set(list)];
  const own = host && uniq.find((e) => e.split("@")[1].replace(/^www\./, "") === host);
  return own || uniq.find((e) => FREE_MAIL.test(e)) || uniq[0] || null;
}

async function checkSite(website) {
  const gaps = [], emails = [];
  let url = website.trim(); if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let host; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return { gaps: ["site_down"], emails, host: null }; }
  if (PLATFORMS.test(host)) return { gaps: [], emails, host, platform: true };
  let home = await get(url);
  if (home.status === 0 && url.startsWith("https://")) home = await get(url.replace(/^https:/, "http:"));
  if ([403, 429, 503].includes(home.status) || (home.status === 0 && /TIMEOUT|Timeout/.test(home.error || ""))) return { gaps: [], emails, host, blocked: true };
  if (home.status === 0 || home.status >= 400 || !home.text) return { gaps: ["site_down"], emails, host };
  const finalHost = (() => { try { return new URL(home.url).hostname.replace(/^www\./, ""); } catch { return host; } })();
  if (PLATFORMS.test(finalHost)) return { gaps: [], emails, host, platform: true };
  if (home.url.startsWith("http://")) gaps.push("no_https");
  if (!/<meta[^>]+name\s*=\s*["']?viewport/i.test(home.text)) gaps.push("no_phone_layout");
  if (!/href\s*=\s*["']\s*tel:/i.test(home.text)) gaps.push("no_tap_to_call");
  emails.push(...emailsIn(home.text));
  const all = links(home.text, home.url);
  const platformLink = all.some((l) => { try { return PLATFORMS.test(new URL(l.abs).hostname); } catch { return false; } });
  const menuLinks = all.filter((l) => l.abs && (/\bmenus?\b|food|drinks|carta|our-menu/i.test(l.text) || /menu/i.test(l.href)));
  const pdf = all.find((l) => l.abs && /\.pdf(\?|$)/i.test(l.abs) && (/menu|food|drink|dinner|lunch|brunch|carta/i.test(l.href + " " + l.text)));
  let menuUrl = null;
  if (pdf) { gaps.push("menu_pdf"); menuUrl = pdf.abs; }
  else if (!platformLink) {
    const own = menuLinks.find((l) => { try { return new URL(l.abs).hostname.replace(/^www\./, "") === finalHost; } catch { return false; } });
    if (own) {
      menuUrl = own.abs;
      const page = /\.(jpe?g|png|webp|gif)(\?|$)/i.test(own.abs) ? { status: 200, text: "", type: "image" } : await get(own.abs);
      if (page.status === 200) {
        emails.push(...emailsIn(page.text || ""));
        const inner = links(page.text || "", page.url || own.abs);
        const innerPdf = inner.find((l) => l.abs && /\.pdf(\?|$)/i.test(l.abs));
        const innerPlatform = inner.some((l) => { try { return PLATFORMS.test(new URL(l.abs).hostname); } catch { return false; } });
        const text = visibleText(page.text || "");
        const prices = (text.match(/\$\s?\d{1,3}(\.\d{2})?\b|\b\d{1,2}\.\d{2}\b/g) || []).length;
        const images = ((page.text || "").match(/<img\b/gi) || []).length;
        if (/image/.test(page.type)) gaps.push("menu_image");
        else if (innerPdf && prices < 5) { gaps.push("menu_pdf"); menuUrl = innerPdf.abs; }
        else if (!innerPlatform && prices < 5 && images >= 1 && !/<iframe/i.test(page.text || "")) gaps.push("menu_image");
      }
    } else if (!menuLinks.length) {
      const prices = (visibleText(home.text).match(/\$\s?\d{1,3}(\.\d{2})?\b/g) || []).length;
      if (prices < 5 && !/<iframe/i.test(home.text)) gaps.push("menu_missing");
    }
  }
  // One contact-style page for an email when none was found yet.
  if (!pickEmail(emails, finalHost)) {
    const contact = all.find((l) => { try { return /contact|about|visit|location|info/i.test(l.text + " " + l.href) && new URL(l.abs).hostname.replace(/^www\./, "") === finalHost; } catch { return false; } });
    if (contact) { const page = await get(contact.abs); if (page.status === 200) emails.push(...emailsIn(page.text)); }
  }
  return { gaps, emails, host: finalHost, menuUrl };
}

function offerFor(gaps) {
  if (gaps.some((g) => g.startsWith("menu_"))) return "ONLINE_MENU_QR";
  if (gaps.includes("no_website") || gaps.includes("no_phone_layout") || gaps.includes("site_down")) return "WEBSITE_PACKAGE";
  if (gaps.includes("no_tap_to_call") || gaps.includes("no_https")) return "CONVERSION_FIX";
  return null;
}

async function pool(items, size, work) {
  let i = 0; const out = [];
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await work(items[k]); } }));
  return out;
}

async function oidcToken() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: u, ACTIONS_ID_TOKEN_REQUEST_TOKEN: t } = process.env;
  const res = await fetch(`${u}&audience=menu-made-prospects`, { headers: { Authorization: `Bearer ${t}` } });
  return (await res.json()).value;
}

const businesses = new Map();
for (const city of CITIES) {
  const elements = await overpass(city);
  let kept = 0;
  for (const el of elements) {
    const t = el.tags || {};
    if (!t.name || t.brand || t["brand:wikidata"] || t["disused:amenity"] || t.opening_hours === "closed") continue;
    const id = `${el.type}/${el.id}`;
    if (businesses.has(id)) continue;
    businesses.set(id, {
      id, name: t.name, kind: t.amenity || t.shop, cuisine: t.cuisine || null, city: t["addr:city"] || city,
      address: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null,
      phone: t.phone || t["contact:phone"] || null, website: t.website || t["contact:website"] || t.url || null,
      osmEmail: t.email || t["contact:email"] || null
    });
    kept++;
  }
  console.log(`${city}: ${elements.length} places, ${kept} independent`);
  await sleep(5000);
}

const list = [...businesses.values()];
const stats = { checked: 0, blocked: 0, platform: 0, withEmail: 0, withOffer: 0, gaps: {} };
const rows = (await pool(list, 16, async (b) => {
  let gaps = [], emails = [], host = null, menuUrl = null;
  if (b.website) {
    const r = await checkSite(b.website); stats.checked++;
    if (r.blocked) stats.blocked++; if (r.platform) stats.platform++;
    gaps = r.gaps; emails = r.emails; host = r.host; menuUrl = r.menuUrl || null;
  } else if (b.osmEmail) gaps = ["no_website"];
  const email = b.osmEmail ? b.osmEmail.split(/[;,\s]/)[0].toLowerCase() : pickEmail(emails, host);
  const offer = offerFor(gaps);
  if (!offer) return null;
  for (const g of gaps) stats.gaps[g] = (stats.gaps[g] || 0) + 1;
  stats.withOffer++; if (email) stats.withEmail++;
  const score = gaps.reduce((n, g) => n + (WEIGHTS[g] || 0), 0) + (email ? 3 : 0);
  return { id: b.id, name: b.name, kind: b.kind, cuisine: b.cuisine, city: b.city, address: b.address, phone: b.phone, website: b.website,
    email, email_source: b.osmEmail ? "osm" : email ? "page" : null, gaps, menu_url: menuUrl, offer_code: offer, score };
})).filter(Boolean);

console.log(`Independent places: ${list.length}; websites checked: ${stats.checked} (${stats.blocked} blocked the check, ${stats.platform} on ordering platforms)`);
console.log(`With a gap Menu-made fixes: ${stats.withOffer}; of those with a contact email: ${stats.withEmail}`);
console.log(`Gaps: ${Object.entries(stats.gaps).map(([g, n]) => `${g} ${n}`).join(", ")}`);
const offers = rows.reduce((m, r) => (m[r.offer_code] = (m[r.offer_code] || 0) + 1, m), {});
console.log(`Lead offers: ${Object.entries(offers).map(([o, n]) => `${o} ${n}`).join(", ")}`);

if (process.env.DRY_RUN) process.exit(0);
const token = await oidcToken();
let stored = 0;
for (let k = 0; k < rows.length; k += 300) {
  const res = await fetch("https://menu-made.com/api/system/prospects", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ run_id: process.env.GITHUB_RUN_ID, prospects: rows.slice(k, k + 300) }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { console.log(`Posting failed: ${res.status} ${out.error || ""}`); process.exit(1); }
  stored += out.stored || 0;
}
console.log(`Stored ${stored} prospects in the private database.`);
