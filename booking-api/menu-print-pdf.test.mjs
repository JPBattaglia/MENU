// Print-ready menu PDF (owner, Nov 5, 2026): every hosted Online Menu + QR menu has /api/menu/<slug>/print.pdf,
// drawn from the live page with a QR code back to it, kept current by Menu Care, and linked from the delivery email.
// Run: node --no-warnings --test booking-api/menu-print-pdf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { buildPrintMenuPdf } = await import('./src/producers/menu-qr/print-pdf.js');
const { buildDesignedMenuHtml } = await import('./src/producers/menu-qr/design.js');

const PROJECT = '22222222-2222-4222-8222-222222222222';
const HOSTED = 'https://menu-made.com/api/menu/proof-cafe-22222222';
const qr = { size: 21, get: (r, c) => (r + c) % 2 === 0 };
const section = (name, count, withDesc = true) => ({
  name,
  items: Array.from({ length: count }, (_, i) => ({
    name: `${name} item ${i + 1}`,
    description: withDesc ? 'Tomato, basil, mozzarella and olive oil, finished with sea salt' : '',
    price: `$${(9 + i).toFixed(2)}`
  }))
});
const pagesOf = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();

test('a short menu fits on one letter page; a long one flows onto more pages instead of shrinking the type', async () => {
  const short = await buildPrintMenuPdf({ businessName: "Nino's Café", primary: '#7a1f2b', accent: '#b8902b', menu: { sections: [section('Coffee', 6), section('Pastries', 4, false)], notes: 'Ask about gluten-free options.' }, qrModules: qr, qrUrl: HOSTED });
  assert.equal(Buffer.from(short.slice(0, 5)).toString(), '%PDF-');
  const doc = await PDFDocument.load(short);
  assert.equal(doc.getPageCount(), 1);
  assert.deepEqual(doc.getPage(0).getSize(), { width: 612, height: 792 });
  assert.match(doc.getTitle(), /Nino's Café/);

  const long = await buildPrintMenuPdf({ businessName: 'Big Diner', menu: { sections: Array.from({ length: 12 }, (_, i) => section(`Section ${i + 1}`, 14)) }, qrModules: qr, qrUrl: HOSTED });
  assert.ok(await pagesOf(long) > 1);
});

test('text the standard fonts cannot show: a few odd characters are tolerated, a menu in another script is refused', async () => {
  const mostlyLatin = await buildPrintMenuPdf({ businessName: 'Café ☕ Ünïcode', menu: { sections: [{ name: 'Drinks', items: [{ name: 'Crème brûlée latte 🍮', price: '€5' }, { name: 'Matcha', description: 'Ceremonial grade − whisked', price: '$6' }] }] }, qrModules: null, qrUrl: '' });
  assert.ok(mostlyLatin, 'accents, euro sign and emoji are fine');
  const chinese = await buildPrintMenuPdf({ businessName: '麵屋', menu: { sections: [{ name: '拉麵', items: [{ name: '豚骨拉麵', price: '$15' }] }] }, qrModules: null, qrUrl: '' });
  assert.equal(chinese, null);
  assert.equal(await buildPrintMenuPdf({ businessName: 'Empty', menu: { sections: [] } }), null);
});

function setup({ html }) {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = new Date().toISOString();
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'pat@proofcafe.example', 'Pat', 'Lee')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Proof Cafe')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('order', ?, ?, 'cust', 'biz', 'DELIVERED', 14400, 14400, 'PAID')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer', ?, ?, 'ONLINE_MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov', 'offer', 1, ?, ?, 'ACTIVE', 14400, '{}')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('item', 'order', 'offer', 'ov', 14400, 14400)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES (?, 'order', 'item', 'biz', 'cust', 'MENU', 'DELIVERED', 'MENU_QR_V1', ?, ?)`, PROJECT, t, t);
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES ('a1', 'biz', 'cust', ?, 'DELIVERABLE', 'k/menu-v1.html', 'menu.html', 'text/html', 1, 'VALID', ?)`, PROJECT, t);
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d1', ?, 'a1', 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`, PROJECT, t, t);
  sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, value_text, required, status, created_at, updated_at) VALUES ('in-qr', ?, 'qr_destination', 'URL', ?, 1, 'VALID', ?, ?)`, PROJECT, HOSTED, t, t);
  ASSETS.put('k/menu-v1.html', html);
  const env = { DB, ASSETS };
  const call = (path) => worker.fetch(new Request(`https://menu-made.com${path}`), env, { waitUntil() {} });
  return { env, sql, call, ASSETS, t };
}

const designed = (menu) => buildDesignedMenuHtml({ businessName: 'Proof Cafe', brandColors: '#071f2c, #00d6e6', menu, logoDataUri: null });

