// Draws waiting Social Posts graphics and Guest App icons for the menu-checkout worker. Run by .github/workflows/render-social-posts.yml
// (every 5 minutes); see booking-api/src/producers/social-posts/render-jobs.js for why this runs outside the Worker.
//
// The repo is public, so its Actions logs are too: this script prints job ids and counts only, never a business name,
// menu text or image. Auth is the workflow's GitHub OIDC token (permissions: id-token: write); there is no secret.
//
// Local dry run against a saved spec (no network): node booking-api/scripts/render-social-posts.mjs --spec spec.json --out pack.zip
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createZip } from "../src/producers/social-posts/zip.js";

const API = process.env.RENDER_API || "https://menu-made.com";
const AUDIENCE = "menu-made-render";
const MAX_JOBS = 5;
const require = createRequire(import.meta.url);

// Display fonts for the Nino design services (open-licence Google Fonts, installed by the workflow from npm as
// @expo-google-fonts/* packages). Any that are missing are skipped: resvg then falls back to Liberation Sans.
async function displayFonts() {
  const root = new URL("../node_modules/@expo-google-fonts/", import.meta.url);
  const found = [];
  const walk = async (dir, depth) => {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && depth < 3) await walk(new URL(`${e.name}/`, dir), depth + 1);
      else if (e.isFile() && e.name.endsWith(".ttf")) found.push(new URL(e.name, dir));
    }
  };
  await walk(root, 0);
  return Promise.all(found.map((u) => readFile(u)));
}

let fontsLoaded = null;
async function rasterizer() {
  const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
  await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
  const base = await Promise.all(["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"]
    .map((f) => readFile(new URL(`../assets/fonts/${f}`, import.meta.url))));
  fontsLoaded = fontsLoaded || await displayFonts();
  const fonts = [...base, ...fontsLoaded];
  return (svg, width) => new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontBuffers: fonts.map((b) => new Uint8Array(b)), defaultFontFamily: "Liberation Sans", loadSystemFonts: false }
  }).render().asPng();
}

function pngSize(png) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

const escapeHtml = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// preview.html: small copies of the images on one page (Nino designs), so the owner and buyer can see the work
// without unzipping anything. Drawn here because the Worker's CPU budget is too small to encode images.
function previewPage(spec, rasterize, logo) {
  const byName = new Map(spec.files.map((f) => [f.name, f]));
  const img = (name) => {
    const file = byName.get(name);
    const width = spec.preview.widths?.[name] || 480;
    const png = rasterize(logo ? file.svg.replaceAll("__LOGO_DATA_URI__", logo) : file.svg, width);
    const checker = /transparent/.test(name) ? ' class="checker"' : "";
    return `<figure><img${checker} src="data:image/png;base64,${Buffer.from(png).toString("base64")}" alt="${escapeHtml(name)}" width="${width}"><figcaption>${escapeHtml(name)}</figcaption></figure>`;
  };
  const sections = spec.preview.sections.map((s) => `<section><h2>${escapeHtml(s.heading)}</h2><div class="grid">${s.files.map(img).join("")}</div></section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(spec.preview.title)}</title>
<style>body{margin:0;background:#f4f1ec;font:16px/1.5 system-ui,sans-serif;color:#1d1d1b}header{padding:28px 20px 8px;text-align:center}h1{margin:0;font-size:26px}main{max-width:1100px;margin:0 auto;padding:0 16px 48px}h2{font-size:18px;margin:28px 0 10px}.grid{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;background:#fff;border:1px solid #e3ddd2;border-radius:8px;padding:10px;max-width:100%}img{display:block;max-width:100%;height:auto}.checker{background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/24px 24px}figcaption{font-size:12px;color:#6b675f;margin-top:6px;word-break:break-all}</style></head>
<body><header><h1>${escapeHtml(spec.preview.title)}</h1><p>Designed by Nino Battaglia's studio. Full-size files are in the ZIP.</p></header><main>${sections}</main></body></html>`;
}

function buildPack(spec, rasterize) {
  const logo = spec.assets?.logo || ""; // the owner's logo as a data URI, kept out of every SVG until now
  const files = spec.files.map((file) => {
    const data = rasterize(logo ? file.svg.replaceAll("__LOGO_DATA_URI__", logo) : file.svg, file.width);
    const size = pngSize(data);
    if (size.width !== file.width || size.height !== file.height) throw new Error(`${file.name} came out ${size.width}x${size.height}`);
    return { name: file.name, data };
  });
  for (const extra of spec.extra || []) files.push({ name: extra.name, data: new TextEncoder().encode(extra.text) });
  if (spec.preview) files.push({ name: "preview.html", data: new TextEncoder().encode(previewPage(spec, rasterize, logo)) });
  return createZip(files);
}

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error("No GitHub OIDC token available (the workflow needs permissions: id-token: write)");
  const response = await fetch(`${url}&audience=${AUDIENCE}`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!response.ok) throw new Error(`OIDC token request failed: HTTP ${response.status}`);
  return (await response.json()).value;
}

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await oidcToken()}` } });
  // Server error messages are generic (no customer data), so they are safe to print.
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path.replace(/[0-9a-f-]{36}/, "<job>")}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--spec") {
    const spec = JSON.parse(await readFile(args[1], "utf8"));
    await writeFile(args[3] || "pack.zip", buildPack(spec, await rasterizer()));
    console.log(`Rendered ${spec.files.length} images locally`);
    return;
  }
  let rasterize = null;
  let done = 0;
  for (let i = 0; i < MAX_JOBS; i++) {
    const { job } = await (await api("/api/render-jobs/next")).json();
    if (!job) break;
    rasterize = rasterize || await rasterizer();
    const spec = await (await api(`/api/render-jobs/${job}`)).json();
    const zip = buildPack(spec, rasterize);
    await api(`/api/render-jobs/${job}`, { method: "POST", body: zip, headers: { "Content-Type": "application/zip" } });
    console.log(`Job ${job}: ${spec.files.length} images rendered and uploaded${spec.fonts ? ` (${fontsLoaded?.length || 0} display font files available)` : ""}`);
    done++;
  }
  console.log(done ? `Finished ${done} job(s)` : "No graphics waiting");
}

main().catch((error) => {
  console.error(`Render failed: ${error.message}`);
  process.exit(1);
});
