// Hybrid Mobile Apps (owner decision Nov 8, 2026, replaces "whole site in an app" for the owner's own two apps):
// real app screens built from live data, with the website opened inside the app only where a screen would just copy it
// (checkout, cart, account, long pages). Design: the "Hybrid apps: Menu-made and Nino Battaglia" canvas.
//
//   GET /api/app-hybrid/<key>   key = menumade | nino. Public JSON the app's native screens render.
//
// Everything a screen shows comes from here, live, so a change on either website (new designs, prices, plans) shows
// in the apps the next time they open, with no store build. Only a change to the app itself (a new tab, icon, phone
// feature) needs a new build. Sources:
//   menumade: the plans and prices in this worker's own catalog (the same answer as GET /api/catalog)
//   nino:     ninobattaglia.com/catalog.json, the shop's public design list (prices, photos, colours, sizes)
// Public data only, cached at the edge for TTL seconds. CORS "*" because the app runs from capacitor://localhost or
// https://localhost and the store screenshots load it from a local page.
import { getSiteCatalog } from "../checkout/catalog.js";
import { queuePush } from "../producers/guest-app/engage.js";

const TTL = 300;
const MM = "https://menu-made.com";
const NINO = "https://ninobattaglia.com";
// Nino's shop API (NinoSite commerce-api): rewards card, ideas board and the last week's new designs (fans.mjs).
const NINO_API = "https://nino-printful-commerce-api.ijpbattaglia.workers.dev";
const EARLY_SECONDS = 86400;
const HYBRID_KEYS = new Set(["menumade", "nino"]);
const PLAN_ORDER = ["BUNDLE_STARTER", "BUNDLE_GROWTH", "BUNDLE_PRO"];

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const httpsUrl = (value, base) => {
  try { const u = new URL(String(value || ""), base); return u.protocol === "https:" ? u.toString() : ""; } catch { return ""; }
};
const hex = (value) => (/^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : null);
const slugOk = (value) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(value || ""));

// ---- Menu-made: plans from the catalog answer ----
function includesText(offer, byCode) {
  const names = (offer.includes || []).map((code) => clean(String(byCode.get(code)?.name || "").replace(/\s*plan$/i, ""), 40)).filter(Boolean);
  if (!names.length) return "";
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `Includes ${list}`;
}

function menumadeContent(catalog) {
  const offers = Array.isArray(catalog?.offers) ? catalog.offers : [];
  const byCode = new Map(offers.map((o) => [o.code, o]));
  const plans = PLAN_ORDER.map((code) => byCode.get(code)).filter((o) => o && o.on_sale && o.prices?.month).map((o) => ({
    code: o.code,
    name: clean(String(o.name || "").replace(/\s*(bundle|plan)$/i, ""), 40),
    // The bundle's own services, by name, from the same catalog (so a change to a plan shows here too).
    description: clean(o.short_description, 220) || includesText(o, byCode),
    month_cents: Number(o.prices.month) || 0,
    year_cents: Number(o.prices.year) || 0,
    checkout_month: `${MM}/contact.html?plan=${o.code}&interval=month`,
    checkout_year: `${MM}/contact.html?plan=${o.code}&interval=year`
  }));
  return {
    ok: true,
    key: "menumade",
    kind: "services",
    // The app's look follows menu-made.com (app-shell/www/app.css, .hy-theme-menumade); pictures come from the site.
    theme: "menumade",
    assets: { logo: `${MM}/MENU1.png`, mark: `${MM}/MENU%3D.png` },
    name: "MENU-MADE",
    tagline: "For Food & Bev businesses",
    tabs: ["home", "preview", "plans", "account"],
    hero: { title: "Your menu online, see it before you checkout", action: "Try a free menu preview" },
    steps: [
      { title: "Free menu preview", text: "Upload your PDF menu", tab: "preview" },
      { title: "Free website preview", text: "Nine designs, built from your info", url: `${MM}/website-design.html` },
      { title: "Pick a plan", text: "Starter, Growth or Pro", tab: "plans" }
    ],
    preview: { create_url: `${MM}/api/menu-preview/create`, upload_url: `${MM}/api/inquiry`, more_url: `${MM}/online-menu.html` },
    plans,
    plans_note: "On a yearly plan the menu setup and first-year hosting are free.",
    links: [
      { label: "Your account", text: "Orders, plans and billing", url: `${MM}/account.html` },
      { label: "All services", text: "Everything Menu-made does", url: `${MM}/services.html` },
      { label: "Our work", text: "Sites and menus we've made", url: `${MM}/portfolio.html` },
      { label: "Contact us", text: "info@menu-made.com", url: `${MM}/contact.html` }
    ]
  };
}

