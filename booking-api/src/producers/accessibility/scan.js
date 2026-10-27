// Accessibility Monitoring scanner (stage 6). A static scan of each page's HTML: no browser, no JavaScript execution.
// It finds the problems that are visible in the markup itself. It cannot judge colour contrast, keyboard focus order or
// content added by scripts; every report says so. Pure functions plus one small crawler that takes an injectable fetch.
const VOID_OK = new Set(["img", "input", "meta", "link", "br", "hr"]);
const strip = (html) => String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
const text = (html) => strip(html).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function attrsOf(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (name === "<" || attrs[name] !== undefined) continue;
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

function tagsOf(html, name) {
  return [...strip(html).matchAll(new RegExp(`<${name}(\\s[^>]*)?>`, "gi"))].map((m) => ({ attrs: attrsOf(m[1] || ""), index: m.index }));
}

// Elements with content: [{ attrs, inner }]
function elementsOf(html, name) {
  return [...strip(html).matchAll(new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => ({ attrs: attrsOf(m[1] || ""), inner: m[2] }));
}

const RULES = {
  "html-lang": { impact: "serious", title: "Page language is not set", why: "Screen readers use the page language to choose the right voice and pronunciation.", fix: 'Add a language to the opening tag: <html lang="en">.' },
  "page-title": { impact: "serious", title: "Page has no title", why: "The title is the first thing a screen reader announces and what shows in browser tabs and search results.", fix: "Add a short, specific <title> inside <head>, such as <title>Menu - Joe's Pizza</title>." },
  "image-alt": { impact: "critical", title: "Image has no alternative text", why: "People who cannot see the image get nothing at all; search engines also use this text.", fix: 'Add alt text describing the image, e.g. <img src="pizza.jpg" alt="Margherita pizza with fresh basil">. For purely decorative images use alt="".' },
  "link-name": { impact: "serious", title: "Link has no readable text", why: "A link with no text is announced as just \"link\", so people cannot tell where it goes.", fix: 'Put text inside the link, or add aria-label="Call us" when it only contains an icon.' },
  "button-name": { impact: "critical", title: "Button has no readable name", why: "People using a screen reader cannot tell what the button does.", fix: 'Put text in the button or add aria-label, e.g. <button aria-label="Open menu">.' },
  "label": { impact: "critical", title: "Form field has no label", why: "Without a label, a screen reader user does not know what to type, and tapping the label cannot focus the field.", fix: 'Connect a label: <label for="email">Email</label> <input id="email" type="email">. A placeholder alone is not a label.' },
  "heading-one": { impact: "moderate", title: "Page should have exactly one main heading (h1)", why: "The main heading tells everyone what the page is about and is where screen reader users jump first.", fix: "Use one <h1> for the page topic and <h2>, <h3> for sections beneath it." },
  "heading-order": { impact: "moderate", title: "Heading levels skip", why: "Skipping from h2 to h4 breaks the outline that screen reader users navigate by.", fix: "Use heading levels in order without gaps (h2, then h3, then h4)." },
  "zoom-blocked": { impact: "critical", title: "Pinch-to-zoom is blocked", why: "People with low vision rely on zooming the page.", fix: 'Remove user-scalable=no and any maximum-scale below 5 from <meta name="viewport">.' },
  "duplicate-id": { impact: "minor", title: "Two elements share the same id", why: "Labels and ARIA references can point at the wrong element.", fix: "Give every id on the page a unique value." },
  "landmark-main": { impact: "moderate", title: "Page has no main landmark", why: "A <main> region lets keyboard and screen reader users skip straight to the content.", fix: "Wrap the page's main content in <main>...</main>." },
  "frame-title": { impact: "serious", title: "Embedded frame has no title", why: "Screen readers announce frames by title; without one, an embedded map or video is a mystery.", fix: 'Add a title: <iframe title="Map to our restaurant" ...>.' },
  "tabindex": { impact: "moderate", title: "Positive tabindex changes the keyboard order", why: "Positive tabindex values make the Tab key jump around the page unpredictably.", fix: 'Remove tabindex values above 0; use tabindex="0" or the natural page order.' }
};

function nameless(el) {
  const a = el.attrs;
  if ((a["aria-label"] || "").trim() || (a["aria-labelledby"] || "").trim() || (a.title || "").trim()) return false;
  if (text(el.inner)) return false;
  return !/<img[^>]*\salt\s*=\s*["'][^"']+["']/i.test(el.inner);
}

// Returns [{ rule, count, examples: [string] }] for one page.
function scanHtml(html) {
  const findings = [];
  const add = (rule, examples) => { if (examples.length) findings.push({ rule, count: examples.length, examples: examples.slice(0, 3) }); };
  const source = String(html);
  const root = /<html(\s[^>]*)?>/i.exec(source);
  if (!root || !(attrsOf(root[1] || "").lang || "").trim()) add("html-lang", ["<html>"]);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  if (!title || !text(title[1])) add("page-title", ["<head>"]);
  add("image-alt", tagsOf(source, "img").filter((t) => t.attrs.alt === undefined && t.attrs.role !== "presentation").map((t) => `<img src="${(t.attrs.src || "").slice(0, 60)}">`));
  add("link-name", elementsOf(source, "a").filter((el) => el.attrs.href !== undefined && nameless(el)).map((el) => `<a href="${(el.attrs.href || "").slice(0, 60)}">`));
  add("button-name", elementsOf(source, "button").filter(nameless).map(() => "<button>"));
  const labelFor = new Set(elementsOf(source, "label").map((el) => el.attrs.for).filter(Boolean));
  const wrapped = elementsOf(source, "label").map((el) => el.inner).join(" ");
  const fields = [...tagsOf(source, "input"), ...tagsOf(source, "select"), ...tagsOf(source, "textarea")]
    .filter((t) => !["hidden", "submit", "button", "image", "reset"].includes(String(t.attrs.type || "").toLowerCase()));
  add("label", fields.filter((t) => !(t.attrs["aria-label"] || "").trim() && !(t.attrs["aria-labelledby"] || "").trim() && !(t.attrs.title || "").trim()
    && !(t.attrs.id && labelFor.has(t.attrs.id)) && !(t.attrs.id && new RegExp(`id\\s*=\\s*["']${t.attrs.id}["']`).test(wrapped)))
    .map((t) => `<input${t.attrs.name ? ` name="${t.attrs.name}"` : ""}>`));
  const levels = [...strip(source).matchAll(/<h([1-6])[\s>]/gi)].map((m) => Number(m[1]));
  if (levels.filter((l) => l === 1).length !== 1) add("heading-one", [levels.includes(1) ? `${levels.filter((l) => l === 1).length} h1 headings` : "no h1"]);
  const skips = [];
  for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) skips.push(`h${levels[i - 1]} then h${levels[i]}`);
  add("heading-order", skips);
  const viewport = tagsOf(source, "meta").find((t) => (t.attrs.name || "").toLowerCase() === "viewport");
  if (viewport) {
    const content = (viewport.attrs.content || "").toLowerCase();
    const max = /maximum-scale\s*=\s*([\d.]+)/.exec(content);
    if (/user-scalable\s*=\s*(no|0)/.test(content) || (max && Number(max[1]) < 2)) add("zoom-blocked", [content.slice(0, 80)]);
  }
  const ids = [...strip(source).matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  add("duplicate-id", [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].map((id) => `id="${id}"`));
  if (!/<main[\s>]/i.test(strip(source)) && !/role\s*=\s*["']main["']/i.test(source)) add("landmark-main", ["<body>"]);
  add("frame-title", tagsOf(source, "iframe").filter((t) => !(t.attrs.title || "").trim() && !(t.attrs["aria-label"] || "").trim()).map((t) => `<iframe src="${(t.attrs.src || "").slice(0, 60)}">`));
  add("tabindex", [...strip(source).matchAll(/tabindex\s*=\s*["']?([1-9]\d*)/gi)].map((m) => `tabindex="${m[1]}"`));
  return findings;
}

function sameSiteLinks(html, baseUrl, limit) {
  const base = new URL(baseUrl);
  const seen = new Set([base.href.split("#")[0]]);
  const out = [];
  for (const el of elementsOf(html, "a")) {
    if (!el.attrs.href || /^(mailto:|tel:|javascript:|#)/i.test(el.attrs.href)) continue;
    let url;
    try { url = new URL(el.attrs.href, base); } catch { continue; }
    url.hash = "";
    if (url.origin !== base.origin || !/^https?:$/.test(url.protocol) || /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|css|js)$/i.test(url.pathname)) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    out.push(url.href);
    if (out.length >= limit) break;
  }
  return out;
}

// Scans the home page and up to `maxPages - 1` pages it links to on the same site.
async function scanSite(startUrl, { maxPages = 10, fetcher = fetch, timeoutMs = 8000 } = {}) {
  const pages = [];
  const get = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "MenuMadeAccessibilityScan/1.0 (+https://menu-made.com)", accept: "text/html" } });
      const type = response.headers.get("content-type") || "";
      if (!response.ok) return { url, error: `HTTP ${response.status}` };
      if (!/html/i.test(type)) return { url, error: `not a web page (${type.split(";")[0] || "unknown type"})` };
      return { url: response.url || url, html: (await response.text()).slice(0, 1_500_000) };
    } catch (error) {
      return { url, error: error?.name === "AbortError" ? "timed out" : "could not be reached" };
    } finally { clearTimeout(timer); }
  };
  const first = await get(startUrl);
  if (first.error) return { pages: [{ url: startUrl, error: first.error, findings: [] }], scanned: 0, failed: 1 };
  pages.push({ url: first.url, findings: scanHtml(first.html) });
  for (const link of sameSiteLinks(first.html, first.url, maxPages - 1)) {
    const page = await get(link);
    pages.push(page.error ? { url: link, error: page.error, findings: [] } : { url: page.url, findings: scanHtml(page.html) });
  }
  return { pages, scanned: pages.filter((p) => !p.error).length, failed: pages.filter((p) => p.error).length };
}

const IMPACT_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };

// Site-wide totals per rule, ranked by impact then count.
function summarize(result) {
  const byRule = new Map();
  for (const page of result.pages) for (const f of page.findings) {
    const entry = byRule.get(f.rule) || { rule: f.rule, count: 0, pages: [], examples: [] };
    entry.count += f.count; entry.pages.push(page.url); entry.examples.push(...f.examples);
    byRule.set(f.rule, entry);
  }
  const issues = [...byRule.values()].map((e) => ({ ...RULES[e.rule], ...e, examples: [...new Set(e.examples)].slice(0, 3) }))
    .sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact] || b.count - a.count);
  return { issues, total: issues.reduce((n, i) => n + i.count, 0), rules: issues.length };
}

export { IMPACT_ORDER, RULES, elementsOf, sameSiteLinks, scanHtml, scanSite, strip, summarize, tagsOf, text };
