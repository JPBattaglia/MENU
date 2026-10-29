// Nino design services (stage 10): the designs themselves, as SVG. The PNGs are drawn by the GitHub renderer
// (scripts/render-social-posts.mjs), which loads the display fonts below from open-licence font packages; when a font
// is missing the renderer falls back to Liberation Sans, so every layout is sized to fit with the widest face.
//
// Every text box is measured with a per-font average glyph width; text that cannot fit at the smallest allowed size is
// a production failure (the owner is told), never a clipped design.

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const BODY = "'Liberation Sans', Arial, sans-serif";

// Display face per style, with the average glyph width (em) used to measure it. Widths are deliberately generous.
const FACES = {
  classic: { family: "Playfair Display", weight: 700, em: 0.6 },
  modern: { family: "Montserrat", weight: 700, em: 0.68 },
  bold: { family: "Bebas Neue", weight: 400, em: 0.5 },
  elegant: { family: "DM Serif Display", weight: 400, em: 0.58 },
  playful: { family: "Pacifico", weight: 400, em: 0.66 },
  rustic: { family: "Abril Fatface", weight: 400, em: 0.66 }
};
const FONT_FAMILIES = [...new Set(Object.values(FACES).map((f) => f.family))];
const face = (style) => FACES[style] || FACES.classic;
const fam = (f) => `'${f.family}', 'Liberation Sans', Arial, sans-serif`;

// Style palettes, used when the buyer gives no colours. [background, ink, accent]
const PALETTES = {
  classic: ["#f6f1e7", "#1f2a2e", "#a3322a"],
  modern: ["#ffffff", "#111827", "#0e9f9a"],
  bold: ["#111111", "#ffffff", "#f2b705"],
  elegant: ["#16232b", "#f4ead8", "#c9a227"],
  playful: ["#fff4e6", "#2b2d42", "#ef476f"],
  rustic: ["#efe6d2", "#3b2a1a", "#8a5a2b"]
};

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const inkOn = (bg) => (contrast(bg, "#111111") >= contrast(bg, "#ffffff") ? "#111111" : "#ffffff");

// Buyer colours win; ink always keeps readable contrast with the background.
function paletteFor(style, brandColors = "") {
  const given = String(brandColors || "").split(/[\s,]+/).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase());
  const [bg0, ink0, accent0] = PALETTES[style] || PALETTES.classic;
  const accent = given[0] || accent0;
  const bg = given[1] || bg0;
  const ink = contrast(bg, ink0) >= 4.5 ? ink0 : inkOn(bg);
  return { bg, ink, accent, accentInk: inkOn(accent) };
}

