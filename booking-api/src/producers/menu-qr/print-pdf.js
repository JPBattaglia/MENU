// Print-ready PDFs of a hosted menu (owner, Nov 5, 2026: Online Menu + QR includes them, matching the online menu).
//   buildPrintMenuPdf(input)  -> Uint8Array | null   letter page(s): brand header, one or two columns, QR footer
//   buildTriFoldPdf(input)    -> Uint8Array | null   letter landscape, two sides: cover, QR back, menu inside
//   buildTableTentPdf(input)  -> Uint8Array | null   letter, folds in half into a tent with the QR code on both faces
//   input = { businessName, primary, accent, logoDataUri, menu, qrModules, qrUrl, style, hideName }
// `style` is the design the online menu uses: its paper, text, heading, price and line colours carry over, and a
// sans-serif design gets sans-serif headings. Patterns, decorations and the design's own typefaces do not: these
// PDFs are drawn with the PDF standard fonts.
// All are built from the same parsed menu the live page shows, so they always match the current version. Diet and
// allergen marks the menu already uses, like "(V, GF)", become small icons with a key (see dietary.js).
// Uses the PDF standard fonts, which cover Western European text. Returns null when the menu has too many
// characters those fonts cannot show (for example a menu written in Chinese), or when it can't fit the format, so
// the caller can say so instead of printing question marks or unreadable type.
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from "pdf-lib";
import { markItems, markLabel } from "./dietary.js";
import { FONTS, mix, toStyle } from "./style.js";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const GUTTER = 30;
const FOOTER_H = 92;
const MAX_UNSUPPORTED_SHARE = 0.03;

const hexToRgb = (hex, fallback) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")) || /^#?([0-9a-f]{6})$/i.exec(fallback);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const INK = rgb(0.114, 0.114, 0.106);
const MUTED = rgb(0.365, 0.353, 0.333);
const RULE = rgb(0.85, 0.82, 0.77);
const LEADER = rgb(0.68, 0.65, 0.6);
const PAPER = rgb(0.984, 0.973, 0.953);
const WHITE = rgb(1, 1, 1);
const CHILI = rgb(0.75, 0.16, 0.12);

