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
import { MENU_PACKAGE_PRICING } from "../checkout/quote.js";
import { HOLIDAY_PRICING, OCCASION_NAMES, holidayOnSale } from "../checkout/holiday.js";
import { SERVICES as SWITCHED, offSwitches } from "../lib/switches.js";
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

// offCodes: offer codes the owner has switched off for sale (lib/switches.js); they leave the services list.
function menumadeContent(catalog, { offCodes = [], now = Date.now() } = {}) {
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
  // Services (the Account tab's own list, so "All services" no longer opens the website): everything on sale that
  // isn't a bundle or one of Nino's design services, with its price from the same catalog.
  const dollars = (cents) => `$${(Number(cents) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const menuPrice = dollars(MENU_PACKAGE_PRICING.setupCents + MENU_PACKAGE_PRICING.hostingFirstYearCents);
  const services = offers.filter((o) => o && o.on_sale && o.kind !== "BUNDLE" && !PLAN_ORDER.includes(o.code) && !offCodes.includes(o.code) && !/^NINO_/.test(String(o.code || "")) && o.name)
    // Online Menu + QR is sold as setup plus the first year's hosting, the price "Make it live" shows.
    .map((o) => ({ name: clean(o.name, 60), text: clean(o.short_description, 220), price: o.code === "ONLINE_MENU_QR" ? `${menuPrice} first year` : o.prices?.month ? `${dollars(o.prices.month)}/mo` : o.price_cents ? dollars(o.price_cents) : "" }))
    .filter((x) => x.price).slice(0, 20);
  const occasions = offCodes.includes("HOLIDAY_MENU") || !byCode.get("HOLIDAY_MENU")?.on_sale ? [] : ["christmas", "newyear"].filter((o) => holidayOnSale(o, now)).map((o) => ({ key: o, label: OCCASION_NAMES[o] }));
  const holidayPrice = dollars(HOLIDAY_PRICING.firstCents);
  const first = occasions[0]?.key;
  const which = occasions.map((o) => o.label).join(" or ");
  const holidayGenerators = occasions.length ? [{
    key: "holiday", noun: "holiday menu", title: "Holiday menu generator", count: 6, badge: `${holidayPrice} per holiday`,
    text: `A ${which} menu with its own link and QR code, apart from your regular menu.`,
    card_title: "Holiday Menu", card_text: `Your ${which} menu as a phone menu with its own QR code, in six holiday designs. Keep your regular menu as it is.`, card_action: "Try it free",
    occasions, occasion_label: "Which holiday is this menu for?", file_label: "Your holiday menu",
    // The banner on Home and the pop-up a few seconds after the app opens (owner, Nov 11, 2026: "there's no holiday
    // banner or pop up"), worded as on the website (index.html's holiday strip, holiday-popup.js).
    strip: { lead: "Holiday special:", text: `your ${occasions.map((o) => o.label).join(" and ")} ${occasions.length > 1 ? "menus" : "menu"} online with a QR code, ${holidayPrice} per holiday.`, action: "See my holiday menu free" },
    popup: {
      icons: first === "christmas" ? "🎄🎁❄️" : "🥂✨🎉", kicker: "Holiday special",
      title: `Get your ${OCCASION_NAMES[first]} menu online`,
      text: "Your holiday menu as a phone page with its own QR code, a print PDF and a table tent. It sits beside the menu you already have.",
      price: holidayPrice, price_note: occasions.length > 1 ? `per holiday, or ${dollars(HOLIDAY_PRICING.firstCents + HOLIDAY_PRICING.secondCents)} for Christmas and New Year's Eve` : "nothing renews",
      action: "See my holiday menu free", later: "Not now"
    },
    // The six designs to look through before uploading (owner, Nov 11, 2026: "include the 6 templates available to
    // review first like the site offers"): the Holiday Menu page's "Six holiday designs" section, same words and
    // pictures (holiday-menu.html #designs, assets/holiday), each opening full size.
    designs: {
      title: "Nine holiday designs",
      text: "Three for Christmas, three for New Year's Eve and three that suit either. Your menu is shown in the six that fit your holiday, so you can pick the one you like. Tap a design to see it full size.",
      action: "See my menu in it free",
      groups: [
        { title: "Christmas", items: [
          ["evergreen", "Evergreen", "Pine green and gold, holly, falling snow", "pine green and gold with holly and falling snow"],
          ["candycane", "Candy Cane", "Red and white stripes, price tags", "red and white stripes with red section banners"],
          ["silentnight", "Silent Night", "Midnight blue, gold stars, baubles", "midnight blue with gold stars and hanging baubles"]] },
        { title: "New Year's Eve", items: [
          ["midnight", "Midnight Gold", "Black and gold, fireworks", "black and gold with fireworks over the name"],
          ["champagne", "Champagne", "Ivory and gold, rising bubbles", "ivory and champagne gold with rising bubbles"],
          ["confetti", "Confetti", "Deep violet, bright confetti", "deep violet with bright confetti and bold cards"]] },
        // Owner, Nov 12, 2026: three that fit either holiday; each holiday's generator shows its own three and these.
        { title: "Either holiday", items: [
          ["winterlights", "Winter Lights", "Winter blue and silver, snowflakes, a string of lights", "winter blue, white and silver with snowflakes and a string of lights under the name"],
          ["candlelight", "Candlelight", "Warm espresso and amber, framed title", "warm espresso and amber with a framed title and centred courses"],
          ["silvergold", "Silver and Gold", "Soft silver and warm gold, rounded cards", "soft silver and warm gold with gold stars and rounded cards in a fine frame"]] }
      ].map((group) => ({ title: group.title, items: group.items.map(([file, name, note, alt]) => ({
        name, note, alt: `${name} design: ${alt}`, image: `${MM}/assets/holiday/${file}.webp`, large: `${MM}/assets/holiday/${file}-large.webp` })) }))
    },
    form_text: "Upload your holiday menu. You'll see it as a phone menu in six holiday designs.",
    create_url: `${MM}/api/menu-preview/create`, state_url: `${MM}/api/menu-preview/state/`, start: "Make my holiday menu preview",
    busy: ["Reading your holiday menu…", "Finding the courses, dishes and prices…", "Drawing your menu in six holiday designs…"], wait: "This takes about a minute. Keep the app open.",
    buttons: [
      { label: "Generate menu", text: "Shows your menu in the next of six holiday designs. Tap it as often as you like." },
      { label: "Customize", text: "Adds your logo, your colour and the line under your name, on every design." },
      { label: "Make it live", text: `Orders the design on screen: ${holidayPrice} for one holiday, live through the day after it. A second holiday menu this season is ${dollars(HOLIDAY_PRICING.secondCents)}. Nothing renews.` }
    ]
  }] : [];
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
    // Home (owner, Nov 10, 2026: "looks wrong and needs to be better since it's the first thing a user sees"):
    // a picture, what the app does in one line, the two generators, real work, then the steps and plans.
    hero: {
      title: "Your menu and your website, made from the menu you already have",
      text: "Upload a PDF or a photo of your menu. See it as a phone menu and as a whole website, free, before you checkout.",
      image: `${MM}/home-digital-presence.webp`, action: "Try a free menu preview"
    },
    steps: [
      { title: "Upload your menu", text: "A PDF or a photo is all we need" },
      { title: "Pick a design", text: "Nine for your menu, nine for your website" },
      { title: "Make it live", text: "Checkout only when it looks right" }
    ],
    // The two generators (the Preview tab). Each runs inside the app: the form, the wait, the designs in a frame on the
    // app's own screen and its three buttons. buttons = what the chooser page says each of the three does.
    upload_url: `${MM}/api/inquiry`,
    generators: [
      { key: "menu", title: "Menu generator", count: 9, text: "Your printed menu becomes a phone menu page with a QR code.",
        create_url: `${MM}/api/menu-preview/create`, state_url: `${MM}/api/menu-preview/state/`, start: "Make my menu preview",
        busy: ["Reading your menu…", "Finding the sections, dishes and prices…", "Drawing your menu in nine designs…"], wait: "This takes about a minute. Keep the app open.",
        buttons: [
          { label: "Generate menu", text: "Shows your menu in the next of nine designs. Tap it as often as you like." },
          { label: "Customize", text: "Adds your logo, your colour and your name the way you want it, on every design." },
          { label: "Make it live", text: `Orders the design on screen: your menu online with its QR code, ${menuPrice} for the first year.` }
        ] },
      { key: "site", title: "Website generator", count: 9, text: "The same menu becomes a whole website: home, menu, about and contact pages.",
        create_url: `${MM}/api/website-preview/create`, state_url: `${MM}/api/website-preview/state/`, start: "Build my website preview", city: true,
        busy: ["Reading your menu…", "Writing your pages…", "Building your website in nine designs…"], wait: "This takes a minute or two. Keep the app open.",
        buttons: [
          { label: "Generate site", text: "Shows your website in the next of nine designs. Tap it as often as you like." },
          { label: "Customize", text: "Adds your logo, photos, colour, hours and links to every design." },
          { label: "Choose this site", text: "Orders the design on screen: $299 for the whole site as files you own. Hosting is optional." }
        ] }
    ],
    // In season (owner, Nov 11, 2026: "add holiday addition to the menu app"): the Holiday menu generator, for the
    // holidays still on sale (checkout/holiday.js). A field of its own, because app builds from before this have no
    // words for a third generator; they don't read it and keep their two.
    seasonal: holidayGenerators,
    // Kept for app builds from before Nov 10, 2026 (their Preview tab reads these).
    preview: { create_url: `${MM}/api/menu-preview/create`, upload_url: `${MM}/api/inquiry`, more_url: `${MM}/online-menu.html` },
    plans,
    plans_note: "On a yearly plan the menu setup and first-year hosting are free.",
    services,
    // Work we've made (the Account tab's own gallery; the pictures are the ones on menu-made.com/portfolio.html).
    work: [
      { title: "Fahy's Fog & Barrel", text: "Website and menu", image: `${MM}/assets/work/fahys-website.webp` },
      { title: "My Happy Donut", text: "Website and menu", image: `${MM}/assets/work/happy-donut-website.webp` },
      { title: "Pinecrest Diner", text: "Dinner menu as a phone page", image: `${MM}/assets/work/pinecrest-dinner-preview.webp` },
      { title: "Ella's Wood Fired Pizza", text: "Printed menu", image: `${MM}/assets/work/ellas-menu.webp` },
      { title: "Li Po", text: "Website", image: `${MM}/assets/work/lipo-website.webp` },
      { title: "Nino Battaglia", text: "Website and shop", image: `${MM}/assets/work/nino-website.webp` }
    ],
    contact: { email: "info@menu-made.com" },
    links: [
      { label: "Your account", text: "Orders, plans and billing", url: `${MM}/account.html` },
      { label: "All services", text: "Everything Menu-made does", url: `${MM}/services.html`, screen: "services" },
      { label: "Our work", text: "Sites and menus we've made", url: `${MM}/portfolio.html`, screen: "work" },
      { label: "Contact us", text: "info@menu-made.com", url: `${MM}/contact.html`, mailto: "info@menu-made.com" }
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
    const off = await offSwitches(env);
    return menumadeContent(catalog, { offCodes: SWITCHED.filter((x) => off.has(`sell:${x.key}`) || off.has("sell:ALL")).flatMap((x) => x.offers) });
  }
  const [res, rel] = await Promise.all([
    fetchImpl(`${NINO}/catalog.json`, { headers: { Accept: "application/json", "User-Agent": "MenuMadeApp/1.0" }, cf: { cacheTtl: TTL } }),
    fetchImpl(`${NINO_API}/api/releases`, { headers: { Accept: "application/json" } }).catch(() => null)
  ]);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const releases = rel?.ok ? await rel.json().catch(() => null) : null;
  return ninoContent(await res.json(), releases);
}

