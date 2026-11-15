// Owner, Nov 14, 2026 ("Yes" to closing the pay-$12-and-cancel loophole): a menu whose first year came free with
// MΞNU Plus (or a yearly plan) is covered only while the plan is; when it ends the menu drops to the free plan
// (still online, the badge, no print set) instead of keeping a paid year. Run: node --no-warnings --test booking-api/menu-plus-lapse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { menuHostingState, remindMenuHostingRenewals } = await import('./src/producers/menu-qr/hosting-renewal.js');
const { buildDesignedMenuHtml } = await import('./src/producers/menu-qr/design.js');

const URL_ = 'https://menu-made.com/api/menu/lapse-cafe-abcd';

async function setup({ waived }) {
  const DB = createD1();
  for (const m of ['0007_plan_settings.sql', '0009_website_package.sql', '0017_customer_accounts.sql', '0018_menu_hosting_index.sql']) DB.raw.exec(readFileSync(new URL(`./migrations/${m}`, import.meta.url), 'utf8'));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = new Date(Date.now() - 60 * 864e5).toISOString();
  sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('c', ?, ?, 'owner@lapse.example')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('b', ?, ?, 'Lapse Cafe')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o', ?, ?, 'c', 'b', 'COMPLETED', 0, 0, 'PAID')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('om', ?, ?, 'ONLINE_MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1'), ('op', ?, ?, 'MENU_PLUS', 'MΞNU Plus', 'MENU', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 'MENU_PLUS_V1')`, t, t, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('vm', 'om', 1, ?, ?, 'ACTIVE', 14400, '{}'), ('vp', 'op', 1, ?, ?, 'ACTIVE', 1200, '{}')`, t, t, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json) VALUES ('i', 'o', 'om', 'vm', 0, 0, ?)`, JSON.stringify(waived ? { setup_waived_cents: 14400 } : {}));
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES ('p', 'o', 'i', 'b', 'c', 'MENU', 'DELIVERED', 'MENU_QR_V1', 1, ?, ?)`, t, t);
  sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, status, value_text, created_at, updated_at) VALUES ('pi', 'p', 'qr_destination', 'URL', 'VALID', ?, ?, ?)`, URL_, t, t);
  const ASSETS = createR2();
  await ASSETS.put('r/m.html', new TextEncoder().encode(buildDesignedMenuHtml({ businessName: 'Lapse Cafe', brandColors: '#335', menu: { sections: [{ name: 'Food', items: [{ name: 'Toast', description: '', price: '$5' }] }], notes: '' }, style: null, subtitle: 'Menu' })));
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES ('a', 'b', 'c', 'p', 'DELIVERABLE', 'R2', 'r/m.html', 'm.html', 'text/html', 1, 'x', 'VALID', ?)`, t);
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d', 'p', 'a', 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`, t, t);
  sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, started_at, created_at, updated_at) VALUES ('s', 'c', 'b', 'op', 'vp', 'sub_x', 'cus_x', 'ACTIVE', 'MONTH', 1200, ?, ?, ?)`, t, t, t);
  sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('e', 'c', 'b', 's', 'MENU_PLUS', 'ACTIVE', ?, ?, ?)`, t, t, t);
  const env = { DB, ASSETS, RESEND_API_KEY: 're_test', PRODUCTION_RUNNER_SECRET: 'x' };
  const call = (path) => worker.fetch(new Request(`https://menu-made.com${path}`), env, { waitUntil() {} });
  const cancel = (daysAgo) => sql(`UPDATE entitlements SET status = 'EXPIRED', ends_at = ?, updated_at = ?`, new Date(Date.now() - daysAgo * 864e5).toISOString(), new Date().toISOString());
  return { env, call, cancel };
}

test('Plus-waived menu: covered while Plus is active, then the free plan (online, badge, no print set), never offline, no renewal emails', async () => {
  const h = await setup({ waived: true });
  assert.equal((await menuHostingState(h.env, 'b')).reason, 'menu_care');
  assert.doesNotMatch(await (await h.call('/api/menu/lapse-cafe-abcd')).text(), /mm-made-with/);
  h.cancel(1);
  const grace = await menuHostingState(h.env, 'b');
  assert.equal(grace.reason, 'grace', 'a short grace after cancelling, as with Menu Care');
  h.cancel(40);
  assert.deepEqual(await menuHostingState(h.env, 'b'), { live: true, reason: 'free_plan' }, 'no paid year from a waived menu: the free plan');
  const later = new Date(Date.now() + 400 * 864e5);
  assert.deepEqual(await menuHostingState(h.env, 'b', later), { live: true, reason: 'free_plan' }, 'never offline');
  const page = await (await h.call('/api/menu/lapse-cafe-abcd')).text();
  assert.match(page, /Toast/);
  assert.match(page, /mm-made-with/);
  assert.match(await (await h.call('/api/menu/lapse-cafe-abcd/tv')).text(), /Comes with MΞNU Plus/);
  assert.equal((await remindMenuHostingRenewals(h.env, { now: new Date(Date.now() + 300 * 864e5), projectIds: ['p'] })).sent, 0);
});

test('a menu bought with its own paid first year keeps that year after a plan ends (unchanged)', async () => {
  const h = await setup({ waived: false });
  h.cancel(40);
  const state = await menuHostingState(h.env, 'b');
  assert.equal(state.reason, 'covered');
  assert.equal(state.live, true);
});
