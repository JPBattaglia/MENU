// Conversion Fix audit (stage 6). A static look at the buyer's site: the home page plus a few pages it links to.
// Every finding is a plain fact read from the HTML or measured when we fetched it, with an id the AI step must cite, so
// the recommendations cannot talk about problems the site does not have. It does not run scripts or see analytics.
import { elementsOf, sameSiteLinks, strip, tagsOf, text } from "../accessibility/scan.js";

const GOALS = [
  { key: "calls", words: /call|phone|ring/i, label: "phone calls" },
  { key: "orders", words: /order|takeout|take-out|delivery|pickup|pick-up/i, label: "online orders" },
  { key: "bookings", words: /book|reserv|table|appointment|schedul/i, label: "bookings" },
  { key: "visits", words: /visit|walk|foot|direction|in-person|come in|stop by/i, label: "visits" }
];
const CTA_WORDS = {
  calls: /\b(call|phone|ring)\b/i,
  orders: /\b(order|pick-?up|take-?out|delivery)\b|doordash|ubereats|grubhub|toasttab|squareup|clover\.com/i,
  bookings: /\b(book|reserve|reservation|table|appointment)\b|opentable|resy|tock|yelp\.com\/reservations/i,
  visits: /\b(directions?|find us|visit|hours|location)\b|maps\.google|goo\.gl\/maps|google\.com\/maps/i
};

function goalKind(goal) {
  return (GOALS.find((g) => g.words.test(String(goal))) || GOALS[0]).key;
}

async function crawl(startUrl, { maxPages = 6, fetcher = fetch, timeoutMs = 8000 } = {}) {
  const get = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetcher(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "MenuMadeSiteAudit/1.0 (+https://menu-made.com)", accept: "text/html" } });
      const type = response.headers.get("content-type") || "";
      if (!response.ok) return { url, error: `HTTP ${response.status}` };
      if (!/html/i.test(type)) return { url, error: "not a web page" };
      const html = (await response.text()).slice(0, 1_500_000);
      return { url: response.url || url, html, ms: Date.now() - started, https: (response.url || url).startsWith("https:") };
    } catch (error) { return { url, error: error?.name === "AbortError" ? "timed out" : "could not be reached" }; }
    finally { clearTimeout(timer); }
  };
  const home = await get(startUrl);
  if (home.error) return { pages: [home], home: null };
  const pages = [home];
  for (const link of sameSiteLinks(home.html, home.url, maxPages - 1)) pages.push(await get(link));
  return { pages, home };
}

const F = (id, area, severity, title, evidence) => ({ id, area, severity, title, evidence });

