// Guest App builder (stage 8): one installable page (PWA) built only from the owner's answers.
// Files, all served under <slug>.menu-made.com/app/:
//   index.html            quick actions (call, directions, order, reserve), specials, menu, hours and location
//   manifest.webmanifest  what phones read to install it: name, short name, colours, icons, start URL and scope
//   app.js                registers the service worker (generated sites forbid inline scripts)
//   sw.js                 keeps the app usable offline: cached app shell, network first for the page
//   icons/*.png           drawn by the GitHub renderer from iconSpecs() (see social-posts/render-jobs.js)
import { parseHours, parseOfferings } from "../website/build.js";
import { hexOk, readableOn } from "../website/styles.js";
import { CLIENT_JS, CLIENT_VERSION, PUSH_SW } from "./client.js";

const DEFAULT_BRAND = "#1f4e5f";
const LOGO_PLACEHOLDER = "__LOGO_DATA_URI__"; // replaced by the renderer with the logo's data URI
const ICONS = [
  { path: "icons/icon-192.png", size: 192, purpose: "any" },
  { path: "icons/icon-512.png", size: 512, purpose: "any" },
  { path: "icons/maskable-512.png", size: 512, purpose: "maskable" },
  { path: "icons/apple-touch-icon.png", size: 180, purpose: "apple" }
];

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const digits = (phone) => String(phone || "").replace(/[^\d+]/g, "");
const brandOf = (app) => (hexOk(app.brand_color) ? app.brand_color.trim().toLowerCase() : DEFAULT_BRAND);

// The name under the home-screen icon: the owner's short name, else the app name cut at a word to 12 characters.
function shortNameOf(app) {
  const own = String(app.short_name || "").trim();
  if (own) return own.slice(0, 12);
  const name = String(app.app_name || "").trim();
  if (name.length <= 12) return name;
  const words = name.split(/\s+/);
  let out = "";
  for (const w of words) { if ((out ? `${out} ${w}` : w).length > 12) break; out = out ? `${out} ${w}` : w; }
  return out || name.slice(0, 12);
}

