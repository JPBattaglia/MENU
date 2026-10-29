// Stage 9 part 2: Online Menu + QR hosting moves to Menu Care after the first year. Reminders 30 and 7 days before
// the year ends; the email's link starts a Menu Care checkout bound to the business that owns the menu, so the
// subscription edits and serves that same menu (same address, same QR).
// Run: node --no-warnings --test booking-api/menu-hosting-renewal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { remindMenuHostingRenewals } = await import('./src/producers/menu-qr/hosting-renewal.js');
const catalog = JSON.parse(readFileSync(new URL('./subscription-catalog.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('./migrations/0001_subscription_catalog.sql', import.meta.url), 'utf8');
const DAY = 86400000;
const PROJECT = '11111111-1111-4111-8111-111111111111';

function setup({ deliveredDaysAgo = 340, environment = 'live' } = {}) {
  const DB = createD1();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2025-09-01T00:00:00.000Z';
  for (const [code, slug, price, wf] of [['ONLINE_MENU_QR', 'online-menu-qr', 12900, 'MENU_QR_V1'], ['GOOGLE_VISIBILITY', 'google-visibility', 14900, 'GOOGLE_VISIBILITY_V1'], ['CONVERSION_FIX', 'conversion-fix', 29900, 'CONVERSION_FIX_V1']]) {
    sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, sort_order, is_public, is_featured, cta_text)
         VALUES (?, ?, ?, ?, ?, 'OTHER', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 0, 0, ?, ?, 1, 1, 0, 'Get Started')`, `offer_${code.toLowerCase()}`, t, t, code, code, wf, slug);
    sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, scope_json, stripe_price_id)
         VALUES (?, ?, 1, ?, ?, 'ACTIVE', ?, 'USD', '{}', ?)`, `offerv1_${code.toLowerCase()}`, `offer_${code.toLowerCase()}`, t, t, price, catalog.one_time[code].price);
  }
  DB.raw.exec(migration);
  DB.raw.exec(readFileSync(new URL('./migrations/0018_menu_hosting_index.sql', import.meta.url), 'utf8'));
  sql(`UPDATE offers SET is_public = 1`);
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'pat@proofcafe.example', 'Pat', 'Lee')`, t, t);
  // Two businesses share the name: the renewal must land on the one that owns the menu (the later one).
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('other', '2025-01-01T00:00:00.000Z', ?, 'Proof Cafe'), ('biz', ?, ?, 'Proof Cafe')`, t, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('order', ?, ?, 'cust', 'biz', 'DELIVERED', 14400, 14400, 'PAID')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json) VALUES ('item', 'order', 'offer_online_menu_qr', 'offerv1_online_menu_qr', 14400, 14400, ?)`, JSON.stringify({ offer_code: 'ONLINE_MENU_QR', environment }));
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES (?, 'order', 'item', 'biz', 'cust', 'MENU', 'DELIVERED', 'MENU_QR_V1', ?, ?)`, PROJECT, t, t);
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES ('a1', 'biz', 'cust', ?, 'DELIVERABLE', 'k/menu.html', 'menu.html', 'text/html', 1, 'VALID', ?)`, PROJECT, t);
  const delivered = new Date(Date.now() - deliveredDaysAgo * DAY).toISOString();
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d1', ?, 'a1', 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?), ('d2', ?, 'a1', 'MENU_DRAFT', 2, 'FINAL', 1, ?, ?)`,
    PROJECT, delivered, t, PROJECT, new Date(Date.now() - 100 * DAY).toISOString(), t);

  const stripe = { sessions: [] };
  const emails = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'api.resend.com') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (u.hostname === 'api.stripe.com' && (init.method || 'GET') === 'POST' && u.pathname === '/v1/checkout/sessions') {
      const id = `cs_${stripe.sessions.length + 1}`;
      stripe.sessions.push({ id, key: init.headers.Authorization, params: new URLSearchParams(init.body) });
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    throw new Error(`Unexpected fetch ${init.method || 'GET'} ${url}`);
  };
  const env = { DB, ASSETS: createR2(), PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_SECRET_KEY_TEST: 'sk_test_x' };
  const call = (path, init) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, { waitUntil() {} });
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const linkIn = (email) => /https:\/\/menu-made\.com(\/api\/menu-hosting\/[^\s"]+)/.exec(email.text)[1];
  return { env, call, row, sql, emails, stripe, linkIn, restore: () => { globalThis.fetch = realFetch; } };
}

test('reminders go out 30 and 7 days before the first year ends, once each, and stop when Menu Care is added', async () => {
  const h = setup({ deliveredDaysAgo: 330 });
  try {
    assert.equal((await remindMenuHostingRenewals(h.env)).sent, 0, '35 days left: not yet');
    const at = (daysAgo) => h.sql(`UPDATE deliverables SET delivered_at = ? WHERE id = 'd1'`, new Date(Date.now() - daysAgo * DAY).toISOString());
    at(340);
    const first = await remindMenuHostingRenewals(h.env);
    assert.equal(first.sent, 1, JSON.stringify(first));
    const email = h.emails[0];
    assert.deepEqual([email.to].flat(), ['pat@proofcafe.example']);
    assert.match(email.text, /first year of hosting/);
    assert.match(email.text, /same address and QR code/);
    assert.match(email.text, /\$29\/month or \$290\/year/);
    assert.match(email.text, /https:\/\/menu-made\.com\/api\/menu\/proof-cafe-11111111/, 'shows the menu address they already have');
    assert.equal((await remindMenuHostingRenewals(h.env)).sent, 0, 'the 30-day reminder goes once');
    at(360);
    assert.equal((await remindMenuHostingRenewals(h.env)).sent, 1, 'the 7-day reminder');
    assert.match(h.emails[1].subject, /first year ends/);
    assert.equal((await remindMenuHostingRenewals(h.env)).sent, 0);
    h.sql(`DELETE FROM communications`);
    h.sql(`INSERT INTO entitlements (id, customer_id, business_id, order_item_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('e', 'cust', 'biz', 'item', 'MENU_CARE', 'ACTIVE', ?, ?, ?)`, '2026-01-01', '2026-01-01', '2026-01-01');
    const covered = await remindMenuHostingRenewals(h.env);
    assert.equal(covered.sent, 0);
    assert.equal(covered.skipped[0].reason, 'has Menu Care');
    at(370);
    h.sql(`DELETE FROM entitlements`);
    assert.equal((await remindMenuHostingRenewals(h.env)).sent, 0, 'not after the year has ended');
  } finally { h.restore(); }
});

test('sandbox Menu + QR orders get no reminder from the daily pass', async () => {
  const h = setup({ deliveredDaysAgo: 340, environment: 'sandbox' });
  try {
    const result = await remindMenuHostingRenewals(h.env);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped[0].reason, 'sandbox');
  } finally { h.restore(); }
});

