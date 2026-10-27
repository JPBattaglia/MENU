// Minimal ZIP writer (STORE, no compression) so a month's PNGs and captions can ship as one file. Pure JS, no dependencies.
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// files: [{ name, data: Uint8Array }] -> Uint8Array
function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (bytes) => { chunks.push(bytes); offset += bytes.length; };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, file.data.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    central.push({ name, crc, size: file.data.length, offset });
    push(new Uint8Array(local.buffer)); push(name); push(file.data);
  }
  const centralStart = offset;
  for (const entry of central) {
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint32(16, entry.crc, true);
    header.setUint32(20, entry.size, true);
    header.setUint32(24, entry.size, true);
    header.setUint16(28, entry.name.length, true);
    header.setUint32(42, entry.offset, true);
    push(new Uint8Array(header.buffer)); push(entry.name);
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, offset - centralStart, true);
  end.setUint32(16, centralStart, true);
  push(new Uint8Array(end.buffer));
  const out = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

// Reads back an archive made by createZip (STORE entries only): [{ name, data }]. Used by the self-test to inspect the pack.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not a ZIP file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("Corrupt ZIP directory");
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    if (crc32(data) !== crc) throw new Error(`Checksum mismatch for ${name}`);
    entries.push({ name, data });
    at += 46 + nameLength;
  }
  return entries;
}

export { createZip, crc32, readZip };
