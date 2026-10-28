// Builds the Website Package pages (stage 7) from the buyer's intake and the AI-written copy. Pure functions.
// Facts (name, phone, address, hours, menu items, prices) come only from the intake; the AI supplies the tagline, the
// intro and the About text. Output: { "index.html": html, ... } with relative links, so the same files work under
// /api/site/<slug>/, a preview path, and a subdomain or custom domain.
import { css, paletteFor } from "./styles.js";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const digits = (v) => String(v ?? "").replace(/[^\d+]/g, "");

// "# Section" starts a section; items are "Name | description | $price" (also "Name - description - $price").
function parseOfferings(text) {
  const sections = [];
  let current = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#+\s*(.+)$/.exec(line);
    if (heading) { current = { name: heading[1].trim().slice(0, 60), items: [] }; sections.push(current); continue; }
    if (!current) { current = { name: "", items: [] }; sections.push(current); }
    const parts = (line.includes("|") ? line.split("|") : line.split(/\s+-\s+/)).map((p) => p.trim()).filter(Boolean);
    const last = parts.at(-1) || "";
    const price = parts.length > 1 && /^\$?\s?\d[\d.,]*$|^from\s+\$?\d|^\$\d/i.test(last) ? parts.pop() : "";
    const name = (parts.shift() || "").slice(0, 80);
    if (!name) continue;
    current.items.push({ name, description: parts.join(" - ").slice(0, 240), price: price && !price.startsWith("$") && /^\d/.test(price) ? `$${price}` : price });
  }
  return sections.filter((s) => s.items.length);
}

function parseHours(text) {
  return String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 10).map((line) => {
    const i = line.indexOf(":");
    return i > 0 && i < 24 ? { day: line.slice(0, i).trim(), time: line.slice(i + 1).trim() } : { day: "", time: line };
  });
}

function pageList(site) {
  const pages = [{ file: "index.html", nav: "Home" }, { file: site.kind === "services" ? "services.html" : "menu.html", nav: site.kind === "services" ? "Services" : "Menu" }, { file: "about.html", nav: "About" }];
  if (site.photos.length) pages.push({ file: "gallery.html", nav: "Gallery" });
  pages.push({ file: "contact.html", nav: "Contact" });
  return pages;
}

function shell(site, copy, current, title, description, body) {
  const palette = paletteFor(site.style, site.brand);
  const pages = pageList(site);
  const nav = pages.map((p) => `<li><a href="${p.file}"${p.file === current ? ' aria-current="page"' : ""}>${esc(p.nav)}</a></li>`).join("");
  const logo = site.logo ? `<img src="${esc(site.logo.path)}" alt="" width="44" height="44">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="${palette.brand}"><style>${css(site.style, site.brand)}</style></head>
<body><a class="skip" href="#content">Skip to content</a><header class="site"><div class="in"><a class="brand" href="index.html">${logo}<span>${esc(site.name)}</span></a><nav class="wide" aria-label="Main"><ul>${nav}</ul></nav><details class="narrow"><summary><svg aria-hidden="true" focusable="false" width="26" height="26" viewBox="0 0 26 26"><rect x="3" y="6" width="20" height="2.6" rx="1.3" fill="currentColor"/><rect x="3" y="11.7" width="20" height="2.6" rx="1.3" fill="currentColor"/><rect x="3" y="17.4" width="20" height="2.6" rx="1.3" fill="currentColor"/></svg><span class="vh">Pages</span></summary><nav aria-label="Main"><ul>${nav}</ul></nav></details></div></header>
<main id="content">${body}</main><footer class="site"><p>${esc(site.name)}${site.address ? ` · ${esc(site.address)}` : ""}${site.phone ? ` · <a href="tel:${esc(digits(site.phone))}">${esc(site.phone)}</a>` : ""}</p></footer></body></html>`;
}

const buttons = (site) => [
  site.phone ? `<a class="btn" href="tel:${esc(digits(site.phone))}">Call ${esc(site.phone)}</a>` : "",
  `<a class="btn" href="contact.html">Hours and directions</a>`
].join("");

function menuHtml(site, sections) {
  return sections.map((s) => `<section class="menu-section">${s.name ? `<h2>${esc(s.name)}</h2>` : ""}<ul>${s.items.map((i) => `<li><span class="n">${esc(i.name)}</span>${i.price ? `<span class="p">${esc(i.price)}</span>` : ""}${i.description ? `<span class="d">${esc(i.description)}</span>` : ""}</li>`).join("")}</ul></section>`).join("");
}

function buildSite(site, copy) {
  const sections = parseOfferings(site.offerings);
  const hours = parseHours(site.hours);
  const menuFile = site.kind === "services" ? "services.html" : "menu.html";
  const menuTitle = site.kind === "services" ? "Services" : "Menu";
  const hero = site.photos[0] ? `<img class="hero-img" src="${esc(site.photos[0].path)}" alt="${esc(site.photos[0].alt)}" width="980" height="420">` : "";
  const pages = {};
  pages["index.html"] = shell(site, copy, "index.html", `${site.name} | ${copy.tagline}`, copy.meta_description, `<div class="hero">${hero}<h1>${esc(site.name)}</h1><p class="lead">${esc(copy.tagline)}</p><p>${buttons(site)}</p></div><div class="text"><p>${esc(copy.intro)}</p></div>`);
  pages[menuFile] = shell(site, copy, menuFile, `${menuTitle} | ${site.name}`, `${menuTitle} at ${site.name}.`, `<h1>${menuTitle}</h1>${menuHtml(site, sections)}<p>${buttons(site)}</p>`);
  pages["about.html"] = shell(site, copy, "about.html", `About | ${site.name}`, copy.meta_about, `<h1>About ${esc(site.name)}</h1><div class="text">${copy.about.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`);
  if (site.photos.length) pages["gallery.html"] = shell(site, copy, "gallery.html", `Gallery | ${site.name}`, `Photos of ${site.name}.`, `<h1>Gallery</h1><ul class="gallery">${site.photos.map((p) => `<li><img src="${esc(p.path)}" alt="${esc(p.alt)}" width="400" height="230" loading="lazy"></li>`).join("")}</ul>`);
  const map = site.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${site.name} ${site.address}`)}` : "";
  const social = [site.facebook && ["Facebook", site.facebook], site.instagram && ["Instagram", site.instagram]].filter(Boolean);
  pages["contact.html"] = shell(site, copy, "contact.html", `Contact and hours | ${site.name}`, `Hours, address and phone for ${site.name}.`,
    `<h1>Contact and hours</h1><div class="card">${site.address ? `<p><strong>Address</strong><br>${esc(site.address)}<br><a href="${esc(map)}">Get directions</a></p>` : ""}${site.phone ? `<p><strong>Phone</strong><br><a href="tel:${esc(digits(site.phone))}">${esc(site.phone)}</a></p>` : ""}${site.email ? `<p><strong>Email</strong><br><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>` : ""}${social.length ? `<p><strong>Follow us</strong><br>${social.map(([n, u]) => `<a href="${esc(u)}">${n}</a>`).join(" · ")}</p>` : ""}</div>
<h2>Hours</h2>${hours.length ? `<dl class="hours">${hours.map((h) => (h.day ? `<dt>${esc(h.day)}</dt><dd>${esc(h.time)}</dd>` : `<dd style="grid-column:1/3">${esc(h.time)}</dd>`)).join("")}</dl>` : "<p>Please call for our hours.</p>"}`);
  return pages;
}

export { buildSite, pageList, parseHours, parseOfferings };
