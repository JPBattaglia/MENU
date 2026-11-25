// Word menus (owner, Nov 25, 2026): a .docx is read as text for the menu reader and its saved page count is billed.
// Run: node --no-warnings --test booking-api/docx.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createR2 } from './test-support/d1.mjs';

const { DOCX_MIME, isDocx, readDocx } = await import('./src/lib/docx.js');
const { menuFileBlock, MENU_FILE_TYPES } = await import('./src/producers/menu-qr/claude-reader.js');
const { countMenuPages } = await import('./src/producers/menu-qr/page-billing.js');

// A minimal zip writer: stored or deflated parts, the way Word saves them.
async function deflateRaw(bytes) {
  const out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  return out;
}
async function zip(files) {
  const enc = new TextEncoder();
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text, deflate] of files) {
    const nameBytes = enc.encode(name); const raw = enc.encode(text);
    const data = deflate ? await deflateRaw(raw) : raw;
    const local = new Uint8Array(30 + nameBytes.length + data.length); const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, deflate ? 8 : 0, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length); const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, deflate ? 8 : 0, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true); central.set(nameBytes, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...locals, ...centrals, end]; const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
const para = (...runs) => `<w:p>${runs.join('')}</w:p>`;
const run = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const DOC = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${para(run('Christmas Eve Dinner'))}${para(run('Prime Rib'), '<w:r><w:tab/></w:r>', run('$48'))}`
  + `${para(run('Fish &amp; Chips &lt;GF&gt;'))}<w:tbl><w:tr><w:tc>${para(run('Eggnog'))}</w:tc><w:tc>${para(run('$9'))}</w:tc></w:tr></w:tbl></w:body></w:document>`;
const APP = `<?xml version="1.0"?><Properties><Pages>2</Pages><Words>12</Words></Properties>`;

test('a Word file is read as text: paragraphs, tabs, table cells and entities, with the saved page count', async () => {
  const bytes = await zip([['[Content_Types].xml', '<Types/>', false], ['word/document.xml', DOC, true], ['docProps/app.xml', APP, false]]);
  assert.equal(isDocx(bytes), true);
  const { text, pages } = await readDocx(bytes);
  assert.equal(pages, 2);
  assert.match(text, /^Christmas Eve Dinner\nPrime Rib\t\$48\nFish & Chips <GF>\n/);
  assert.match(text, /Eggnog \| \$9/);
  const block = await menuFileBlock(bytes, DOCX_MIME);
  assert.equal(block.type, 'text');
  assert.match(block.text, /^MENU TEXT \(from a Word document/);
  assert.ok(MENU_FILE_TYPES.has(DOCX_MIME) && MENU_FILE_TYPES.has('application/pdf'));
});

test('a Word file without a saved page count, a non-Word zip and a PDF', async () => {
  const noPages = await zip([['word/document.xml', DOC, true]]);
  assert.equal((await readDocx(noPages)).pages, null);
  const notWord = await zip([['hello.txt', 'hi', false]]);
  assert.equal(isDocx(notWord), false);
  await assert.rejects(readDocx(notWord), /not a Word/);
  await assert.rejects(menuFileBlock(await zip([['word/document.xml', '<w:document/>', false]]), DOCX_MIME), /no text/);
  const pdf = await menuFileBlock(new TextEncoder().encode('%PDF-1.4'), 'application/pdf');
  assert.equal(pdf.type, 'document');
});

test('per-page billing counts a Word menu by the pages Word saved', async () => {
  const env = { ASSETS: createR2() };
  await env.ASSETS.put('menus/a.docx', await zip([['word/document.xml', DOC, true], ['docProps/app.xml', APP, false]]));
  await env.ASSETS.put('menus/b.docx', await zip([['word/document.xml', DOC, true]]));
  const inputs = (key) => ({ menu_file: { type: 'FILE', asset: { mime_type: DOCX_MIME, storage_key: key } } });
  assert.deepEqual(await countMenuPages(inputs('menus/a.docx'), env), { pages: 2, method: 'docx' });
  assert.deepEqual(await countMenuPages(inputs('menus/b.docx'), env), { pages: null, method: 'docx_unreadable' });
});
