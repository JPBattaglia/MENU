// Word menus (owner, Nov 25, 2026: "build it to accept and read Word docs"). A .docx file is a zip of XML parts:
// word/document.xml holds the text and docProps/app.xml the page count Word saved. This reads both without a
// library, so the menu reader can take the text as it takes a PDF, and per-page billing can count the pages.
// Old binary .doc files (Word 2003 and earlier) are not read: buyers save those as PDF.

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_PART_BYTES = 8 * 1024 * 1024; // an inflated part larger than this is not a menu
const MAX_TEXT = 60000;

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// A zip starts with "PK\x03\x04"; a Word file also has a word/document.xml part.
function looksLikeZip(bytes) {
  return bytes?.length > 30 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// The central directory lists every part with its size and where its data starts.
function zipEntries(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return null;
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const entries = new Map();
  for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
    if (u32(bytes, at) !== 0x02014b50) break;
    const method = u16(bytes, at + 10);
    const compressed = u32(bytes, at + 20);
    const size = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extra = u16(bytes, at + 30);
    const comment = u16(bytes, at + 32);
    const local = u32(bytes, at + 42);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, { method, compressed, size, local });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PART_BYTES) { await reader.cancel().catch(() => {}); throw new Error("Word document part is too large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

async function readPart(bytes, entries, name) {
  const entry = entries.get(name);
  if (!entry || entry.size > MAX_PART_BYTES) return null;
  const at = entry.local;
  if (u32(bytes, at) !== 0x04034b50) return null;
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  const data = bytes.subarray(start, start + entry.compressed);
  const raw = entry.method === 0 ? data : entry.method === 8 ? await inflateRaw(data) : null;
  return raw ? new TextDecoder().decode(raw) : null;
}

const decodeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, "&");

// Paragraphs become lines, tabs stay tabs (dish<TAB>price is common in Word menus), table cells are joined with " | ".
function documentText(xml) {
  const body = xml.replace(/<w:(?:instrText|delText)\b[^>]*>[\s\S]*?<\/w:(?:instrText|delText)>/g, "");
  let text = "";
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
  for (const m of body.matchAll(token)) {
    if (m[1] !== undefined) text += decodeXml(m[1]);
    else if (m[0] === "<w:tab/>") text += "\t";
    else if (m[0] === "</w:tc>") text = text.replace(/\s+$/, "") + " | ";
    else text += "\n";
  }
  return text.replace(/[ \t]*\|\s*\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
}

function isDocx(bytes) {
  if (!looksLikeZip(bytes)) return false;
  const entries = zipEntries(bytes);
  return Boolean(entries?.has("word/document.xml"));
}

// { text, pages }: pages is the count Word saved (docProps/app.xml), or null when the file doesn't say (some
// exports from other apps leave it out).
async function readDocx(bytes) {
  const entries = looksLikeZip(bytes) ? zipEntries(bytes) : null;
  if (!entries?.has("word/document.xml")) throw new Error("This file is not a Word (.docx) document");
  const xml = await readPart(bytes, entries, "word/document.xml");
  if (xml == null) throw new Error("The Word document could not be opened");
  const app = await readPart(bytes, entries, "docProps/app.xml").catch(() => null);
  const pages = Number(/<Pages>(\d+)<\/Pages>/.exec(app || "")?.[1]);
  return { text: documentText(xml), pages: Number.isInteger(pages) && pages > 0 ? pages : null };
}

export { DOCX_MIME, isDocx, readDocx, documentText };