// ---- Nino: designs from the shop's catalog.json ----
// releases: the shop's GET /api/releases answer (designs from the last 7 days, with when each first appeared).
// A design in its first 24 hours is the app's early access: listed first with early = true; the website holds it back.
function ninoContent(catalog, releases = null, nowSeconds = Math.floor(Date.now() / 1000)) {
  const shop = catalog?.shop || {};
  const collections = (Array.isArray(shop.collections) ? shop.collections : [])
    .filter((c) => slugOk(c?.id) && c.name).map((c) => ({ id: c.id, name: clean(c.name, 40) })).slice(0, 12);
  const products = (Array.isArray(catalog?.products) ? catalog.products : []).filter((p) => slugOk(p?.slug) && p.title).map((p) => {
    const colors = (p.options?.colors || []).map((c) => ({ name: clean(c?.name, 30), hex: hex(c?.hex) })).filter((c) => c.name && c.hex).slice(0, 40);
    const sizes = (p.options?.sizes || []).map((s) => clean(s, 8)).filter(Boolean).slice(0, 12);
    const id = /^\d{1,20}$/.test(String(p.id || "")) ? String(p.id) : "";
    return {
      id,
      slug: p.slug,
      title: clean(p.title, 60),
      category: clean(p.category, 30),
      collections: (p.collections || []).filter(slugOk).slice(0, 6),
      description: clean(p.description, 300),
      image: httpsUrl(p.image, `${NINO}/`),
      price_cents: Number(p.price?.amount) || 0,
      featured: Boolean(p.featured),
      accent: hex(p.accent),
      colors,
      sizes,
      url: `${NINO}/shirts/${p.slug}.html`,
      buy_url: id ? `${NINO}/shop.html?product=${id}` : `${NINO}/shirts/${p.slug}.html`
    };
  }).filter((p) => p.image).slice(0, 400);
  // New designs: from the shop's list (newer than catalog.json, which is refreshed daily).
  const known = new Map(products.map((p) => [p.id, p]));
  for (const d of (Array.isArray(releases?.designs) ? releases.designs : [])) {
    const id = /^\d{1,20}$/.test(String(d?.id || "")) ? String(d.id) : "";
    const at = Number(d?.released_at) || 0;
    if (!id || !at) continue;
    const early = at > nowSeconds - EARLY_SECONDS;
    const existing = known.get(id);
    if (existing) { existing.released_at = at; existing.early = early; continue; }
    const image = httpsUrl(d.image, `${NINO}/`);
    if (!image || !d.title) continue;
    const p = { id, slug: `new-${id}`, title: clean(d.title, 60), category: "New", collections: [], description: "", image, price_cents: Number(d.price_cents) || 0,
      featured: false, accent: null, colors: [], sizes: [], url: `${NINO}/shop.html?product=${id}`, buy_url: `${NINO}/shop.html?product=${id}`, released_at: at, early };
    products.push(p); known.set(id, p);
  }
  // Early-access designs first, then the newest of the week, then Nino's featured ones.
  products.sort((a, b) => Number(Boolean(b.early)) - Number(Boolean(a.early)) || (b.released_at || 0) - (a.released_at || 0) || Number(b.featured) - Number(a.featured));
  return {
    ok: true,
    key: "nino",
    kind: "shop",
    // The app's look follows ninobattaglia.com (.hy-theme-nino): the rusted metal backdrop, grain, Barlow Condensed.
    theme: "nino",
    assets: { logo: `${NINO}/assets/brand-mark.webp`, backdrop: `${NINO}/assets/metal-bg-portrait.webp`, grain: `${NINO}/assets/grain.webp` },
    hero: { eyebrow: "Original artwork / everyday expression", line1: "Wear your", line2: "perspective", text: "Original artwork on shirts. Find the design that feels like you." },
    name: "NINO BATTAGLIA",
    tagline: "by Nino, an SF artist",
    tabs: ["shop", "ideas", "rewards", "cart", "work"],
    // The app talks to the shop directly for these (each member's own card and votes): fans.mjs in NinoSite.
    fans_api: NINO_API,
    // Shop links get ?app=<member key> added by the app, so orders count toward the rewards (site.js keeps it).
    app_param: "app",
    collections,
    products,
    shop_note: "Every design is printed to order. Free 3-inch sticker of the design with every order.",
    // The Work tab's portfolio, the same pieces and order as ninobattaglia.com/art.html (owner, Nov 9, 2026: the tab was
    // only two links). image = the grid picture, full = the larger one shown when a piece is tapped.
    work: [
      {"title": "Garamond", "category": "Typography", "image": `${NINO}/assets/design-typography-640.webp`, "full": `${NINO}/assets/design-typography.webp`},
      {"title": "Bird / letter P", "category": "Branding", "image": `${NINO}/assets/design-lettermark.webp`, "full": `${NINO}/assets/design-lettermark.webp`},
      {"title": "Face Landscape", "category": "Illustration", "image": `${NINO}/assets/art-face-landscape-640.webp`, "full": `${NINO}/assets/art-face-landscape.webp`},
      {"title": "Identity explorations", "category": "Branding", "image": `${NINO}/assets/design-logo-collection.webp`, "full": `${NINO}/assets/design-logo-collection.webp`},
      {"title": "Skull Wave", "category": "Illustration", "image": `${NINO}/assets/art-skull-wave-640.webp`, "full": `${NINO}/assets/art-skull-wave.webp`},
      {"title": "Letterform studies", "category": "Typography", "image": `${NINO}/assets/design-type-studies-640.webp`, "full": `${NINO}/assets/design-type-studies.webp`},
      {"title": "Self identity", "category": "Branding", "image": `${NINO}/assets/design-identity-card-640.webp`, "full": `${NINO}/assets/design-identity-card.webp`},
      {"title": "Airobic Fitness", "category": "Print & layout", "image": `${NINO}/assets/design-editorial-layout-640.webp`, "full": `${NINO}/assets/design-editorial-layout.webp`},
      {"title": "Menu presentation", "category": "Print & layout", "image": `${NINO}/assets/design-menu-layout.webp`, "full": `${NINO}/assets/design-menu-layout.webp`},
      {"title": "Photo animation study", "category": "Motion", "image": `${NINO}/assets/design-motion-preview.webp`, "full": `${NINO}/assets/design-motion-preview.webp`},
      {"title": "Oroboros", "category": "Illustration", "image": `${NINO}/assets/art-oroboros.webp`, "full": `${NINO}/assets/art-oroboros.webp`},
      {"title": "Body Face", "category": "Illustration", "image": `${NINO}/assets/art-face-lines-640.webp`, "full": `${NINO}/assets/art-face-lines.webp`},
      {"title": "Bison Samurai", "category": "Illustration", "image": `${NINO}/assets/art-bison-samurai.webp`, "full": `${NINO}/assets/art-bison-samurai.webp`},
      {"title": "Motopsycho", "category": "Illustration", "image": `${NINO}/assets/art-motopsycho.webp`, "full": `${NINO}/assets/art-motopsycho.webp`},
      {"title": "Owls", "category": "Illustration", "image": `${NINO}/assets/art-owls-640.webp`, "full": `${NINO}/assets/art-owls.webp`},
      {"title": "Graphite Bird", "category": "Drawing", "image": `${NINO}/assets/art-graphite-bird.webp`, "full": `${NINO}/assets/art-graphite-bird.webp`},
      {"title": "Landscape", "category": "Drawing", "image": `${NINO}/assets/art-landscape-640.webp`, "full": `${NINO}/assets/art-landscape.webp`},
      {"title": "Artificial Intelligence", "category": "Illustration", "image": `${NINO}/assets/art-artificial-intelligence-640.webp`, "full": `${NINO}/assets/art-artificial-intelligence.webp`},
      {"title": "Halloween Harmony", "category": "Illustration", "image": `${NINO}/assets/art-halloween-harmony-640.webp`, "full": `${NINO}/assets/art-halloween-harmony.webp`},
      {"title": "Grumpy Frog", "category": "Illustration", "image": `${NINO}/assets/art-grumpy-frog-640.webp`, "full": `${NINO}/assets/art-grumpy-frog.webp`}
    ],
    links: { work: `${NINO}/art.html`, cart: `${NINO}/cart.html`, services: `${NINO}/services.html`, help: `${NINO}/support.html` },
    rewards: {
      enabled: true,
      steps: [{ at: 3, tier: "canvas", title: "Free 8x10 canvas print", text: "With your 3rd shirt" }, { at: 6, tier: "hoodie", title: "Free hoodie", text: "With your 6th shirt" }],
      note: "Every shirt you buy in the app counts. After the hoodie it starts again.",
      early: "New designs land here 24 hours before the website. Turn on notifications to hear the moment one drops."
    },
    ideas: { title: "Ideas board", text: "Tell Nino what to draw next, and vote for the ideas you'd wear. Nino reads every one." }
  };
}