// Makes text safe for the standard fonts: common look-alikes are swapped, accents dropped only when the accented
// letter isn't available, and anything else counted so the caller can refuse a menu the fonts cannot show.
function makeSanitizer(font) {
  const cache = new Map();
  const ok = (ch) => {
    if (!cache.has(ch)) {
      try { font.encodeText(ch); cache.set(ch, true); } catch { cache.set(ch, false); }
    }
    return cache.get(ch);
  };
  const swaps = { "‐": "-", "‑": "-", "‒": "-", "−": "-", " ": " ", " ": " ", " ": " ", " ": " ", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8" };
  const stats = { total: 0, unsupported: 0 };
  const clean = (value) => {
    let out = "";
    for (const ch of String(value ?? "").replace(/\s+/g, " ").trim()) {
      stats.total++;
      if (ok(ch)) { out += ch; continue; }
      if (swaps[ch] !== undefined) { out += swaps[ch]; continue; }
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      if (base && [...base].every(ok)) { out += base; continue; }
      if (/\p{Extended_Pictographic}|️|‍/u.test(ch)) continue; // emoji: dropped, not counted
      stats.unsupported++;
    }
    return out.replace(/\s+/g, " ").trim();
  };
  return { clean, stats };
}

function wrap(text, font, size, width) {
  const words = String(text || "").split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
    // A single word wider than the column is cut so it never runs into the next column.
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Diet marks: a small pill per code. Spicy is a filled chili-red pill; the rest are outlined in the accent colour.
const badgeText = (code) => (code === "HOT" ? "HOT" : code);
function badgeWidth(fonts, code, size) {
  return fonts.bold.widthOfTextAtSize(badgeText(code), size * 0.62) + size * 0.62;
}
function badgesWidth(fonts, marks, size) {
  return marks.reduce((sum, code) => sum + badgeWidth(fonts, code, size) + size * 0.25, 0);
}
function drawBadges(page, fonts, theme, marks, x, baseline, size) {
  let bx = x;
  for (const code of marks) {
    const w = badgeWidth(fonts, code, size);
    const h = size * 0.92;
    const hot = code === "HOT";
    page.drawRectangle({ x: bx, y: baseline - size * 0.2, width: w, height: h, color: hot ? CHILI : theme.paper, borderColor: hot ? CHILI : theme.accent, borderWidth: 0.7, opacity: 1 });
    page.drawText(badgeText(code), { x: bx + size * 0.31, y: baseline + size * 0.02, size: size * 0.62, font: fonts.bold, color: hot ? WHITE : theme.accent });
    bx += w + size * 0.25;
  }
  return bx;
}

// Turns the menu into measured blocks for one type size and column width. Each block knows its height and how to
// draw itself; a section heading is glued to its first item so a heading never ends a column on its own.
function measure(menu, fonts, size, colW, { notes = true, key = true } = {}) {
  const titleSize = size * 1.3;
  const descSize = size * 0.88;
  const lead = 1.28;
  const blocks = [];
  for (const section of menu.sections) {
    // A long section name wraps onto as many lines as it needs and the rule and first item move down with it
    // (owner's tri-fold, Nov 12, 2026: "MAIN COURSE - SECONDI" ran over its own rule and the first dish).
    const titleLines = wrap(section.name.toUpperCase(), fonts.serifBold, titleSize, colW);
    const titleH = titleSize * 1.25 + (titleLines.length - 1) * titleSize * 1.12;
    const heading = {
      height: titleH + 9 + size * 0.5,
      draw(page, x, top, theme) {
        titleLines.forEach((line, i) => page.drawText(line, { x, y: top - titleSize - i * titleSize * 1.12, size: titleSize, font: fonts.serifBold, color: theme.primary }));
        page.drawLine({ start: { x, y: top - titleH - 4 }, end: { x: x + colW, y: top - titleH - 4 }, thickness: 1.4, color: theme.accent });
      }
    };
    section.items.forEach((item, index) => {
      const priceW = item.price ? fonts.bold.widthOfTextAtSize(item.price, size) : 0;
      const marksW = item.marks?.length ? badgesWidth(fonts, item.marks, size) + size * 0.3 : 0;
      const nameLines = wrap(item.name, fonts.bold, size, Math.max(colW - priceW - 28 - marksW, colW * 0.4));
      const descLines = item.description ? wrap(item.description, fonts.regular, descSize, colW) : [];
      const height = nameLines.length * size * lead + descLines.length * descSize * lead + size * 0.62;
      const block = {
        height,
        draw(page, x, top, theme) {
          let y = top - size;
          nameLines.forEach((line, i) => {
            page.drawText(line, { x, y, size, font: fonts.bold, color: theme.ink });
            if (i === nameLines.length - 1) {
              let end = x + fonts.bold.widthOfTextAtSize(line, size) + 5;
              if (item.marks?.length) end = drawBadges(page, fonts, theme, item.marks, end + size * 0.05, y, size) + 3;
              if (item.price) {
                const priceX = x + colW - priceW;
                if (priceX - end > 8) {
                  page.drawLine({ start: { x: end, y: y + 1.5 }, end: { x: priceX - 5, y: y + 1.5 }, thickness: 0.7, color: theme.leader, dashArray: [0.8, 2.6], lineCap: 1 });
                }
                page.drawText(item.price, { x: priceX, y, size, font: fonts.bold, color: theme.price });
              }
            }
            y -= size * lead;
          });
          let dy = y + size * lead - descSize * 1.32;
          for (const line of descLines) {
            page.drawText(line, { x, y: dy, size: descSize, font: fonts.regular, color: theme.muted });
            dy -= descSize * lead;
          }
        }
      };
      block.section = section;
      if (index === 0) {
        blocks.push({
          section,
          height: heading.height + block.height,
          gapBefore: blocks.length ? size * 1.1 : 0,
          draw(page, x, top, theme) { heading.draw(page, x, top, theme); block.draw(page, x, top - heading.height, theme); }
        });
      } else {
        blocks.push(block);
      }
    });
  }
  if (key && menu.used?.length) blocks.push(keyBlock(menu.used, fonts, size * 0.85, colW));
  if (notes && menu.notes) blocks.push(notesBlock(menu.notes, fonts, size * 0.85, colW));
  return blocks;
}

function notesBlock(text, fonts, noteSize, colW) {
  const lead = 1.28;
  const lines = wrap(text, fonts.italic, noteSize, colW);
  return {
    height: lines.length * noteSize * lead + 4,
    gapBefore: noteSize * 1.2,
    draw(page, x, top, theme) {
      lines.forEach((line, i) => page.drawText(line, { x, y: top - noteSize - i * noteSize * lead, size: noteSize, font: fonts.italic, color: theme.muted }));
    }
  };
}

// "V Vegetarian  GF Gluten-free ..." laid out in rows that fit the column.
function keyBlock(used, fonts, size, colW) {
  const entries = used.map((code) => ({ code, label: markLabel(code), w: badgeWidth(fonts, code, size) + 4 + fonts.regular.widthOfTextAtSize(markLabel(code), size) + size * 1.2 }));
  const rows = [[]];
  let rowW = 0;
  for (const entry of entries) {
    if (rowW + entry.w > colW && rows.at(-1).length) { rows.push([]); rowW = 0; }
    rows.at(-1).push(entry);
    rowW += entry.w;
  }
  const lineH = size * 1.6;
  return {
    height: rows.length * lineH + 2,
    gapBefore: size * 1.3,
    draw(page, x, top, theme) {
      rows.forEach((row, r) => {
        let cx = x;
        const baseline = top - size - r * lineH;
        for (const entry of row) {
          cx = drawBadges(page, fonts, theme, [entry.code], cx, baseline, size) + 2;
          page.drawText(entry.label, { x: cx, y: baseline, size, font: fonts.regular, color: theme.muted });
          cx += fonts.regular.widthOfTextAtSize(entry.label, size) + size * 1.2;
        }
      });
    }
  };
}

// Fills columns top to bottom. Returns the placed blocks per page, or null when it needs more than maxPages.
function flow(blocks, cols, firstTop, otherTop, bottom, maxPages) {
  const pages = [[]];
  let col = 0;
  let pageIndex = 0;
  let y = firstTop;
  const top = () => (pageIndex === 0 ? firstTop : otherTop);
  for (const block of blocks) {
    const gap = y === top() ? 0 : block.gapBefore || 0;
    if (y - gap - block.height < bottom) {
      col++;
      if (col >= cols) {
        col = 0;
        pageIndex++;
        if (pageIndex >= maxPages) return null;
        pages.push([]);
      }
      y = top();
      if (y - block.height < bottom) return null; // one block taller than a whole column
      pages[pageIndex].push({ block, col, top: y });
      y -= block.height;
    } else {
      pages[pageIndex].push({ block, col, top: y - gap });
      y -= gap + block.height;
    }
  }
  return pages;
}

// Whole sections as single blocks, so a section is never split between two panels of a tri-fold.
function keepSections(blocks) {
  const out = [];
  for (const block of blocks) {
    const last = out.at(-1);
    if (!block.section || !last || last.section !== block.section) { out.push(block.section ? { section: block.section, gapBefore: block.gapBefore, parts: [block], height: block.height } : block); continue; }
    last.parts.push(block);
    last.height += (block.gapBefore || 0) + block.height;
  }
  return out.map((b) => (b.parts ? {
    ...b,
    draw(page, x, top, theme) {
      let y = top;
      b.parts.forEach((part, i) => { if (i) y -= part.gapBefore || 0; part.draw(page, x, y, theme); y -= part.height; });
    }
  } : b));
}

// For a one-page layout, the shortest column height that still fits, so columns end at about the same line instead
// of one full column and one nearly empty one.
function balance(blocks, cols, top, bottom) {
  let lo = bottom;
  let hi = top;
  let best = flow(blocks, cols, top, top, bottom, 1);
  if (!best) return null;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const pages = flow(blocks, cols, top, top, mid, 1);
    if (pages) { best = pages; lo = mid; } else { hi = mid; }
  }
  return best;
}

async function embedLogo(doc, dataUri) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUri || ""));
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return m[1] === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

