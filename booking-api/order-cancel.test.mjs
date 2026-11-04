// Cancel for a full refund before work starts (Nov 4, 2026). Run: node --no-warnings --test booking-api/order-cancel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { cancelLink, loadOrder, refundEligibility } = await import('./src/account/cancel.js');

const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function setup(t, { code = 'NINO_LOGO', billing = 'ONE_TIME', fulfillment = 'DIGITAL', category = 'DESIGN', status = 'AWAITING_INPUTS', placedDaysAgo = 1, delivered = false } = {}) {
  const DB = createD1();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const now = new Date().toISOString();
  const placed = new Date(Date.now() - placedDaysAgo * 864e5).toISOString();
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name) VALUES ('cust', ?, ?, 'joe@cafe.example', 'Joe')`, now, now);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Cafe')`, now, now);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('of', ?, ?, ?, 'The Service', ?, 'ACTIVE', ?, ?, 1, 'WF')`, now, now, code, category, billing, fulfillment);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov', 'of', 1, ?, ?, 'ACTIVE', 24900, '{}')`, now, now);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id, stripe_payment_intent_id, placed_at) VALUES (?, ?, ?, 'cust', 'biz', 'IN_PRODUCTION', 24900, 24900, 'PAID', 'cs_live_1', 'pi_123', ?)`, ORDER, placed, placed, placed);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('item', ?, 'of', 'ov', 24900, 24900)`, ORDER);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES (?, ?, 'item', 'biz', 'cust', 'DESIGN', ?, 'WF_V1', 1, ?, ?)`, PROJECT, ORDER, status, now, now);
  sql(`INSERT INTO workflow_runs (id, project_id, workflow_key, workflow_version, status, trigger_type, created_at) VALUES ('run', ?, 'WF_V1', 1, 'WAITING', 'ORDER', ?)`, PROJECT, now);
  if (delivered) {
    sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES ('a1', 'biz', 'cust', ?, 'DELIVERABLE', 'R2', 'k', 'f', 'text/html', 1, 'x', 'VALID', ?)`, PROJECT, now);
    sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d1', ?, 'a1', 'HOSTED_MENU', 1, 'FINAL', 1, ?, ?)`, PROJECT, now, now);
  }
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    calls.push({ url, body: String(init.body || ''), key: init.headers?.['Idempotency-Key'] });
    if (url === 'https://api.stripe.com/v1/refunds') return Response.json({ id: 're_1', status: 'succeeded' });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'em' });
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  const env = { DB, ASSETS: createR2(), PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', STRIPE_SECRET_KEY: 'sk_live_x' };
  const call = (path, init) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, { waitUntil() {} });
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, call, calls, row, sql };
}

test('a design order whose brief is not sent yet: confirm page first, then a full Stripe refund and production stops', async (t) => {
  const f = setup(t);
  const url = new URL(await cancelLink(f.env, ORDER));
  const path = url.pathname + url.search;
  const confirm = await f.call(path);
  assert.equal(confirm.status, 200);
  assert.match(await confirm.text(), /Cancel and refund \$249/);
  assert.equal(f.calls.length, 0, 'opening the link (or a scanner) refunds nothing');
  const done = await f.call(path, { method: 'POST' });
  assert.equal(done.status, 200);
  const refund = f.calls.find((c) => c.url === 'https://api.stripe.com/v1/refunds');
  assert.match(refund.body, /payment_intent=pi_123/);
  assert.equal(refund.key, `order-cancel/${ORDER}`);
  assert.equal(f.row(`SELECT payment_status FROM orders`).payment_status, 'REFUNDED');
  assert.equal(f.row(`SELECT status FROM projects`).status, 'CANCELLED');
  assert.equal(f.row(`SELECT status FROM workflow_runs`).status, 'CANCELLED');
  assert.equal(f.calls.filter((c) => c.url === 'https://api.resend.com/emails').length, 2, 'buyer confirmation and owner FYI');
  const again = await f.call(path, { method: 'POST' });
  assert.match(await again.text(), /Already refunded/);
  assert.equal(f.calls.filter((c) => c.url === 'https://api.stripe.com/v1/refunds').length, 1);
});

test('once work starts (brief sent) a design order is not refundable', async (t) => {
  const f = setup(t, { status: 'READY' });
  assert.match(refundEligibility(await loadOrder(f.env, ORDER)).reason, /Work on this order has started/);
  const url = new URL(await cancelLink(f.env, ORDER));
  assert.equal((await f.call(url.pathname + url.search, { method: 'POST' })).status, 409);
  assert.equal(f.calls.length, 0);
});

test('Online Menu + QR is refundable while it is being made, not once delivered', async (t) => {
  const making = setup(t, { code: 'ONLINE_MENU_QR', category: 'MENU', status: 'READY' });
  assert.equal(refundEligibility(await loadOrder(making.env, ORDER)).ok, true);
  const delivered = setup(t, { code: 'ONLINE_MENU_QR', category: 'MENU', status: 'READY', delivered: true });
  assert.match(refundEligibility(await loadOrder(delivered.env, ORDER)).reason, /already been delivered/);
});

test('plans, printed items, old orders and bad links are never refunded online', async (t) => {
  assert.match(refundEligibility(await loadOrder(setup(t, { billing: 'RECURRING' }).env, ORDER)).reason, /Plans aren't refunded/);
  assert.match(refundEligibility(await loadOrder(setup(t, { code: 'STAFF_MERCH', fulfillment: 'PHYSICAL', category: 'MERCH' }).env, ORDER)).reason, /Printed items/);
  assert.match(refundEligibility(await loadOrder(setup(t, { placedDaysAgo: 31 }).env, ORDER)).reason, /30 days/);
  const f = setup(t);
  assert.equal((await f.call(`/api/order/${ORDER}/cancel?t=forged.token`, { method: 'POST' })).status, 403);
  assert.equal(f.calls.length, 0);
});