function auditHome(page, goal) {
  const kind = goalKind(goal);
  const html = page.html;
  const body = /<body[\s\S]*$/i.exec(strip(html))?.[0] || strip(html);
  const visible = text(html);
  const findings = [];
  const links = elementsOf(html, "a");
  const linkText = (el) => `${text(el.inner)} ${el.attrs.href || ""} ${el.attrs["aria-label"] || ""}`;
  const buttons = elementsOf(html, "button").map((b) => ({ attrs: { href: "" }, inner: b.inner }));
  const clickable = [...links, ...buttons];

  // Speed: measured once from our server, plus page weight signals in the markup.
  const kb = Math.round(new TextEncoder().encode(html).length / 1024);
  if (page.ms > 2500) findings.push(F("slow-response", "speed", "high", "The home page was slow to load", `It took ${(page.ms / 1000).toFixed(1)} seconds to download from our server.`));
  else if (page.ms > 1200) findings.push(F("slow-response", "speed", "medium", "The home page loads a little slowly", `It took ${(page.ms / 1000).toFixed(1)} seconds to download from our server.`));
  if (kb > 600) findings.push(F("heavy-page", "speed", "medium", "The page's HTML is very large", `The home page's HTML alone is ${kb} KB.`));
  const scripts = tagsOf(html, "script");
  const blocking = (/<head[\s\S]*?<\/head>/i.exec(html)?.[0].match(/<script\b(?![^>]*\b(async|defer|type\s*=\s*["']module)\b)[^>]*\bsrc=/gi) || []).length;
  if (scripts.length > 15) findings.push(F("many-scripts", "speed", "medium", "Many script files load on the page", `${scripts.length} script tags were found on the home page.`));
  if (blocking > 2) findings.push(F("blocking-scripts", "speed", "medium", "Scripts in the page head hold up the first view", `${blocking} scripts in the head have neither async nor defer.`));
  const images = tagsOf(html, "img");
  const unsized = images.filter((i) => !i.attrs.width && !i.attrs.height).length;
  if (images.length > 6 && images.filter((i) => (i.attrs.loading || "").toLowerCase() === "lazy").length === 0) findings.push(F("no-lazy-images", "speed", "low", "No images load lazily", `${images.length} images are on the home page and none use loading="lazy".`));
  if (unsized >= 3) findings.push(F("unsized-images", "speed", "low", "Images have no set size, so the page jumps while loading", `${unsized} of ${images.length} images have no width or height.`));
  if (!page.https) findings.push(F("not-https", "trust", "high", "The site address does not use https", "The home page was served without a secure connection."));

  // Mobile layout.
  const viewport = tagsOf(html, "meta").find((m) => (m.attrs.name || "").toLowerCase() === "viewport");
  if (!viewport) findings.push(F("no-viewport", "mobile", "high", "The page is not set up for phones", 'There is no <meta name="viewport"> tag, so phones show a shrunken desktop page.'));
  else if (/width\s*=\s*\d{3,}/i.test(viewport.attrs.content || "")) findings.push(F("fixed-width-viewport", "mobile", "high", "The page is locked to a desktop width", `The viewport is set to "${(viewport.attrs.content || "").slice(0, 60)}".`));
  if (links.filter((a) => /\.pdf(\?|$)/i.test(a.attrs.href || "") && /menu/i.test(linkText(a))).length) findings.push(F("pdf-menu", "mobile", "medium", "The menu is a PDF", "A link to a PDF menu was found; PDFs are slow and hard to read on phones."));

  // Calls to action.
  const tel = links.filter((a) => /^tel:/i.test(a.attrs.href || ""));
  if (tel.length === 0) findings.push(F("no-tel-link", "cta", kind === "calls" ? "high" : "medium", "The phone number is not tap-to-call", "No tel: link was found on the home page."));
  const goalLinks = clickable.filter((a) => CTA_WORDS[kind].test(linkText(a)));
  if (goalLinks.length === 0) findings.push(F("no-goal-cta", "cta", "high", `No clear button for your main goal (${(GOALS.find((g) => g.key === kind)).label})`, `No link or button on the home page mentions ${kind === "calls" ? "calling" : kind === "orders" ? "ordering" : kind === "bookings" ? "booking" : "directions or hours"}.`));
  else {
    const first = body.indexOf(goalLinks[0].attrs.href && goalLinks[0].attrs.href.length > 1 ? goalLinks[0].attrs.href : text(goalLinks[0].inner).slice(0, 12));
    if (first > body.length * 0.35 && tel.length === 0) findings.push(F("cta-buried", "cta", "medium", "The main action is far down the page", "The first link for your goal appears after the first third of the page."));
  }
  if (links.length > 80) findings.push(F("cluttered-links", "cta", "low", "The home page has a very large number of links", `${links.length} links compete for attention.`));
  const h1 = elementsOf(html, "h1");
  if (h1.length === 0) findings.push(F("no-h1", "message", "medium", "The home page has no main headline", "No <h1> was found."));
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!title || !text(title[1])) findings.push(F("no-title", "message", "medium", "The page has no title", "The <title> tag is missing or empty."));
  const desc = tagsOf(html, "meta").find((m) => (m.attrs.name || "").toLowerCase() === "description");
  if (!desc || !(desc.attrs.content || "").trim()) findings.push(F("no-meta-description", "message", "low", "No search description", 'There is no <meta name="description"> tag, so Google chooses the text for your search result.'));

  // Forms.
  const forms = elementsOf(html, "form");
  for (const [i, form] of forms.entries()) {
    const fields = tagsOf(form.inner, "input").filter((t) => !["hidden", "submit", "button", "image", "reset", "checkbox", "radio"].includes((t.attrs.type || "").toLowerCase()))
      .length + tagsOf(form.inner, "textarea").length + tagsOf(form.inner, "select").length;
    if (fields > 6) findings.push(F(`long-form-${i + 1}`, "forms", "medium", "A form asks for a lot", `Form ${i + 1} has ${fields} fields; shorter forms get completed more often.`));
    if (!/type\s*=\s*["']submit["']|<button/i.test(form.inner)) findings.push(F(`form-no-submit-${i + 1}`, "forms", "high", "A form has no submit button", `Form ${i + 1} has no submit button.`));
  }

  // Trust signals.
  if (!/\b\d{1,5}\s+[A-Za-z0-9.' -]{2,40}\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|hwy|highway|pkwy|ct|court|pl|place)\b/i.test(visible)) findings.push(F("no-address", "trust", kind === "visits" ? "high" : "medium", "No street address on the home page", "No street address was found in the page text."));
  if (!/\b(open|hours|mon|tue|wed|thu|fri|sat|sun)\b[^.]{0,60}\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(visible)) findings.push(F("no-hours", "trust", "medium", "Opening hours are not on the home page", "No opening hours were found in the page text."));
  if (!/review|testimonial|rated|stars?\b|★|⭐|yelp|tripadvisor|google reviews/i.test(visible + " " + links.map(linkText).join(" "))) findings.push(F("no-social-proof", "trust", "medium", "No reviews or social proof", "No reviews, ratings or testimonials were found on the home page."));
  if (!links.some((a) => /facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com/i.test(a.attrs.href || ""))) findings.push(F("no-social-links", "trust", "low", "No links to social media", "No Facebook, Instagram or similar link was found."));

  // Menu and ordering links.
  if (!links.some((a) => /menu/i.test(linkText(a)))) findings.push(F("no-menu-link", "menu", "high", "There is no obvious menu link", 'No link mentioning "menu" was found on the home page.'));
  if (kind === "orders" && !links.some((a) => CTA_WORDS.orders.test(linkText(a)))) findings.push(F("no-order-link", "menu", "high", "No way to order is linked", "No ordering link was found."));
  return { findings, facts: { kind, loadSeconds: Number((page.ms / 1000).toFixed(1)), htmlKb: kb, scripts: scripts.length, images: images.length, links: links.length, forms: forms.length, telLinks: tel.length, https: page.https } };
}

// Short text the AI may quote from: headline, title, button and link wording.
function siteSample(page) {
  const html = page.html;
  const pick = (name, n) => elementsOf(html, name).map((e) => text(e.inner)).filter(Boolean).slice(0, n);
  const links = [...new Set(elementsOf(html, "a").map((e) => text(e.inner)).filter((t) => t && t.length < 50))].slice(0, 25);
  return {
    title: text(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || ""),
    description: (tagsOf(html, "meta").find((m) => (m.attrs.name || "").toLowerCase() === "description")?.attrs.content || "").slice(0, 300),
    headlines: [...pick("h1", 3), ...pick("h2", 6)],
    buttons: [...pick("button", 8), ...links.slice(0, 12)].slice(0, 20),
    paragraphs: pick("p", 6).map((p) => p.slice(0, 220)),
    text: text(html).slice(0, 6000)
  };
}

async function auditSite(url, goal, opts = {}) {
  const site = await crawl(url, opts);
  if (!site.home) return { ok: false, error: site.pages[0].error, pages: site.pages };
  const home = auditHome(site.home, goal);
  // Other pages: a broken page is a finding; slow pages are noted by name.
  const broken = site.pages.slice(1).filter((p) => p.error);
  const findings = [...home.findings];
  if (broken.length) findings.push(F("broken-links", "trust", "high", "Some pages linked from the home page do not load", `${broken.length} linked page(s) failed: ${broken.slice(0, 3).map((p) => `${p.url} (${p.error})`).join("; ")}.`));
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { ok: true, url: site.home.url, goal, facts: home.facts, findings, pagesChecked: site.pages.filter((p) => !p.error).length, sample: siteSample(site.home) };
}

export { GOALS, auditHome, auditSite, crawl, goalKind, siteSample };
