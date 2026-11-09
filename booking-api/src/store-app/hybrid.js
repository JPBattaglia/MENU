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

const TTL = 300;
const MM = "https://menu-made.com";
const NINO = "https://ninobattaglia.com";
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
function ninoContent(catalog) {
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
  products.sort((a, b) => Number(b.featured) - Number(a.featured));
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
    tabs: ["shop", "work", "rewards", "cart"],
    collections,
    products,
    shop_note: "Every design is printed to order. Free 3-inch sticker of the design with every order.",
    links: { work: `${NINO}/art.html`, cart: `${NINO}/cart.html`, services: `${NINO}/services.html`, help: `${NINO}/support.html` },
    rewards: { enabled: false, note: "Points on every order are on the way. Turn on notifications to hear about new designs first." }
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
  const res = await fetchImpl(`${NINO}/catalog.json`, { headers: { Accept: "application/json", "User-Agent": "MenuMadeApp/1.0" }, cf: { cacheTtl: TTL } });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return ninoContent(await res.json());
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
const hybridUrl = (key) => (HYBRID_KEYS.has(key) ? `${MM}/api/app-hybrid/${key}` : "");
const hybridUrlForBundle = (bundleId) => hybridUrl(HYBRID_BUNDLES.get(String(bundleId || "")) || "");

export { HYBRID_BUNDLES, HYBRID_KEYS, hybridUrlForBundle, TTL as HYBRID_TTL, handleHybridContent, hybridUrl, menumadeContent, ninoContent };
