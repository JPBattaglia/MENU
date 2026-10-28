// Draws waiting Social Posts graphics and Guest App icons for the menu-checkout worker. Run by .github/workflows/render-social-posts.yml
// (every 5 minutes); see booking-api/src/producers/social-posts/render-jobs.js for why this runs outside the Worker.
//
// The repo is public, so its Actions logs are too: this script prints job ids and counts only, never a business name,
// menu text or image. Auth is the workflow's GitHub OIDC token (permissions: id-token: write); there is no secret.
//
// Local dry run against a saved spec (no network): node booking-api/scripts/render-social-posts.mjs --spec spec.json --out pack.zip
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createZip } from "../src/producers/social-posts/zip.js";

const API = process.env.RENDER_API || "https://menu-made.com";
const AUDIENCE = "menu-made-render";
const MAX_JOBS = 5;
const require = createRequire(import.meta.url);

async function rasterizer() {
  const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
  await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
  const fonts = await Promise.all(["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"]
    .map((f) => readFile(new URL(`../assets/fonts/${f}`, import.meta.url))));
  return (svg, width) => new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontBuffers: fonts.map((b) => new Uint8Array(b)), defaultFontFamily: "Liberation Sans", loadSystemFonts: false }
  }).render().asPng();
}

function pngSize(png) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

function buildPack(spec, rasterize) {
  const logo = spec.assets?.logo || ""; // Guest App icons: the owner's logo as a data URI, kept out of every SVG until now
  const files = spec.files.map((file) => {
    const data = rasterize(logo ? file.svg.replaceAll("__LOGO_DATA_URI__", logo) : file.svg, file.width);
    const size = pngSize(data);
    if (size.width !== file.width || size.height !== file.height) throw new Error(`${file.name} came out ${size.width}x${size.height}`);
    return { name: file.name, data };
  });
  for (const extra of spec.extra || []) files.push({ name: extra.name, data: new TextEncoder().encode(extra.text) });
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
    console.log(`Job ${job}: ${spec.files.length} images rendered and uploaded`);
    done++;
  }
  console.log(done ? `Finished ${done} job(s)` : "No graphics waiting");
}

main().catch((error) => {
  console.error(`Render failed: ${error.message}`);
  process.exit(1);
});
