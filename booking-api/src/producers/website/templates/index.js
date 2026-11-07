// The site generator's builder: one business, one design -> the files of a complete one-page site.
//   { "index.html", "styles.css" } plus the business's images at the paths given in site.logo / site.photos.
// Same files are shown in the generator, delivered in the zip, and served when Menu-made hosts it.
import { BASE_CSS, page, siteData } from "./common.js";
import { DESIGNS, DESIGN_KEYS, designFor } from "./designs.js";

function buildDesignSite(site, copy, key) {
  const design = designFor(key);
  if (!design) throw new Error(`Unknown design ${key}`);
  const d = siteData(site, copy);
  const out = design.render(d, site.brand);
  return {
    "index.html": page(d, { fonts: design.fonts, body: out.body, theme: out.theme }),
    "styles.css": `${BASE_CSS}\n${out.css}\n`
  };
}

export { DESIGNS, DESIGN_KEYS, buildDesignSite, designFor };