test('the hosted menu has a print PDF at /print.pdf, drawn once per menu version and redrawn after an update', async () => {
  const h = setup({ html: designed({ sections: [section('Pizza', 5)], notes: '' }) });
  const res = await h.call('/api/menu/proof-cafe-22222222/print.pdf');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /proof-cafe-22222222-menu\.pdf/);
  const first = new Uint8Array(await res.arrayBuffer());
  assert.equal(await pagesOf(first), 1);
  assert.ok(h.ASSETS.objects.has('k/menu-v1.html.print-v3.pdf'), 'kept next to the page it was drawn from');

  // A Menu Care update is a new menu version: the PDF follows it.
  h.sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES ('a2', 'biz', 'cust', ?, 'DELIVERABLE', 'k/menu-v2.html', 'menu.html', 'text/html', 1, 'VALID', ?)`, PROJECT, h.t);
  h.sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d2', ?, 'a2', 'MENU_DRAFT', 2, 'FINAL', 1, ?, ?)`, PROJECT, new Date(Date.now() + 1000).toISOString(), h.t);
  await h.ASSETS.put('k/menu-v2.html', designed({ sections: Array.from({ length: 12 }, (_, i) => section(`Section ${i + 1}`, 14)), notes: '' }));
  const updated = new Uint8Array(await (await h.call('/api/menu/proof-cafe-22222222/print.pdf')).arrayBuffer());
  assert.ok(await pagesOf(updated) > 1, 'the new, longer menu');
  assert.ok(h.ASSETS.objects.has('k/menu-v2.html.print-v3.pdf'));
});

test('print PDF: unknown menus are not found, and a page that is not in the designed format gets a friendly note', async () => {
  const h = setup({ html: '<html><body><h1>Proof Cafe</h1><p>Margherita $15</p></body></html>' });
  assert.equal((await h.call('/api/menu/nobody-here/print.pdf')).status, 404);
  const res = await h.call('/api/menu/proof-cafe-22222222/print.pdf');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /Print version not available/);
});

// ---- Diet marks, tri-fold, table tent and TV screen (owner, Nov 5, 2026) ----
const { splitMarks, markItems } = await import('./src/producers/menu-qr/dietary.js');
const { buildTriFoldPdf, buildTableTentPdf } = await import('./src/producers/menu-qr/print-pdf.js');
const { buildTvMenuHtml } = await import('./src/producers/menu-qr/tv-menu.js');

test('diet marks are read only from brackets the menu already uses; other brackets stay as text', () => {
  assert.deepEqual(splitMarks('Garden Salad (V, GF)'), { text: 'Garden Salad', marks: ['V', 'GF'] });
  assert.deepEqual(splitMarks('Sorbetto [vegan]'), { text: 'Sorbetto', marks: ['VG'] });
  assert.deepEqual(splitMarks('Diavola (spicy)'), { text: 'Diavola', marks: ['HOT'] });
  assert.deepEqual(splitMarks('Wings (6 pieces)'), { text: 'Wings (6 pieces)', marks: [] });
  assert.deepEqual(splitMarks('Burger (add bacon)'), { text: 'Burger (add bacon)', marks: [] });
  assert.deepEqual(splitMarks('Pad Thai, peanuts'), { text: 'Pad Thai, peanuts', marks: [] }, 'nothing guessed from ingredients');
  const { menu, used } = markItems({ sections: [{ name: 'Mains', items: [{ name: 'Tofu Bowl (VG)', description: 'Rice, greens (GF)', price: '$14' }, { name: 'Steak', price: '$30' }] }] });
  assert.deepEqual(menu.sections[0].items[0], { name: 'Tofu Bowl', description: 'Rice, greens', price: '$14', marks: ['VG', 'GF'] });
  assert.deepEqual(menu.sections[0].items[1].marks, []);
  assert.deepEqual(used, ['VG', 'GF']);
});

test('tri-fold: two landscape sides; too long for the inside and flap, it is refused rather than shrunk', async () => {
  const fold = await buildTriFoldPdf({ businessName: 'Proof Cafe', primary: '#1f4e3d', menu: { sections: [section('Pizza (V)', 6), section('Drinks', 5, false)], notes: 'Ask about allergies.' }, qrModules: qr, qrUrl: HOSTED });
  const doc = await PDFDocument.load(fold);
  assert.equal(doc.getPageCount(), 2);
  assert.deepEqual(doc.getPage(0).getSize(), { width: 792, height: 612 });
  const huge = await buildTriFoldPdf({ businessName: 'Big Diner', menu: { sections: Array.from({ length: 12 }, (_, i) => section(`Section ${i + 1}`, 14)) }, qrModules: qr, qrUrl: HOSTED });
  assert.equal(huge, null);
});