// Shared start for every format: fonts, cleaned text, diet marks, colours and logo. Null when the text can't be shown.
async function prepare({ businessName, primary, accent, logoDataUri, menu, hideName = false, style = null }) {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold)
  };
  const { clean, stats } = makeSanitizer(fonts.regular);
  const marked = markItems(menu);
  const name = clean(businessName) || "Menu";
  const sections = (marked.menu.sections || []).map((section) => ({
    name: clean(section.name) || "Menu",
    items: (section.items || []).map((item) => ({ name: clean(item?.name), description: clean(item?.description), price: clean(item?.price), marks: item.marks || [] })).filter((item) => item.name)
  })).filter((section) => section.items.length);
  const notes = clean(menu?.notes);
  if (stats.total && stats.unsupported / stats.total > MAX_UNSUPPORTED_SHARE) return null;
  const theme = { primary: hexToRgb(primary, "#1f2a2e"), accent: hexToRgb(accent || primary, "#1f2a2e"), paper: PAPER, ink: INK, muted: MUTED, rule: RULE, leader: LEADER, price: null, band: null, bandText: WHITE };
  theme.price = theme.primary;
  theme.band = theme.primary;
  const design = toStyle(style);
  if (design) {
    const c = (hex) => hexToRgb(hex, "#1f2a2e");
    Object.assign(theme, {
      primary: c(design.heading), accent: c(design.accent), paper: c(design.paper), ink: c(design.item), muted: c(design.muted),
      rule: c(design.rule), leader: c(mix(design.muted, design.paper, 0.35)), price: c(design.price),
      band: c(design.dark ? mix(design.paper, "#000000", 0.28) : design.heading), bandText: design.dark ? c(design.heading) : WHITE
    });
    if (/sans-serif$/.test(FONTS[design.headingFont] || "")) fonts.serifBold = fonts.bold;
  }
  const logo = await embedLogo(doc, logoDataUri);
  // "Hide the name (my logo already shows it)" on the online menu holds for every printed format too (owner, Nov 12,
  // 2026). Without a logo there would be nothing in its place, so the name stays.
  const showName = !(hideName === true && logo);
  return { doc, fonts, name, showName, menu: { sections, notes, used: marked.used }, theme, logo };
}

