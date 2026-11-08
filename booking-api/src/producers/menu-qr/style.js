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
  script: '"Snell Roundhand", "Apple Chancery", "Segoe Script", "Brush Script MT", cursive',
  // Hand-lettered chalk (owner, Nov 7, 2026): Chalkboard SE is on every iPhone and Mac; then Mac-only Chalkduster,
  // Marker Felt, and Comic Sans / Comic Neue elsewhere.
  chalk: '"Chalkboard SE", Chalkduster, "Marker Felt", "Comic Sans MS", "Comic Neue", "Segoe Print", cursive'
};
const CASES = { upper: "uppercase", title: "capitalize", "as-printed": "none" };
const DIVIDERS = ["line", "double", "dotted", "ornament", "none"];
const LAYOUTS = ["stacked", "inline", "cards", "grid", "centered", "board", "badge"];
// Structure (menu generator designs, Nov 7, 2026: "all the menus look too similar"). CSS only, over the same page, so
// every design keeps the markup Menu Care edits. The reader never sets these: a customer's own menu keeps the defaults.
const HEADERS = ["plain", "band", "arch", "hero", "frame", "split", "ticket", "minimal"];
const NAVS = ["pills", "tabs", "links", "chips", "bar"];
const SECTIONS = ["rule", "banner", "label", "fill", "side", "numbered", "short"];
const TEXTURES = ["none", "dots", "lines", "chalk", "grid"];

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
    // Menu generator designs (menu-designs.js); see HEADERS etc. above.
    header: pick(raw.header, HEADERS, "plain"),
    nav: pick(raw.nav, NAVS, "pills"),
    section: pick(raw.section, SECTIONS, "rule"),
    texture: pick(raw.texture, TEXTURES, "none"),
    // Page frame: "line" (a thin double rule) or "chalk" (a wooden chalkboard frame). true = "line" (pages from before).
    frame: raw.frame === true || raw.frame === "line" ? "line" : raw.frame === "chalk" ? "chalk" : "none",
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
  ${structureCss(s)}`;
}

// The structural options: header, section nav, section headings, item layout, paper texture, page frame.
function structureCss(s) {
  const onPrimary = `color: var(--paper); } h1 { color: var(--paper); } header p { color: var(--paper); opacity: .9; } header p::before, header p::after { background: var(--paper); }`;
  const header = {
    plain: "",
    band: `header { background: var(--primary); padding: 34px 20px 28px; ${onPrimary}`,
    arch: `header { background: var(--primary); padding: 38px 20px 44px; border-radius: 0 0 50% 50% / 0 0 34px 34px; ${onPrimary}`,
    hero: `header { background: radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent) 45%, var(--primary)) 0%, var(--primary) 72%); padding: 66px 20px 56px; ${onPrimary} h1 { font-size: clamp(44px, 14vw, 78px); line-height: .95; letter-spacing: -.01em; }`,
    frame: `header { padding: 34px 20px 22px; } h1 { display: inline-block; padding: 16px 28px 14px; border: 4px double var(--accent); } header p { margin-top: 14px; }`,
    split: `header { text-align: left; max-width: 760px; margin: 0 auto; padding: 30px 22px 20px; border-bottom: 4px solid var(--primary); display: grid; grid-template-columns: auto 1fr; column-gap: 16px; align-items: center; } header:not(:has(img)) { display: block; } header img { grid-row: span 2; margin: 0; max-height: 72px; max-width: 46vw; } h1 { font-size: clamp(38px, 11vw, 64px); line-height: 1; letter-spacing: -.02em; font-weight: 800; } header p { margin-top: 6px; letter-spacing: .2em; } header p::before, header p::after { display: none; }`,
    ticket: `header { position: relative; background: var(--primary); padding: 34px 20px 46px; ${onPrimary} header::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 16px; background: repeating-conic-gradient(var(--primary) 0 25%, var(--paper) 0 50%) 0 0 / 16px 16px; }`,
    minimal: `header { padding: 72px 20px 34px; } h1 { font-weight: 400; font-size: clamp(26px, 7.5vw, 40px); letter-spacing: .22em; text-transform: uppercase; } header p { margin-top: 14px; letter-spacing: .5em; font-size: 11px; }`
  }[s.header];
  // Centred when the sections fit; scrolls sideways when they don't (auto margins, unlike justify-content: center,
  // never push the first section off screen).
  const nav = `.jump { justify-content: flex-start; } .jump a:first-child { margin-left: auto; } .jump a:last-child { margin-right: auto; } ` + {
    pills: "",
    tabs: `.jump { gap: 6px; padding: 4px 14px 0; } .jump a { border: 0; border-bottom: 3px solid transparent; border-radius: 0; padding: 12px 10px 9px; text-transform: uppercase; letter-spacing: .1em; font-size: 12.5px; } .jump a:hover, .jump a:focus-visible { border-bottom-color: var(--accent); }`,
    links: `.jump { gap: 0; padding: 12px 16px; } .jump a { border: 0; border-radius: 0; padding: 4px 2px; font-weight: 500; font-style: italic; font-size: 15px; } .jump a + a::before { content: "\\00B7"; display: inline-block; margin: 0 12px; color: var(--accent); font-style: normal; }`,
    chips: `.jump a { background: var(--primary); border-color: var(--primary); color: var(--paper); border-radius: 4px; text-transform: uppercase; letter-spacing: .12em; font-size: 12px; padding: 8px 12px; }`,
    bar: `.jump { background: var(--item); border-bottom: 0; } .jump a { background: transparent; border-color: color-mix(in srgb, var(--paper) 55%, transparent); color: var(--paper); text-transform: uppercase; letter-spacing: .08em; font-size: 13px; }`
  }[s.nav];
  const reset = `border: 0; padding-bottom: 0;`;
  const section = {
    rule: "",
    banner: `h2 { ${reset} background: var(--primary); color: var(--paper); padding: 10px 14px; text-align: center; margin-bottom: 8px; }`,
    label: `h2 { ${reset} display: table; margin: 0 ${s.align === "left" ? "0" : "auto"} 16px; padding: 9px 20px 8px; border: 2px solid var(--accent); font-size: 19px; }`,
    fill: `h2 { ${reset} display: table; margin: 0 ${s.align === "left" ? "0" : "auto"} 14px; padding: 8px 18px; border-radius: 999px; background: var(--primary); color: var(--paper); font-size: 18px; }`,
    side: `h2 { ${reset} text-align: left; border-left: 6px solid var(--accent); padding: 4px 0 4px 14px; }`,
    numbered: `.menu-content { counter-reset: mm-section; } h2 { counter-increment: mm-section; text-align: left; display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid var(--rule); padding-bottom: 10px; } h2::before { content: counter(mm-section, decimal-leading-zero); font-size: 1.9em; line-height: 1; font-weight: 800; color: var(--accent); letter-spacing: 0; }`,
    short: `h2 { ${reset} } h2::after { content: ""; display: block; width: 46px; height: 3px; margin: 10px ${s.align === "left" ? "0" : "auto"} 0; background: var(--accent); }`
  }[s.section];
  const card = `background: color-mix(in srgb, var(--paper) ${s.dark ? "88%" : "93%"}, var(--ink)); border: 1px solid var(--rule); border-radius: 12px; padding: 14px 16px;`;
  const items = {
    stacked: "",
    inline: `li { padding: 10px 0; } li:has(.desc) .row .leader { display: none; } li:has(.desc) .row { display: block; } li:has(.desc) .row .price { float: right; margin-left: 12px; } li:has(.desc) .desc { margin-top: 2px; }`,
    cards: `ul { display: grid; gap: 12px; } li, li:last-child { ${card} } .leader { visibility: hidden; }`,
    grid: `main { max-width: 900px; } ul { display: grid; gap: 12px; } @media (min-width: 600px) { ul { grid-template-columns: 1fr 1fr; } } li, li:last-child { ${card} border-radius: 6px; border-top: 4px solid var(--accent); } .row { align-items: flex-start; } .leader { visibility: hidden; }`,
    centered: `li { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 16px 0; border-bottom: 0; } .row { display: contents; } .leader { display: none; } .item { order: 0; } .desc { order: 1; max-width: 32em; margin-top: 4px; font-style: italic; } .price { order: 2; margin-top: 6px; font-weight: 500; letter-spacing: .06em; }`,
    board: `li { padding: 14px 0; border-bottom: 2px dashed var(--rule); } .row { align-items: center; } .item { font-size: 1.18em; } .price { font-size: 1.4em; font-weight: 800; } .leader { visibility: hidden; }`,
    badge: `.leader { visibility: hidden; } .row { align-items: center; } .price { background: var(--price); color: var(--paper); border-radius: 999px; padding: 3px 11px; font-size: .92em; }`
  }[s.layout];
  const texture = {
    none: "",
    dots: `body { background-image: radial-gradient(color-mix(in srgb, var(--ink) 10%, transparent) 1px, transparent 1.6px); background-size: 18px 18px; }`,
    lines: `body { background-image: repeating-linear-gradient(0deg, transparent 0 31px, color-mix(in srgb, var(--accent) 13%, transparent) 31px 32px); }`,
    // Chalk: erased smudges and a fine dust over the slate (no rings: owner, Nov 7, 2026).
    chalk: `body { background-image: radial-gradient(60% 40% at 18% 12%, rgba(255,255,255,.10), transparent 70%), radial-gradient(50% 35% at 85% 45%, rgba(255,255,255,.08), transparent 70%), radial-gradient(55% 30% at 30% 85%, rgba(255,255,255,.07), transparent 70%), radial-gradient(rgba(255,255,255,.06) 1px, transparent 1.5px); background-size: auto, auto, auto, 5px 5px; background-attachment: fixed; }`,
    grid: `body { background-image: linear-gradient(color-mix(in srgb, var(--accent) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--accent) 9%, transparent) 1px, transparent 1px); background-size: 26px 26px; }`
  }[s.texture];
  const frame = s.frame === "chalk"
    ? `body { margin: 0; border: 16px ridge #74492a; min-height: 100vh; box-shadow: inset 0 0 0 3px #3a2414, inset 0 0 70px rgba(0,0,0,.55); } header { background: transparent; } body, h1, h2, .item, .price, .desc, .jump a { text-shadow: 0 0 1px rgba(255,255,255,.35), 0 0 6px rgba(255,255,255,.08); } h2 { border-bottom-style: dashed; } li { border-bottom-style: dashed; } .jump { background: color-mix(in srgb, var(--paper) 93%, transparent); border-bottom: 2px dashed var(--rule); } .jump a { background: transparent; color: var(--primary); border: 2px solid var(--accent); border-radius: 999px 820px 900px 760px / 760px 900px 820px 999px; } footer { color: var(--muted); }`
    : s.frame === "line" ? `main { margin: 22px max(14px, calc((100% - 720px) / 2)); padding: 10px 22px 40px; border: 1px solid var(--accent); outline: 1px solid var(--accent); outline-offset: 5px; background: var(--paper); }` : "";
  return [header, nav, section, items, texture, frame].filter(Boolean).join("\n  ");
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
    item_case: value.itemCase, heading_align: value.align, divider: value.divider, item_layout: value.layout, header: value.header,
    nav: value.nav, section: value.section, texture: value.texture, frame: value.frame
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

export { FONTS, normalizeStyle, toStyle, styleCss, styleMeta, readStyleMeta, contrast, luminance, mix };
