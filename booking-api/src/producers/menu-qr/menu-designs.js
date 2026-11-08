// The menu generator's designs (owner, Nov 7, 2026: "the same multiple template option" as the site generator). The free
// preview shows the buyer's menu in each design; "Generate menu" goes to the next one and "Make it live" orders the one
// on screen. The first design is the buyer's own printed menu (colours and type the reader saw, style.js); the rest
// are fixed themes over the same phone page, so every design passes the same checks and Menu Care keeps it (the
// theme is stored in the page, styleMeta).
//
// Each design is a raw style in the reader's vocabulary (style.js normalizeStyle), plus:
//   header  "plain" (name on the paper) or "band" (name on a band of the heading colour)
// The buyer's brand colour (Customize) replaces heading and accent; normalizeStyle keeps it readable on the paper.

const MENU_DESIGNS = [
  { key: "yours", label: "Your printed menu", blurb: "The colours and type of the menu you sent" },
  { key: "classic", label: "Classic", blurb: "Cream paper, warm serif, dotted price lines",
    style: { paper: "#fbf8f3", text: "#1d1d1b", heading: "#7a1f2b", accent: "#b8902b", item: "#1d1d1b", price: "#7a1f2b", title_font: "classic-serif", heading_font: "classic-serif", body_font: "classic-serif", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "line", item_layout: "stacked", header: "band" } },
  { key: "bistro", label: "Bistro Noir", blurb: "Dark and candle-lit, gold headings",
    style: { paper: "#1b1a17", text: "#efe8da", heading: "#d9b46a", accent: "#d9b46a", item: "#f6f0e4", price: "#d9b46a", title_font: "elegant-serif", heading_font: "classic-serif", body_font: "classic-serif", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "double", item_layout: "stacked", header: "plain" } },
  { key: "modern", label: "Modern", blurb: "Clean white, bold sans, left aligned",
    style: { paper: "#ffffff", text: "#141414", heading: "#141414", accent: "#0f766e", item: "#141414", price: "#0f766e", title_font: "modern-sans", heading_font: "modern-sans", body_font: "modern-sans", heading_case: "upper", item_case: "as-printed", heading_align: "left", divider: "line", item_layout: "inline", header: "band" } },
  { key: "chalkboard", label: "Chalkboard", blurb: "A slate board with chalk-white writing",
    style: { paper: "#24302b", text: "#f1f1ea", heading: "#f5e6a8", accent: "#9fd3c7", item: "#ffffff", price: "#f5e6a8", title_font: "script", heading_font: "condensed-sans", body_font: "rounded-sans", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "dotted", item_layout: "stacked", header: "plain" } },
  { key: "diner", label: "Diner", blurb: "Red and blue, slab type, all-day feel",
    style: { paper: "#fffaf0", text: "#222222", heading: "#c62828", accent: "#1d4e89", item: "#1d4e89", price: "#c62828", title_font: "slab", heading_font: "slab", body_font: "modern-sans", heading_case: "upper", item_case: "upper", heading_align: "center", divider: "double", item_layout: "stacked", header: "band" } },
  { key: "garden", label: "Garden", blurb: "Soft green, rounded type, fresh and light",
    style: { paper: "#f3f6ee", text: "#26352a", heading: "#2f6b45", accent: "#7d9a7e", item: "#26352a", price: "#2f6b45", title_font: "rounded-sans", heading_font: "rounded-sans", body_font: "rounded-sans", heading_case: "title", item_case: "as-printed", heading_align: "left", divider: "none", item_layout: "inline", header: "plain" } },
  { key: "fine", label: "Fine Dining", blurb: "Ivory and black, spaced capitals, quiet",
    style: { paper: "#faf7f2", text: "#1b1b1b", heading: "#1b1b1b", accent: "#8a6d3b", item: "#1b1b1b", price: "#5a4a2e", title_font: "elegant-serif", heading_font: "elegant-serif", body_font: "classic-serif", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "ornament", item_layout: "stacked", header: "plain" } },
  { key: "night", label: "Night Market", blurb: "Deep navy with neon amber, loud and late",
    style: { paper: "#141a2e", text: "#e9ecf5", heading: "#ffb000", accent: "#ff5c8a", item: "#ffffff", price: "#ffb000", title_font: "condensed-sans", heading_font: "condensed-sans", body_font: "modern-sans", heading_case: "upper", item_case: "upper", heading_align: "left", divider: "line", item_layout: "inline", header: "band" } }
];
const MENU_DESIGN_KEYS = MENU_DESIGNS.map((d) => d.key);
const menuDesignFor = (key) => MENU_DESIGNS.find((d) => d.key === key) || null;

// The raw style for a design. "yours" is the reader's own (null when it saw none: the standard page).
function designStyle(key, menu) {
  const design = menuDesignFor(key) || MENU_DESIGNS[0];
  return design.style ? { ...design.style } : menu?.style || null;
}

export { MENU_DESIGNS, MENU_DESIGN_KEYS, menuDesignFor, designStyle };
