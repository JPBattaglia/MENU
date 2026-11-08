// The look of the customer's own menu, carried onto the phone menu (owner, Nov 5, 2026: generated menus looked
// "remedial" next to the printed ones). The menu reader reports a few design facts (paper colour, text colours,
// kind of typeface, capitals, alignment, dividers); this turns them into a safe theme over the standard page.
//   normalizeStyle(raw)      -> style | null   only known values, colours forced to readable contrast
//   styleCss(style)          -> CSS text appended after the standard page styles
//   styleMeta(style) / readStyleMeta(html)   keep the theme in the page so Menu Care updates keep it too
// Fonts are system font stacks (no downloads: the hosted menu's security policy blocks outside stylesheets), chosen
// so iPhones and Macs show a close match and other devices a sensible fallback.

const FONTS = {
  "classic-serif": '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  "elegant-serif": 'Didot, "Bodoni 72", "Bodoni MT", "Hoefler Text", Georgia, serif',
  "modern-sans": '"Avenir Next", Avenir, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  "condensed-sans": '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif',
  "rounded-sans": '"SF Pro Rounded", "Arial Rounded MT Bold", "Varela Round", "Avenir Next", sans-serif',
  slab: 'Rockwell, "Roboto Slab", "American Typewriter", Georgia, serif',
  typewriter: '"American Typewriter", "Courier New", Courier, monospace',
  script: '"Snell Roundhand", "Apple Chancery", "Segoe Script", "Brush Script MT", cursive'
};
const CASES = { upper: "uppercase", title: "capitalize", "as-printed": "none" };
const DIVIDERS = ["line", "double", "dotted", "ornament", "none"];
const LAYOUTS = ["stacked", "inline"];

