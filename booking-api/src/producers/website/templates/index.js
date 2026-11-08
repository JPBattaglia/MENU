// The site generator's builder: one business, one design -> the files of a complete site with separate pages
// (owner, Nov 6, 2026: "keep all the pages as separate pages", and the menu never at or near the top of the home page):
//   index.html    the design's hero, then About and Visit (hours and contact); the menu is one tap away, not on it
//   menu.html     the menu (or services), only when there is one
//   about.html    the story
//   contact.html  hours, address, phone, links
//   styles.css    the design
// plus the business's images at the paths given in site.logo / site.photos. The same files are shown in the generator,
// delivered in the zip, and served when Menu-made hosts the site.
import { BASE_CSS, brandOr, esc, inkOn, nameEl, page, siteData } from "./common.js";
import { logoTreatment } from "../../menu-qr/design.js";
import { luminance } from "../../menu-qr/style.js";
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

// Where the element starting at `start` closes (the index of its closing tag), or -1.
function closeAt(html, start) {
  const name = /^<([a-z0-9]+)/i.exec(html.slice(start))?.[1];
  if (!name) return -1;
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[1]) { depth--; if (depth === 0) return m.index; } else if (!m[0].endsWith("/>")) depth++;
  }
  return -1;
}
function appendInside(html, attr, snippet) {
  const i = startOf(html, attr);
  const end = i < 0 ? -1 : closeAt(html, i);
  return end < 0 ? html : html.slice(0, end) + snippet + html.slice(end);
}