function initials(name) {
  const words = String(name || "").replace(/['\u2019]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "A").slice(0, 2)).toUpperCase();
}

// One SVG per icon size. With a logo: the logo centred on the brand colour (inside the 80% safe zone for "maskable",
// which phones crop to a circle or squircle). Without: the business initials.
function iconSpecs(app, { hasLogo }) {
  const brand = brandOf(app);
  const ink = readableOn(brand);
  return ICONS.map(({ path, size, purpose }) => {
    const pad = purpose === "maskable" ? 0.24 : purpose === "apple" ? 0.14 : 0.12;
    const inner = 512 * (1 - 2 * pad);
    const art = hasLogo
      ? `<image href="${LOGO_PLACEHOLDER}" x="${512 * pad}" y="${512 * pad}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid meet"/>`
      : `<text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="Liberation Sans" font-weight="bold" font-size="${Math.round(inner * 0.5)}" fill="${ink}">${esc(initials(app.app_name))}</text>`;
    const radius = purpose === "any" ? 96 : 0; // maskable and Apple icons are cropped by the phone itself
    return {
      name: path.replace(/^icons\//, ""), width: size, height: size, min_bytes: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${brand}"/>${art}</svg>`
    };
  });
}

function manifest(app) {
  const brand = brandOf(app);
  return JSON.stringify({
    name: String(app.app_name).slice(0, 45),
    short_name: shortNameOf(app),
    description: `${app.app_name}: menu, specials, hours and location.`,
    id: "./",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: brand,
    icons: ICONS.filter((i) => i.purpose !== "apple").map((i) => ({ src: i.path, sizes: `${i.size}x${i.size}`, type: "image/png", purpose: i.purpose }))
  }, null, 2);
}

// app.js: the offline worker registration plus notifications and rewards (client.js).
const APP_JS = CLIENT_JS;

function serviceWorker(version) {
  return `// Guest App offline worker (build ${version}). The page is fetched fresh when online and served from cache when not;
// icons and the manifest are cache-first. Old caches are removed when a new build activates.
const CACHE = "guest-app-${version}";
const SHELL = ["./", "manifest.webmanifest", "app.js", ${ICONS.map((i) => JSON.stringify(i.path)).join(", ")}];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put("./", copy));
      return response;
    }).catch(() => caches.match("./")));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
${PUSH_SW}`;
}

// The worker version an installed app sees: the build's own version plus the client code version, so a change to
// notifications or rewards reaches apps that were built earlier.
const workerVersion = (buildVersion) => `${buildVersion}-${CLIENT_VERSION}`;

function css(brand) {
  const on = readableOn(brand);
  return `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:#f6f7f8;color:#1b1f23;font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;overflow-wrap:anywhere}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:#fff;padding:8px;z-index:2}
header{background:${brand};color:${on};padding:calc(18px + env(safe-area-inset-top)) 18px 22px;text-align:center}header img{width:64px;height:64px;border-radius:14px;background:#fff;object-fit:contain}
h1{margin:8px 0 4px;font-size:26px;line-height:1.2}header p{margin:0;opacity:.9}
main{max-width:640px;margin:0 auto;padding:16px 16px 40px}
.actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:0 0 18px;padding:0;list-style:none}
.actions a{display:block;text-align:center;background:#fff;border:2px solid ${brand};color:#1b1f23;border-radius:12px;padding:14px 8px;font-weight:700;text-decoration:none}
section{background:#fff;border-radius:14px;padding:16px 18px;margin:0 0 14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h2{font-size:20px;margin:0 0 10px}h3{font-size:16px;margin:14px 0 4px;text-transform:uppercase;letter-spacing:.04em;color:#4b5560}
.menu ul{list-style:none;margin:0;padding:0}.menu li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;padding:10px 0;border-bottom:1px solid #e8ebee}
.menu .n{font-weight:700}.menu .p{font-weight:700}.menu .d{grid-column:1/2;color:#4b5560;font-size:15px}
dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 16px;margin:0}dt{font-weight:700}dd{margin:0}
.specials p{white-space:pre-line;margin:0}footer{text-align:center;color:#6b7580;font-size:13px;padding:0 16px calc(24px + env(safe-area-inset-bottom))}
a{color:#0b5d7a}`;
}

function buildApp(app, { version, hasLogo }) {
  const brand = brandOf(app);
  const sections = parseOfferings(app.menu);
  const hours = parseHours(app.hours);
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(app.address)}`;
  const actions = [
    `<li><a href="tel:${esc(digits(app.phone))}">Call</a></li>`,
    `<li><a href="${esc(map)}" rel="noopener">Directions</a></li>`,
    app.order_url ? `<li><a href="${esc(app.order_url)}" rel="noopener">Order online</a></li>` : "",
    app.reserve_url ? `<li><a href="${esc(app.reserve_url)}" rel="noopener">Book a table</a></li>` : ""
  ].join("");
  const specials = String(app.specials || "").trim()
    ? `<section class="specials" aria-labelledby="specials-h"><h2 id="specials-h">Specials</h2><p>${esc(app.specials)}</p></section>` : "";
  const menu = sections.length ? `<section class="menu" aria-labelledby="menu-h"><h2 id="menu-h">Menu</h2>${sections.map((s) => `${s.name ? `<h3>${esc(s.name)}</h3>` : ""}<ul>${s.items.map((i) => `<li><span class="n">${esc(i.name)}</span>${i.price ? `<span class="p">${esc(i.price)}</span>` : ""}${i.description ? `<span class="d">${esc(i.description)}</span>` : ""}</li>`).join("")}</ul>`).join("")}</section>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(app.app_name)}</title><meta name="description" content="${esc(`${app.app_name}: menu, specials, hours and location.`)}">
<meta name="theme-color" content="${brand}"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${esc(shortNameOf(app))}"><meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>${css(brand)}</style><script src="app.js" defer></script></head>
<body><a class="skip" href="#content">Skip to content</a>
<header>${hasLogo ? `<img src="icons/icon-192.png" alt="" width="64" height="64">` : ""}<h1>${esc(app.app_name)}</h1><p>${esc(app.address)}</p></header>
<main id="content"><ul class="actions" aria-label="Quick actions">${actions}</ul>${specials}${menu}
<section aria-labelledby="hours-h"><h2 id="hours-h">Hours and location</h2><dl>${hours.map((h) => `<dt>${esc(h.day || "Hours")}</dt><dd>${esc(h.time)}</dd>`).join("")}</dl>
<p><a href="${esc(map)}" rel="noopener">${esc(app.address)}</a><br><a href="tel:${esc(digits(app.phone))}">${esc(app.phone)}</a></p></section></main>
<footer>Add this app to your home screen to keep it one tap away.</footer></body></html>`;
  return {
    files: { "index.html": html, "manifest.webmanifest": manifest(app), "app.js": APP_JS, "sw.js": serviceWorker(workerVersion(version)) },
    icons: ICONS.map((i) => i.path)
  };
}

export { APP_JS, DEFAULT_BRAND, ICONS, LOGO_PLACEHOLDER, brandOf, buildApp, iconSpecs, initials, serviceWorker, shortNameOf, workerVersion };
