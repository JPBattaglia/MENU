// A Stripe retry must finish a checkout.session.completed that an earlier attempt left half-done.
// Regression for self-test 13630adf (Oct 27, 2026): the D1 daily limit hit between the project insert
// and its inputs, and the retry skipped the existing project, so the checkout menu could never attach.
// Run: node --no-warnings --test webhook-retry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { handleCheckoutCompleted } = await import('./src/checkout/webhook.js');

const REF = '11111111-2222-4333-8444-555555555555';

function setup() {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = new Date().toISOString();
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'buyer@example.com', 'Pat', 'Lee')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Proof Cafe')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer', ?, ?, 'ONLINE_MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov', 'offer', 1, ?, ?, 'ACTIVE', 12900, '{}')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, notes) VALUES ('order', ?, ?, 'cust', 'biz', 'PAYMENT_PENDING', 14400, 14400, 'UNPAID', ?)`,
    t, t, `Menu: 3 pages\nDocument ref: ${REF}`);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('item', 'order', 'offer', 'ov', 14400, 14400)`);
  sql(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at) VALUES (?, ?, 'x', 0)`, REF,
    JSON.stringify({ document: { name: 'menu.pdf', contentType: 'application/pdf', size: 9, checksum: 'abc', storageKey: `private/inquiries/${REF}/abc` } }));
  ASSETS.put(`private/inquiries/${REF}/abc`, '%PDF-1.4 fake');
  sql(`INSERT INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES ('wd', 'MENU_QR_V1', 1, 'ACTIVE', ?, ?, ?)`,
    JSON.stringify([{ key: 'PREPARE_INPUTS', order: 10 }, { key: 'GENERATE_MENU_DRAFT', order: 20 }, { key: 'GENERATE_QR', order: 30 }, { key: 'QUALITY_CHECK', order: 40 }, { key: 'PACKAGE_DELIVERABLES', order: 50 }]), t, t);
  const env = { DB, ASSETS, RESEND_API_KEY: 're_test_placeholder', PRODUCTION_RUNNER_SECRET: 'test-runner-secret' };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, sql, row, t };
}

const event = { id: 'evt_1', type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_1', payment_intent: 'pi_1', amount_total: 14400, currency: 'usd', metadata: { order_id: 'order' } } } };

async function withFetch(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === 'https://api.resend.com/emails') return Response.json({ id: 'email' });
    throw new Error(`Unexpected fetch ${url}`);
  };
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('a first attempt attaches the checkout menu', async () => {
  const f = setup();
  await withFetch(() => handleCheckoutCompleted(event, f.env));
  const project = f.row(`SELECT id, metadata_json FROM projects WHERE order_id = 'order'`);
  assert.equal(f.row(`SELECT status FROM project_inputs WHERE project_id = ? AND input_key = 'menu_file'`, project.id).status, 'VALID');
  assert.ok(JSON.parse(project.metadata_json).extras_until);
});

test('a retry repairs a project whose inputs an interrupted attempt never created', async () => {
  const f = setup();
  // State left by the Oct 27 failure: project row written, no inputs, order already marked paid.
  f.sql(`UPDATE orders SET payment_status = 'PAID', status = 'PAID' WHERE id = 'order'`);
  f.sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at) VALUES ('proj', 'order', 'item', 'biz', 'cust', 'MENU', 'AWAITING_INPUTS', 'MENU_QR_V1', 1, 'NORMAL', 0, ?, ?)`, f.t, f.t);
  await withFetch(() => handleCheckoutCompleted(event, f.env));
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM projects WHERE order_id = 'order'`).n, 1);
  assert.equal(f.row(`SELECT status FROM project_inputs WHERE project_id = 'proj' AND input_key = 'menu_file'`).status, 'VALID');
  assert.equal(f.row(`SELECT status FROM project_inputs WHERE project_id = 'proj' AND input_key = 'business_name'`).status, 'VALID');
  assert.ok(JSON.parse(f.row(`SELECT metadata_json FROM projects WHERE id = 'proj'`).metadata_json).extras_until);
});

test('the Menu + QR self-test waits for the webhook to attach the menu, and fails only if it never does', async () => {
  const { advanceSelfTests } = await import('./src/selftest/menu-qr-selftest.js');
  const f = setup();
  f.sql(`UPDATE orders SET payment_status = 'PAID', status = 'PAID' WHERE id = 'order'`);
  // The moment self-test menuqr-fix-9492dbb looked: project created, menu not attached yet.
  f.sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at) VALUES ('proj', 'order', 'item', 'biz', 'cust', 'MENU', 'AWAITING_INPUTS', 'MENU_QR_V1', 1, 'NORMAL', 0, ?, ?)`, f.t, f.t);
  f.sql(`INSERT INTO self_tests (id, kind, status, stage, stage_started_at, order_id, requested_by, created_at, updated_at) VALUES ('st', 'MENU_QR_EXTRA_PAGES', 'RUNNING', 'AWAIT_ORDER_PAID', ?, 'order', 'test', ?, ?)`, f.t, f.t, f.t);
  await withFetch(() => advanceSelfTests(f.env, null));
  assert.equal(f.row(`SELECT status FROM self_tests WHERE id = 'st'`).status, 'RUNNING');

  f.sql(`UPDATE self_tests SET stage_started_at = ? WHERE id = 'st'`, new Date(Date.now() - 11 * 60000).toISOString());
  await withFetch(() => advanceSelfTests(f.env, null));
  const failed = f.row(`SELECT status, error FROM self_tests WHERE id = 'st'`);
  assert.equal(failed.status, 'FAILED');
  assert.match(failed.error, /menu uploaded at checkout was not attached/);
});