async function handleHybridContent(request, env, key, { fetchImpl = fetch, cacheStore = globalThis.caches?.default, ctx = null } = {}) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" } });
  if (request.method !== "GET") return jsonOut({ ok: false, error: "Not found" }, 404);
  if (!HYBRID_KEYS.has(key)) return jsonOut({ ok: false, error: "Not found" }, 404);
  if (env.DB) { const counting = countAppOpen(request, env, key).catch(() => null); if (ctx?.waitUntil) ctx.waitUntil(counting); else await counting; }
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  if (cacheStore) {
    const hit = await cacheStore.match(cacheKey).catch(() => null);
    if (hit) return hit;
  }
  let content;
  try { content = await buildContent(env, key, fetchImpl); } catch { return jsonOut({ ok: false, error: "Temporarily unavailable" }, 503); }
  // Website pages the MENU-MADE app opens carry mm_app=1, so the site leaves out its "Get the app" buttons there
  // (owner, Nov 13, 2026). The Nino app already adds its own ?app=<member key> to every ninobattaglia.com link.
  if (key === "menumade") content = tagAppPages(content);
  const response = jsonOut({ ...content, updated_at: new Date().toISOString() }, 200, TTL);
  if (cacheStore) await cacheStore.put(cacheKey, response.clone()).catch(() => null);
  return response;
}

