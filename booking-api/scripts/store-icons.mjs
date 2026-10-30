// Stage 11 part 2: turns the worker's build config answer (GET /api/store-build/config) into the files a restaurant's
// Store App build uses: build.json for app-shell/configure.mjs, the 1024 px App Store icon, and Android launcher icons
// (legacy squares plus the adaptive icon's foreground and background colour). Draws with resvg (the renderer's engine)
// and the bundled Liberation Sans, so initials look the same as on the Guest App icons.
// Usage: node booking-api/scripts/store-icons.mjs <config answer .json> <output dir>
// Writes: <out>/build.json, <out>/ios/icon-1024.png, <out>/android/res/... (copied over android/app/src/main/res).
// Prints nothing about the restaurant (public repo, public logs).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const [input, out] = process.argv.slice(2);
if (!input || !out) throw new Error("Usage: store-icons.mjs <config.json> <out dir>");
const answer = JSON.parse(await readFile(input, "utf8"));
if (!answer.ok || !answer.config || !answer.icon_svg || !answer.android_foreground_svg) throw new Error("The build config answer is incomplete");
if (!/^#[0-9a-f]{6}$/i.test(answer.config.brand_color || "")) throw new Error("brand_color must be #rrggbb");

const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
const fonts = await Promise.all(["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"].map((f) => readFile(new URL(`../assets/fonts/${f}`, import.meta.url))));
const draw = (svg, width) => new Resvg(svg, {
  fitTo: { mode: "width", value: width },
  font: { fontBuffers: fonts.map((b) => new Uint8Array(b)), defaultFontFamily: "Liberation Sans", loadSystemFonts: false }
}).render().asPng();

async function put(path, data) {
  await mkdir(join(out, path, ".."), { recursive: true });
  await writeFile(join(out, path), data);
}

await put("build.json", JSON.stringify({ ...answer.config, build_number: 1 }, null, 2));
await put("ios/icon-1024.png", draw(answer.icon_svg, 1024));
// Android densities: launcher icons are 48 dp, the adaptive foreground 108 dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, scale] of Object.entries(DENSITIES)) {
  const legacy = draw(answer.icon_svg, Math.round(48 * scale));
  await put(`android/res/mipmap-${name}/ic_launcher.png`, legacy);
  await put(`android/res/mipmap-${name}/ic_launcher_round.png`, legacy);
  await put(`android/res/mipmap-${name}/ic_launcher_foreground.png`, draw(answer.android_foreground_svg, Math.round(108 * scale)));
}
await put("android/res/values/ic_launcher_background.xml", `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${answer.config.brand_color.toUpperCase()}</color>\n</resources>\n`);
console.log("Store icons drawn: 1 App Store icon, 15 Android launcher files");
