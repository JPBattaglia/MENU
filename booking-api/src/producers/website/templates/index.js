// The site generator's builder: one business, one design -> the files of a complete site with separate pages
// (owner, Nov 6, 2026: "keep all the pages as separate pages", and the menu never at or near the top of the home page):
//   index.html    the design's hero, then About and Visit (hours and contact); the menu is one tap away, not on it
//   menu.html     the menu (or services), only when there is one
//   about.html    the story
//   contact.html  hours, address, phone, links
//   styles.css    the design
// plus the business's images at the paths given in site.logo / site.photos. The same files are shown in the generator,
// delivered in the zip, and served when Menu-made hosts the site.
import { BASE_CSS, page, siteData } from "./common.js";
import { DESIGNS, DESIGN_KEYS, designFor } from "./designs.js";

const PAGES = { "index.html": "Home", "menu.html": "Menu", "about.html": "About", "contact.html": "Contact" };

// Removes the element that starts at `start` (an index of its "<tag"), counting nested tags of the same name.
function removeAt(html, start) {
  const name = /^<([a-z0-9]+)/i.exec(html.slice(start))?.[1];
  if (!name) return html;
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[1]) { depth--; if (depth === 0) return html.slice(0, start) + html.slice(re.lastIndex); }
    else if (!m[0].endsWith("/>")) depth++;
  }
  return html;
}
const startOf = (html, attr) => { const i = html.search(new RegExp(`<[a-z0-9]+\\b[^>]*\\s${attr}[\\s>]`, "i")); return i; };
function drop(html, attr) {
  const i = startOf(html, attr);
  return i < 0 ? html : removeAt(html, i);
}

function composePage(body, file, hasMenu) {
  let html = body;
  if (file !== "index.html") html = drop(html, "data-hero");
  const keep = { "index.html": ["about", "visit"], "menu.html": ["menu"], "about.html": ["about"], "contact.html": ["visit"] }[file];
  for (const id of ["menu", "about", "visit"]) if (!keep.includes(id)) html = drop(html, `id="${id}"`);
  // Links between pages instead of anchors within one page.
  html = html.replace(/href="#menu"/g, `href="${hasMenu ? "menu.html" : "index.html"}"`).replace(/href="#about"/g, 'href="about.html"').replace(/href="#visit"/g, 'href="contact.html"')
    .replace(/(<a(?![^>]*class="skip")[^>]*?)href="#main"/g, '$1href="index.html"');
  // Mark the current page in the navigation.
  html = html.replace(new RegExp(`(<nav[^>]*>[\\s\\S]*?)<a href="${file}"`, "g"), (m, before) => `${before}<a aria-current="page" href="${file}"`);
  return html;
}

function buildDesignSite(site, copy, key) {
  const design = designFor(key);
  if (!design) throw new Error(`Unknown design ${key}`);
  const d = siteData(site, copy);
  const out = design.render(d, site.brand);
  const hasMenu = d.sections.length > 0;
  const files = {};
  for (const [file, label] of Object.entries(PAGES)) {
    if (file === "menu.html" && !hasMenu) continue;
    const title = file === "index.html" ? null : (file === "menu.html" ? d.menuLabel : label);
    let html = page({ ...d, pageTitle: title }, { fonts: design.fonts, body: composePage(out.body, file, hasMenu), theme: out.theme });
    // The skip link needs a target on every page: without the hero, the page's own section.
    if (!/\sid="main"/.test(html)) html = html.replace('<a class="skip" href="#main">', `<a class="skip" href="#${{ "menu.html": "menu", "about.html": "about", "contact.html": "visit" }[file]}">`);
    files[file] = html;
  }
  files["styles.css"] = `${BASE_CSS}\n${out.css}\n`;
  return files;
}

export { DESIGNS, DESIGN_KEYS, PAGES, buildDesignSite, composePage, designFor };
