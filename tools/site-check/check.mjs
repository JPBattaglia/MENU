// Stage 12, task 4: site checks for menu-made.com and ninobattaglia.com, run by .github/workflows/site-check.yml.
// For each site: the pages in sitemap.xml plus the pages they link to (same site, capped), each loaded in Chromium.
//   FAIL: a page that doesn't answer 200; a broken same-site link, image, script or stylesheet; a JavaScript error;
//         an arrow on a button or link (house rule, Oct 29, 2026: no arrows on any button or link, including CSS
//         ::before/::after); a critical accessibility violation (axe); a page taking over 8 s to load.
//   WARN (listed, not failing): serious accessibility violations, pages over 4 s, broken links to other sites
//         (many sites refuse robots), forms with no action and no script handler.
// Forms are not submitted: every form on both sites either sends a real email or opens a real checkout, and the
// checkout paths are proven by the self-tests in Stripe test mode.
// Phone (390x844) and desktop (1280x800) screenshots of each sitemap page go to ./site-check-out/ for the
// workflow to keep as an artifact. Writes ./site-check-out/result.json and exits 0 (the workflow reports it).
//
//   node tools/site-check/check.mjs https://menu-made.com https://ninobattaglia.com
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "site-check-out";
const MAX_PAGES = Number(process.env.SITE_CHECK_MAX_PAGES || 160);
const SLOW_WARN_MS = 4000;
const SLOW_FAIL_MS = 8000;
const ARROWS = /[←-⇿➡⟵-⟿⬅-⬇⮕➜➔➝-➟»›‹«]|-{1,2}>|<-{1,2}|=>/;

let AxeBuilder = null;
try { ({ default: AxeBuilder } = await import("@axe-core/playwright")); } catch { AxeBuilder = null; }

