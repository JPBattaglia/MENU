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
  { key: "classic", label: "Classic", blurb: "Burgundy band, ruled cream paper, framed page",
    style: { paper: "#fbf6ec", text: "#2a2420", heading: "#7a1f2b", accent: "#b8902b", item: "#2a2420", price: "#7a1f2b", title_font: "classic-serif", heading_font: "classic-serif", body_font: "classic-serif", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "line", item_layout: "stacked", header: "band", nav: "pills", section: "short", texture: "lines", frame: "line" } },
  { key: "bistro", label: "Bistro Noir", blurb: "Black and gold, framed title, big prices",
    style: { paper: "#151412", text: "#efe8da", heading: "#e2bf72", accent: "#e2bf72", item: "#fbf6ec", price: "#e2bf72", title_font: "elegant-serif", heading_font: "elegant-serif", body_font: "classic-serif", heading_case: "upper", item_case: "upper", heading_align: "center", divider: "none", item_layout: "board", header: "frame", nav: "links", section: "label" } },
  { key: "modern", label: "Modern", blurb: "Bold sans, numbered sections, two-column cards",
    style: { paper: "#ffffff", text: "#111111", heading: "#111111", accent: "#ff4f2e", item: "#111111", price: "#111111", title_font: "modern-sans", heading_font: "modern-sans", body_font: "modern-sans", heading_case: "upper", item_case: "as-printed", heading_align: "left", divider: "none", item_layout: "grid", header: "split", nav: "tabs", section: "numbered" } },
  { key: "chalkboard", label: "Chalkboard", blurb: "Hand-lettered chalk on a slate board in a wooden frame",
    style: { paper: "#2b3a33", text: "#f1f3ea", heading: "#fff3b8", accent: "#bfe6dc", item: "#ffffff", price: "#fff3b8", title_font: "chalk", heading_font: "chalk", body_font: "chalk", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "dotted", item_layout: "inline", header: "plain", nav: "pills", section: "rule", texture: "chalk", frame: "chalk" } },
  { key: "diner", label: "Diner", blurb: "Checkered edge, red banners, price tags",
    style: { paper: "#fffaf0", text: "#222222", heading: "#c62828", accent: "#1d4e89", item: "#1d4e89", price: "#c62828", title_font: "slab", heading_font: "slab", body_font: "modern-sans", heading_case: "upper", item_case: "upper", heading_align: "center", divider: "none", item_layout: "badge", header: "ticket", nav: "bar", section: "banner" } },
  { key: "garden", label: "Garden", blurb: "Soft green arch, rounded cards, dotted paper",
    style: { paper: "#f2f6ec", text: "#25352a", heading: "#2f6b45", accent: "#c07a3a", item: "#25352a", price: "#2f6b45", title_font: "rounded-sans", heading_font: "rounded-sans", body_font: "rounded-sans", heading_case: "title", item_case: "as-printed", heading_align: "left", divider: "none", item_layout: "cards", header: "arch", nav: "pills", section: "side", texture: "dots" } },
  { key: "fine", label: "Fine Dining", blurb: "Spaced capitals, centred dishes, quiet ivory",
    style: { paper: "#faf7f1", text: "#1b1b1b", heading: "#1b1b1b", accent: "#9a7b45", item: "#1b1b1b", price: "#5a4a2e", title_font: "elegant-serif", heading_font: "elegant-serif", body_font: "elegant-serif", heading_case: "upper", item_case: "upper", heading_align: "center", divider: "ornament", item_layout: "centered", header: "minimal", nav: "links", section: "rule", frame: "line" } },
  { key: "night", label: "Night Market", blurb: "Neon glow on navy, pill headings, grid cards",
    style: { paper: "#11162b", text: "#e9ecf5", heading: "#ffb000", accent: "#ff4f9a", item: "#ffffff", price: "#ffb000", title_font: "condensed-sans", heading_font: "condensed-sans", body_font: "modern-sans", heading_case: "upper", item_case: "upper", heading_align: "left", divider: "none", item_layout: "grid", header: "hero", nav: "tabs", section: "fill", texture: "grid" } },
  // Last since Nov 10, 2026 (owner: "the first menu template needs to be the Classic not the plain Your printed menu").
  { key: "yours", label: "Your printed menu", blurb: "The colours and type of the menu you sent" }
];
// Holiday Menu (owner, Nov 10, 2026): a short-run menu for Christmas or New Year's Eve, on top of whatever menu the
// business already has. The holiday generator shows only these: three per holiday, plus three that fit either
// holiday (see designsFor). Decorations (deco, snow, stars, bubbles, confetti) are in style.js.
const HOLIDAY_DESIGNS = [
  { key: "evergreen", occasion: "christmas", label: "Evergreen", blurb: "Pine green and gold, holly under the name, falling snow",
    style: { paper: "#12352a", text: "#f4efe2", heading: "#e6c36a", accent: "#e6c36a", item: "#fbf6ec", price: "#e6c36a", title_font: "elegant-serif", heading_font: "elegant-serif", body_font: "classic-serif", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "star", item_layout: "stacked", header: "plain", nav: "links", section: "rule", texture: "snow", deco: "holly" } },
  { key: "candycane", occasion: "christmas", label: "Candy Cane", blurb: "Red and white stripes, red banners, price tags",
    style: { paper: "#fffaf5", text: "#2a1d1d", heading: "#b3202a", accent: "#1f6b3a", item: "#2a1d1d", price: "#b3202a", title_font: "slab", heading_font: "slab", body_font: "rounded-sans", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "none", item_layout: "badge", header: "plain", nav: "chips", section: "banner", deco: "candycane" } },
  { key: "silentnight", occasion: "christmas", label: "Silent Night", blurb: "Midnight blue, gold stars, baubles hanging over the name",
    style: { paper: "#0f1e3d", text: "#eef1f8", heading: "#f0d48a", accent: "#f0d48a", item: "#ffffff", price: "#f0d48a", title_font: "script", heading_font: "elegant-serif", body_font: "elegant-serif", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "ornament", item_layout: "centered", header: "plain", nav: "links", section: "rule", texture: "stars", deco: "baubles" } },
  { key: "midnight", occasion: "newyear", label: "Midnight Gold", blurb: "Black and gold, fireworks over the name, big prices",
    style: { paper: "#0d0d0f", text: "#efe8da", heading: "#e2bf72", accent: "#e2bf72", item: "#fbf6ec", price: "#e2bf72", title_font: "elegant-serif", heading_font: "elegant-serif", body_font: "classic-serif", heading_case: "upper", item_case: "upper", heading_align: "center", divider: "none", item_layout: "board", header: "frame", nav: "links", section: "label", texture: "stars", deco: "fireworks" } },
  { key: "champagne", occasion: "newyear", label: "Champagne", blurb: "Ivory and champagne gold, rising bubbles, centred courses",
    style: { paper: "#faf6ee", text: "#2b2418", heading: "#8a6a2c", accent: "#b88a3a", item: "#2b2418", price: "#8a6a2c", title_font: "elegant-serif", heading_font: "elegant-serif", body_font: "elegant-serif", heading_case: "upper", item_case: "upper", heading_align: "center", divider: "star", item_layout: "centered", header: "minimal", nav: "links", section: "rule", texture: "bubbles", frame: "line" } },
  { key: "confetti", occasion: "newyear", label: "Confetti", blurb: "Deep violet, bright confetti, bold headings and cards",
    style: { paper: "#1a1240", text: "#f1eefc", heading: "#ffd166", accent: "#ef476f", item: "#ffffff", price: "#ffd166", title_font: "condensed-sans", heading_font: "condensed-sans", body_font: "modern-sans", heading_case: "upper", item_case: "as-printed", heading_align: "left", divider: "none", item_layout: "grid", header: "hero", nav: "tabs", section: "fill", texture: "confetti" } },
  // Either holiday (owner, Nov 12, 2026: "add 3 that fit either holiday and include a slight hanuka colors
  // template"). Each holiday's generator shows its own three, then these three; the other holiday's are left out.
  // Winter Lights is the one in blue, white and silver; it carries no holiday symbol, only the colours.
  { key: "winterlights", occasion: "either", label: "Winter Lights", blurb: "Deep blue, white and silver, a string of lights under the name",
    style: { paper: "#10264f", text: "#eaf0fb", heading: "#ffffff", accent: "#c9d6ea", item: "#ffffff", price: "#c9d6ea", title_font: "elegant-serif", heading_font: "modern-sans", body_font: "modern-sans", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "star", item_layout: "stacked", header: "band", nav: "pills", section: "short", texture: "stars", deco: "lights" } },
  { key: "candlelight", occasion: "either", label: "Candlelight", blurb: "Warm espresso and amber, framed title, centred courses",
    style: { paper: "#24160f", text: "#f3e6d3", heading: "#f0b45a", accent: "#f0b45a", item: "#fff6e8", price: "#f0b45a", title_font: "script", heading_font: "elegant-serif", body_font: "classic-serif", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "ornament", item_layout: "centered", header: "frame", nav: "links", section: "label", frame: "line" } },
  // Owner, Nov 12, 2026: "replace the green and white one with a silver and gold one" (was Winter Greens).
  { key: "silvergold", occasion: "either", label: "Silver and Gold", blurb: "Soft silver and warm gold, gold stars, rounded cards in a fine frame",
    style: { paper: "#e6e8ec", text: "#2b2e34", heading: "#96700f", accent: "#c9a227", item: "#2b2e34", price: "#96700f", title_font: "elegant-serif", heading_font: "elegant-serif", body_font: "rounded-sans", heading_case: "upper", item_case: "as-printed", heading_align: "center", divider: "star", item_layout: "cards", header: "minimal", nav: "pills", section: "rule", texture: "stars", frame: "line" } }
];
const OCCASIONS = { christmas: "Christmas", newyear: "New Year's Eve" };

const MENU_DESIGN_KEYS = MENU_DESIGNS.map((d) => d.key);
const menuDesignFor = (key) => MENU_DESIGNS.find((d) => d.key === key) || HOLIDAY_DESIGNS.find((d) => d.key === key) || null;
// The generator's list: the regular designs, or for a holiday preview that holiday's three and the three that fit
// either holiday. The other holiday's designs are left out (owner, Nov 12, 2026).
function designsFor(occasion) {
  if (!OCCASIONS[occasion]) return MENU_DESIGNS;
  return [...HOLIDAY_DESIGNS.filter((d) => d.occasion === occasion), ...HOLIDAY_DESIGNS.filter((d) => d.occasion === "either")];
}

// The raw style for a design. "yours" is the reader's own (null when it saw none: the standard page).
function designStyle(key, menu) {
  const design = menuDesignFor(key) || MENU_DESIGNS[0];   // an unknown key gets the first design (Classic)
  return design.style ? { ...design.style } : menu?.style || null;
}

export { MENU_DESIGNS, HOLIDAY_DESIGNS, OCCASIONS, MENU_DESIGN_KEYS, menuDesignFor, designsFor, designStyle };
