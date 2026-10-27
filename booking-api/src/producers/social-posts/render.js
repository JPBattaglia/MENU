// Social Posts graphics (stage 6). Builds each post as an SVG from brand colors, then (elsewhere) rasterizes to PNG.
//   SIZES: square 1080x1080 (feed) and story 1080x1920.
//   fitText() guarantees the headline fits its box; a post whose text cannot fit is a quality failure, not a clipped graphic.
import { colorLuminance, parseBrandColors, readableOnWhiteText } from "../menu-qr/design.js";

const SIZES = { square: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } };
const FONT = "Liberation Sans";
const esc = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Average glyph width of a bold sans face is about 0.56 em; used to wrap and to prove fit.
function wrap(text, fontSize, maxWidth) {
  const perLine = Math.max(4, Math.floor(maxWidth / (fontSize * 0.58)));
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (word.length > perLine) return null; // a single word wider than the box cannot be wrapped
    if (!line) line = word;
    else if ((line + " " + word).length <= perLine) line += " " + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(text, { maxWidth, maxHeight, start, min }) {
  for (let size = start; size >= min; size -= 4) {
    const lines = wrap(text, size, maxWidth);
    if (lines && lines.length * size * 1.18 <= maxHeight) return { lines, fontSize: size };
  }
  return null;
}

function brandOf({ primary, accent, brandColors } = {}) {
  const parsed = parseBrandColors(brandColors || "").filter((c) => c !== "#ffffff");
  const main = readableOnWhiteText(primary || parsed[0] || "#1f2a2e");
  const second = accent || parsed[1] || "#f2b705";
  const light = colorLuminance(second) > 0.4;
  return { primary: main, accent: second, accentInk: light ? "#1d1d1b" : "#ffffff" };
}

// post: { headline, featured: { name, price }|null, kind }. Returns { svg } or { error }.
function renderPostSvg(post, { businessName, brand, logoDataUri }, size) {
  const { width, height } = SIZES[size];
  const margin = 90;
  const story = size === "story";
  const box = { maxWidth: width - margin * 2, maxHeight: story ? 760 : 430 };
  const fit = fitText(String(post.headline || "").trim(), { ...box, start: story ? 118 : 104, min: 52 });
  if (!fit) return { error: `The headline "${String(post.headline).slice(0, 40)}" does not fit the ${size} graphic` };
  const top = story ? 480 : 270;
  const headline = fit.lines.map((line, i) => `<text x="${width / 2}" y="${top + (i + 1) * fit.fontSize * 1.18}" font-size="${fit.fontSize}" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(line)}</text>`).join("");
  const afterHeadline = top + fit.lines.length * fit.fontSize * 1.18 + 60;
  const featured = post.featured?.name
    ? `<rect x="${margin + 60}" y="${afterHeadline}" width="${width - (margin + 60) * 2}" height="110" rx="55" fill="${brand.accent}"/>
       <text x="${width / 2}" y="${afterHeadline + 70}" font-size="46" font-weight="700" text-anchor="middle" fill="${brand.accentInk}">${esc(post.featured.name)}${post.featured.price ? ` · ${esc(post.featured.price)}` : ""}</text>`
    : "";
  const logo = logoDataUri ? `<image href="${esc(logoDataUri)}" x="${width / 2 - 90}" y="${story ? 220 : 90}" width="180" height="120" preserveAspectRatio="xMidYMid meet"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}, Arial, sans-serif">
  <rect width="${width}" height="${height}" fill="${brand.primary}"/>
  <rect x="0" y="0" width="${width}" height="26" fill="${brand.accent}"/>
  <rect x="0" y="${height - 26}" width="${width}" height="26" fill="${brand.accent}"/>
  ${logo}${headline}${featured}
  <text x="${width / 2}" y="${height - 90}" font-size="44" font-weight="700" text-anchor="middle" fill="#ffffff" opacity="0.92">${esc(businessName)}</text>
</svg>`;
  return { svg };
}

export { FONT, SIZES, brandOf, esc, fitText, renderPostSvg, wrap };
