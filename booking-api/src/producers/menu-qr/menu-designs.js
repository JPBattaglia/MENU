// The menu generator's designs (owner, Nov 7, 2026: "the same multiple template option" as the site generator). The free
// preview shows the buyer's menu in each design; "Generate menu" goes to the next one and "Make it live" orders the one
// on screen. The first design is the buyer's own printed menu (colours and type the reader saw, style.js); the rest
// are fixed themes over the same phone page, so every design passes the same checks and Menu Care keeps it (the
// theme is stored in the page, styleMeta).
//
// Each design is a raw style in the reader's vocabulary (style.js normalizeStyle), plus structure (style.js
// structureCss): header, nav (all centred), section headings, item layout, paper texture, page frame. Owner, Nov 7:
// "all the menus look too similar", so each design differs in structure, type and colour, not colour alone.
// The buyer's Customize colour changes only the highlights (accent); headers and headings keep the design's colours.

const MENU_DESIGNS = [
  { key: "yours", label: "Your printed menu", blurb: "The colours and type of the menu you sent" },
  { key: "classic", label: "Classic", blurb: "Burgundy band, ruled cream paper, framed page",
    style: { paper: "#fbf6ec", text: "#2a2420", heading: "#7a1f2b", accent: "#b8902b", item: "#2a2420", price: "#7a1f2b", title_font: "classic-serif", heading_font: "classic-serif", body_font: "classic-serif", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "line", item_layout: "stacked", header: "band", nav: "pills", section: "short", texture: "lines", frame: true } },
  { key: "bistro", label: "Bistro Noir", blurb: "Black and gold, framed title, big prices",
    style: { paper: "#151412", text: "#efe8da", heading: "#e2bf72", accent: "#e2bf72", item: "#fbf6ec", price: "#e2bf72", title_font: "elegant-serif", heading_font: "elegant-serif", body_font: "classic-serif", heading_case: "upper", item_case: "upper", heading_align: "center", divider: "none", item_layout: "board", header: "frame", nav: "links", section: "label" } },
  { key: "modern", label: "Modern", blurb: "Bold sans, numbered sections, two-column cards",
    style: { paper: "#ffffff", text: "#111111", heading: "#111111", accent: "#ff4f2e", item: "#111111", price: "#111111", title_font: "modern-sans", heading_font: "modern-sans", body_font: "modern-sans", heading_case: "upper", item_case: "as-printed", heading_align: "left", divider: "none", item_layout: "grid", header: "split", nav: "tabs", section: "numbered" } },
  { key: "chalkboard", label: "Chalkboard", blurb: "A slate board, chalk lettering, tag-style nav",
    style: { paper: "#26332d", text: "#eef0e6", heading: "#f6e7a6", accent: "#a8dccf", item: "#ffffff", price: "#f6e7a6", title_font: "script", heading_font: "condensed-sans", body_font: "rounded-sans", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "dotted", item_layout: "inline", header: "plain", nav: "chips", section: "rule", texture: "chalk" } },
  { key: "diner", label: "Diner", blurb: "Checkered edge, red banners, price tags",
    style: { paper: "#fffaf0", text: "#222222", heading: "#c62828", accent: "#1d4e89", item: "#1d4e89", price: "#c62828", title_font: "slab", heading_font: "slab", body_font: "modern-sans", heading_case: "upper", item_case: "upper", heading_align: "center", divider: "none", item_layout: "badge", header: "ticket", nav: "bar", section: "banner" } },
  { key: "garden", label: "Garden", blurb: "Soft green arch, rounded cards, dotted paper",
    style: { paper: "#f2f6ec", text: "#25352a", heading: "#2f6b45", accent: "#c07a3a", item: "#25352a", price: "#2f6b45", title_font: "rounded-sans", heading_font: "rounded-sans", body_font: "rounded-sans", heading_case: "title", item_case: "as-printed", heading_align: "left", divider: "none", item_layout: "cards", header: "arch", nav: "pills", section: "side", texture: "dots" } },
  { key: "fine", label: "Fine Dining", blurb: "Spaced capitals, centred dishes, quiet ivory",
    style: { paper: "#faf7f1", text: "#1b1b1b", heading: "#1b1b1b", accent: "#9a7b45", item: "#1b1b1b", price: "#5a4a2e", title_font: "elegant-serif", heading_font: "elegant-serif", body_font: "elegant-serif", heading_case: "upper", item_case: "upper", heading_align: "center", divider: "ornament", item_layout: "centered", header: "minimal", nav: "links", section: "rule", frame: true } },
  { key: "night", label: "Night Market", blurb: "Neon glow on navy, pill headings, grid cards",
    style: { paper: "#11162b", text: "#e9ecf5", heading: "#ffb000", accent: "#ff4f9a", item: "#ffffff", price: "#ffb000", title_font: "condensed-sans", heading_font: "condensed-sans", body_font: "modern-sans", heading_case: "upper", item_case: "upper", heading_align: "left", divider: "none", item_layout: "grid", header: "hero", nav: "tabs", section: "fill", texture: "grid" } }
];
const MENU_DESIGN_KEYS = MENU_DESIGNS.map((d) => d.key);
const menuDesignFor = (key) => MENU_DESIGNS.find((d) => d.key === key) || null;

// The raw style for a design. "yours" is the reader's own (null when it saw none: the standard page).
function designStyle(key, menu) {
  const design = menuDesignFor(key) || MENU_DESIGNS[0];
  return design.style ? { ...design.style } : menu?.style || null;
}

export { MENU_DESIGNS, MENU_DESIGN_KEYS, menuDesignFor, designStyle };
