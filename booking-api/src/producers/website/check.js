// Automated checks on a built site before the owner sees it (stage 7): accessibility scan with zero findings, every
// internal link and image resolves, no placeholder text, the buyer's contact facts are on the contact page, and size limits.
import { elementsOf, scanHtml, tagsOf } from "../accessibility/scan.js";
import { parseHours } from "./build.js";

const PLACEHOLDER = /lorem ipsum|\bTODO\b|\bTBD\b|\[(?:name|business|phone|address)\]|your (?:business|company) name|example\.com|undefined|\bnull\b/i;
const MAX_PAGE_BYTES = 200_000;
const MAX_IMAGE_BYTES = 1_500_000;

function checkSite({ pages, images = {}, site }) {
  const problems = [];
  const files = Object.keys(pages);
  if (files.length < 4 || files.length > 5) problems.push(`A site has 4 or 5 pages, this one has ${files.length}`);
  for (const [file, html] of Object.entries(pages)) {
    const size = new TextEncoder().encode(html).length;
    if (size > MAX_PAGE_BYTES) problems.push(`${file}: page is ${Math.round(size / 1024)} KB, over the ${MAX_PAGE_BYTES / 1000} KB limit`);
    for (const f of scanHtml(html)) problems.push(`${file}: accessibility - ${f.rule} (${f.count}) ${f.examples[0] || ""}`.trim());
    if (PLACEHOLDER.test(html.replace(/<style[\s\S]*?<\/style>/gi, ""))) problems.push(`${file}: contains placeholder-looking text`);
    for (const a of elementsOf(html, "a")) {
      const href = a.attrs.href || "";
      if (!href || /^(https?:|mailto:|tel:|#)/i.test(href)) continue;
      if (!pages[href.split("#")[0]]) problems.push(`${file}: link to ${href} goes nowhere`);
    }
    for (const img of tagsOf(html, "img")) {
      const src = img.attrs.src || "";
      if (!images[src]) problems.push(`${file}: image ${src} is not in the site`);
      else if (images[src] > MAX_IMAGE_BYTES) problems.push(`${file}: image ${src} is ${Math.round(images[src] / 1024)} KB, over the ${MAX_IMAGE_BYTES / 1000} KB limit`);
    }
  }
  const contact = pages["contact.html"] || "";
  if (site.phone && !contact.includes(`tel:${String(site.phone).replace(/[^\d+]/g, "")}`)) problems.push("contact.html: the buyer's phone number is missing");
  if (site.address && !contact.includes(String(site.address).replace(/&/g, "&amp;").replace(/</g, "&lt;"))) problems.push("contact.html: the buyer's address is missing");
  for (const h of parseHours(site.hours)) if (!contact.includes(h.time.replace(/&/g, "&amp;").replace(/</g, "&lt;"))) problems.push(`contact.html: hours line "${h.time}" is missing`);
  return problems;
}

export { MAX_IMAGE_BYTES, checkSite };
