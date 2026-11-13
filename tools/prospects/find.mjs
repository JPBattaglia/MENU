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
// 1b. New openings (Nov 8, 2026): SF food and drink locations registered with the city in the last 120 days (see below).
// 4. Each business gets the ONE offer that fixes its biggest gap (a menu gap leads, it's the cheap way in) and a score.
//
// The repository is public: the log shows counts only. Rows go to menu-made.com/api/system/prospects over this job's
// OIDC token and are kept in the private database.
//
//   node tools/prospects/find.mjs            (in GitHub Actions; DRY_RUN=1 prints counts without posting)

const UA = "MenuMadeProspects/1.0 (+https://menu-made.com; info@menu-made.com)";
// Small map tiles (south, west, north, east): whole-city area queries time out on the public Overpass servers.
// Nov 12, 2026: owner OK'd going nationwide (the offers need no in-person visit). REGION picks what one run scans:
//   "bay" (default, Mondays) = San Francisco and nearby cities, plus SF new openings;
//   "next" (Thursdays) = the next metro in NATIONWIDE, rotating by week; or a NATIONWIDE key to scan that metro now.
const BAY = [];
for (const [la, lb] of [[37.70, 37.745], [37.745, 37.79], [37.79, 37.835]]) for (const [wa, wb] of [[-122.52, -122.465], [-122.465, -122.42], [-122.42, -122.35]]) BAY.push(["San Francisco", [la, wa, lb, wb]]);
BAY.push(["Oakland", [37.73, -122.33, 37.80, -122.20]], ["Oakland", [37.80, -122.33, 37.86, -122.20]], ["Oakland", [37.73, -122.20, 37.86, -122.11]],
  ["Berkeley", [37.84, -122.32, 37.91, -122.23]], ["Alameda", [37.75, -122.34, 37.80, -122.22]],
  ["Daly City", [37.65, -122.50, 37.71, -122.38]], ["South San Francisco", [37.60, -122.48, 37.65, -122.38]], ["Sausalito", [37.84, -122.51, 37.87, -122.47]]);
