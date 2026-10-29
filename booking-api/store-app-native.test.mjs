// Stage 11 part 2: what the Store App (native iOS / Android app in app-shell/) reads from a live Guest App:
// GET <app>/api/content, CORS for the two native origins, rewards from the native app, and nothing before approval.
// Run: node --no-warnings --test booking-api/store-app-native.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const engage = await import('./src/producers/guest-app/engage.js');
const native = await import('./src/producers/guest-app/native.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const APP_ID = '11111111-2222-4333-8444-555555555555';
const DATA = {
  app_name: "Joe's Pizza", phone: '(555) 010-2030', address: '12 Main St, Springfield', hours: 'Mon-Fri: 11am-9pm\nSat: noon-10pm',
  menu: '# Pizza\nMargherita | Tomato, basil | $14\nPepperoni - $16\n# Drinks\nSoda | $3', specials: 'Two slices and a soda $9',
  order_url: 'https://order.example/joes', reserve_url: 'javascript:alert(1)', brand_color: '#B3261E',
  loyalty_reward: 'a free slice', loyalty_visits: '3'
};

function setup({ approved = true } = {}) {
  const DB = createD1(); const ASSETS = createR2();
  DB.raw.exec(read('0009_website_package.sql')); DB.raw.exec(read('0012_guest_app.sql')); DB.raw.exec(read('0021_guest_app_engagement.sql'));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('cust', ?, ?, 'joe@joespizza.example')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Joe''s Pizza')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_g', ?, ?, 'GUEST_APP_SETUP', 'Guest App Setup', 'APP', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'GUEST_APP_SETUP_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_g', 'offer_g', 1, ?, ?, 'ACTIVE', 29900, '{}')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o1', ?, ?, 'cust', 'biz', 'DELIVERED', 0, 0, 'PAID')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'offer_g', 'ov_g', 0, 0)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES ('p1', 'o1', 'i1', 'biz', 'cust', 'APP', 'DELIVERED', 'GUEST_APP_SETUP_V1', ?, ?)`, t, t);
  sql(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES (?, 'joes-pizza', 'p1', 'biz', 'cust', ?, ?, ?)`, APP_ID, JSON.stringify(DATA), t, t);
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, metadata_json) VALUES ('a1', 'biz', 'cust', 'p1', 'DELIVERABLE', 'R2', 'apps/joes/build.json', 'build.json', 'application/json', 10, 'x', 'VALID', ?, '{"app":{"slug":"joes-pizza"}}')`, t);
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d1', 'p1', 'a1', 'APP_BUILD', 1, ?, ?, ?, ?)`, approved ? 'FINAL' : 'DRAFT', approved ? 1 : 0, approved ? t : null, t);
  ASSETS.put('apps/joes/build.json', JSON.stringify({ files: { 'index.html': '<h1>Joe</h1>' }, icons: [{ path: 'icons/icon-192.png', storage_key: 'apps/joes/i192.png', mime: 'image/png' }] }));
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret' };
  return { env, DB, sql };
}
const BASE = 'https://menu-made.com/api/site/joes-pizza/app/';
const call = (f, url, init) => worker.fetch(new Request(url, init), f.env, { waitUntil() {} });

test('content: the live app as JSON with only public fields, unsafe links dropped, cached and readable from the native app', async () => {
  const f = setup();
  const res = await call(f, `${BASE}api/content`, { headers: { Origin: 'capacitor://localhost' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'capacitor://localhost');
  assert.match(res.headers.get('Cache-Control'), /max-age=60/);
  const c = await res.json();
  assert.equal(c.name, "Joe's Pizza");
  assert.equal(c.tel, '5550102030');
  assert.match(c.map_url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=12%20Main/);
  assert.equal(c.order_url, 'https://order.example/joes');
  assert.equal(c.reserve_url, '', 'a non-https link is never passed to the app');
  assert.deepEqual(c.menu.map((s) => s.name), ['Pizza', 'Drinks']);
  assert.equal(c.menu[0].items[0].price, '$14');
  assert.deepEqual(c.hours[0], { day: 'Mon-Fri', time: '11am-9pm' });
  assert.equal(c.brand_color, '#b3261e');
  assert.equal(c.icon_url, `${BASE}icons/icon-192.png`);
  assert.deepEqual(c.loyalty, { enabled: true, reward: 'a free slice', goal: 3 });
  for (const field of ['email', 'customer_id', 'business_id', 'loyalty_visits', 'push_specials']) assert.ok(!(field in c), field);
  const web = await call(f, `${BASE}api/content`);
  assert.equal(web.headers.get('Access-Control-Allow-Origin'), '*', 'public content: any origin may read it');
});

test('content is not served before the owner approves the app, or for an unknown app', async () => {
  const f = setup({ approved: false });
  assert.equal((await call(f, `${BASE}api/content`)).status, 404);
  assert.equal((await call(f, 'https://menu-made.com/api/site/nobody/app/api/content')).status, 404);
});

test('preflight: only the two native origins get CORS for POSTs', async () => {
  const f = setup();
  for (const origin of ['capacitor://localhost', 'https://localhost']) {
    const res = await call(f, `${BASE}api/loyalty`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(res.status, 204, origin);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
    assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
  }
  assert.equal((await call(f, `${BASE}api/loyalty`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 404);
});

test('rewards from the native app: card, earn with the counter code, CORS on the answer; other POSTs stay same-origin only', async () => {
  const f = setup();
  const member = 'A'.repeat(32);
  const post = (path, body, origin) => call(f, `${BASE}api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  const me = await post('loyalty', { action: 'me', member }, 'https://localhost');
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('Access-Control-Allow-Origin'), 'https://localhost');
  assert.deepEqual((await me.json()).card, { points: 0, visits: 0, goal: 3, reward: 'a free slice', can_redeem: false });
  assert.equal((await post('loyalty', { action: 'earn', member, code: '000000' }, 'capacitor://localhost')).status, 400, 'a wrong code is refused');
  const code = await engage.counterCode(f.env, APP_ID, engage.windowAt());
  const earn = await post('loyalty', { action: 'earn', member, code }, 'capacitor://localhost');
  assert.equal(earn.status, 200);
  assert.equal((await earn.json()).card.points, 1);
  assert.equal((await post('loyalty', { action: 'earn', member, code }, 'capacitor://localhost')).status, 409, 'one visit per card per code');
  assert.equal((await post('push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: {} }, 'capacitor://localhost')).status, 403, 'web push stays on the web app');
  assert.equal((await post('loyalty', { action: 'me', member }, 'https://evil.example')).status, 403);
});

test('contentOf is pure and leaves out a missing icon', () => {
  const c = native.contentOf({ data: { app_name: 'X', menu: '' }, build: { icons: [] }, updated_at: 't' }, 'https://x.menu-made.com/app/');
  assert.equal(c.icon_url, '');
  assert.deepEqual(c.menu, []);
  assert.equal(c.loyalty.enabled, false);
});