// Wraps words into lines no wider than maxWidth at fontSize; null when one word alone is too wide.
function wrapLines(text, { fontSize, maxWidth, em }) {
  const perLine = Math.max(3, Math.floor(maxWidth / (fontSize * em)));
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (word.length > perLine) return null;
    if (!line) line = word;
    else if (`${line} ${word}`.length <= perLine) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function fit(text, { maxWidth, maxHeight, start, min, em, lineHeight = 1.15 }) {
  for (let size = start; size >= min; size -= 2) {
    const lines = wrapLines(text, { fontSize: size, maxWidth, em });
    if (lines && lines.length && lines.length * size * lineHeight <= maxHeight) return { lines, size, height: lines.length * size * lineHeight };
  }
  return null;
}

const textLines = (lines, { x, y, size, lineHeight = 1.15, anchor = "middle", fill, family, weight = 400, extra = "" }) =>
  lines.map((l, i) => `<text x="${x}" y="${Math.round(y + (i + 1) * size * lineHeight - size * (lineHeight - 1))}" font-size="${size}" font-family="${family}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}"${extra}>${esc(l)}</text>`).join("");

const logoImage = (x, y, w, h) => `<image href="__LOGO_DATA_URI__" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;

const svgOpen = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;

// ---------- Flyer ----------
// size: "print" (letter at 300 dpi) or "square" (1080, for social media).
function flyerSvg(brief, { size = "print", hasLogo = false, variant = 0 } = {}) {
  const [W, H] = size === "print" ? [2550, 3300] : [1080, 1080];
  const k = W / 2550;
  const f = face(brief.style);
  const p = paletteFor(brief.style, brief.brand_colors);
  const pad = Math.round(170 * k);
  const inner = W - pad * 2;
  const parts = [];
  // Variant changes the frame so "request changes" yields a fresh layout.
  const frame = variant % 3;
  parts.push(`<rect width="${W}" height="${H}" fill="${p.bg}"/>`);
  if (frame === 0) parts.push(`<rect x="${pad / 2}" y="${pad / 2}" width="${W - pad}" height="${H - pad}" fill="none" stroke="${p.accent}" stroke-width="${Math.round(14 * k)}"/>`);
  if (frame === 1) parts.push(`<rect width="${W}" height="${Math.round(H * 0.42)}" fill="${p.accent}"/>`);
  if (frame === 2) parts.push(`<rect x="0" y="0" width="${Math.round(40 * k)}" height="${H}" fill="${p.accent}"/><rect x="${W - Math.round(40 * k)}" y="0" width="${Math.round(40 * k)}" height="${H}" fill="${p.accent}"/>`);
  const headInk = frame === 1 ? p.accentInk : p.accent;
  let y = Math.round((size === "print" ? 260 : 120) * k);
  if (hasLogo) {
    const lh = Math.round((size === "print" ? 330 : 360) * k);
    parts.push(logoImage(W / 2 - lh, y, lh * 2, lh));
    y += lh + Math.round(60 * k);
  }
  const nameFit = fit(brief.business_name, { maxWidth: inner, maxHeight: 200 * k * (size === "print" ? 1 : 1.6), start: Math.round(110 * k * (size === "print" ? 1 : 1.5)), min: Math.round(48 * k), em: 0.6 });
  if (!nameFit) return { error: "The business name is too long for the flyer" };
  parts.push(textLines(nameFit.lines, { x: W / 2, y, size: nameFit.size, fill: frame === 1 ? p.accentInk : p.ink, family: BODY, weight: 700, extra: ` letter-spacing="${Math.round(4 * k)}"` }));
  y += nameFit.height + Math.round(70 * k);
  const headFit = fit(brief.headline, { maxWidth: inner, maxHeight: (size === "print" ? 900 : 1300) * k, start: Math.round((size === "print" ? 300 : 420) * k), min: Math.round(90 * k), em: f.em });
  if (!headFit) return { error: "The headline does not fit the flyer" };
  parts.push(textLines(headFit.lines, { x: W / 2, y, size: headFit.size, fill: headInk, family: fam(f), weight: f.weight, lineHeight: 1.1 }));
  y += headFit.size * 1.1 * headFit.lines.length + Math.round(110 * k);
  const details = String(brief.details || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (size === "print" || details.length <= 3) {
    for (const line of details) {
      const lf = fit(line, { maxWidth: inner, maxHeight: 130 * k, start: Math.round(92 * k * (size === "print" ? 1 : 1.4)), min: Math.round(44 * k), em: 0.56 });
      if (!lf) return { error: `A details line does not fit: ${line.slice(0, 40)}` };
      parts.push(textLines(lf.lines, { x: W / 2, y, size: lf.size, fill: p.ink, family: BODY, weight: 400 }));
      y += lf.height + Math.round(36 * k);
    }
  }
  if (brief.call_to_action) {
    const cta = fit(brief.call_to_action, { maxWidth: inner - 200 * k, maxHeight: 120 * k * (size === "print" ? 1 : 1.5), start: Math.round(84 * k * (size === "print" ? 1 : 1.5)), min: Math.round(40 * k), em: 0.62 });
    if (!cta) return { error: "The call to action is too long" };
    const bh = Math.round(cta.height + 70 * k);
    const by = Math.max(y + 40 * k, H - Math.round((size === "print" ? 620 : 300) * k));
    parts.push(`<rect x="${pad + 100 * k}" y="${by}" width="${inner - 200 * k}" height="${bh}" rx="${bh / 2}" fill="${p.accent}"/>`);
    parts.push(textLines(cta.lines, { x: W / 2, y: by + 35 * k, size: cta.size, fill: p.accentInk, family: BODY, weight: 700 }));
    y = by + bh;
  }
  if (brief.contact) {
    const cf = fit(brief.contact, { maxWidth: inner, maxHeight: 120 * k * (size === "print" ? 1 : 1.5), start: Math.round(64 * k * (size === "print" ? 1 : 1.5)), min: Math.round(30 * k), em: 0.56 });
    if (!cf) return { error: "The contact line is too long" };
    parts.push(textLines(cf.lines, { x: W / 2, y: H - Math.round((size === "print" ? 300 : 120) * k) - cf.height, size: cf.size, fill: p.ink, family: BODY, weight: 400 }));
  }
  if (y > H - 80 * k) return { error: "The flyer text does not fit the page; shorten the details" };
  return { svg: `${svgOpen(W, H)}${parts.join("")}</svg>`, width: W, height: H };
}

// ---------- Social graphics ----------
const SOCIAL_SIZES = { square: [1080, 1080], story: [1080, 1920] };

function socialSvg(post, { businessName, style, brandColors, hasLogo }, size) {
  const [W, H] = SOCIAL_SIZES[size];
  const f = face(style);
  const p = paletteFor(style, brandColors);
  const story = size === "story";
  const parts = [`<rect width="${W}" height="${H}" fill="${p.bg}"/>`, `<rect x="0" y="${H - 180}" width="${W}" height="180" fill="${p.accent}"/>`];
  if (hasLogo) parts.push(logoImage(W / 2 - 110, story ? 200 : 70, 220, 150));
  const top = story ? 520 : (hasLogo ? 270 : 170);
  const head = fit(post.headline, { maxWidth: W - 160, maxHeight: story ? 820 : 470, start: story ? 140 : 116, min: 56, em: f.em, lineHeight: 1.1 });
  if (!head) return { error: `The headline "${String(post.headline).slice(0, 40)}" does not fit the ${size} graphic` };
  parts.push(textLines(head.lines, { x: W / 2, y: top, size: head.size, fill: p.ink, family: fam(f), weight: f.weight, lineHeight: 1.1 }));
  if (post.subline) {
    const sub = fit(post.subline, { maxWidth: W - 200, maxHeight: story ? 240 : 150, start: 54, min: 32, em: 0.56 });
    if (sub) parts.push(textLines(sub.lines, { x: W / 2, y: top + head.size * 1.1 * head.lines.length + 50, size: sub.size, fill: p.ink, family: BODY, weight: 400 }));
  }
  const name = fit(businessName, { maxWidth: W - 160, maxHeight: 90, start: 52, min: 30, em: 0.6 });
  if (name) parts.push(textLines(name.lines, { x: W / 2, y: H - 135, size: name.size, fill: p.accentInk, family: BODY, weight: 700 }));
  return { svg: `${svgOpen(W, H)}${parts.join("")}</svg>`, width: W, height: H };
}

// ---------- Logo (wordmark) ----------
// Six options: three display faces close to the chosen style, each in two layouts. Each option is drawn three times:
// transparent, on a light background and on a dark background.
const STYLE_FACES = {
  classic: ["classic", "elegant", "modern"], modern: ["modern", "bold", "classic"], bold: ["bold", "modern", "rustic"],
  elegant: ["elegant", "classic", "playful"], playful: ["playful", "rustic", "modern"], rustic: ["rustic", "classic", "bold"]
};
const LOGO_W = 2000;
const LOGO_H = 1000;

function logoOption({ name, tagline, colors, faceKey, layout, background }) {
  const f = FACES[faceKey];
  const ink = background === "dark" ? "#ffffff" : colors.ink;
  const accent = background === "dark" ? (contrast(colors.accent, "#16181d") >= 3 ? colors.accent : "#ffffff") : colors.accent;
  const parts = [];
  if (background === "light") parts.push(`<rect width="${LOGO_W}" height="${LOGO_H}" fill="#ffffff"/>`);
  if (background === "dark") parts.push(`<rect width="${LOGO_W}" height="${LOGO_H}" fill="#16181d"/>`);
  const text = layout === 1 && faceKey !== "playful" ? name.toUpperCase() : name;
  const nameFit = fit(text, { maxWidth: 1700, maxHeight: tagline ? 420 : 560, start: 360, min: 120, em: f.em * (layout === 1 ? 1.12 : 1), lineHeight: 1.05 });
  if (!nameFit) return null;
  const tagSize = tagline ? Math.min(78, Math.max(48, Math.round(nameFit.size * 0.24))) : 0;
  const block = nameFit.height + (tagline ? tagSize * 1.6 + 40 : 0) + (layout === 1 ? 60 : 0);
  let y = (LOGO_H - block) / 2;
  if (layout === 1) { parts.push(`<rect x="${LOGO_W / 2 - 160}" y="${y}" width="320" height="16" fill="${accent}"/>`); y += 60; }
  parts.push(textLines(nameFit.lines, { x: LOGO_W / 2, y, size: nameFit.size, fill: layout === 0 ? ink : accent, family: fam(f), weight: f.weight, lineHeight: 1.05, extra: layout === 1 ? ` letter-spacing="${Math.round(nameFit.size * 0.06)}"` : "" }));
  y += nameFit.height + 40;
  if (tagline) {
    parts.push(textLines([layout === 1 ? tagline.toUpperCase() : tagline], { x: LOGO_W / 2, y, size: tagSize, fill: layout === 0 ? accent : ink, family: BODY, weight: layout === 1 ? 700 : 400, extra: ` letter-spacing="${Math.round(tagSize * (layout === 1 ? 0.25 : 0.04))}"` }));
  }
  return `${svgOpen(LOGO_W, LOGO_H)}${parts.join("")}</svg>`;
}

// Returns { options: [{ id, face, layout, files: [{ name, svg, width, height }] }] } or { error }.
function logoOptions(brief, { variant = 0 } = {}) {
  const name = String(brief.business_name || "").trim();
  if (!name) return { error: "No name for the logo" };
  const colors = paletteFor(brief.style, brief.brand_colors);
  colors.ink = contrast("#ffffff", colors.ink) >= 4.5 ? colors.ink : "#1f2a2e";
  colors.accent = contrast("#ffffff", colors.accent) >= 3 ? colors.accent : colors.ink;
  const faces = STYLE_FACES[brief.style] || STYLE_FACES.classic;
  // Request changes (variant 1+) rotates the faces so the buyer sees new options.
  const order = variant % 2 === 0 ? faces : [...faces.slice(1), faces[0]];
  const options = [];
  let n = 0;
  for (const faceKey of order) {
    for (const layout of [0, 1]) {
      n += 1;
      const files = [];
      for (const background of ["transparent", "light", "dark"]) {
        const svg = logoOption({ name, tagline: String(brief.tagline || "").trim(), colors, faceKey, layout: (layout + variant) % 2, background });
        if (!svg) return { error: `The name does not fit as a wordmark in ${FACES[faceKey].family}` };
        files.push({ name: `option-${n}/logo-${n}-${background}.png`, svg, width: LOGO_W, height: LOGO_H, min_bytes: 1500 });
      }
      options.push({ id: n, face: FACES[faceKey].family, layout: (layout + variant) % 2 ? "Spaced capitals with a rule" : "Wordmark", files });
    }
  }
  return { options };
}

// ---------- Menu pages ----------
// menu: { sections: [{ name, items: [{ name, description, price }] }], notes }. Letter pages at 300 dpi, two columns.
const PAGE = { W: 2550, H: 3300, margin: 190, gutter: 120 };

function menuBlocks(menu, s, colW) {
  const blocks = [];
  for (const section of menu.sections || []) {
    const items = (section.items || []).filter((i) => String(i.name || "").trim());
    if (!items.length) continue;
    blocks.push({ kind: "section", text: String(section.name || "Menu").trim(), h: Math.round(130 * s), keepWithNext: true });
    for (const item of items) {
      const price = String(item.price || "").trim();
      const nameW = colW - (price ? (price.length * 0.58 * 46 * s + 40) : 0);
      const nameLines = wrapLines(String(item.name).trim(), { fontSize: 46 * s, maxWidth: Math.max(200, nameW), em: 0.6 });
      const descLines = item.description ? wrapLines(String(item.description).trim(), { fontSize: 34 * s, maxWidth: colW, em: 0.52 }) : [];
      if (!nameLines || descLines === null) return null;
      blocks.push({ kind: "item", item, price, nameLines, descLines, h: Math.round(nameLines.length * 46 * s * 1.25 + descLines.length * 34 * s * 1.3 + 34 * s) });
    }
  }
  return blocks;
}

function layoutMenu(menu, { pages, hasHeader = true }, s) {
  const colW = (PAGE.W - PAGE.margin * 2 - PAGE.gutter) / 2;
  const blocks = menuBlocks(menu, s, colW);
  if (!blocks) return null;
  const columns = [];
  const top = (pageIndex) => (pageIndex === 0 && hasHeader ? 760 : PAGE.margin + 40);
  const bottom = PAGE.H - PAGE.margin - 120;
  let page = 0; let col = 0; let y = top(0); let current = [];
  const next = () => { columns.push({ page, col, blocks: current }); current = []; col += 1; if (col > 1) { col = 0; page += 1; } y = top(page); };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const need = b.h + (b.keepWithNext && blocks[i + 1] ? blocks[i + 1].h : 0);
    if (y + need > bottom && current.length) next();
    if (y + b.h > bottom) return null; // a single block taller than a column
    current.push({ ...b, y }); y += b.h;
  }
  if (current.length) columns.push({ page, col, blocks: current });
  const used = Math.max(...columns.map((c) => c.page)) + 1;
  return used <= pages ? { columns, pages: used, colW } : null;
}

function menuPageSvgs(menu, brief, { pages, hasLogo }) {
  let layout = null; let s = 1;
  for (s = 1; s >= 0.62; s -= 0.04) { layout = layoutMenu(menu, { pages }, s); if (layout) break; }
  if (!layout) return { error: `The menu does not fit on ${pages} page${pages === 1 ? "" : "s"} at a readable size` };
  const f = face(brief.style);
  const p = paletteFor(brief.style, brief.brand_colors);
  const out = [];
  for (let pg = 0; pg < layout.pages; pg++) {
    const parts = [`<rect width="${PAGE.W}" height="${PAGE.H}" fill="${p.bg}"/>`, `<rect x="70" y="70" width="${PAGE.W - 140}" height="${PAGE.H - 140}" fill="none" stroke="${p.accent}" stroke-width="6"/>`];
    if (pg === 0) {
      let y = 200;
      if (hasLogo) { parts.push(logoImage(PAGE.W / 2 - 220, y - 30, 440, 220)); y += 220; }
      const nf = fit(brief.business_name, { maxWidth: PAGE.W - 500, maxHeight: hasLogo ? 200 : 300, start: hasLogo ? 150 : 200, min: 70, em: f.em, lineHeight: 1.05 });
      if (!nf) return { error: "The business name is too long for the menu header" };
      parts.push(textLines(nf.lines, { x: PAGE.W / 2, y, size: nf.size, fill: p.accent, family: fam(f), weight: f.weight, lineHeight: 1.05 }));
      y += nf.height + 20;
      if (brief.tagline) parts.push(textLines([brief.tagline], { x: PAGE.W / 2, y, size: 52, fill: p.ink, family: BODY, extra: ' font-style="italic"' }));
    }
    for (const column of layout.columns.filter((c) => c.page === pg)) {
      const x = PAGE.margin + column.col * (layout.colW + PAGE.gutter);
      for (const b of column.blocks) {
        if (b.kind === "section") {
          parts.push(textLines([b.text], { x, y: b.y + 20 * s, size: Math.round(70 * s), fill: p.accent, family: fam(f), weight: f.weight, anchor: "start" }));
          parts.push(`<rect x="${x}" y="${Math.round(b.y + 112 * s)}" width="${Math.round(layout.colW * 0.3)}" height="4" fill="${p.accent}"/>`);
          continue;
        }
        const ns = Math.round(46 * s);
        parts.push(textLines(b.nameLines, { x, y: b.y, size: ns, fill: p.ink, family: BODY, weight: 700, anchor: "start", lineHeight: 1.25 }));
        if (b.price) parts.push(textLines([b.price], { x: x + layout.colW, y: b.y, size: ns, fill: p.ink, family: BODY, weight: 700, anchor: "end", lineHeight: 1.25 }));
        if (b.descLines.length) parts.push(textLines(b.descLines, { x, y: b.y + b.nameLines.length * ns * 1.25, size: Math.round(34 * s), fill: p.ink, family: BODY, anchor: "start", lineHeight: 1.3, extra: ' opacity="0.85"' }));
      }
    }
    const foot = [brief.footer, pg === layout.pages - 1 ? menu.notes : ""].filter(Boolean).join("  ·  ");
    if (foot) {
      const ff = fit(foot, { maxWidth: PAGE.W - 500, maxHeight: 100, start: 36, min: 24, em: 0.52 });
      if (ff) parts.push(textLines(ff.lines, { x: PAGE.W / 2, y: PAGE.H - PAGE.margin - 60, size: ff.size, fill: p.ink, family: BODY }));
    }
    if (layout.pages > 1) parts.push(textLines([`${pg + 1} / ${layout.pages}`], { x: PAGE.W / 2, y: PAGE.H - 150, size: 28, fill: p.ink, family: BODY, extra: ' opacity="0.6"' }));
    out.push({ name: `menu-page-${pg + 1}.png`, svg: `${svgOpen(PAGE.W, PAGE.H)}${parts.join("")}</svg>`, width: PAGE.W, height: PAGE.H });
  }
  // Every item name and price must be on the pages (nothing dropped by the layout).
  const all = out.map((o) => o.svg).join("");
  for (const section of menu.sections || []) {
    for (const item of section.items || []) {
      const firstWord = esc(String(item.name || "").trim().split(/\s+/)[0] || "");
      if (firstWord && !all.includes(firstWord)) return { error: `"${String(item.name).slice(0, 40)}" is missing from the layout` };
      if (item.price && !all.includes(esc(String(item.price).trim()))) return { error: `The price of "${String(item.name).slice(0, 40)}" is missing from the layout` };
    }
  }
  return { pages: out, scale: Math.round(s * 100) / 100 };
}

export { FACES, FONT_FAMILIES, LOGO_H, LOGO_W, PAGE, SOCIAL_SIZES, esc, fit, flyerSvg, logoOptions, menuPageSvgs, paletteFor, socialSvg, wrapLines };