// Inner pages (owner, Nov 6, 2026: "most templates don't use the images on the other pages", "logo is too small"):
// a full-width photo band before <main> (a different photo per page where there are enough). It carries the logo and
// name only when the page's header doesn't (Trattoria's header is just the navigation); no photo and nothing to carry
// = no band.
const BAND_PHOTO = { "menu.html": [2, 1, 0], "about.html": [3, 0], "contact.html": [4, 1, 0] };
function pageBand(d, file, brand, headerHasBrand) {
  const pick = (BAND_PHOTO[file] || [0]).map((i) => d.photos[i]).find(Boolean);
  if (!pick && headerHasBrand) return "";
  const img = pick ? `<img class="pb-img" src="${esc(pick.path)}" alt="${esc(pick.alt || "")}">` : "";
  const logo = d.logo ? `<img class="pb-logo" src="${esc(d.logo.path)}" alt="">` : "";
  const words = headerHasBrand ? "" : `<div class="pb-in">${logo}${nameEl(d, "p", "pb-name")}</div>`;
  return `<div class="page-band${pick ? "" : " plain"}${words ? "" : " photo-only"}" style="--pb:${brand};--pb-ink:${inkOn(brand)}">${img}${words}</div>\n`;
}
// The buyer's own photos beyond the two the designs place, on the About page.
function gallery(d) {
  const own = d.photos.filter((p) => !p.sample);
  if (own.length < 3) return "";
  return `<div class="gallery">${own.slice(2).map((p) => `<img src="${esc(p.path)}" alt="${esc(p.alt || "")}" loading="lazy">`).join("")}</div>`;
}
// Contact form (owner, Nov 6, 2026). On a bought site it posts to Menu-made, which emails the business; in the
// generator it's shown but doesn't send.
function contactForm(d, action) {
  const off = !action;
  return `<form class="cform" method="post" action="${off ? "#" : esc(action)}"${off ? ' data-preview="1"' : ""}><h3>Send us a message</h3>
<fieldset${off ? " disabled" : ""}><label>Your name<input name="name" autocomplete="name" required maxlength="100"></label>
<label>Email<input type="email" name="email" autocomplete="email" maxlength="150"></label>
<label>Phone <small>(optional)</small><input type="tel" name="phone" autocomplete="tel" maxlength="40"></label>
<label>Message<textarea name="message" rows="5" required maxlength="3000"></textarea></label>
<label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
<button type="submit">Send message</button></fieldset>${off ? '<p class="cform-note">Preview: the form sends to your email once your site is live.</p>' : ""}</form>`;
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

// Logo legibility (owner, Nov 7, 2026: the menu Customize's "Logo background", on websites too). The design's main
// logos get a treatment against the colour behind them (design.logoBg): none, a halo, a badge in a tone of the
// design, or a border for a logo with its own box (menu-qr/design.js logoTreatment). The page-band and footer
// logos sit on a plate: white by default (dark for a light logo), or the buyer's choice.
function decorateLogos(html, d, out, brand) {
  if (!d.logo) return html;
  const bg = out.logoBg || out.theme || "#ffffff";
  const theme = { paper: bg, text: luminance(bg) > 0.4 ? "#1d1d1f" : "#f7f4ee" };
  const mode = d.logoMode || "auto";
  const info = d.logo.info || null;
  const t = logoTreatment({ info, mode, isJpeg: /\.jpe?g$/i.test(d.logo.path || ""), headerBg: bg, theme, accent: brand });
  const vars = t.kind === "badge" ? ` style="--plate:${t.plate}"` : t.kind === "halo" ? ` style="--glow:${t.glow}"` : "";
  const plate = { none: "transparent", light: "#ffffff", dark: "#1d1d1f", accent: brand }[mode] || (info && info.l > 0.6 ? "#1d1d1f" : "#ffffff");
  const plateStyle = mode === "none" ? ` style="--plate:transparent;box-shadow:none;padding:0"` : ` style="--plate:${plate}"`;
  return html
    .replace(/<img class="logo"/g, `<img class="logo logo-${t.kind}"${vars}`)
    .replace(/<img class="(pb-logo|foot-logo)"/g, (m, cls) => `<img class="${cls}"${plateStyle}`);
}

function buildDesignSite(site, copy, key, { formAction = "" } = {}) {
  const design = designFor(key);
  if (!design) throw new Error(`Unknown design ${key}`);
  const d = siteData(site, copy);
  const out = design.render(d, site.brand);
  const brand = brandOr(site.brand, design.defaultBrand);
  const hasMenu = d.sections.length > 0;
  const files = {};
  for (const [file, label] of Object.entries(PAGES)) {
    if (file === "menu.html" && !hasMenu) continue;
    const title = file === "index.html" ? null : (file === "menu.html" ? d.menuLabel : label);
    let body = composePage(out.body, file, hasMenu);
    if (file !== "index.html") {
      const head = body.slice(0, Math.max(0, body.search(/<main\b/)));
      body = body.replace(/<main\b/, (m) => pageBand(d, file, brand, head.includes(esc(d.name))) + m);
    }
    if (file === "about.html") body = appendInside(body, 'id="about"', gallery(d));
    if (file === "contact.html") body = appendInside(body, 'id="visit"', contactForm(d, formAction));
    if (d.logo) body = body.replace(/<footer([^>]*)>/, (m) => `${m}<img class="foot-logo" src="${esc(d.logo.path)}" alt="">`);
    if (d.social.length) body = body.replace(/<footer([^>]*)>((?:<img class="foot-logo"[^>]*>)?)/, (m) => `${m}<p class="foot-social">${d.social.map(([n, u]) => `<a href="${esc(u)}" rel="noopener">${n}</a>`).join("")}</p>`);
    // Every page needs one main heading for screen readers and search. The sub-pages (and Farmhouse's home, whose name
    // is a styled line) have none of their own, so a hidden one goes first in <main>; nothing changes on screen.
    if (!/<h1[\s>]/.test(body)) body = body.replace(/<main\b[^>]*>/, (m) => `${m}<h1 class="vh">${title ? `${esc(title)} | ` : ""}${esc(d.name)}</h1>`);
    let html = page({ ...d, pageTitle: title }, { fonts: design.fonts, body, theme: out.theme });
    // The skip link needs a target on every page: without the hero, the page's own section.
    if (!/\sid="main"/.test(html)) html = html.replace('<a class="skip" href="#main">', `<a class="skip" href="#${{ "menu.html": "menu", "about.html": "about", "contact.html": "visit" }[file]}">`);
    files[file] = decorateLogos(html, d, out, brand);
  }
  files["styles.css"] = `${BASE_CSS}\n${out.css}\n${PARTS_CSS(brand)}\n`;
  return files;
}

// Shared styles for the band, gallery, form and footer logo, after the design's own so they hold.
const PARTS_CSS = (brand) => `.page-band{position:relative;display:flex;align-items:center;justify-content:center;min-height:clamp(200px,30vw,340px);overflow:hidden;background:#111;color:#fff;text-align:center}
.page-band.plain{background:var(--pb);color:var(--pb-ink)}.page-band .pb-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}.page-band.photo-only{min-height:clamp(180px,26vw,320px)}.page-band.photo-only .pb-img{opacity:1}
.page-band .pb-in{position:relative;display:flex;flex-direction:column;align-items:center;gap:14px;padding:36px 20px}
.page-band .pb-logo{height:clamp(88px,12vw,128px);width:auto;max-width:min(320px,70vw);object-fit:contain;background:var(--plate,#fff);border-radius:16px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.25)}
.page-band .pb-name{margin:0;font-family:inherit;font-weight:800;font-size:clamp(28px,5vw,52px);line-height:1.1;text-shadow:0 2px 14px rgba(0,0,0,.35)}.page-band.plain .pb-name{text-shadow:none}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:32px 0 0}.gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px}
.cform{max-width:620px;margin:36px auto 72px;text-align:left}.cform h3{margin:0 0 14px;font-size:1.5em;line-height:1.2}.cform fieldset{display:grid;gap:14px;margin:0;padding:0;border:0;min-width:0}
.cform label{display:grid;gap:6px;font-weight:700}.cform small{font-weight:400;opacity:.75}
.cform input,.cform textarea{width:100%;font:inherit;font-weight:400;padding:12px 14px;border:1.5px solid currentColor;border-color:color-mix(in srgb,currentColor 40%,transparent);border-radius:8px;background:transparent;color:inherit}
.cform textarea{resize:vertical}.cform .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.cform button{justify-self:start;padding:14px 26px;border:0;border-radius:8px;background:${brand};color:${inkOn(brand)};font:inherit;font-weight:700;cursor:pointer}.cform fieldset[disabled]{opacity:.7}
.cform-note{margin:10px 0 0;font-size:.9em;opacity:.8}
.foot-social{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 18px;margin:0 0 12px}.foot-social a{color:inherit;font-weight:700;text-decoration:underline;text-underline-offset:3px}
.foot-logo{display:block;height:72px;width:auto;max-width:240px;object-fit:contain;margin:0 auto 12px;background:var(--plate,#fff);border-radius:12px;padding:8px}
.logo-halo{filter:drop-shadow(0 0 1px var(--glow)) drop-shadow(0 0 1px var(--glow)) drop-shadow(0 0 7px color-mix(in srgb,var(--glow) 70%,transparent))}
.logo-badge{box-sizing:content-box;padding:8px 12px;border-radius:14px;background:var(--plate);box-shadow:0 3px 12px rgba(0,0,0,.18)}img.logo.logo-badge{max-width:calc(100% - 24px)}
.logo-boxed{border-radius:10px;border:2px solid ${brand};box-shadow:0 3px 12px rgba(0,0,0,.18)}
@media(max-width:600px){.brand .logo{height:44px;max-width:140px}.mark .logo{height:56px}.top .logo{height:96px}.crest .logo,.hero .logo{height:96px}.rail .logo{height:84px}header a.cta{white-space:nowrap}.brand{font-size:min(1em,20px)}}`;

export { DESIGNS, DESIGN_KEYS, PAGES, buildDesignSite, composePage, designFor };