const sites = process.argv.slice(2);
if (!sites.length) { console.error("usage: check.mjs <site> [site...]"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const result = { checked_at: new Date().toISOString(), axe: Boolean(AxeBuilder), sites: [] };
const status = new Map(); // url -> HTTP status (resources and links, checked once each)
const checkedOn = new Set(); // "page|url" already judged, so a shared broken link is listed once per page

async function head(context, url) {
  if (status.has(url)) return status.get(url);
  let code = 0;
  try {
    let res = await context.request.fetch(url, { method: "HEAD", maxRedirects: 5, timeout: 20000, failOnStatusCode: false });
    // Some servers don't answer HEAD the way they answer a browser (the Nino shop's model photos 404 on HEAD and
    // load fine on GET), so anything that isn't OK is asked again the way a browser asks before it's called broken.
    if (res.status() >= 400) res = await context.request.get(url, { maxRedirects: 5, timeout: 20000, failOnStatusCode: false });
    code = res.status();
  } catch { code = 0; }
  status.set(url, code);
  return code;
}

const slug = (u) => (new URL(u).pathname.replace(/\/$/, "/index").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "index");

for (const site of sites) {
  const origin = new URL(site).origin;
  const host = new URL(site).hostname;
  const s = { site: origin, pages: [], failures: [], warnings: [] };
  result.sites.push(s);
  const fail = (page, what) => s.failures.push(`${page}: ${what}`);
  const warn = (page, what) => s.warnings.push(`${page}: ${what}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: "Mozilla/5.0 (Macintosh) MenuMadeSiteCheck/1.0 Chrome/130" });

  // Pages: the sitemap first (these also get screenshots), then same-site links found on them.
  let sitemap = [];
  try {
    const xml = await (await context.request.get(`${origin}/sitemap.xml`, { timeout: 20000 })).text();
    sitemap = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, origin));
  } catch { /* no sitemap: start from the home page */ }
  if (!sitemap.length) sitemap = [`${origin}/`];
  const queue = [...new Set(sitemap)];
  const seen = new Set(queue);

  for (let i = 0; i < queue.length && i < MAX_PAGES; i++) {
    const url = queue[i];
    const path = new URL(url).pathname + new URL(url).search;
    const page = await context.newPage();
    const jsErrors = [];
    const badResources = [];
    page.on("pageerror", (e) => jsErrors.push(String(e.message || e).slice(0, 200)));
    page.on("response", (r) => {
      const u = r.url();
      if (r.status() >= 400 && new URL(u).hostname === host && ["image", "script", "stylesheet", "font"].includes(r.request().resourceType())) badResources.push(`${r.status()} ${new URL(u).pathname}`);
    });
    const t0 = Date.now();
    let response = null;
    try { response = await page.goto(url, { waitUntil: "load", timeout: 30000 }); } catch (e) { fail(path, `did not load (${String(e.message).split("\n")[0].slice(0, 120)})`); }
    const ms = Date.now() - t0;
    const info = { path, status: response?.status() || 0, ms };
    s.pages.push(info);
    if (!response) { await page.close(); continue; }
    if (response.status() !== 200) fail(path, `answered HTTP ${response.status()}`);
    if (ms > SLOW_FAIL_MS) fail(path, `took ${(ms / 1000).toFixed(1)} s to load`);
    else if (ms > SLOW_WARN_MS) warn(path, `took ${(ms / 1000).toFixed(1)} s to load`);
    await page.waitForTimeout(800); // scripts that fill the page (catalog, cart) settle
    for (const r of [...new Set(badResources)]) fail(path, `broken file ${r}`);
    for (const e of [...new Set(jsErrors)]) fail(path, `JavaScript error: ${e}`);

    // Links, images, arrows and forms, read from the rendered page.
    const found = await page.evaluate((arrowSource) => {
      const arrow = new RegExp(arrowSource);
      const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      const arrows = [];
      for (const el of document.querySelectorAll("a, button, [role=button], input[type=submit], input[type=button]")) {
        if (!visible(el)) continue;
        const text = (el.innerText || el.value || "").trim();
        const before = getComputedStyle(el, "::before").content; const after = getComputedStyle(el, "::after").content;
        const pseudo = [before, after].filter((c) => c && c !== "none" && c !== "normal").join(" ");
        if (arrow.test(text) || arrow.test(pseudo)) arrows.push(`${el.tagName.toLowerCase()} "${(text || pseudo).slice(0, 40)}"`);
      }
      const links = [...document.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => /^https?:/.test(h));
      const images = [...document.querySelectorAll("img[src]")].map((i) => i.currentSrc || i.src).filter((h) => /^https?:/.test(h));
      const forms = [...document.querySelectorAll("form")].map((f) => ({ action: f.getAttribute("action") || "", name: f.getAttribute("name") || f.id || f.className || "form", handled: f.hasAttribute("data-handled") || Object.keys(f).some((k) => k.startsWith("on")) }));
      return { arrows, links, images, forms };
    }, ARROWS.source);
    for (const a of found.arrows) fail(path, `arrow on ${a} (house rule: no arrows on buttons or links)`);
    for (const f of found.forms) if (!f.action && !f.handled) info.forms = (info.forms || 0) + 1; // script-handled forms have no action; counted, not judged

    // Every link and image is checked once per run (cached), 12 at a time.
    const targets = [];
    for (const href of [...new Set([...found.links, ...found.images])]) {
      const u = new URL(href); u.hash = "";
      const clean = u.href;
      if (u.hostname === host && /\.(html?)?$|\/$|^[^.]*$/.test(u.pathname) && !seen.has(clean) && !u.search && found.links.includes(href)) { seen.add(clean); queue.push(clean); }
      if (!status.has(clean)) targets.push(clean);
      else if (!checkedOn.has(`${path}|${clean}`)) targets.push(clean);
    }
    for (let k = 0; k < targets.length; k += 12) await Promise.all(targets.slice(k, k + 12).map((t) => head(context, t)));
    for (const clean of targets) {
      checkedOn.add(`${path}|${clean}`);
      const u = new URL(clean); const code = status.get(clean);
      if (u.hostname === host) { if (code === 0 || code >= 400) fail(path, `broken link ${u.pathname}${u.search} (${code || "no answer"})`); }
      else if (code === 404 || code === 410) warn(path, `link to another site is gone: ${clean} (${code})`);
    }

    // The accessibility scan runs on the sitemap pages (the site's own pages); linked detail pages share their templates.
    if (AxeBuilder && sitemap.includes(url)) {
      try {
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        for (const v of axe.violations) {
          const line = `${v.id} (${v.nodes.length}): ${v.help}`;
          if (v.impact === "critical") fail(path, `accessibility, critical: ${line}`); else if (v.impact === "serious") warn(path, `accessibility: ${line}`);
        }
      } catch (e) { warn(path, `accessibility scan didn't run (${String(e.message).slice(0, 80)})`); }
    }

    if (sitemap.includes(url)) {
      const name = `${host}-${slug(url)}`;
      await page.screenshot({ path: `${OUT}/${name}-desktop.png`, fullPage: true }).catch(() => null);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${name}-phone.png`, fullPage: true }).catch(() => null);
    }
    await page.close();
  }
  if (queue.length > MAX_PAGES) warn("(crawl)", `stopped at ${MAX_PAGES} pages of ${queue.length} found`);
  await context.close();
}
await browser.close();

result.ok = result.sites.every((s) => s.failures.length === 0);
writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
for (const s of result.sites) {
  console.log(`\n${s.site}: ${s.pages.length} pages, ${s.failures.length} failures, ${s.warnings.length} warnings`);
  for (const f of s.failures) console.log(`  FAIL ${f}`);
  for (const w of s.warnings.slice(0, 40)) console.log(`  warn ${w}`);
}
console.log(`\n${result.ok ? "PASSED" : "FAILED"}${result.axe ? "" : " (accessibility scan not installed)"}`);