const hex = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return "#" + v.slice(1).split("").map((c) => c + c).join("");
  return null;
};
const channels = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
function luminance(h) {
  const [r, g, b] = channels(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// Moves a colour toward black (on light paper) or white (on dark paper) until it reaches the contrast asked for.
function readable(color, paper, min) {
  let c = color;
  const target = luminance(paper) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  for (let i = 0; i < 24 && contrast(c, paper) < min; i++) {
    c = toHex(channels(c).map((v, k) => v + (target[k] - v) * 0.12));
  }
  return c;
}
const mix = (a, b, t) => toHex(channels(a).map((v, k) => v + (channels(b)[k] - v) * t));

function normalizeStyle(raw) {
  if (!raw || typeof raw !== "object") return null;
  const paper = hex(raw.paper) || "#fbf8f3";
  const dark = luminance(paper) < 0.25;
  const text = readable(hex(raw.text) || (dark ? "#f4efe6" : "#1d1d1b"), paper, 7);
  const heading = readable(hex(raw.heading) || text, paper, 4.5);
  const item = readable(hex(raw.item) || text, paper, 4.5);
  const price = readable(hex(raw.price) || item, paper, 4.5);
  const accent = readable(hex(raw.accent) || heading, paper, 3);
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const fontKeys = Object.keys(FONTS);
  return {
    paper, text, heading, item, price, accent,
    muted: readable(mix(text, paper, 0.35), paper, 4.5),
    rule: mix(text, paper, dark ? 0.75 : 0.82),
    titleFont: pick(raw.title_font, fontKeys, pick(raw.heading_font, fontKeys, "classic-serif")),
    headingFont: pick(raw.heading_font, fontKeys, "classic-serif"),
    // Script faces are for titles only; long text in a script is hard to read on a phone.
    bodyFont: pick(raw.body_font, fontKeys.filter((k) => k !== "script"), "classic-serif"),
    headingCase: pick(raw.heading_case, Object.keys(CASES), "upper"),
    itemCase: pick(raw.item_case, Object.keys(CASES), "as-printed"),
    align: raw.heading_align === "left" ? "left" : "center",
    divider: pick(raw.divider, DIVIDERS, "line"),
    layout: pick(raw.item_layout, LAYOUTS, "stacked"),
    // Menu generator designs (menu-designs.js): the name on the paper, or on a band of the heading colour.
    header: raw.header === "band" ? "band" : "plain",
    dark
  };
}

function styleCss(s) {
  if (!s) return "";
  const dividerCss = {
    line: `border-bottom: 1px solid var(--accent); padding-bottom: 10px;`,
    double: `border-bottom: 3px double var(--accent); padding-bottom: 10px;`,
    dotted: `border-bottom: 2px dotted var(--accent); padding-bottom: 10px;`,
    ornament: `border-bottom: 0; padding-bottom: 0;`,
    none: `border-bottom: 0; padding-bottom: 0;`
  }[s.divider];
  const ornament = s.divider === "ornament"
    ? `h2::after { content: "\\2766"; display: block; margin-top: 6px; font-size: .8em; color: var(--accent); letter-spacing: 0; text-transform: none; }`
    : "";
  return `
  /* The customer's own menu style (see style.js). */
  :root { --paper: ${s.paper}; --ink: ${s.text}; --muted: ${s.muted}; --rule: ${s.rule}; --primary: ${s.heading}; --accent: ${s.accent}; --item: ${s.item}; --price: ${s.price}; }
  body { font-family: ${FONTS[s.bodyFont]}; font-size: 17px; }
  header { background: var(--paper); color: var(--primary); padding: 40px 20px 18px; border-bottom: 0; }
  h1 { font-family: ${FONTS[s.titleFont]}; font-size: clamp(32px, 9vw, 52px); color: var(--primary); font-weight: ${s.titleFont === "script" ? 400 : 700}; }
  header p { color: var(--accent); opacity: 1; letter-spacing: 4px; }
  header p::before, header p::after { content: ""; display: inline-block; width: 28px; height: 1px; background: var(--accent); vertical-align: middle; margin: 0 10px; }
  .jump { background: ${s.dark ? "rgba(0,0,0,.35)" : "color-mix(in srgb, var(--paper) 94%, transparent)"}; border-bottom-color: var(--rule); }
  .jump a { background: transparent; border-color: var(--accent); color: var(--primary); font-family: ${FONTS[s.headingFont === "script" ? s.bodyFont : s.headingFont]}; }
  h2 { font-family: ${FONTS[s.headingFont]}; font-weight: ${s.headingFont === "script" ? 400 : 600}; font-size: ${s.headingFont === "script" ? "30px" : "23px"}; text-align: ${s.align}; text-transform: ${CASES[s.headingCase]}; color: var(--primary); letter-spacing: ${s.headingCase === "upper" ? "2px" : "0"}; ${dividerCss} }
  ${ornament}
  li { border-bottom-color: var(--rule); }
  .item { color: var(--item); text-transform: ${CASES[s.itemCase]}; letter-spacing: ${s.itemCase === "upper" ? ".06em" : "0"}; font-weight: 700; }
  .price { color: var(--price); }
  .leader { border-bottom-color: var(--rule); }
  .desc { color: var(--muted); }
  .notes { background: transparent; border-color: var(--rule); color: var(--muted); }
  footer { color: var(--muted); }
  ${s.header === "band" ? `header { background: var(--primary); color: var(--paper); padding: 34px 20px 26px; } h1 { color: var(--paper); } header p { color: var(--paper); opacity: .88; } header p::before, header p::after { background: var(--paper); }` : ""}
  ${s.layout === "inline" ? `li { padding: 10px 0; } li:has(.desc) .row .leader { display: none; } li:has(.desc) .row { display: block; } li:has(.desc) .row .price { float: right; margin-left: 12px; } li:has(.desc) .desc { margin-top: 2px; }` : ""}`;
}

function styleMeta(s) {
  if (!s) return "";
  return `<meta name="mm-style" content="${JSON.stringify(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}">`;
}

// Accepts the reader's raw style or a theme already made by normalizeStyle (stored in a page), and returns a theme.
function toStyle(value) {
  if (!value || typeof value !== "object") return null;
  if (!value.titleFont) return normalizeStyle(value);
  return normalizeStyle({
    paper: value.paper, text: value.text, heading: value.heading, item: value.item, price: value.price, accent: value.accent,
    title_font: value.titleFont, heading_font: value.headingFont, body_font: value.bodyFont, heading_case: value.headingCase,
    item_case: value.itemCase, heading_align: value.align, divider: value.divider, item_layout: value.layout, header: value.header
  });
}

function readStyleMeta(html) {
  const m = /<meta name="mm-style" content="([^"]*)">/.exec(String(html || ""));
  if (!m) return null;
  try {
    return toStyle(JSON.parse(m[1].replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&")));
  } catch {
    return null;
  }
}

export { FONTS, normalizeStyle, toStyle, styleCss, styleMeta, readStyleMeta, contrast };