// Core areas of US metros (south, west, north, east), cut into about 5 km tiles. Big metros are split so one run fits.
const NATIONWIDE = [
  ["la-west", "Los Angeles", [33.95, -118.50, 34.12, -118.30]], ["seattle", "Seattle", [47.53, -122.42, 47.72, -122.26]],
  ["san-jose", "San Jose", [37.24, -122.05, 37.42, -121.80]], ["portland", "Portland", [45.46, -122.74, 45.58, -122.55]],
  ["san-diego", "San Diego", [32.68, -117.26, 32.82, -117.06]], ["la-east", "Los Angeles", [33.98, -118.30, 34.18, -118.10]],
  ["sacramento", "Sacramento", [38.50, -121.54, 38.65, -121.38]], ["austin", "Austin", [30.20, -97.83, 30.40, -97.66]],
  ["denver", "Denver", [39.66, -105.05, 39.79, -104.88]], ["chicago", "Chicago", [41.84, -87.72, 41.99, -87.60]],
  ["manhattan", "New York", [40.70, -74.02, 40.82, -73.93]], ["brooklyn", "Brooklyn", [40.60, -74.03, 40.72, -73.90]],
  ["boston", "Boston", [42.31, -71.15, 42.40, -71.02]], ["philadelphia", "Philadelphia", [39.91, -75.22, 40.00, -75.12]],
  ["miami", "Miami", [25.72, -80.32, 25.88, -80.12]], ["atlanta", "Atlanta", [33.72, -84.45, 33.86, -84.32]],
  ["nashville", "Nashville", [36.11, -86.84, 36.21, -86.71]], ["new-orleans", "New Orleans", [29.91, -90.13, 30.01, -90.00]],
  ["phoenix", "Phoenix", [33.40, -112.13, 33.54, -111.88]], ["las-vegas", "Las Vegas", [36.08, -115.25, 36.22, -115.09]],
  ["dallas", "Dallas", [32.74, -96.86, 32.88, -96.72]], ["houston", "Houston", [29.70, -95.47, 29.82, -95.32]],
  ["minneapolis", "Minneapolis", [44.93, -93.32, 45.02, -93.20]], ["washington-dc", "Washington", [38.87, -77.08, 38.96, -76.97]]
];
function tilesFor(city, [s, w, n, e], step = 0.05) {
  const out = [];
  for (let la = s; la < n - 1e-9; la += step) for (let wa = w; wa < e - 1e-9; wa += step)
    out.push([city, [+la.toFixed(3), +wa.toFixed(3), +Math.min(n, la + step).toFixed(3), +Math.min(e, wa + step).toFixed(3)]]);
  return out;
}
// "next" rotation (Nov 13, 2026): two nationwide runs a week (Tuesday and Thursday, Pacific), each a different metro.
// Weeks count from Mon Nov 9, 2026. la-west (index 0) was scanned by hand on Nov 12, so Tue Nov 17 takes index 1
// (seattle), Thu Nov 19 index 2, and so on through the list, then round again.
function nextMetroIndex(ms = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const day = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const week = Math.floor((day - Date.UTC(2026, 10, 9)) / (7 * 86400000));
  const slot = parts.weekday === "Thu" || parts.weekday === "Fri" || parts.weekday === "Sat" || parts.weekday === "Sun" ? 1 : 0;
  const n = week * 2 + slot - 1;
  return ((n % NATIONWIDE.length) + NATIONWIDE.length) % NATIONWIDE.length;
}
function pickRegion(region = "bay") {
  if (!region || region === "bay") return { key: "bay", tiles: BAY };
  let entry = NATIONWIDE.find(([k]) => k === region);
  if (!entry && region === "next") entry = NATIONWIDE[nextMetroIndex()];
  if (!entry) { console.log(`Unknown region "${region}"; scanning the Bay Area.`); return { key: "bay", tiles: BAY }; }
  return { key: entry[0], tiles: tilesFor(entry[1], entry[2]) };
}
const REGION = pickRegion(process.env.REGION);
const TILES = REGION.tiles;
console.log(`Region: ${REGION.key} (${TILES.length} map tiles)`);
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const PLATFORMS = /(^|\.)(toasttab\.com|squareup\.com|square\.site|chownow\.com|clover\.com|popmenu\.com|bentobox\.com|spothopper\.com|olo\.com|doordash\.com|ubereats\.com|grubhub\.com|menufy\.com|order\.online|slicelife\.com|beyondmenu\.com|menusifu\.com|owner\.com|getbento\.com|resy\.com|opentable\.com|sevenrooms\.com|tock\.com|exploretock\.com)$/i;
const BAD_EMAIL_DOMAINS = /(sentry|wixpress|example\.|domain\.com|email\.com|yourdomain|godaddy|squarespace|schema\.org|sentry\.io|wix\.com|mysite\.com|company\.com|test\.com|placeholder)/i;
const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|me|msn|comcast|sbcglobal|att|live)\.(com|net)$/i;
const WEIGHTS = { menu_pdf: 5, menu_image: 5, menu_missing: 3, no_phone_layout: 4, site_down: 2, no_https: 1, no_tap_to_call: 2, no_website: 3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass([s, w, n, e]) {
  const b = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:90];(nwr["amenity"~"^(restaurant|cafe|bar|pub|fast_food|ice_cream|biergarten)$"](${b});nwr["shop"~"^(bakery|deli|pastry|coffee|tea|confectionery)$"](${b}););out center tags;`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(`${url}?data=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120000) });
      const body = await res.text();
      if (res.ok && body.trim().startsWith("{")) return JSON.parse(body).elements || [];
      console.log(`  ${new URL(url).hostname}: ${res.status} ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160)}`);
    } catch (e) { console.log(`  ${new URL(url).hostname}: ${String(e?.cause?.code || e?.name || e).slice(0, 120)}`); }
    await sleep(attempt < 3 ? 5000 : 20000);
  }
  return null;
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
  if (gaps.includes("no_tap_to_call") || gaps.includes("no_https")) return "WEBSITE_PACKAGE"; // Conversion Fix folded in, Nov 6, 2026
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
let failedTiles = 0;
for (const [city, box] of TILES) {
  const elements = await overpass(box);
  if (!elements) { failedTiles++; console.log(`${city} tile ${box.join(",")}: map server unavailable, skipped`); continue; }
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
  await sleep(3000);
}
if (failedTiles === TILES.length) { console.log("Every map tile failed; nothing to check."); process.exit(1); }

