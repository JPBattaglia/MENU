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
if (!/^https:\/\//.test(cfg.api_base || "")) throw new Error("api_base must be https");

writeFileSync(join(here, "capacitor.config.json"), JSON.stringify({
  appId: cfg.app_id,
  appName: name,
  webDir: "www",
  backgroundColor: cfg.brand_color,
  plugins: { PushNotifications: { presentationOptions: ["badge", "sound", "alert"] } }
}, null, 2));

writeFileSync(join(here, "www", "config.json"), JSON.stringify({
  app_name: name, brand_color: cfg.brand_color, api_base: cfg.api_base
}, null, 2));

console.log(`Configured ${cfg.app_id} v${cfg.version || "1.0.0"} (${cfg.build_number || 1})`);