function finish(doc, name, kind) {
  doc.setTitle(`${name} — ${kind}`);
  doc.setCreator("MENU-MADE");
  doc.setProducer("MENU-MADE");
  return doc.save();
}

function drawQr(page, qrModules, x, y, size) {
  if (!qrModules?.size) return false;
  const n = qrModules.size;
  const cell = size / n;
  const pad = cell * 2;
  page.drawRectangle({ x: x - pad, y: y - pad, width: size + 2 * pad, height: size + 2 * pad, color: WHITE });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qrModules.get(r, c)) {
        page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
      }
    }
  }
  return true;
}

const centerText = (page, text, font, size, cx, y, color, opacity = 1) =>
  page.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y, size, font, color, opacity });
const fitSize = (font, text, max, width) => Math.min(max, (width / Math.max(font.widthOfTextAtSize(text, max), 1)) * max);

// ---------- Letter menu ----------

async function buildPrintMenuPdf(input) {
  const ready = await prepare(input);
  if (!ready || !ready.menu.sections.length) return null;
  const { doc, fonts, name, showName, menu, theme, logo } = ready;
  const { qrModules, qrUrl } = input;
  const logoH = logo ? Math.min(58, logo.height * (180 / Math.max(logo.width, 1)), logo.height) : 0;
  const nameSize = showName ? fitSize(fonts.serifBold, name, 34, PAGE_W - 2 * MARGIN) : 0;
  const headerH = 34 + (logo ? logoH + 12 : 0) + nameSize + 26;
  const firstTop = PAGE_H - headerH - 26;
  const otherTop = PAGE_H - MARGIN - 18;
  // Every page carries the QR footer, so a page that gets separated from the others still leads to the online menu.
  const bottom = MARGIN + FOOTER_H;
  const fullW = PAGE_W - 2 * MARGIN;

  // Largest type that fits on one page, trying one column for short menus; otherwise a readable size over pages.
  const attempts = [
    { cols: 1, sizes: [13, 12, 11] },
    { cols: 2, sizes: [11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5] }
  ];
  let plan = null;
  for (const { cols, sizes } of attempts) {
    const colW = cols === 1 ? Math.min(fullW, 430) : (fullW - GUTTER) / 2;
    for (const size of sizes) {
      const blocks = measure(menu, fonts, size, colW);
      if (flow(blocks, cols, firstTop, otherTop, bottom, 1)) { plan = { cols, colW, pages: balance(blocks, cols, firstTop, bottom) }; break; }
    }
    if (plan) break;
  }
  if (!plan) {
    const colW = (fullW - GUTTER) / 2;
    plan = { cols: 2, colW, pages: flow(measure(menu, fonts, 9.5, colW), 2, firstTop, otherTop, bottom, 40) };
    if (!plan.pages) return null;
  }

  const left = plan.cols === 1 ? (PAGE_W - plan.colW) / 2 : MARGIN;
  plan.pages.forEach((placed, pageIndex) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: theme.paper });
    if (pageIndex === 0) {
      page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: theme.band });
      let y = PAGE_H - 34;
      if (logo) {
        const w = logo.width * (logoH / logo.height);
        page.drawImage(logo, { x: (PAGE_W - w) / 2, y: y - logoH, width: w, height: logoH });
        y -= logoH + 12;
      }
      if (showName) centerText(page, name, fonts.serifBold, nameSize, PAGE_W / 2, y - nameSize * 0.8, theme.bandText);
      centerText(page, "M E N U", fonts.regular, 9, PAGE_W / 2, y - nameSize * 0.8 - 20, theme.bandText, 0.85);
    } else {
      page.drawText(`${name} — continued`, { x: MARGIN, y: PAGE_H - MARGIN, size: 9, font: fonts.regular, color: theme.muted });
      page.drawLine({ start: { x: MARGIN, y: PAGE_H - MARGIN - 7 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 7 }, thickness: 0.6, color: theme.rule });
    }
    for (const { block, col, top } of placed) {
      block.draw(page, left + col * (plan.colW + GUTTER), top, theme);
    }
    if (plan.cols === 2 && placed.some((p) => p.col === 1)) {
      const lineTop = pageIndex === 0 ? firstTop : otherTop;
      page.drawLine({ start: { x: PAGE_W / 2, y: lineTop }, end: { x: PAGE_W / 2, y: bottom }, thickness: 0.5, color: theme.rule });
    }
    drawFooter(page, fonts, theme, qrModules, qrUrl);
    if (plan.pages.length > 1) {
      const n = `${pageIndex + 1} / ${plan.pages.length}`;
      page.drawText(n, { x: PAGE_W - MARGIN - fonts.regular.widthOfTextAtSize(n, 8), y: 20, size: 8, font: fonts.regular, color: theme.muted });
    }
  });
  return finish(doc, name, "Menu");
}

