// Print-ready PDF of a hosted menu (owner, Nov 5, 2026: Online Menu + QR now includes one, matching the online menu).
//   buildPrintMenuPdf({ businessName, primary, accent, logoDataUri, menu, qrModules, qrUrl }) -> Uint8Array | null
// Letter size, built from the same parsed menu the live page shows, so it always matches the current version.
// Layout: brand-colour header, the menu in one or two columns (the largest type that fits on one page, or several
// pages at a readable size), and a QR code back to the online menu at the foot of every page.
// Uses the PDF standard fonts, which cover Western European text. Returns null when the menu has too many
// characters those fonts cannot show (for example a menu written in Chinese), so the caller can say so instead of
// printing question marks.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

// Turns the menu into measured blocks for one type size and column width. Each block knows its height and how to
// draw itself; a section heading is glued to its first item so a heading never ends a column on its own.
function measure(menu, fonts, size, colW) {
  const titleSize = size * 1.3;
  const descSize = size * 0.88;
  const lead = 1.28;
  const blocks = [];
  for (const section of menu.sections) {
    const heading = {
      height: titleSize * 1.25 + 9 + size * 0.5,
      draw(page, x, top, theme) {
        page.drawText(section.name.toUpperCase(), { x, y: top - titleSize, size: titleSize, font: fonts.serifBold, color: theme.primary, maxWidth: colW });
        page.drawLine({ start: { x, y: top - titleSize * 1.25 - 4 }, end: { x: x + colW, y: top - titleSize * 1.25 - 4 }, thickness: 1.4, color: theme.accent });
      }
    };
    section.items.forEach((item, index) => {
      const priceW = item.price ? fonts.bold.widthOfTextAtSize(item.price, size) : 0;
      const nameLines = wrap(item.name, fonts.bold, size, Math.max(colW - priceW - 28, colW * 0.45));
      const descLines = item.description ? wrap(item.description, fonts.regular, descSize, colW) : [];
      const height = nameLines.length * size * lead + descLines.length * descSize * lead + size * 0.62;
      const block = {
        height,
        draw(page, x, top, theme) {
          let y = top - size;
          nameLines.forEach((line, i) => {
            page.drawText(line, { x, y, size, font: fonts.bold, color: INK });
            if (i === nameLines.length - 1 && item.price) {
              const end = x + fonts.bold.widthOfTextAtSize(line, size) + 5;
              const priceX = x + colW - priceW;
              if (priceX - end > 8) {
                page.drawLine({ start: { x: end, y: y + 1.5 }, end: { x: priceX - 5, y: y + 1.5 }, thickness: 0.7, color: LEADER, dashArray: [0.8, 2.6], lineCap: 1 });
              }
              page.drawText(item.price, { x: priceX, y, size, font: fonts.bold, color: theme.primary });
            }
            y -= size * lead;
          });
          let dy = y + size * lead - descSize * 1.32;
          for (const line of descLines) {
            page.drawText(line, { x, y: dy, size: descSize, font: fonts.regular, color: MUTED });
            dy -= descSize * lead;
          }
        }
      };
      if (index === 0) {
        blocks.push({
          height: heading.height + block.height,
          gapBefore: blocks.length ? size * 1.1 : 0,
          draw(page, x, top, theme) { heading.draw(page, x, top, theme); block.draw(page, x, top - heading.height, theme); }
        });
      } else {
        blocks.push(block);
      }
    });
  }
  if (menu.notes) {
    const noteSize = size * 0.85;
    const lines = wrap(menu.notes, fonts.italic, noteSize, colW);
    blocks.push({
      height: lines.length * noteSize * lead + 4,
      gapBefore: size,
      draw(page, x, top) {
        lines.forEach((line, i) => page.drawText(line, { x, y: top - noteSize - i * noteSize * lead, size: noteSize, font: fonts.italic, color: MUTED }));
      }
    });
  }
  return blocks;
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
      pages[pageIndex].push({ block, col, top: y });
      y -= block.height;
    } else {
      pages[pageIndex].push({ block, col, top: y - gap });
      y -= gap + block.height;
    }
  }
  return pages;
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

