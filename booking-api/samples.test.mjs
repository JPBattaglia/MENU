// Stage 9 part 2: product samples are the newest real self-test outputs, renamed and with private links removed.
// Run: node --no-warnings --test booking-api/samples.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { scrub } = await import('./src/delivery/samples.js');

test('scrub renames test businesses and removes every signed link', () => {
  const out = scrub(`<h1>Social Posts Self-Test Cafe</h1><p>Menu-Made Self-Test</p><a href="https://menu-made.com/api/menu-care/abc?t=eyJr.sig">Change</a><a href="https://menu-made.com/api/delivery/1?x=1&amp;t=tok">Get</a><a href="https://menu-made.com/plans.html">Plans</a> delivered@resend.dev #SocialPostsSelfTestCafe #CafeLife`, ['Social Posts Self-Test Cafe']);
  assert.match(out, /<h1>Sample Cafe<\/h1>/);
  assert.doesNotMatch(out, /Self-Test/);
  assert.doesNotMatch(out, /t=eyJr|t=tok/);
  assert.match(out, /https:\/\/menu-made\.com\/plans\.html/, 'ordinary links stay');
  assert.doesNotMatch(out, /resend\.dev/);
  assert.match(out, /#SampleCafe #CafeLife/);
  assert.doesNotMatch(out, /SelfTest/);
});

test('/api/samples/menu serves the self-test buyer\'s newest menu, never a real customer\'s', async () => {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer', ?, ?, 'ONLINE_MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov', 'offer', 1, ?, ?, 'ACTIVE', 12900, '{}')`, t, t);
  sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('st', ?, ?, 'delivered@resend.dev'), ('real', ?, ?, 'joe@pizza.example')`, t, t, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('b1', ?, ?, 'Menu QR Self-Test Cafe'), ('b2', ?, ?, 'Joe''s Pizza')`, t, t, t, t);
  for (const [id, cust, biz, key, when] of [['p1', 'st', 'b1', 'k/test.html', '2026-10-02T00:00:00Z'], ['p2', 'real', 'b2', 'k/real.html', '2026-10-03T00:00:00Z']]) {
    sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES (?, ?, ?, ?, ?, 'DELIVERED', 0, 0, 'PAID')`, `o${id}`, t, t, cust, biz);
    sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES (?, ?, 'offer', 'ov', 0, 0)`, `i${id}`, `o${id}`);
    sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'MENU', 'DELIVERED', 'MENU_QR_V1', ?, ?)`, id, `o${id}`, `i${id}`, biz, cust, t, t);
    sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES (?, ?, ?, ?, 'DELIVERABLE', ?, 'm.html', 'text/html', 1, 'VALID', ?)`, `a${id}`, biz, cust, id, key, t);
    sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES (?, ?, ?, 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`, `d${id}`, id, `a${id}`, when, t);
  }
  await ASSETS.put('k/test.html', '<html><body><h1>Menu QR Self-Test Cafe</h1><p>Tomato soup $7</p></body></html>');
  await ASSETS.put('k/real.html', '<html><body><h1>Joe\'s Pizza</h1></body></html>');
  const env = { DB, ASSETS };
  const res = await worker.fetch(new Request('https://menu-made.com/api/samples/menu'), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  assert.match(res.headers.get('Content-Security-Policy'), /sandbox/);
  const html = await res.text();
  assert.match(html, /Sample Cafe/);
  assert.match(html, /fictional business/);
  assert.doesNotMatch(html, /Joe/);
  assert.equal((await worker.fetch(new Request('https://menu-made.com/api/samples/google'), env, {})).status, 404);
  assert.equal((await worker.fetch(new Request('https://menu-made.com/api/samples/social'), env, {})).status, 404, 'missing samples answer 404, not an error');
});