test('table tent: one letter page with the QR code; needs a QR code', async () => {
  const tent = await buildTableTentPdf({ businessName: 'Proof Cafe', primary: '#1f4e3d', menu: { sections: [] }, qrModules: qr, qrUrl: HOSTED });
  assert.equal(await pagesOf(tent), 1);
  assert.equal(await buildTableTentPdf({ businessName: 'Proof Cafe', menu: { sections: [] }, qrModules: null, qrUrl: '' }), null);
});

test('TV screen: one screen when it fits, otherwise even screens; marks shown with a key', () => {
  const one = buildTvMenuHtml({ businessName: 'Proof Cafe', primary: '#1f4e3d', menu: { sections: [{ name: 'Pizza', items: [{ name: 'Margherita (V)', price: '$18' }, { name: 'Diavola (spicy)', price: '$21' }] }] } });
  assert.equal(one.pages, 1);
  assert.match(one.html, /<span class="mk" title="Vegetarian">V<\/span>/);
  assert.match(one.html, /class="mk hot"/);
  assert.match(one.html, /Vegetarian<\/span>/);
  assert.doesNotMatch(one.html, /<script/i);
  const big = { sections: Array.from({ length: 8 }, (_, i) => section(`Section ${i + 1}`, 12)) };
  const first = buildTvMenuHtml({ businessName: 'Big', menu: big, page: 1 });
  assert.ok(first.pages > 1);
  const counts = Array.from({ length: first.pages }, (_, i) => (buildTvMenuHtml({ businessName: 'Big', menu: big, page: i + 1 }).html.match(/class="it"/g) || []).length);
  assert.equal(counts.reduce((a, b) => a + b, 0), 96, 'every item on some screen');
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 6, `screens are even: ${counts}`);
});

test('routes: tri-fold and table tent PDFs, and the TV screen with a refresh so updates appear by themselves', async () => {
  const h = setup({ html: designed({ sections: [section('Pizza', 5)], notes: '' }) });
  for (const [path, name] of [['tri-fold.pdf', 'tri-fold-menu'], ['table-tent.pdf', 'table-tent']]) {
    const res = await h.call(`/api/menu/proof-cafe-22222222/${path}`);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), new RegExp(`proof-cafe-22222222-${name}\\.pdf`));
  }
  const tv = await h.call('/api/menu/proof-cafe-22222222/tv');
  assert.equal(tv.status, 200);
  assert.match(tv.headers.get('refresh'), /^300; url=https:\/\/menu-made\.com\/api\/menu\/proof-cafe-22222222\/tv$/);
  assert.match(tv.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(await tv.text(), /Pizza item 1/);
  assert.equal((await h.call('/api/menu/proof-cafe-22222222/menu.docx')).status, 404);
});

