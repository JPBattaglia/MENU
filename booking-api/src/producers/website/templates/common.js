// Shared pieces for the site generator's templates (owner, Nov 6, 2026: "generate site" shuffles real designs, the
// buyer chooses one, pays, and gets the whole site as a zip). Each template is a genuinely different layout, not a
// recolour: its own hero, menu layout, navigation, footer and type. Every site is one page (index.html) with sections
// Home, Menu, About, Visit, plus its images. Facts come only from what the business gave us; copy from the AI step.
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
    name: site.name, tagline: copy.tagline, intro: copy.intro, about: copy.about || [], meta: copy.meta_description,
    sections, hours, address: site.address || "", phone: site.phone || "", tel: digits(site.phone), email: site.email || "", map,
    social: [site.facebook && ["Facebook", site.facebook], site.instagram && ["Instagram", site.instagram]].filter(Boolean),
    order: /^https:\/\//.test(String(site.order_url || "")) ? site.order_url : "",
    logo: site.logo || null, photos: site.photos || [], menuLabel: services ? "Services" : "Menu", services
  };
}

const nav = (d, extra = "") => [["#menu", d.menuLabel], ["#about", "About"], ["#visit", d.address ? "Visit" : "Contact"]].filter(([h]) => h !== "#menu" || d.sections.length)
  .map(([h, t]) => `<a href="${h}"${extra}>${esc(t)}</a>`).join("");

const callBtn = (d, cls) => (d.phone ? `<a class="${cls}" href="tel:${esc(d.tel)}">Call ${esc(d.phone)}</a>` : "");
const orderBtn = (d, cls) => (d.order ? `<a class="${cls}" href="${esc(d.order)}" rel="noopener">${d.services ? "Book now" : "Order online"}</a>` : "");
const menuBtn = (d, cls) => (d.sections.length ? `<a class="${cls}" href="#menu">See the ${esc(d.menuLabel.toLowerCase())}</a>` : "");

function item(i, { leader = false } = {}) {
  return `<li class="item"><div class="item-top"><span class="item-name">${esc(i.name)}</span>${leader && i.price ? '<span class="leader" aria-hidden="true"></span>' : ""}${i.price ? `<span class="item-price">${esc(i.price)}</span>` : ""}</div>${i.description ? `<p class="item-desc">${esc(i.description)}</p>` : ""}</li>`;
}

function hoursList(d, cls = "hours") {
  if (!d.hours.length) return d.phone ? "<p>Call us for today’s hours.</p>" : "";
  return `<dl class="${cls}">${d.hours.map((h) => (h.day ? `<dt>${esc(h.day)}</dt><dd>${esc(h.time)}</dd>` : `<dd class="wide">${esc(h.time)}</dd>`)).join("")}</dl>`;
}

function contactLines(d) {
  return [
    d.address ? `<p class="c-line"><span class="c-label">Address</span><span>${esc(d.address)}</span>${d.map ? `<a href="${esc(d.map)}" rel="noopener">Get directions</a>` : ""}</p>` : "",
    d.phone ? `<p class="c-line"><span class="c-label">Phone</span><a href="tel:${esc(d.tel)}">${esc(d.phone)}</a></p>` : "",
    d.email ? `<p class="c-line"><span class="c-label">Email</span><a href="mailto:${esc(d.email)}">${esc(d.email)}</a></p>` : "",
    d.social.length ? `<p class="c-line"><span class="c-label">Follow</span><span>${d.social.map(([n, u]) => `<a href="${esc(u)}" rel="noopener">${n}</a>`).join(" · ")}</span></p>` : ""
  ].join("");
}

const logoImg = (d, cls = "logo", size = 48) => (d.logo ? `<img class="${cls}" src="${esc(d.logo.path)}" alt="" width="${size}" height="${size}">` : "");
const photo = (d, i, cls = "") => (d.photos[i] ? `<img class="${cls}" src="${esc(d.photos[i].path)}" alt="${esc(d.photos[i].alt || "")}" loading="${i ? "lazy" : "eager"}">` : "");
const aboutHtml = (d) => d.about.map((p) => `<p>${esc(p)}</p>`).join("");

function page(d, { fonts, css, body, theme }) {
  const fontLink = fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.name)}${d.tagline ? ` | ${esc(d.tagline)}` : ""}</title><meta name="description" content="${esc(d.meta || d.intro)}"><meta name="theme-color" content="${theme}">${fontLink}<link rel="stylesheet" href="styles.css"></head>
<body><a class="skip" href="#main">Skip to content</a>${body}</body></html>`;
}

const BASE_CSS = `*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{margin:0;overflow-wrap:anywhere}img{max-width:100%;display:block}
.skip{position:absolute;left:-999px;top:0;z-index:50;padding:10px 14px;background:#000;color:#fff}.skip:focus{left:8px;top:8px}
a:focus-visible,button:focus-visible{outline:3px solid currentColor;outline-offset:3px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
section[id]{scroll-margin-top:84px}
.item{list-style:none}.item-top{display:flex;align-items:baseline;gap:10px}.item-name{font-weight:700}.item-price{margin-left:auto;font-weight:700;white-space:nowrap}
.leader{flex:1;border-bottom:2px dotted currentColor;opacity:.35;transform:translateY(-4px)}.leader+.item-price{margin-left:0}
.item-desc{margin:4px 0 0;opacity:.82}
dl{margin:0}dt{font-weight:700}dd{margin:0}.c-line{display:flex;flex-wrap:wrap;gap:4px 12px;margin:0 0 12px}.c-label{font-weight:700;min-width:72px}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}`;

export { BASE_CSS, aboutHtml, brandOr, callBtn, contactLines, esc, hoursList, inkOn, item, logoImg, menuBtn, mix, nav, orderBtn, page, photo, siteData, textOn };