// 1b. New openings (owner, Nov 8, 2026): San Francisco food and drink locations registered with the city in the last
// NEW_DAYS days (DataSF "Registered Business Locations", free, no key, refreshed daily; food = self_reported_naics_code). One already on the map is marked
// with its opening date; one that isn't yet is looked up on the web by the worker (Claude web search, once per business,
// at most MAX_LOOKUPS new lookups a run) for its website, email and phone. Either way it is checked like any other.
const SF_REGISTRY = "https://data.sf.gov/resource/g8m3-pdis.json"; // moved from data.sfgov.org (Nov 2026)
// Self-reported NAICS: full-service, limited-service, snack and coffee places, bars, retail bakeries and sweets shops.
// Food trucks, caterers and contract cafeterias are left out (no storefront to pitch).
const FOOD_NAICS = /^(722511|722513|722514|722515|722410|311811|445291|445292|445298)$/;
const NEW_DAYS = 120, MAX_LOOKUPS = 40;
const CHAINS = /\b(starbucks|mcdonald'?s|subway|chipotle|peet'?s|philz|blue bottle|taco bell|burger king|wendy'?s|jack in the box|domino'?s|pizza hut|panda express|sweetgreen|panera|dunkin|7-eleven|in-n-out|shake shack|popeyes|kfc|jamba|mendocino farms|cava|tender greens|ike'?s|chick-fil-a|raising cane|wingstop|jollibee|tous les jours|paris baguette|gong cha|kung fu tea|tpumps|sharetea|compass group|bon appetit|aramark|sodexo|levy|delaware north)\b/i;
const nameWords = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
  .filter((w) => w && !["the", "and", "a", "of", "restaurant", "cafe", "bar", "llc", "inc", "corp", "co", "sf"].includes(w));
const sameName = (a, b) => { const x = nameWords(a), y = nameWords(b); if (!x.length || !y.length) return false; const [sh, lo] = x.length <= y.length ? [x, y] : [y, x]; return sh.every((w) => lo.includes(w)); };
const houseNumber = (a) => /^\s*(\d+)/.exec(a || "")?.[1] || null;
function cleanName(raw) {
  let n = String(raw || "").replace(/\s+/g, " ").replace(/[,.]?\s*\b(llc|l\.l\.c\.|inc|incorporated|corp|corporation|co|ltd|lp)\.?\s*$/i, "").trim();
  if (n && n === n.toUpperCase()) n = n.toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/'S\b/g, "'s");
  return n;
}
const titleAddress = (a) => String(a || "").replace(/\s+/g, " ").trim().toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, d, x) => d + x.toLowerCase());