// App opens (owner, Nov 13, 2026). Only the apps themselves count: their screens run at capacitor://localhost (iPhone)
// or https://localhost (Android), and the browser sends that as Origin. A device is a hash with a salt that changes
// daily, so the numbers say how many phones opened the app on a day, never who.
function appPlatform(request) {
  const origin = request.headers.get("Origin") || "";
  if (origin === "capacitor://localhost") return "ios";
  if (origin === "https://localhost" || origin === "http://localhost") return "android";
  return null;
}
function pacificDay(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
async function countAppOpen(request, env, key, now = Date.now()) {
  const platform = appPlatform(request);
  if (!platform) return false;
  const day = pacificDay(now);
  const raw = `${day}|${env.PRODUCTION_RUNNER_SECRET || "app-opens"}|${request.headers.get("CF-Connecting-IP") || ""}|${request.headers.get("User-Agent") || ""}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  const device = [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO app_opens (day, app, platform, opens) VALUES (?, ?, ?, 1) ON CONFLICT(day, app, platform) DO UPDATE SET opens = opens + 1").bind(day, key, platform),
    env.DB.prepare("INSERT OR IGNORE INTO app_open_devices (day, app, platform, device) VALUES (?, ?, ?, ?)").bind(day, key, platform, device)
  ]);
  return true;
}

// Adds mm_app=1 to every menu-made.com page address in the app's content (not /api/ addresses, images or videos).
const APP_PAGE = /^https:\/\/menu-made\.com\/(?!api\/)([^?#]*)(\?[^#]*)?(#.*)?$/;
function tagAppPages(value) {
  if (typeof value === "string") {
    const m = APP_PAGE.exec(value);
    if (!m || !(m[1] === "" || /\.html$/.test(m[1]) || !/\.[a-z0-9]+$/i.test(m[1]))) return value;
    if (/[?&]mm_app=1(&|$)/.test(m[2] || "")) return value;
    return `https://menu-made.com/${m[1]}${m[2] ? `${m[2]}&` : "?"}mm_app=1${m[3] || ""}`;
  }
  if (Array.isArray(value)) return value.map(tagAppPages);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tagAppPages(v)]));
  return value;
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
// label: the name under the app's icon on the phone (owner, Nov 10, 2026: "just Nino" and "just MΞNU"). The App Store
// and Google Play listing names stay Nino Battaglia and MENU-MADE (app_name).
const HYBRID_LOOK = {
  // icon_bg: the icon's own background (owner, Nov 10, 2026: "needs a darker background so the logo contrasts better";
  // the brand teal #013f45 was too close to the gear's cyan). Of five shown he picked the second, #012a30 ("B").
  // icon_file: the gear brightened for the icon only (owner, Nov 10, 2026, after the darker background: "the logo
  // needs to be brighter"); made from MENU=.png (brightness 1.6, contrast 1.05, colour 1.15). In the app the gear is unchanged.
  menumade: { logo_url: `${MM}/MENU%3D.png`, label: "M\u039eNU", icon_bg: "#012a30", icon_file: "assets/own-apps/menumade-icon-logo.png" },
  // Owner, Nov 8: the logo animation plays once as the app opens (no sound); the ring of fire N (clip #6, NinoGif1,
  // background removed) shows whenever something is loading. Nov 10, 2026: "Replace splash with this one", his
  // Neon_Light_Rays_Intro_720p.mp4 (the red and black logo lighting up, 5 seconds, upright 720 x 1280), re-encoded
  // without its sound track. It has a new file name so a phone never plays a remembered copy of the old clip in the
  // new upright layout. For twenty minutes that evening the clip was redrawn with the orange and gold logo (Claude
  // misread "needs the new icon"); the owner: "That's not going to work, put it back the way it was". So the clip is
  // his file again, red and black logo and all, and it stays that way while the icon is orange and gold. All three
  // file names (nino-intro.mp4, nino-intro-neon.mp4, nino-intro-gold.mp4) hold his clip, because builds 72 to 78
  // each ask for one of them.
  // Icon (owner, Nov 10, 2026; five drawings tried that afternoon and evening). Current: his second
  // NinoLogoRevision_3 file (orange and gold mark and ring on a deep red disc, transparent corners, 423 px), sent at
  // 5:34 pm after seeing the red and black NinoLogo2024OB icon on his phone: "App icon doesn't look right, try making
  // one with this". nino-icon-logo.png is that file enlarged to 1024 px, unaltered otherwise; icon_bg is a warm
  // near-black; icon_pad / icon_pad_android say how far in the disc sits (Android's stays inside the launcher's
  // safe circle; owner on the first build of it: "put a little more space between the logo and the edges", so the
  // margin went from 5% to 10% a side, and that is the one he then named as the icon to use). The opening clip shows the red and black logo, on purpose. In the app the header logo and loader are
  // unchanged (logo_url).
  // Superseded Nov 13, 2026 (owner: "change the Nino App icon to this with the same white color background"): his
  // red-ring, navy-and-blue N disc (3788.jpg). nino-icon-logo.png is that picture squared to 1024 px with its black
  // corners and outer white band flattened to the band's own colour #dddad5, and icon_bg is that same colour, so the
  // disc's white band runs straight into the icon's background with no seam. Same 10% / 22% margins as before.
  nino: { label: "Nino", logo_url: `${MM}/assets/own-apps/nino-app-logo.png`, icon_file: "assets/own-apps/nino-icon-logo.png",
    icon_bg: "#dddad5", icon_pad: 0.1, icon_pad_android: 0.22,
    intro_url: `${MM}/assets/own-apps/nino-intro-neon.mp4`,
    // Loading animation (owner, Nov 11, 2026: "Use this and just make it rotate slowly"): his NinoLogoAppIcon copy.png
    // (the red and navy mark in its ring, 512 px, see-through background), unaltered, turned by the app once every
    // loader_spin seconds. It replaces the ring of fire N (nino-loader.webp, kept for the builds that still ask for it).
    loader_url: `${MM}/assets/own-apps/nino-loader-logo.png`, loader_spin: 8 }
};
// Holiday app icons (owner, Nov 13, 2026: the MΞNU app icon becomes his Christmas gear, the candy-cane bars in a
// snowy holly wreath, through Dec 31, then back to the regular gear). A build made inside the window (Pacific
// dates, month-day) draws the holiday picture; the first build after it draws the regular one again. The worker's
// tick queues that rebuild on Jan 1 (holidayIconRebuilds in store-build.js), so the icon goes back by itself.
const HOLIDAY_ICONS = {
  menumade: { icon_file: "assets/own-apps/menumade-icon-logo-xmas.png", from: "11-13", to: "12-31" }
};
const holidayIconOn = (key, now = Date.now()) => {
  const h = HOLIDAY_ICONS[key];
  if (!h) return null;
  const md = pacificDay(now).slice(5);
  return md >= h.from && md <= h.to ? h : null;
};
const hybridLookForBundle = (bundleId, now = Date.now()) => {
  const key = HYBRID_BUNDLES.get(String(bundleId || ""));
  const look = HYBRID_LOOK[key];
  if (!look) return null;
  const h = holidayIconOn(key, now);
  return h ? { ...look, icon_file: h.icon_file } : look;
};
const hybridUrlForBundle = (bundleId) => hybridUrl(HYBRID_BUNDLES.get(String(bundleId || "")) || "");

