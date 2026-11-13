// Shared pieces for the site generator's templates (owner, Nov 6, 2026: "generate site" shuffles real designs, the
// buyer chooses one, pays, and gets the whole site as a zip). Each template is a genuinely different layout, not a
// recolour: its own hero, menu layout, navigation, footer and type. Every site is one page (index.html) with sections
// Home, Menu, About, Contact, plus its images. Facts come only from what the business gave us; copy from the AI step.
import { parseHours, parseOfferings } from "../build.js";
import { hexOk } from "../styles.js";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const digits = (v) => String(v ?? "").replace(/[^\d+]/g, "");

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const inkOn = (bg) => (contrast("#111111", bg) >= contrast("#ffffff", bg) ? "#111111" : "#ffffff");
// The accent as text on `bg`: the brand colour when it reads (4.5:1), else the fallback.
const textOn = (colour, bg, fallback) => (contrast(colour, bg) >= 4.5 ? colour : fallback);
function mix(hex, other, amount) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(other.slice(i, i + 2), 16));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}
const brandOr = (brand, fallback) => (hexOk(brand) ? String(brand).trim().toLowerCase() : fallback);

// Everything a template needs, worked out once.
function siteData(site, copy) {
  const sections = parseOfferings(site.offerings);
  const hours = parseHours(site.hours);
  const services = site.kind === "services";
  const map = site.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${site.name} ${site.address}`)}` : "";
  return {
    // Customize (owner, Nov 6, 2026): the buyer's own motto and About text replace what we wrote.
    name: site.name, tagline: site.motto || copy.tagline, intro: copy.intro, meta: copy.meta_description,
    about: site.about_text ? String(site.about_text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, 4) : copy.about || [],
    sections, hours, address: site.address || "", phone: site.phone || "", tel: digits(site.phone), email: site.email || "", map,
    social: [["Instagram", site.instagram], ["Facebook", site.facebook], ["TikTok", site.tiktok], ["Yelp", site.yelp]].filter(([, u]) => /^https:\/\//.test(String(u || ""))),
    order: /^https:\/\//.test(String(site.order_url || "")) ? site.order_url : "",
    orderLabel: ["Order online", "Book a table", "Book now"].includes(site.order_label) ? site.order_label : "",
    logo: site.logo || null, logoMode: site.logo_bg || "auto", hideName: site.hide_name === true, photos: site.photos || [], menuLabel: services ? "Services" : "Menu", services
  };
}

const nav = (d, extra = "") => [["#main", "Home"], ["#menu", d.menuLabel], ["#about", "About"], ["#visit", "Contact"]].filter(([h]) => h !== "#menu" || d.sections.length)
  .map(([h, t]) => `<a href="${h}"${extra}>${esc(t)}</a>`).join("");

const callBtn = (d, cls) => (d.phone ? `<a class="${cls}" href="tel:${esc(d.tel)}">Call ${esc(d.phone)}</a>` : "");
const orderBtn = (d, cls) => (d.order ? `<a class="${cls}" href="${esc(d.order)}" rel="noopener">${esc(d.orderLabel || (d.services ? "Book now" : "Order online"))}</a>` : "");
const menuBtn = (d, cls) => (d.sections.length ? `<a class="${cls}" href="#menu">See the ${esc(d.menuLabel.toLowerCase())}</a>` : "");

function item(i, { leader = false } = {}) {
  return `<li class="item"><div class="item-top"><span class="item-name">${esc(i.name)}</span>${leader && i.price ? '<span class="leader" aria-hidden="true"></span>' : ""}${i.price ? `<span class="item-price">${esc(i.price)}</span>` : ""}</div>${i.description ? `<p class="item-desc">${esc(i.description)}</p>` : ""}</li>`;
}

function hoursList(d, cls = "hours") {
  if (!d.hours.length) return d.phone ? "<p>Call us for today’s hours.</p>" : "";
  return `<dl class="${cls}">${d.hours.map((h) => (h.day ? `<dt>${esc(h.day)}</dt><dd>${esc(h.time)}</dd>` : `<dd class="wide">${esc(h.time)}</dd>`)).join("")}</dl>`;
}

// Social links as icons (owner, Nov 12, 2026: "icons that match each template"). One set of simple line/solid
// glyphs drawn in currentColor; each design frames them its own way (SOCIAL_CSS in index.js, class soc-<design>).
const SOCIAL_ICONS = {
  Instagram: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.4" cy="6.6" r="1.25" fill="currentColor"/></svg>',
  Facebook: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.6 21v-7.6h2.6l.4-3.1h-3V8.4c0-.9.3-1.5 1.6-1.5h1.6V4.1c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.3H8v3.1h2.6V21z" fill="currentColor"/></svg>',
  TikTok: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16.3 3c.3 2.2 1.6 3.7 3.7 3.9v3c-1.4.1-2.6-.3-3.7-1v6.3c0 3.1-2.3 5.6-5.6 5.6S5 18.4 5.4 15.1c.4-2.8 2.9-4.7 5.9-4.4v3.1c-1.4-.3-2.8.5-2.9 1.9-.1 1.3.9 2.4 2.3 2.4 1.4 0 2.4-1 2.4-2.6V3z" fill="currentColor"/></svg>',
  Yelp: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.8l2.4 5.4 5.9.6-4.4 3.9 1.3 5.8L12 15.5l-5.2 3 1.3-5.8-4.4-3.9 5.9-.6z" fill="currentColor"/></svg>'
};
function socialIcons(d, cls = "soc-row") {
  if (!d.social.length) return "";
  return `<span class="${cls}">${d.social.map(([n, u]) => `<a class="soc" href="${esc(u)}" rel="noopener" aria-label="${n}" title="${n}">${SOCIAL_ICONS[n] || esc(n)}</a>`).join("")}</span>`;
}

function contactLines(d) {
  return [
    d.address ? `<p class="c-line"><span class="c-label">Address</span><span>${esc(d.address)}</span>${d.map ? `<a href="${esc(d.map)}" rel="noopener">Get directions</a>` : ""}</p>` : "",
    d.phone ? `<p class="c-line"><span class="c-label">Phone</span><a href="tel:${esc(d.tel)}">${esc(d.phone)}</a></p>` : "",
    d.email ? `<p class="c-line"><span class="c-label">Email</span><a href="mailto:${esc(d.email)}">${esc(d.email)}</a></p>` : "",
    d.social.length ? `<p class="c-line"><span class="c-label">Follow</span>${socialIcons(d)}</p>` : ""
  ].join("");
}

const logoImg = (d, cls = "logo", size = 48) => (d.logo ? `<img class="${cls}" src="${esc(d.logo.path)}" alt="" width="${size}" height="${size}">` : "");
// "Hide the name" (Customize, owner, Nov 7, 2026): for a logo that already spells out the name. The name leaves the
// header and the hero only, and stays there for screen readers and search; page titles, About text and the footer keep it.
const nameHidden = (d) => Boolean(d.hideName && d.logo);
const shownName = (d) => (nameHidden(d) ? `<span class="vh">${esc(d.name)}</span>` : esc(d.name));
const nameEl = (d, tag, cls = "") => {
  const c = [cls, nameHidden(d) ? "vh" : ""].filter(Boolean).join(" ");
  return `<${tag}${c ? ` class="${c}"` : ""}>${esc(d.name)}</${tag}>`;
};
const photo = (d, i, cls = "") => (d.photos[i] ? `<img class="${cls}" src="${esc(d.photos[i].path)}" alt="${esc(d.photos[i].alt || "")}" loading="${i ? "lazy" : "eager"}">` : "");
const aboutHtml = (d) => d.about.map((p) => `<p>${esc(p)}</p>`).join("");

// "Website by MENU-MADE" (owner, Nov 7, 2026), under every design's own footer: the menu-made.com logo on the brand's
// navy, so it reads the same on light and dark designs. The logo is inline (1.8 KB): hosted sites only load images
// from their own domain.
const MENU_MADE_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAL4AAAAoCAMAAAB3lbDxAAAAkFBMVEUAAAACnKrcDgT+AQABd4oEusIDzdTpGhXeXwtbV19hmZiOWVm6HRikKi9VqqoqlqcqYXKkLC8A+fwx3ON/Dg79Xl6qVVUXfHyIiYLRhghyOUVrnZ2LO0b/XwCsVFJV//9D1NdcanfPIiP1QhBTd4RvfIF2dnYDtMsvuMZV/6qXTjnHSygAVaoDnKqiPEAvdIWmaE2TAAAAMHRSTlMA/v4P/f7+Xv7y8NsD4gNk/q4FXAICAwLu//C66QKpA3G4k1is6gIyXQPAkgMhs5JWKPdzAAAES0lEQVR42s2ZCXvqKhCGJxKTg0gjuS7VGz3HaGvt7fL//91li7IlBq3t+R7rUxbhdSQwzEAJiH0wSimjOYwRIEo2hFJZgWCKIOflijLGckAgVPJXoSSKf1yJStV8AFjwAh80h7qu+RBIlTYfvPr1lRBSVZQOiBDGhDfLKVAJOauYZlCzNhpLIKKAuPJRIpVOFP4oy4aynGJemkOe6Qpcw7OkL/eEDkz9OsmqpnR7EF9WDqomwYwXSJINh4lWmk5okqmKJ4ZmAvYZ2Eh1SDGHcvFBf5y3cfps6ODrcoM/1BWJGmpW7geugvRCuEQLMGySpAyRzKKX+Lo8qWEO/NVApUH8xAAizVgX8dOUyt+xoEH6ZZB/CzOFPzxNKf4P46fpSqyVEjVQ3fgcCJ4i8MXgCLZB4y+XyxA+4WvNxE8ng6zV+nLK6fTc/RL+KhofAMfg0wMsbHzq4dd/AX7L4umBv8p/GL/90W3BN/lx7kwZhT/qxp+Z+Fjjy2PBRV86X0F1Iu8efnJSOsG4yo3NL4iPvha/OOvl5Z+QXl7OXd7dR7fOTSFxkN2A/3gaGPfEjxb/FDaN5LVejV9dgf/24Oj4+yy37cHHH8/m87n4G3MhFI8/ugn/Guvbh+ON1o/DTzz8tznqp/lbPP4Y3Rl/GmV5+W7g19+M7y6eBRR7rPQ0CutJt+8L6TH/KH5m4z9DUbWdW77LUwgnu4R++ImYAVz8dTs+icZfwIG0nrpBl21h4//Xic9pr8Xf+fjrAH4RdhrCPs+giMa3d57djfg7Z/HAZxBfeZy/+uBPO/B3l/F38O34m9Ms6Xfioy9aPL3xvbW/+9FHF5fibn8D/hfvPGLjJNEbp4Evb+M2/uM98X2fp9hvhfb7f9u01z3UsWXhMxluacHnLgW6t9MQ7bb97o2PvwE/6LKt1+s2l43jw3kFMuVHtFp/fXf8eOt344/uie+5bN6V5OGobizHo9+0iMb/264rcORrvzc+OPiIB2wNvdv4sVf1Et4v3dStuzq/qsNDDP7ctT7vYur6SMNKXuU+qZa15Wun4bT56z6V2Dod/NLFhy58lBNMiI6hiw8MIsJUAXwYDHofW8ppuISPu/A3iRnWciK60VG2IH6703ArvgyADhMjG3ABH1u0vfFbQrQ+PnXwodv6tCsg7eLzmVimMyHcTjPw8Bed+GGHGWx87zpPovCtte+EMKblaTCKeHgvkJ440AjrVzxEy7dCPkhiDRLE1xFZKz3h4+ej01grJzmkgjIi24VFYg4gLjnk43/yX1Ds5OclWbn45l2MoWcnOeThM7TR60Pg26k5nQfMWa6zfHZqbiZmQ+WW9tx56LaclnLMHDf2rNyzT+I3ibvSTc3Z8fRUdiHJsMG3E6NgOJQqR2kmRpvpyqLZiZUAHpUArHpclPo55Qkuprbvivn4+WbzwRgPPYORGGVMZmdrPdYrF1AmrYryD6pa/wcMa5tUrvAl3gAAAABJRU5ErkJggg==";
const CREDIT = `<a class="mm-credit" href="https://menu-made.com/">Website by <img src="${MENU_MADE_LOGO}" alt="MENU-MADE" width="95" height="20"></a>`;

function page(d, { fonts, css, body, theme }) {
  const fontLink = fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${d.pageTitle ? `${esc(d.pageTitle)} | ${esc(d.name)}` : `${esc(d.name)}${d.tagline ? ` | ${esc(d.tagline)}` : ""}`}</title><meta name="description" content="${esc(d.meta || d.intro)}"><meta name="theme-color" content="${theme}">${fontLink}<link rel="stylesheet" href="styles.css"></head>
<body><a class="skip" href="#main">Skip to content</a>${body}${CREDIT}</body></html>`;
}

const BASE_CSS = `*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{margin:0;overflow-wrap:anywhere}img{max-width:100%;display:block}
.skip{position:absolute;left:-999px;top:0;z-index:50;padding:10px 14px;background:#000;color:#fff}.skip:focus{left:8px;top:8px}
.mm-credit{display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 16px;background:#071f2c;color:#e8f6f7;font:500 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.02em;text-decoration:none}.mm-credit img{display:block;width:auto;height:20px}.mm-credit:hover,.mm-credit:focus-visible{color:#5ff2ff}
a:focus-visible,button:focus-visible{outline:3px solid currentColor;outline-offset:3px}
.vh{position:absolute!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important}
section[id]{scroll-margin-top:84px}
.item{list-style:none}.item-top{display:flex;align-items:baseline;gap:10px}.item-name{font-weight:700}.item-price{margin-left:auto;font-weight:700;white-space:nowrap}
.leader{flex:1;border-bottom:2px dotted currentColor;opacity:.35;transform:translateY(-4px)}.leader+.item-price{margin-left:0}
.item-desc{margin:4px 0 0;opacity:.82}
dl{margin:0}dt{font-weight:700}dd{margin:0}.c-line{display:flex;flex-wrap:wrap;gap:4px 12px;margin:0 0 12px}.c-label{font-weight:700;min-width:72px}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}`;

export { BASE_CSS, SOCIAL_ICONS, aboutHtml, brandOr, callBtn, contactLines, esc, hoursList, inkOn, item, logoImg, menuBtn, mix, nameEl, nameHidden, nav, orderBtn, page, photo, shownName, siteData, socialIcons, textOn };