function drawFooter(page, fonts, theme, qrModules, qrUrl) {
  const y0 = MARGIN - 6;
  page.drawLine({ start: { x: MARGIN, y: y0 + FOOTER_H - 14 }, end: { x: PAGE_W - MARGIN, y: y0 + FOOTER_H - 14 }, thickness: 0.6, color: theme.rule });
  const qrSize = 66;
  const qrX = PAGE_W - MARGIN - qrSize;
  const qrY = y0 + 4;
  const hasQr = drawQr(page, qrModules, qrX, qrY, qrSize);
  const textRight = hasQr ? qrX - 16 : PAGE_W - MARGIN;
  const heading = "Scan for our menu online";
  page.drawText(heading, { x: textRight - fonts.bold.widthOfTextAtSize(heading, 12), y: qrY + 40, size: 12, font: fonts.bold, color: theme.primary });
  const link = String(qrUrl || "").replace(/^https?:\/\//, "");
  if (link) {
    const linkSize = fitSize(fonts.regular, link, 9, textRight - MARGIN);
    page.drawText(link, { x: textRight - fonts.regular.widthOfTextAtSize(link, linkSize), y: qrY + 24, size: linkSize, font: fonts.regular, color: theme.muted });
  }
  page.drawText("Menu by MENU-MADE", { x: MARGIN, y: qrY + 2, size: 7, font: fonts.regular, color: theme.leader });
}

// ---------- Tri-fold ----------
// Letter landscape, printed on both sides (flip on the short edge), folded into thirds with the cover on the right.
// Outside: [inside flap | back with the QR code | cover]. Inside: three columns of menu. A menu too long for the
// inside also uses the inside flap; longer than that, it isn't offered as a tri-fold (null).

const TF_W = 792;
const TF_H = 612;
const PANEL = TF_W / 3;
const TF_PAD = 26;

async function buildTriFoldPdf(input) {
  const ready = await prepare(input);
  if (!ready || !ready.menu.sections.length) return null;
  const { doc, fonts, name, showName, menu, theme, logo } = ready;
  const { qrModules, qrUrl } = input;
  const colW = PANEL - 2 * TF_PAD;
  const top = TF_H - TF_PAD - 4;
  const bottom = TF_PAD;
  // The largest type that fits, so a short menu fills its panels instead of sitting in the top half (owner, Nov 12,
  // 2026). Whole sections stay on one panel when that costs no more than four sizes; a section is split between
  // panels only when the menu is too long for that.
  const SIZES = [18, 17, 16, 15, 14, 13, 12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5];
  const fit = (cols, keep) => {
    for (const size of SIZES) {
      const measured = measure(menu, fonts, size, colW, { notes: cols === 4 });
      const blocks = keep ? keepSections(measured) : measured;
      if (flow(blocks, cols, top, top, bottom, 1)) return { cols, size, placed: balance(blocks, cols, top, bottom)[0] };
    }
    return null;
  };
  let plan = null;
  for (const cols of [3, 4]) {
    const whole = fit(cols, true);
    const split = fit(cols, false);
    plan = whole && (!split || SIZES.indexOf(whole.size) - SIZES.indexOf(split.size) <= 4) ? whole : split;
    if (plan) break;
  }
  if (!plan) return null;
  // Columns start at the same height and the set sits in the middle of the sheet when it is shorter than the panel.
  const lowest = Math.min(...plan.placed.map((p) => p.top - p.block.height));
  const drop = Math.max(0, (lowest - bottom) / 2);
  plan.placed = plan.placed.map((p) => ({ ...p, top: p.top - drop }));

  // Outside
  const outside = doc.addPage([TF_W, TF_H]);
  outside.drawRectangle({ x: 0, y: 0, width: TF_W, height: TF_H, color: theme.paper });
  // Cover (right panel)
  const coverX = PANEL * 2;
  outside.drawRectangle({ x: coverX, y: 0, width: PANEL, height: TF_H, color: theme.band });
  let cy = TF_H * 0.62;
  if (logo) {
    const lh = Math.min(110, logo.height * ((PANEL - 80) / Math.max(logo.width, 1)), logo.height);
    const lw = logo.width * (lh / logo.height);
    outside.drawImage(logo, { x: coverX + (PANEL - lw) / 2, y: cy, width: lw, height: lh });
    cy -= 24;
  }
  const lines = showName ? wrap(name, fonts.serifBold, 30, PANEL - 2 * TF_PAD) : [];
  const coverSize = Math.min(30, ...lines.map((line) => fitSize(fonts.serifBold, line, 30, PANEL - 2 * TF_PAD)));
  lines.forEach((line, i) => centerText(outside, line, fonts.serifBold, coverSize, coverX + PANEL / 2, cy - coverSize - i * coverSize * 1.15, theme.bandText));
  const afterName = lines.length ? cy - coverSize - (lines.length - 1) * coverSize * 1.15 : cy + 8;
  outside.drawLine({ start: { x: coverX + PANEL / 2 - 30, y: afterName - 18 }, end: { x: coverX + PANEL / 2 + 30, y: afterName - 18 }, thickness: 1.2, color: theme.accent === theme.primary ? WHITE : theme.accent });
  centerText(outside, "M E N U", fonts.regular, 10, coverX + PANEL / 2, afterName - 38, theme.bandText, 0.85);
  // Back (middle panel): QR code
  const backX = PANEL;
  const qrSize = 120;
  const hasQr = drawQr(outside, qrModules, backX + (PANEL - qrSize) / 2, TF_H / 2 - 20, qrSize);
  centerText(outside, hasQr ? "Scan for our menu online" : "See our menu online", fonts.bold, 13, backX + PANEL / 2, TF_H / 2 - 52, theme.primary);
  const link = String(qrUrl || "").replace(/^https?:\/\//, "");
  if (link) {
    const linkSize = fitSize(fonts.regular, link, 8.5, PANEL - 2 * TF_PAD);
    centerText(outside, link, fonts.regular, linkSize, backX + PANEL / 2, TF_H / 2 - 68, theme.muted);
  }
  if (showName) centerText(outside, name, fonts.serifBold, fitSize(fonts.serifBold, name, 14, PANEL - 2 * TF_PAD), backX + PANEL / 2, TF_H / 2 + qrSize + 6, theme.primary);
  centerText(outside, "Menu by MENU-MADE", fonts.regular, 7, backX + PANEL / 2, TF_PAD, theme.leader);
  // Inside flap (left panel): menu overflow, or the notes when the menu fits inside.
  if (plan.cols === 4) {
    for (const { block, col, top: t } of plan.placed.filter((p) => p.col === 3)) block.draw(outside, TF_PAD, t, theme);
  } else if (menu.notes) {
    // The notes, centred between two short rules, in type large enough to hold the panel.
    const noteSize = 13;
    const noteLines = wrap(menu.notes, fonts.italic, noteSize, colW).slice(0, 24);
    const noteH = noteLines.length * noteSize * 1.4;
    const noteTop = TF_H / 2 + noteH / 2;
    const cx = PANEL / 2;
    outside.drawLine({ start: { x: cx - 30, y: noteTop + 16 }, end: { x: cx + 30, y: noteTop + 16 }, thickness: 1.2, color: theme.accent });
    noteLines.forEach((line, i) => centerText(outside, line, fonts.italic, noteSize, cx, noteTop - noteSize - i * noteSize * 1.4, theme.ink));
    outside.drawLine({ start: { x: cx - 30, y: noteTop - noteH - 12 }, end: { x: cx + 30, y: noteTop - noteH - 12 }, thickness: 1.2, color: theme.accent });
  }
  // Inside
  const inside = doc.addPage([TF_W, TF_H]);
  inside.drawRectangle({ x: 0, y: 0, width: TF_W, height: TF_H, color: theme.paper });
  for (const { block, col, top: t } of plan.placed.filter((p) => p.col < 3)) block.draw(inside, col * PANEL + TF_PAD, t, theme);
  return finish(doc, name, "Tri-fold menu");
}

// ---------- Table tent ----------
// Letter portrait, folded in half across the middle so it stands on the table. Both faces show the name and a large
// QR code; the top face is drawn upside down so it reads the right way once folded.

async function buildTableTentPdf(input) {
  const ready = await prepare({ ...input, menu: { sections: [] } });
  if (!ready) return null;
  const { doc, fonts, name, showName, theme, logo } = ready;
  const { qrModules, qrUrl } = input;
  if (!qrModules?.size) return null;
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const half = PAGE_H / 2;
  const face = () => {
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: half, color: theme.paper });
    page.drawRectangle({ x: 0, y: half - 66, width: PAGE_W, height: 66, color: theme.band });
    let titleX = PAGE_W / 2;
    if (logo) {
      const lh = 42;
      const lw = Math.min(logo.width * (lh / logo.height), 120);
      page.drawImage(logo, { x: MARGIN, y: half - 54, width: lw, height: lw * (logo.height / logo.width) });
    }
    const nameSize = fitSize(fonts.serifBold, name, 28, PAGE_W - 2 * MARGIN - (logo ? 280 : 0));
    if (showName) centerText(page, name, fonts.serifBold, nameSize, titleX, half - 44, theme.bandText);
    const qrSize = 190;
    const qrX = MARGIN + 30;
    const qrY = 70;
    drawQr(page, qrModules, qrX, qrY, qrSize);
    const tx = qrX + qrSize + 40;
    const tw = PAGE_W - MARGIN - tx;
    page.drawText("Scan for", { x: tx, y: qrY + qrSize - 40, size: 22, font: fonts.regular, color: theme.ink });
    page.drawText("our menu", { x: tx, y: qrY + qrSize - 72, size: fitSize(fonts.serifBold, "our menu", 40, tw), font: fonts.serifBold, color: theme.primary });
    const steps = ["Open your phone's camera", "Point it at the code", "Tap the link that appears"];
    steps.forEach((step, i) => page.drawText(`${i + 1}.  ${step}`, { x: tx, y: qrY + qrSize - 112 - i * 18, size: 11, font: fonts.regular, color: theme.muted }));
    const link = String(qrUrl || "").replace(/^https?:\/\//, "");
    if (link) page.drawText(link, { x: tx, y: qrY + 4, size: fitSize(fonts.regular, link, 9, tw), font: fonts.regular, color: theme.muted });
    centerText(page, "Menu by MENU-MADE", fonts.regular, 7, PAGE_W / 2, 26, theme.leader);
  };
  face();
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(-1, 0, 0, -1, PAGE_W, PAGE_H));
  face();
  page.pushOperators(popGraphicsState());
  page.drawLine({ start: { x: 0, y: half }, end: { x: PAGE_W, y: half }, thickness: 0.5, color: theme.leader, dashArray: [4, 4] });
  page.drawText("fold", { x: 6, y: half + 3, size: 6, font: fonts.regular, color: theme.leader });
  return finish(doc, name, "Table tent");
}

export { buildPrintMenuPdf, buildTriFoldPdf, buildTableTentPdf };
