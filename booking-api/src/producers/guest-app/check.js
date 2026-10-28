// Automated checks on a built Guest App before anyone sees it (stage 8): the page passes the accessibility scan with zero
// findings and has no placeholder text; the manifest has everything Chrome and Safari need to install it (name, short
// name, standalone display, start URL inside its scope, 192 and 512 pixel icons, a maskable icon); the page links the
// manifest, Apple icon and script; the owner's phone, address and hours are on the page; sizes stay small.
import { scanHtml } from "../accessibility/scan.js";
import { parseHours } from "../website/build.js";

const PLACEHOLDER = /lorem ipsum|\bTODO\b|\bTBD\b|\[(?:name|business|phone|address)\]|your (?:business|company) name|example\.com|undefined|\bnull\b|__LOGO_DATA_URI__/i;
const MAX_FILE_BYTES = 200_000;
const MAX_ICON_BYTES = 1_000_000;
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

function checkApp({ files, icons = {}, app }) {
  const problems = [];
  for (const name of ["index.html", "manifest.webmanifest", "app.js", "sw.js"]) if (typeof files[name] !== "string") problems.push(`${name} is missing`);
  if (problems.length) return problems;
  for (const [name, text] of Object.entries(files)) {
    const size = new TextEncoder().encode(text).length;
    if (size > MAX_FILE_BYTES) problems.push(`${name}: ${Math.round(size / 1024)} KB, over the ${MAX_FILE_BYTES / 1000} KB limit`);
  }
  const html = files["index.html"];
  for (const f of scanHtml(html)) problems.push(`index.html: accessibility - ${f.rule} (${f.count}) ${f.examples[0] || ""}`.trim());
  if (PLACEHOLDER.test(html.replace(/<style[\s\S]*?<\/style>/gi, ""))) problems.push("index.html: contains placeholder-looking text");
  for (const needed of ['rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon" href="icons/apple-touch-icon.png"', 'src="app.js"', 'name="viewport"', 'name="theme-color"']) {
    if (!html.includes(needed)) problems.push(`index.html: missing ${needed}`);
  }
  if (!html.includes(`tel:${String(app.phone).replace(/[^\d+]/g, "")}`)) problems.push("index.html: the phone number is missing");
  if (!html.includes(esc(app.address))) problems.push("index.html: the address is missing");
  for (const h of parseHours(app.hours)) if (!html.includes(esc(h.time))) problems.push(`index.html: hours line "${h.time}" is missing`);
  if (!/navigator\.serviceWorker\.register\("sw\.js"/.test(files["app.js"])) problems.push("app.js: does not register the service worker");
  if (!/addEventListener\("fetch"/.test(files["sw.js"])) problems.push("sw.js: has no fetch handler, so the app would not work offline");

  let manifest;
  try { manifest = JSON.parse(files["manifest.webmanifest"]); } catch { return [...problems, "manifest.webmanifest is not valid JSON"]; }
  if (!manifest.name) problems.push("manifest: name is missing");
  if (!manifest.short_name || manifest.short_name.length > 12) problems.push("manifest: short_name is missing or longer than 12 characters");
  if (!["standalone", "fullscreen", "minimal-ui"].includes(manifest.display)) problems.push("manifest: display must be standalone");
  if (manifest.start_url !== "./" || manifest.scope !== "./") problems.push("manifest: start_url and scope must both be ./");
  if (!/^#[0-9a-f]{6}$/i.test(manifest.theme_color || "")) problems.push("manifest: theme_color is missing");
  const list = Array.isArray(manifest.icons) ? manifest.icons : [];
  const has = (size, purpose) => list.some((i) => i.sizes === `${size}x${size}` && i.type === "image/png" && (i.purpose || "any").split(" ").includes(purpose));
  if (!has(192, "any")) problems.push("manifest: a 192x192 PNG icon is required");
  if (!has(512, "any")) problems.push("manifest: a 512x512 PNG icon is required");
  if (!has(512, "maskable")) problems.push("manifest: a 512x512 maskable icon is required");
  for (const icon of [...list.map((i) => i.src), "icons/apple-touch-icon.png"]) {
    if (!(icon in icons)) problems.push(`${icon} is not in the app`);
    else if (icons[icon] > MAX_ICON_BYTES) problems.push(`${icon} is ${Math.round(icons[icon] / 1024)} KB, over the limit`);
  }
  return problems;
}

export { checkApp };
