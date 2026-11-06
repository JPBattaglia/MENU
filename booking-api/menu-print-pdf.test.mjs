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
  assert.ok(h.ASSETS.objects.has('k/menu-v1.html.print-v1.pdf'), 'kept next to the page it was drawn from');

  // A Menu Care update is a new menu version: the PDF follows it.
  h.sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES ('a2', 'biz', 'cust', ?, 'DELIVERABLE', 'k/menu-v2.html', 'menu.html', 'text/html', 1, 'VALID', ?)`, PROJECT, h.t);
  h.sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d2', ?, 'a2', 'MENU_DRAFT', 2, 'FINAL', 1, ?, ?)`, PROJECT, new Date(Date.now() + 1000).toISOString(), h.t);
  await h.ASSETS.put('k/menu-v2.html', designed({ sections: Array.from({ length: 12 }, (_, i) => section(`Section ${i + 1}`, 14)), notes: '' }));
  const updated = new Uint8Array(await (await h.call('/api/menu/proof-cafe-22222222/print.pdf')).arrayBuffer());
  assert.ok(await pagesOf(updated) > 1, 'the new, longer menu');
  assert.ok(h.ASSETS.objects.has('k/menu-v2.html.print-v1.pdf'));
});

test('print PDF: unknown menus are not found, and a page that is not in the designed format gets a friendly note', async () => {
  const h = setup({ html: '<html><body><h1>Proof Cafe</h1><p>Margherita $15</p></body></html>' });
  assert.equal((await h.call('/api/menu/nobody-here/print.pdf')).status, 404);
  const res = await h.call('/api/menu/proof-cafe-22222222/print.pdf');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /Print version not available/);
});