export { appPlatform, countAppOpen, pacificDay, HOLIDAY_ICONS, holidayIconOn, tagAppPages, announceNinoDrops, hybridLookForBundle, HYBRID_BUNDLES, HYBRID_KEYS, hybridUrlForBundle, TTL as HYBRID_TTL, handleHybridContent, hybridUrl, menumadeContent, ninoContent };

// Store links for the owner's own apps, for the "Get the app" buttons on menu-made.com and ninobattaglia.com
// (owner, Nov 10, 2026). A store's link is given only once that store has the app public (store_app_listings:
// Apple's state live, Google's page public), so the buttons appear by themselves on launch day and never point
// at a page that isn't there. Public data, cached 10 minutes, CORS "*".
async function appStoreLinks(env, key) {
  const bundle = [...HYBRID_BUNDLES].find(([, k]) => k === key)?.[0];
  if (!bundle || !env.DB) return { ok: true, apple: null, google: null };
  const row = await env.DB.prepare(`SELECT l.apple_json, l.google_json FROM store_apps a JOIN store_app_listings l ON l.store_app_id = a.id WHERE a.bundle_id = ? AND a.own_app = 1 LIMIT 1`).bind(bundle).first().catch(() => null);
  const parse = (t) => { try { return JSON.parse(t || "{}") || {}; } catch { return {}; } };
  const apple = parse(row?.apple_json), google = parse(row?.google_json);
  return {
    ok: true,
    apple: apple.live && /^\d+$/.test(String(apple.appId || "")) ? `https://apps.apple.com/app/id${apple.appId}` : null,
    google: google.live ? `https://play.google.com/store/apps/details?id=${bundle}` : null
  };
}
export async function handleAppStoreLinks(request, env, key) {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=600" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET" } });
  return new Response(JSON.stringify(await appStoreLinks(env, key)), { headers });
}
