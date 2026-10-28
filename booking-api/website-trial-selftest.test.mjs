// The Website Package trial self-test (stage 7 exit: "the Website Care trial is active"): its checks and cleanup,
// from the point where the test-mode checkout has been paid. Checkout and payment are covered by subscriptions.test.mjs.
// Run: node --no-warnings --test booking-api/website-trial-selftest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { advanceWebsiteTrialSelfTests } = await import('./src/selftest/website-trial-selftest.js');

function setup({ status = 'TRIALING', trialDays = 90 } = {}) {
  const DB = createD1();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = new Date().toISOString();
  const trialEnd = new Date(Date.now() + trialDays * 86400000).toISOString();
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'delivered@resend.dev', 'Menu-Made', 'Self-Test')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Trial Self-Test Cafe')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('o_care', ?, ?, 'WEBSITE_CARE', 'Website Care', 'WEBSITE', 'ACTIVE', 'RECURRING', 'DIGITAL', 1, 'WEBSITE_CARE_V1'), ('o_pkg', ?, ?, 'WEBSITE_PACKAGE', 'Website Package', 'WEBSITE', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'WEBSITE_PACKAGE_V1')`, t, t, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('v_care', 'o_care', 1, ?, ?, 'ACTIVE', 4900, '{}'), ('v_pkg', 'o_pkg', 1, ?, ?, 'ACTIVE', 49900, '{}')`, t, t, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('order', ?, ?, 'cust', 'biz', 'ONBOARDING_REQUIRED', 49900, 49900, 'PAID')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('item', 'order', 'o_pkg', 'v_pkg', 49900, 49900)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES ('proj', 'order', 'item', 'biz', 'cust', 'WEBSITE', 'AWAITING_INPUTS', 'WEBSITE_PACKAGE_V1', ?, ?)`, t, t);
  sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, currency, current_period_start, current_period_end, started_at, trial_ends_at, created_at, updated_at)
       VALUES ('sub', 'cust', 'biz', 'o_care', 'v_care', 'STRIPE', 'sub_test_1', 'cus_test_1', ?, 'MONTH', 4900, 'USD', ?, ?, ?, ?, ?, ?)`, status, t, trialEnd, t, trialEnd, t, t);
  sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('ent', 'cust', 'biz', 'sub', 'WEBSITE_CARE', 'ACTIVE', ?, ?, ?)`, t, t, t);
  sql(`INSERT INTO communications (id, created_at, channel, direction, recipient, subject, purpose, template_key, status, project_id) VALUES ('c1', ?, 'EMAIL', 'OUTBOUND', 'delivered@resend.dev', 'Tell us about your business', 'WEBSITE_INTAKE', 'website_intake_v1', 'SENT', 'proj')`, t);
  sql(`INSERT INTO self_tests (id, kind, status, stage, stage_started_at, order_id, state_json, requested_by, created_at, updated_at) VALUES ('st', 'WEBSITE_TRIAL_RUN', 'RUNNING', 'AWAIT_TRIAL', ?, 'order', '{"customer_id":"cus_test_1","clock_id":"clock_1"}', 'test', ?, ?)`, t, t, t);
  const stripe = []; const emails = []; const customers = [];
  const fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'e' }); }
    if (String(url).startsWith('https://api.stripe.com/')) {
      const method = init.method || 'GET'; const path = new URL(url).pathname; const params = new URLSearchParams(init.body || '');
      stripe.push(`${method} ${path}`);
      if (method === 'POST' && path === '/v1/test_helpers/test_clocks') return Response.json({ id: 'clock_1', status: 'ready' });
      if (method === 'POST' && path === '/v1/customers') { customers.push(Object.fromEntries(params)); return Response.json({ id: 'cus_test_1' }); }
      return Response.json({ id: path.split('/').pop(), deleted: true });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const env = { DB, ASSETS: createR2(), STRIPE_SECRET_KEY_TEST: 'sk_test_placeholder', RESEND_API_KEY: 're_test' };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, sql, row, stripe, emails, fetch, customers };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }

test('a trialing Website Care subscription passes, then the test subscription, website job and order are cancelled', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await advanceWebsiteTrialSelfTests(f.env, null);
    assert.equal(f.row(`SELECT stage FROM self_tests`).stage, 'AWAIT_CANCELLED');
    assert.deepEqual(f.stripe, ['DELETE /v1/subscriptions/sub_test_1']);
    await advanceWebsiteTrialSelfTests(f.env, null);
    assert.equal(f.row(`SELECT status FROM self_tests`).status, 'RUNNING', 'waits for the cancel to sync');
    f.sql(`UPDATE subscriptions SET status = 'CANCELLED'`);
    await advanceWebsiteTrialSelfTests(f.env, null);
    assert.equal(f.row(`SELECT status FROM self_tests`).status, 'PASSED');
    assert.equal(f.row(`SELECT status FROM projects`).status, 'CANCELLED');
    assert.equal(f.row(`SELECT status FROM orders`).status, 'CANCELLED');
    assert.ok(f.stripe.includes('DELETE /v1/test_helpers/test_clocks/clock_1'), 'the test clock (and its customer) is deleted');
    assert.equal(f.emails.length, 0, 'a pass emails nobody');
  });
});

test('a Website Care subscription charged straight away (no trial) fails, alerts the owner and cleans up', async () => {
  const f = setup({ status: 'ACTIVE' });
  await withFetch(f.fetch, async () => {
    await advanceWebsiteTrialSelfTests(f.env, null);
    const result = f.row(`SELECT status, error FROM self_tests`);
    assert.equal(result.status, 'FAILED');
    assert.match(result.error, /ACTIVE, expected TRIALING/);
    assert.equal(f.row(`SELECT status FROM projects`).status, 'CANCELLED');
    assert.ok(f.stripe.includes('DELETE /v1/test_helpers/test_clocks/clock_1'), 'the test clock, customer and subscription are deleted in Stripe');
    assert.match(f.emails[0].subject, /trial self-test failed/);
  });
});

test('a trial of the wrong length fails', async () => {
  const f = setup({ trialDays: 14 });
  await withFetch(f.fetch, async () => {
    await advanceWebsiteTrialSelfTests(f.env, null);
    assert.match(f.row(`SELECT error FROM self_tests`).error, /not about 90 days/);
  });
});

test('the checkout gets a self-test customer on a Stripe test clock, as the checkout route requires', async () => {
  const f = setup();
  f.sql(`UPDATE self_tests SET status = 'REQUESTED', stage = NULL, order_id = NULL, state_json = NULL`);
  let sent = null;
  const app = async (request) => { sent = await request.json(); return Response.json({ ok: false, error: 'stop here' }, { status: 400 }); };
  await withFetch(f.fetch, async () => { await advanceWebsiteTrialSelfTests(f.env, app); });
  assert.deepEqual(f.customers[0], { email: 'delivered@resend.dev', name: 'Menu-Made Self-Test', test_clock: 'clock_1', 'metadata[self_test]': '1' });
  assert.equal(sent.stripe_test_customer, 'cus_test_1');
  assert.deepEqual(sent.items, [{ key: 'WEBSITE_PACKAGE' }]);
  assert.ok(f.stripe.includes('DELETE /v1/test_helpers/test_clocks/clock_1'), 'a failed start still deletes its clock');
});