async function buildPrintMenuPdf({ businessName, primary, accent, logoDataUri, menu, qrModules, qrUrl }) {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold)
  };
  const { clean, stats } = makeSanitizer(fonts.regular);
  const name = clean(businessName) || "Menu";
  const sections = (menu?.sections || []).map((section) => ({
    name: clean(section.name) || "Menu",
    items: (section.items || []).map((item) => ({ name: clean(item?.name), description: clean(item?.description), price: clean(item?.price) })).filter((item) => item.name)
  })).filter((section) => section.items.length);
  const notes = clean(menu?.notes);
  if (!sections.length) return null;
  if (stats.total && stats.unsupported / stats.total > MAX_UNSUPPORTED_SHARE) return null;
  const cleanMenu = { sections, notes };

  const theme = { primary: hexToRgb(primary, "#1f2a2e"), accent: hexToRgb(accent || primary, "#1f2a2e") };
  const logo = await embedLogo(doc, logoDataUri);
  const logoH = logo ? Math.min(58, logo.height * (180 / Math.max(logo.width, 1)), logo.height) : 0;
  const nameSize = Math.min(34, ((PAGE_W - 2 * MARGIN) / Math.max(fonts.serifBold.widthOfTextAtSize(name, 34), 1)) * 34);
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
      const pages = flow(measure(cleanMenu, fonts, size, colW), cols, firstTop, otherTop, bottom, 1);
      if (pages) { plan = { cols, colW, pages }; break; }
    }
    if (plan) break;
  }
  if (!plan) {
    const colW = (fullW - GUTTER) / 2;
    plan = { cols: 2, colW, pages: flow(measure(cleanMenu, fonts, 9.5, colW), 2, firstTop, otherTop, bottom, 40) };
    if (!plan.pages) return null;
  }

  const left = plan.cols === 1 ? (PAGE_W - plan.colW) / 2 : MARGIN;
  plan.pages.forEach((placed, pageIndex) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.984, 0.973, 0.953) });
    if (pageIndex === 0) {
      page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: theme.primary });
      let y = PAGE_H - 34;
      if (logo) {
        const w = logo.width * (logoH / logo.height);
        page.drawImage(logo, { x: (PAGE_W - w) / 2, y: y - logoH, width: w, height: logoH });
        y -= logoH + 12;
      }
      const nameW = fonts.serifBold.widthOfTextAtSize(name, nameSize);
      page.drawText(name, { x: (PAGE_W - nameW) / 2, y: y - nameSize * 0.8, size: nameSize, font: fonts.serifBold, color: rgb(1, 1, 1) });
      const label = "M E N U";
      page.drawText(label, { x: (PAGE_W - fonts.regular.widthOfTextAtSize(label, 9)) / 2, y: y - nameSize * 0.8 - 20, size: 9, font: fonts.regular, color: rgb(1, 1, 1), opacity: 0.85 });
    } else {
      const label = `${name} — continued`;
      page.drawText(label, { x: MARGIN, y: PAGE_H - MARGIN, size: 9, font: fonts.regular, color: MUTED });
      page.drawLine({ start: { x: MARGIN, y: PAGE_H - MARGIN - 7 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 7 }, thickness: 0.6, color: RULE });
    }
    for (const { block, col, top } of placed) {
      block.draw(page, left + col * (plan.colW + GUTTER), top, theme);
    }
    if (plan.cols === 2 && placed.some((p) => p.col === 1)) {
      const lineTop = pageIndex === 0 ? firstTop : otherTop;
      page.drawLine({ start: { x: PAGE_W / 2, y: lineTop }, end: { x: PAGE_W / 2, y: bottom }, thickness: 0.5, color: RULE });
    }
    drawFooter(page, fonts, theme, qrModules, qrUrl);
    if (plan.pages.length > 1) {
      const n = `${pageIndex + 1} / ${plan.pages.length}`;
      page.drawText(n, { x: PAGE_W - MARGIN - fonts.regular.widthOfTextAtSize(n, 8), y: 20, size: 8, font: fonts.regular, color: MUTED });
    }
  });
  doc.setTitle(`${name} — Menu`);
  doc.setCreator("MENU-MADE");
  doc.setProducer("MENU-MADE");
  return doc.save();
}

function drawFooter(page, fonts, theme, qrModules, qrUrl) {
  const y0 = MARGIN - 6;
  page.drawLine({ start: { x: MARGIN, y: y0 + FOOTER_H - 14 }, end: { x: PAGE_W - MARGIN, y: y0 + FOOTER_H - 14 }, thickness: 0.6, color: RULE });
  const qrSize = 66;
  const qrX = PAGE_W - MARGIN - qrSize;
  const qrY = y0 + 4;
  if (qrModules?.size) {
    const n = qrModules.size;
    const cell = qrSize / n;
    page.drawRectangle({ x: qrX - 3, y: qrY - 3, width: qrSize + 6, height: qrSize + 6, color: rgb(1, 1, 1) });
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qrModules.get(r, c)) {
          page.drawRectangle({ x: qrX + c * cell, y: qrY + qrSize - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
        }
      }
    }
  }
  const textRight = qrModules?.size ? qrX - 16 : PAGE_W - MARGIN;
  const heading = "Scan for our menu online";
  page.drawText(heading, { x: textRight - fonts.bold.widthOfTextAtSize(heading, 12), y: qrY + 40, size: 12, font: fonts.bold, color: theme.primary });
  const link = String(qrUrl || "").replace(/^https?:\/\//, "");
  if (link) {
    const linkSize = Math.min(9, (textRight - MARGIN) / Math.max(fonts.regular.widthOfTextAtSize(link, 9), 1) * 9);
    page.drawText(link, { x: textRight - fonts.regular.widthOfTextAtSize(link, linkSize), y: qrY + 24, size: linkSize, font: fonts.regular, color: MUTED });
  }
  page.drawText("Menu by MENU-MADE", { x: MARGIN, y: qrY + 2, size: 7, font: fonts.regular, color: LEADER });
}

export { buildPrintMenuPdf };
