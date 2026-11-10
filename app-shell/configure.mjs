// Turns one restaurant's build config into the files Capacitor reads. No secrets pass through here.
// Usage: node app-shell/configure.mjs app-shell/sample/build.json
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));

const APP_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/; // valid for both Apple bundle ids and Android packages
if (!APP_ID.test(cfg.app_id || "")) throw new Error("app_id must look like com.menumade.name (lowercase letters and digits)");
if (!/^#[0-9a-f]{6}$/i.test(cfg.brand_color || "")) throw new Error("brand_color must be #rrggbb");
const name = String(cfg.app_name || "").trim();
if (!name || name.length > 30) throw new Error("app_name must be 1-30 characters (App Store limit)");
// The name under the icon on the phone (CFBundleDisplayName on iPhone, the launcher label on Android). Defaults to
// app_name, which stays the App Store and Google Play listing name.
const label = String(cfg.app_label || "").trim() || name;
if (label.length > 30 || /[<>&"]/.test(label)) throw new Error("app_label must be 1-30 characters without < > & or quotes");
if (!/^https:\/\//.test(cfg.api_base || "")) throw new Error("api_base must be https");

// Site apps (the owner's own apps, booking-api/src/store-app/own-apps.js): the app opens the business's whole website
// inside the app. Its own domain and Stripe's checkout stay in the app (buying never leaves it); any other site opens
// in the phone's browser.
// Hybrid apps (booking-api/src/store-app/hybrid.js, owner decision Nov 8): real app screens drawn from live JSON at
// hybrid_url; the website opens in the in-app browser (@capacitor/browser) for checkout, cart and long pages. A hybrid
// app ignores site_url.
let hybrid = "";
if (cfg.hybrid_url) {
  if (!/^https:\/\/menu-made\.com\/api\/app-hybrid\/[a-z]{1,20}$/.test(cfg.hybrid_url)) throw new Error("hybrid_url must be https://menu-made.com/api/app-hybrid/<key>");
  hybrid = cfg.hybrid_url;
}
let site = null;
if (cfg.site_url && !hybrid) {
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(cfg.site_url)) throw new Error("site_url must be an https address");
  const host = new URL(cfg.site_url).hostname.replace(/^www\./, "");
  site = { url: cfg.site_url, hosts: [host, `www.${host}`, "checkout.stripe.com", "*.stripe.com", "*.stripe.network"] };
}

writeFileSync(join(here, "capacitor.config.json"), JSON.stringify({
  appId: cfg.app_id,
  appName: label,
  webDir: "www",
  backgroundColor: cfg.brand_color,
  ...(site ? { server: { allowNavigation: site.hosts } } : {}),
  plugins: { PushNotifications: { presentationOptions: ["badge", "sound", "alert"] } }
}, null, 2));

writeFileSync(join(here, "www", "config.json"), JSON.stringify({
  app_name: name, brand_color: cfg.brand_color, api_base: cfg.api_base, app_id: cfg.app_id,
  ...(hybrid ? { hybrid_url: hybrid } : {}),
  // The loading screen's picture (spins while the content loads); menu-made.com only.
  ...(hybrid && /^https:\/\/menu-made\.com\/[A-Za-z0-9%=._\/-]+\.png$/.test(cfg.logo_url || "") ? { logo_url: cfg.logo_url } : {}),
  // The opening clip (plays once as the app opens, no sound) and the loading animation; menu-made.com only.
  ...(hybrid && /^https:\/\/menu-made\.com\/[A-Za-z0-9%=._\/-]+\.mp4$/.test(cfg.intro_url || "") ? { intro_url: cfg.intro_url } : {}),
  ...(hybrid && /^https:\/\/menu-made\.com\/[A-Za-z0-9%=._\/-]+\.(webp|gif|png)$/.test(cfg.loader_url || "") ? { loader_url: cfg.loader_url } : {}),
  ...(site ? { site_url: site.url, site_screens: (Array.isArray(cfg.site_screens) ? cfg.site_screens : []).filter((p) => /^\/[A-Za-z0-9._\/-]*$/.test(p)).slice(0, 3) } : {}),
  // TestFlight and App Store builds use Apple's production push service; only Xcode debug builds use sandbox.
  push_environment: cfg.push_environment === "sandbox" ? "sandbox" : "production"
}, null, 2));

console.log(`Configured ${cfg.app_id} v${cfg.version || "1.0.0"} (${cfg.build_number || 1})`);