test('the link: GET offers monthly or yearly without opening Stripe; POST opens a Menu Care checkout for the business that owns the menu', async () => {
  const h = setup({ deliveredDaysAgo: 340 });
  try {
    await remindMenuHostingRenewals(h.env);
    const path = h.linkIn(h.emails[0]);
    const page = await h.call(path);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /\$29 a month/);
    assert.match(html, /\$290 a year/);
    assert.equal(h.stripe.sessions.length, 0);
    const token = new URL('https://menu-made.com' + path).searchParams.get('t');
    const post = await h.call(path.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token, interval: 'year' }) });
    assert.equal(post.status, 303);
    assert.equal(post.headers.get('Location'), 'https://checkout.stripe.com/c/pay/cs_1');
    const session = h.stripe.sessions[0];
    assert.equal(session.key, 'Bearer sk_live_x', 'a live menu renews on the live account');
    assert.equal(session.params.get('mode'), 'subscription');
    assert.equal(session.params.get('subscription_data[metadata][plan_code]'), 'MENU_CARE');
    assert.equal(session.params.get('line_items[0][price]'), catalog.subscriptions.MENU_CARE.annual.price);
    const order = h.row(`SELECT * FROM orders WHERE id = ?`, session.params.get('metadata[order_id]'));
    assert.equal(order.business_id, 'biz', 'bound to the business that owns the menu, not the older one with the same name');
    assert.equal(order.customer_id, 'cust');
    assert.match(order.notes, /Online Menu \+ QR project/);
    const forged = await h.call(path.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token.slice(0, -2) + 'xx', interval: 'month' }) });
    assert.equal(forged.status, 404);
  } finally { h.restore(); }
});

test('a business that already has Menu Care is told it is covered instead of being sold it twice', async () => {
  const h = setup({ deliveredDaysAgo: 340 });
  try {
    await remindMenuHostingRenewals(h.env);
    const path = h.linkIn(h.emails[0]);
    h.sql(`INSERT INTO entitlements (id, customer_id, business_id, order_item_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('e', 'cust', 'biz', 'item', 'MENU_CARE', 'ACTIVE', ?, ?, ?)`, '2026-01-01', '2026-01-01', '2026-01-01');
    const token = new URL('https://menu-made.com' + path).searchParams.get('t');
    const post = await h.call(path.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token, interval: 'month' }) });
    assert.match(await post.text(), /already has Menu Care/);
    assert.equal(h.stripe.sessions.length, 0);
  } finally { h.restore(); }
});

test('the MENU_HOSTING_RENEWAL self-test passes against the real schema and cleans up after itself', async () => {
  const h = setup({ deliveredDaysAgo: 10 });
  const { advanceMenuHostingSelfTests } = await import('./src/selftest/menu-hosting-selftest.js');
  const realFetch = globalThis.fetch;
  const sessions = new Map();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    if (u.hostname === 'api.stripe.com' && method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      const params = new URLSearchParams(init.body);
      const id = `cs_test_${sessions.size + 1}`;
      sessions.set(id, { id, mode: params.get('mode'), metadata: { order_id: params.get('metadata[order_id]') }, amount_total: Number(params.get('line_items[0][price_data][unit_amount]')), status: 'open' });
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    let m;
    if (u.hostname === 'api.stripe.com' && (m = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(u.pathname))) {
      const s = sessions.get(m[1]); if (m[2]) s.status = 'expired';
      return Response.json(s);
    }
    return inner(url, init);
  };
  try {
    h.sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('selftest', '2026-01-01', '2026-01-01', 'delivered@resend.dev')`);
    h.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('st1', 'MENU_HOSTING_RENEWAL', 'REQUESTED', 'test', '2026-01-01', '2026-01-01')`);
    const [result] = await advanceMenuHostingSelfTests(h.env);
    const row = h.row(`SELECT * FROM self_tests WHERE id = 'st1'`);
    assert.equal(result.status, 'PASSED', row.error);
    assert.match(row.log_json, /Menu Care, \$29\/month/);
    const project = h.row(`SELECT p.status, d.customer_visible FROM projects p JOIN deliverables d ON d.project_id = p.id WHERE p.id = ?`, row.project_id);
    assert.deepEqual(project, { status: 'CANCELLED', customer_visible: 0 });
    assert.equal(h.row(`SELECT status FROM orders WHERE id = ?`, row.order_id).status, 'CANCELLED');
    assert.ok([...sessions.values()].every((s) => s.status === 'expired'));
  } finally { globalThis.fetch = realFetch; h.restore(); }
});
