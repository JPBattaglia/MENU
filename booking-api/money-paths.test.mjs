// Stage 12, task 5: the daily live money-paths check (MONEY_PATHS), against a fake live Stripe.
// Run: node --no-warnings --test booking-api/money-paths.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './test-support/d1.mjs';

const mp = await import('./src/selftest/money-paths.js');
const NOW = Date.parse('2026-11-01T21:05:00.000Z');

function setup() {
  const DB = createD1();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  sql('PRAGMA foreign_keys = OFF'); sql('DELETE FROM offer_versions'); sql('DELETE FROM offers');
  const offer = (code, pub, versions) => {
    sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, default_workflow_key, is_public) VALUES (?, 'x', 'x', ?, ?, 'OTHER', 'ACTIVE', ?, 'DIGITAL', 'X', ?)`, `o_${code}`, code, code, versions[0][0] ? 'RECURRING' : 'ONE_TIME', pub);
    versions.forEach(([interval, cents, price], i) => sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, billing_interval, stripe_price_id, scope_json) VALUES (?, ?, ?, 'x', 'x', 'ACTIVE', ?, ?, ?, '{}')`, `v_${code}_${i}`, `o_${code}`, i + 1, cents, interval, price));
  };
  offer('MENU_CARE', 1, [['MONTH', 2900, 'price_mc_m'], ['YEAR', 29000, 'price_mc_y']]);
  offer('ONLINE_MENU_QR', 1, [[null, 12900, 'price_qr']]);
  offer('STORE_APP_SETUP', 0, [[null, 99900, 'price_sa']]);
  const stripe = { prices: new Map([
    ['price_mc_m', { id: 'price_mc_m', active: true, unit_amount: 2900, recurring: { interval: 'month' } }],
    ['price_mc_y', { id: 'price_mc_y', active: true, unit_amount: 29000, recurring: { interval: 'year' } }],
    ['price_qr', { id: 'price_qr', active: true, unit_amount: 12900, recurring: null }],
    ['price_sa', { id: 'price_sa', active: true, unit_amount: 99900, recurring: null }]]),
  endpoint: { url: 'https://menu-made.com/api/stripe-webhook', status: 'enabled', enabled_events: [...mp.NEEDED_EVENTS] }, failedEvents: [], calls: [] };
  const call = async (path, { method = 'GET', params = null } = {}) => {
    stripe.calls.push(`${method} ${path}`);
    if (path === '/v1/prices') return { data: [...stripe.prices.values()], has_more: false };
    if (path === '/v1/checkout/sessions' && method === 'POST') { stripe.session = Object.fromEntries(new URLSearchParams(params)); return { id: 'cs_live_1', url: 'https://checkout.stripe.com/c/pay/cs_live_1' }; }
    if (/\/v1\/checkout\/sessions\/cs_live_1\/expire/.test(path)) { stripe.expired = true; return { id: 'cs_live_1', status: 'expired' }; }
    if (path === '/v1/webhook_endpoints') return { data: [stripe.endpoint] };
    if (path === '/v1/events') { stripe.eventsQuery = Object.fromEntries(params); return { data: stripe.failedEvents }; }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const env = { DB, STRIPE_SECRET_KEY: 'sk_live_placeholder' };
  const run = async () => {
    sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, 'MONEY_PATHS', 'REQUESTED', 'test', 'x', 'x')`, crypto.randomUUID());
    await mp.advanceMoneyPathsSelfTests(env, { stripe: call, clock: () => NOW });
    return { ...DB.raw.prepare(`SELECT status, error, log_json FROM self_tests ORDER BY rowid DESC LIMIT 1`).get() };
  };
  return { env, stripe, run, sql };
}

test('passes when prices, a live checkout, the webhook and deliveries are all right; the session is expired at once', async () => {
  const f = setup();
  const r = await f.run();
  assert.equal(r.status, 'PASSED', r.error);
  assert.match(r.log_json, /3 live prices checked|4 live prices checked/);
  assert.equal(f.stripe.expired, true, 'the live session is expired straight away');
  assert.equal(f.stripe.session['metadata[self_test]'], 'money-paths');
  assert.ok(['price_mc_m', 'price_mc_y', 'price_qr'].includes(f.stripe.session['line_items[0][price]']), 'only public offers get a live session');
  assert.equal(f.stripe.eventsQuery.delivery_success, 'false');
  assert.ok(!f.stripe.calls.some((c) => /^POST \/v1\/(prices|products|webhook_endpoints|subscriptions|payment)/.test(c)), 'nothing in Stripe is changed except the one expired session');
});

test('catches a wrong amount, an archived price, a wrong interval and a missing price', async () => {
  const f = setup();
  f.stripe.prices.get('price_mc_m').unit_amount = 3900;
  f.stripe.prices.get('price_mc_y').recurring = { interval: 'month' };
  f.stripe.prices.get('price_qr').active = false;
  f.stripe.prices.delete('price_sa');
  const r = await f.run();
  assert.equal(r.status, 'FAILED');
  assert.match(r.error, /MENU_CARE \(monthly\): Stripe charges 3900, the catalog says 2900/);
  assert.match(r.error, /MENU_CARE \(yearly\): Stripe bills month, the catalog says year/);
  assert.match(r.error, /ONLINE_MENU_QR: Stripe price price_qr is archived/);
  assert.match(r.error, /STORE_APP_SETUP: price price_sa isn't in Stripe live/);
});

test('catches a disabled webhook, a missing event and failed deliveries', async () => {
  const f = setup();
  f.stripe.endpoint.status = 'disabled';
  f.stripe.endpoint.enabled_events = f.stripe.endpoint.enabled_events.filter((e) => e !== 'invoice.paid');
  f.stripe.failedEvents = [{ id: 'evt_1', type: 'invoice.paid' }];
  const r = await f.run();
  assert.equal(r.status, 'FAILED');
  assert.match(r.error, /the live endpoint is disabled/);
  assert.match(r.error, /doesn't send invoice\.paid/);
  assert.match(r.error, /1 live event didn't reach the worker \(e\.g\. invoice\.paid evt_1\)/);
});

test('scheduled once a day at 21:00 UTC', async () => {
  const f = setup();
  for (const [h, m] of [[20, 59], [21, 0], [21, 5], [21, 25]]) await mp.maybeScheduleDaily(f.env, new Date(Date.UTC(2026, 10, 1, h, m)));
  assert.equal(f.env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM self_tests WHERE kind = 'MONEY_PATHS'`).get().n, 1);
});