const jsonOut = (data, status, cacheSeconds) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store"
  }
});

async function buildContent(env, key, fetchImpl) {
  if (key === "menumade") {
    const res = await getSiteCatalog(env);
    const catalog = await res.json();
    if (!catalog?.ok) throw new Error("catalog unavailable");
    return menumadeContent(catalog);
  }
  const [res, rel] = await Promise.all([
    fetchImpl(`${NINO}/catalog.json`, { headers: { Accept: "application/json", "User-Agent": "MenuMadeApp/1.0" }, cf: { cacheTtl: TTL } }),
    fetchImpl(`${NINO_API}/api/releases`, { headers: { Accept: "application/json" } }).catch(() => null)
  ]);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const releases = rel?.ok ? await rel.json().catch(() => null) : null;
  return ninoContent(await res.json(), releases);
}

async function handleHybridContent(request, env, key, { fetchImpl = fetch, cacheStore = globalThis.caches?.default } = {}) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" } });
  if (request.method !== "GET") return jsonOut({ ok: false, error: "Not found" }, 404);
  if (!HYBRID_KEYS.has(key)) return jsonOut({ ok: false, error: "Not found" }, 404);
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  if (cacheStore) {
    const hit = await cacheStore.match(cacheKey).catch(() => null);
    if (hit) return hit;
  }
  let content;
  try { content = await buildContent(env, key, fetchImpl); } catch { return jsonOut({ ok: false, error: "Temporarily unavailable" }, 503); }
  const response = jsonOut({ ...content, updated_at: new Date().toISOString() }, 200, TTL);
  if (cacheStore) await cacheStore.put(cacheKey, response.clone()).catch(() => null);
  return response;
}

