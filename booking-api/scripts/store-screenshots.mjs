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