test('the other formats follow the online menu: its design colours, and a hidden name stays hidden next to a logo', async () => {
  const { designStyle } = await import('./src/producers/menu-qr/menu-designs.js');
  const menu = { sections: [section('Pizza', 4), { name: 'A very long section name that needs two lines', items: [{ name: 'Tiramisu', price: '$9' }] }], notes: 'Ask about allergies.' };
  const style = designStyle('winterlights', menu);
  const logoDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const tv = buildTvMenuHtml({ businessName: 'Proof Cafe', menu, style, logoDataUri, hideName: true });
  assert.match(tv.html, new RegExp(`background-color: ${style.paper}`, 'i'), 'the design paper colour');
  assert.doesNotMatch(tv.html, /<h1>/, 'no name beside the logo');
  assert.match(buildTvMenuHtml({ businessName: 'Proof Cafe', menu, style, hideName: true }).html, /<h1>Proof Cafe<\/h1>/, 'without a logo the name stays');
  assert.doesNotMatch(buildTvMenuHtml({ businessName: 'Proof Cafe', menu }).html, /background-color: #/, 'no stored design: the screen as before');
  const input = { businessName: 'Proof Cafe', menu, style, logoDataUri, hideName: true, qrModules: qr, qrUrl: HOSTED };
  assert.equal(await pagesOf(await buildPrintMenuPdf(input)), 1);
  assert.equal(await pagesOf(await buildTriFoldPdf(input)), 2);
  assert.equal(await pagesOf(await buildTableTentPdf(input)), 1);
});

// ---- PDFs printed by a browser from the menu page (owner, Nov 12, 2026) ----
const { buildPrintHtml } = await import('./src/producers/menu-qr/print-html.js');
const { renderMenuPdf } = await import('./src/producers/menu-qr/browser-pdf.js');
const fakePdf = () => { const b = new Uint8Array(2000); b.set([0x25, 0x50, 0x44, 0x46]); return b; };
const browserThat = (answer) => { const calls = []; return { calls, quickAction: async (action, options) => { calls.push({ action, options }); return answer(); } }; };

test('print layouts are the menu page itself: its stylesheet, header and dishes, laid out for paper', async () => {
  const { designStyle } = await import('./src/producers/menu-qr/menu-designs.js');
  const menu = { sections: [section('Pizza', 3), section('Drinks', 2, false)], notes: 'Ask about allergies.' };
  const pageHtml = buildDesignedMenuHtml({ businessName: 'Proof Cafe', menu, style: designStyle('winterlights', menu), logoDataUri: null });
  const qrSvg = '<svg viewBox="0 0 9 9"><path d="M1 1h1v1h-1z"/></svg>';
  for (const format of ['print.pdf', 'tri-fold.pdf', 'table-tent.pdf']) {
    const html = buildPrintHtml(format, { pageHtml, qrSvg, qrUrl: HOSTED });
    assert.match(html, /The customer's own menu style/, `${format}: the design's own stylesheet`);
    assert.match(html, /<h1>Proof Cafe<\/h1>/, `${format}: the page header`);
    assert.match(html, /proof-cafe-22222222/, `${format}: where the code leads`);
    assert.doesNotMatch(html, /<nav class="jump"/, `${format}: no section links on paper`);
  }
  const fold = buildPrintHtml('tri-fold.pdf', { pageHtml, qrSvg, qrUrl: HOSTED });
  assert.match(fold, /Pizza item 3/);
  assert.match(fold, /class="panel flap"><p>Ask about allergies\.<\/p>/, 'notes on the flap');
  assert.match(buildPrintHtml('print.pdf', { pageHtml, qrSvg, qrUrl: HOSTED }), /Drinks item 2/);
  assert.equal(buildPrintHtml('table-tent.pdf', { pageHtml, qrSvg: '', qrUrl: HOSTED }), null, 'a table tent needs its code');
  assert.equal(buildPrintHtml('print.pdf', { pageHtml: '<html><body><h1>Proof Cafe</h1></body></html>', qrSvg, qrUrl: HOSTED }), null, 'not a designed menu page');
});

test('the browser step returns a PDF or nothing: no binding, an error, a refusal or a non-PDF answer all fall back', async () => {
  const pageHtml = designed({ sections: [section('Pizza', 3)], notes: '' });
  const input = { pageHtml, qrSvg: '<svg></svg>', qrUrl: HOSTED };
  assert.equal(await renderMenuPdf({}, 'print.pdf', input), null);
  const good = browserThat(() => new Response(fakePdf(), { status: 200 }));
  const bytes = await renderMenuPdf({ BROWSER: good }, 'print.pdf', input);
  assert.equal(bytes.length, 2000);
  assert.equal(good.calls[0].action, 'pdf');
  assert.equal(good.calls[0].options.pdfOptions.printBackground, true);
  assert.equal(good.calls[0].options.pdfOptions.preferCSSPageSize, true);
  assert.match(good.calls[0].options.html, /Pizza item 1/);
  assert.equal(await renderMenuPdf({ BROWSER: browserThat(() => { throw new Error('limit'); }) }, 'print.pdf', input), null);
  assert.equal(await renderMenuPdf({ BROWSER: browserThat(() => new Response('busy', { status: 429 })) }, 'print.pdf', input), null);
  assert.equal(await renderMenuPdf({ BROWSER: browserThat(() => new Response('{"errors":[]}', { status: 200 })) }, 'print.pdf', input), null);
});

test('routes: the browser-made PDF is served and kept; when the browser fails the drawn PDF is served instead', async () => {
  const h = setup({ html: designed({ sections: [section('Pizza', 5)], notes: '' }) });
  h.env.BROWSER = browserThat(() => new Response(fakePdf(), { status: 200 }));
  const res = await h.call('/api/menu/proof-cafe-22222222/print.pdf');
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(new Uint8Array(await res.arrayBuffer()).length, 2000, 'the browser-made file');
  assert.ok(h.ASSETS.objects.has('k/menu-v1.html.print-v3x.pdf'));
  await h.call('/api/menu/proof-cafe-22222222/print.pdf');
  assert.equal(h.env.BROWSER.calls.length, 1, 'made once per menu version');
  const fold = await h.call('/api/menu/proof-cafe-22222222/tri-fold.pdf');
  assert.equal(new Uint8Array(await fold.arrayBuffer()).length, 2000);

  const down = setup({ html: designed({ sections: [section('Pizza', 5)], notes: '' }) });
  down.env.BROWSER = browserThat(() => { throw new Error('unavailable'); });
  const drawn = new Uint8Array(await (await down.call('/api/menu/proof-cafe-22222222/print.pdf')).arrayBuffer());
  assert.equal(await pagesOf(drawn), 1, 'a real, drawn PDF');
  assert.ok(down.ASSETS.objects.has('k/menu-v1.html.print-v3.pdf'));
  assert.ok(!down.ASSETS.objects.has('k/menu-v1.html.print-v3x.pdf'));
});