// Which store apps are hybrid: the owner's own two (own-apps.js), by bundle id. A bought Mobile App keeps the
// restaurant screens until the hybrid version is offered for sale.
const HYBRID_BUNDLES = new Map([["com.menumade.menumade", "menumade"], ["com.menumade.ninobattaglia", "nino"]]);
// New-design pushes for Nino's app (hourly, from the scheduled run): one notification for the designs that entered
// their 24-hour early access since the last one. Remembers the ids it announced (worker_settings, last 200).
const DROPS_KEY = "nino_app_drops_announced";
async function announceNinoDrops(env, { fetchImpl = fetch, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!env.DB) return { skipped: "no_db" };
  const res = await fetchImpl(`${NINO_API}/api/releases`, { headers: { Accept: "application/json" } });
  if (!res.ok) return { skipped: `releases_${res.status}` };
  const body = await res.json();
  const early = (body?.designs || []).filter((d) => Number(d.released_at) > nowSeconds - EARLY_SECONDS && /^\d{1,20}$/.test(String(d.id)));
  if (!early.length) return { none: true };
  const row = await env.DB.prepare(`SELECT value FROM worker_settings WHERE key = ?`).bind(DROPS_KEY).first();
  let done = [];
  try { done = JSON.parse(row?.value || "[]"); } catch { done = []; }
  const fresh = early.filter((d) => !done.includes(String(d.id)));
  if (!fresh.length) return { none: true };
  const app = await env.DB.prepare(`SELECT id FROM guest_apps WHERE slug = 'ninos-ts' LIMIT 1`).first();
  if (!app) return { skipped: "no_app" };
  const name = clean(fresh[0].title, 40);
  const sent = await queuePush(env, app.id, fresh.length === 1
    ? { title: `New design: ${name}`, body: "It's in the app now, 24 hours before the website.", source: "NEW_DESIGN" }
    : { title: `${fresh.length} new Nino designs`, body: `${name} and more, in the app now, 24 hours before the website.`, source: "NEW_DESIGN" });
  if (!sent.ok && sent.reason !== "empty") return { skipped: sent.reason };
  const next = [...fresh.map((d) => String(d.id)), ...done].slice(0, 200);
  await env.DB.prepare(`INSERT INTO worker_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(DROPS_KEY, JSON.stringify(next), new Date().toISOString()).run();
  return { announced: fresh.map((d) => String(d.id)) };
}

const hybridUrl = (key) => (HYBRID_KEYS.has(key) ? `${MM}/api/app-hybrid/${key}` : "");
// Each app's picture for the loading screen (spins while the content loads) and, for Nino, the app icon
// (owner, Nov 8: Nino's blue "N" mark; the file is in this repo, so the build draws the icon from it).
const HYBRID_LOOK = {
  menumade: { logo_url: `${MM}/MENU%3D.png` },
  // Owner, Nov 8: the logo animation plays once as the app opens (clip #4, NinoLogoAnimation, no sound); the ring of
  // fire N (clip #6, NinoGif1, background removed) shows whenever something is loading.
  nino: { logo_url: `${MM}/assets/own-apps/nino-app-logo.png`, icon_file: "assets/own-apps/nino-app-logo.png",
    intro_url: `${MM}/assets/own-apps/nino-intro.mp4`, loader_url: `${MM}/assets/own-apps/nino-loader.webp` }
};
const hybridLookForBundle = (bundleId) => HYBRID_LOOK[HYBRID_BUNDLES.get(String(bundleId || ""))] || null;
const hybridUrlForBundle = (bundleId) => hybridUrl(HYBRID_BUNDLES.get(String(bundleId || "")) || "");

export { announceNinoDrops, hybridLookForBundle, HYBRID_BUNDLES, HYBRID_KEYS, hybridUrlForBundle, TTL as HYBRID_TTL, handleHybridContent, hybridUrl, menumadeContent, ninoContent };
