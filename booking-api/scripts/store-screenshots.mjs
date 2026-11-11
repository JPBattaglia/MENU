// Stage 11 part 2: store listing screenshots of a restaurant's real app screens (app-shell/www, already configured with
// its build config), loaded with its live content, at the App Store's iPhone 6.7" size (1290 x 2796) and a Google Play
// phone size (1080 x 1920). Home, Menu and, when the rewards card is on, Rewards (shown with a sample card part-way
// filled; the page can't reach the rewards service from a browser, only from the app).
// Usage: PW_DIR=<dir with playwright installed> node booking-api/scripts/store-screenshots.mjs <http url of app-shell/www> <out dir>
// Writes <out>/ios-1.png ... and <out>/android-1.png ... Prints counts only (public logs).
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const [base, out] = process.argv.slice(2);
if (!base || !out || !process.env.PW_DIR) throw new Error("Usage: PW_DIR=... store-screenshots.mjs <url> <out dir>");
const { chromium } = createRequire(join(process.env.PW_DIR, "noop.js"))("playwright");
const cfg = JSON.parse(await readFile(new URL("../../app-shell/www/config.json", import.meta.url), "utf8"));
// A hybrid app (hybrid.js): its own screens with the live content: every tab, plus a product page for a shop.
if (cfg.hybrid_url) {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  let shots = 0;
  for (const [prefix, viewport] of [["ios", { width: 430, height: 932 }], ["android", { width: 360, height: 640 }]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    // The app leaves out anything seasonal (the holiday banner, pop-up and generator) for its store pictures.
    await context.addInitScript(() => { window.MM_STORE_SHOTS = true; });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "load" });
    await page.waitForSelector("body.hy-ready .hy-tabs", { timeout: 60000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const tabs = await page.$$eval(".hy-tabs button", (b) => b.map((x) => x.getAttribute("data-tab")));
    const plan = [];
    tabs.forEach((tab, i) => { plan.push([tab, false]); if (i === 0 && (cfg.hybrid_url.endsWith("/nino"))) plan.push([tab, true]); });
    let n = 0;
    for (const [tab, detail] of plan.slice(0, 5)) {
      await page.click(`#hy-t-${tab}`);
      if (detail) await page.click(".hy-tile");
      await page.waitForTimeout(1500); // product photos
      await page.screenshot({ path: join(out, `${prefix}-${++n}.png`) });
      shots++;
    }
    await context.close();
  }
  await browser.close();
  console.log(`Screenshots: ${shots}`);
  process.exit(0);
}
// A site app (own-apps.js) is the business's website inside the app: its pictures are those pages, as a phone shows them.
if (cfg.site_url) {
  const origin = new URL(cfg.site_url).origin;
  const pages = (cfg.site_screens?.length ? cfg.site_screens : [new URL(cfg.site_url).pathname]).map((p) => origin + p);
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  let shots = 0;
  for (const [prefix, viewport] of [["ios", { width: 430, height: 932 }], ["android", { width: 360, height: 640 }]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    for (const [i, url] of pages.entries()) {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load" }));
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(out, `${prefix}-${i + 1}.png`) });
      shots++;
    }
    await context.close();
  }
  await browser.close();
  console.log(`Screenshots: ${shots}`);
  process.exit(0);
}
const content = await (await fetch(`${cfg.api_base}/content`)).json();
if (!content.ok) throw new Error("The app's content didn't load");
const rewards = Boolean(content.loyalty?.enabled);
const goal = Number(content.loyalty?.goal) || 10;
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const SIZES = [["ios", { width: 430, height: 932 }], ["android", { width: 360, height: 640 }]];
let count = 0;
for (const [prefix, viewport] of SIZES) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.route("**/api/loyalty", (route) => route.fulfill({ json: { ok: true, card: { points: Math.min(3, goal - 1), goal, can_redeem: false } } }));
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("#hours dt") && document.getElementById("status").hidden, null, { timeout: 30000 });
  await page.waitForTimeout(800); // the logo image
  const tabs = ["home", "menu", ...(rewards ? ["rewards"] : [])];
  for (const [i, tab] of tabs.entries()) {
    if (tab !== "home") await page.click(`#t-${tab}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${prefix}-${i + 1}.png`) });
    count++;
  }
  await context.close();
}
await browser.close();
console.log(`Screenshots taken: ${count}`);
