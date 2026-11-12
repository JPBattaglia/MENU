// The QR code as a PNG image (owner, Nov 12, 2026: an SVG is hard for a buyer who doesn't know what to do with one;
// a PNG opens, prints and pastes anywhere, and shows inside the delivery email).
//   qrPng(modules, { scale = 24, quiet = 4 }) -> Promise<Uint8Array>   black on white, `quiet` blank modules around it
// Written by hand: an 8-bit greyscale PNG, compressed with the runtime's own deflate. No image library, no browser.

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function qrPng(modules, { scale = 24, quiet = 4 } = {}) {
  if (!modules?.size) return null;
  const n = modules.size;
  const side = (n + 2 * quiet) * scale;
  // One filter byte (0 = none) then one grey byte per pixel, per row.
  const raw = new Uint8Array(side * (side + 1));
  const blank = new Uint8Array(side + 1).fill(255);
  blank[0] = 0;
  for (let r = -quiet; r < n + quiet; r++) {
    const row = blank.slice();
    if (r >= 0 && r < n) for (let c = 0; c < n; c++) if (modules.get(r, c)) row.fill(0, 1 + (c + quiet) * scale, 1 + (c + quiet + 1) * scale);
    for (let k = 0; k < scale; k++) raw.set(row, ((r + quiet) * scale + k) * (side + 1));
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, side);
  view.setUint32(4, side);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export { qrPng };