async function sfNewOpenings() {
  const since = new Date(Date.now() - NEW_DAYS * 86400000).toISOString().slice(0, 10);
  const url = `${SF_REGISTRY}?$limit=5000&$order=location_start_date%20DESC&$where=${encodeURIComponent(`location_start_date >= '${since}T00:00:00'`)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
      const body = await res.text();
      if (res.ok) return JSON.parse(body);
      console.log(`  city registry: ${res.status} ${body.slice(0, 200)}`);
      if (res.status === 400) return null;
    } catch (e) { console.log(`  city registry: ${String(e?.cause?.code || e?.name || e).slice(0, 120)}`); }
    await sleep(10000);
  }
  return null;
}

async function lookup(o) {
  try {
    const token = await oidcToken(); // fresh each call: a run of lookups outlasts one token
    const res = await fetch("https://menu-made.com/api/system/prospects/lookup", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: o.id, name: o.name, address: o.address, opened_on: o.opened_on }), signal: AbortSignal.timeout(120000) });
    const out = await res.json().catch(() => ({}));
    return res.ok && out.ok ? out : { error: `${res.status} ${String(out.error || "").slice(0, 100)}` };
  } catch (e) { return { error: String(e?.name || e).slice(0, 100) }; }
}

const openingStats = { registry: 0, food: 0, matched: 0, lookedUp: 0, cached: 0, withEmail: 0, waiting: 0, failed: 0 };
const registry = REGION.key === "bay" ? await sfNewOpenings() : null; // the SF city registry only covers SF
if (!registry) console.log(REGION.key === "bay" ? "New openings: the city registry was unavailable this run; skipped." : "New openings: SF only; not part of this region.");
else {
  openingStats.registry = registry.length;
  const seenLoc = new Set(); const openings = [];
  for (const r of registry) {
    const food = FOOD_NAICS.test(String(r.self_reported_naics_code || "").trim()) || /^RESTAURANT|BARS\/TAVERNS/i.test(r.lic_code_description || "");
    const inSf = /san francisco/i.test(r.city || "") || /^941/.test(String(r.business_zip || ""));
    if (!food || !inSf || r.location_end_date || r.dba_end_date) continue;
    const name = cleanName(r.dba_name || r.ownership_name);
    const address = titleAddress(r.full_business_address);
    const key = String(r.ttxid || r.uniqueid || r.certificate_number || "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40);
    if (!name || !address || !key || CHAINS.test(name) || CHAINS.test(r.ownership_name || "") || seenLoc.has(key)) continue;
    seenLoc.add(key);
    openings.push({ id: `sf/${key}`, name, address, opened_on: String(r.location_start_date || "").slice(0, 10) });
  }
  openingStats.food = openings.length;
  const onMap = [...businesses.values()].filter((b) => b.city === "San Francisco" || /san francisco/i.test(b.city || ""));
  const unmatched = [];
  for (const o of openings) {
    const hit = onMap.find((b) => houseNumber(b.address) && houseNumber(b.address) === houseNumber(o.address) && sameName(b.name, o.name));
    if (hit) { hit.opened_on = hit.opened_on && hit.opened_on > o.opened_on ? hit.opened_on : o.opened_on; openingStats.matched++; }
    else unmatched.push(o);
  }
  const live = !process.env.DRY_RUN;
  let fresh = 0;
  for (const o of unmatched) {
    const b = { id: o.id, name: o.name, kind: "restaurant", cuisine: null, city: "San Francisco", address: o.address, phone: null, website: null, osmEmail: null, lookupEmail: null, opened_on: o.opened_on };
    if (live && fresh < MAX_LOOKUPS) {
      const found = await lookup(o);
      if (found.error) { openingStats.failed++; if (openingStats.failed <= 3) console.log(`  lookup failed: ${found.error}`); if (openingStats.failed >= 5 && !openingStats.lookedUp && !openingStats.cached) { console.log("  lookups stopped for this run"); fresh = MAX_LOOKUPS; } }
      else {
        if (found.cached) openingStats.cached++; else { openingStats.lookedUp++; fresh++; }
        b.website = found.website || null; b.phone = found.phone || null; b.lookupEmail = found.email || null;
        if (found.email) openingStats.withEmail++;
      }
    } else openingStats.waiting++;
    businesses.set(b.id, b);
  }
  console.log(`New openings: ${openingStats.registry} SF registrations in ${NEW_DAYS} days, ${openingStats.food} independent food & drink, ${openingStats.matched} already on the map; ` +
    `web lookups ${openingStats.lookedUp} new + ${openingStats.cached} known (${openingStats.withEmail} with an email), ${openingStats.waiting} wait for next week, ${openingStats.failed} failed`);
}

const list = [...businesses.values()];
const stats = { checked: 0, blocked: 0, platform: 0, withEmail: 0, withOffer: 0, gaps: {} };
const rows = (await pool(list, 16, async (b) => {
  let gaps = [], emails = [], host = null, menuUrl = null;
  if (b.website) {
    const r = await checkSite(b.website); stats.checked++;
    if (r.blocked) stats.blocked++; if (r.platform) stats.platform++;
    gaps = r.gaps; emails = r.emails; host = r.host; menuUrl = r.menuUrl || null;
  } else if (b.osmEmail || b.lookupEmail) gaps = ["no_website"];
  const email = b.osmEmail ? b.osmEmail.split(/[;,\s]/)[0].toLowerCase() : pickEmail(emails, host) || b.lookupEmail || null;
  const offer = offerFor(gaps);
  if (!offer && !b.opened_on) return null; // new openings are kept anyway: they're listed in the Friday numbers email
  for (const g of gaps) stats.gaps[g] = (stats.gaps[g] || 0) + 1;
  if (offer) { stats.withOffer++; if (email) stats.withEmail++; }
  const score = gaps.reduce((n, g) => n + (WEIGHTS[g] || 0), 0) + (email ? 3 : 0) + (b.opened_on ? 6 : 0);
  return { id: b.id, name: b.name, kind: b.kind, cuisine: b.cuisine, city: b.city, address: b.address, phone: b.phone, website: b.website,
    email, email_source: b.osmEmail ? "osm" : email ? "page" : null, gaps, menu_url: menuUrl, offer_code: offer, score, opened_on: b.opened_on || null };
})).filter(Boolean);

console.log(`Independent places: ${list.length}; websites checked: ${stats.checked} (${stats.blocked} blocked the check, ${stats.platform} on ordering platforms)`);
console.log(`With a gap Menu-made fixes: ${stats.withOffer}; of those with a contact email: ${stats.withEmail}`);
console.log(`Gaps: ${Object.entries(stats.gaps).map(([g, n]) => `${g} ${n}`).join(", ")}`);
const offers = rows.filter((r) => r.offer_code).reduce((m, r) => (m[r.offer_code] = (m[r.offer_code] || 0) + 1, m), {});
console.log(`New openings kept: ${rows.filter((r) => r.opened_on).length} (${rows.filter((r) => r.opened_on && r.offer_code && r.email).length} ready for an email)`);
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
