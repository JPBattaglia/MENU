// Stage 9 part 2: customer accounts. Emailed single-use sign-in link, session cookie, account summary, sign-out.
// Run: node --no-warnings --test booking-api/account.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

function setup() {
  const DB = createD1();
  for (const m of ['0007_plan_settings.sql', '0009_website_package.sql', '0011_website_domains.sql', '0012_guest_app.sql', '0013_google_connections.sql', '0017_customer_accounts.sql']) {
    DB.raw.exec(read(m));
  }
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe', 'Rossi'), ('lead', ?, ?, 'lead@example.com', 'Lee', 'Lead')`, t, t, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Joe''s Pizza')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES
       ('offer_mc', ?, ?, 'BUNDLE_GROWTH', 'Growth Plan', 'CARE_PLAN', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 'BUNDLE'),
       ('offer_gv', ?, ?, 'GOOGLE_VISIBILITY', 'Google Visibility', 'VISIBILITY', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 0, 'GOOGLE_VISIBILITY_V1'),
       ('offer_wp', ?, ?, 'WEBSITE_PACKAGE', 'Website Package', 'WEBSITE', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'WEBSITE_PACKAGE_V1')`, t, t, t, t, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_mc', 'offer_mc', 1, ?, ?, 'ACTIVE', 17900, '{}'), ('ov_gv', 'offer_gv', 1, ?, ?, 'ACTIVE', 14900, '{}'), ('ov_wp', 'offer_wp', 1, ?, ?, 'ACTIVE', 49900, '{}')`, t, t, t, t, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES
       ('o1', ?, ?, 'cust', 'biz', 'IN_PRODUCTION', 64800, 64800, 'PAID', 'cs_live_1'),
       ('o2', ?, ?, 'cust', 'biz', 'IN_PRODUCTION', 17900, 17900, 'PAID', NULL),
       ('o3', ?, ?, 'lead', NULL, 'PAYMENT_PENDING', 14900, 14900, 'UNPAID', 'cs_live_3')`, t, t, t, t, t, t);
  sql(`UPDATE orders SET notes = 'Subscription BUNDLE_GROWTH period 2026-10-01 (sub_1)' WHERE id = 'o2'`);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'offer_gv', 'ov_gv', 14900, 14900), ('i2', 'o1', 'offer_wp', 'ov_wp', 49900, 49900)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES
       ('11111111-1111-4111-8111-111111111111', 'o1', 'i1', 'biz', 'cust', 'VISIBILITY', 'AWAITING_INPUTS', 'GOOGLE_VISIBILITY_V1', 1, ?, ?),
       ('22222222-2222-4222-8222-222222222222', 'o1', 'i2', 'biz', 'cust', 'WEBSITE', 'AWAITING_INPUTS', 'WEBSITE_PACKAGE_V1', 1, ?, ?)`, t, t, t, t);
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES ('a1', 'biz', 'cust', '11111111-1111-4111-8111-111111111111', 'DELIVERABLE', 'R2', 'r/report.html', 'report.html', 'text/html', 10, 'x', 'VALID', ?)`, t);
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES
       ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'a1', 'GOOGLE_PROFILE_REPORT', 1, 'FINAL', 1, ?, ?),
       ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'a1', 'GOOGLE_PROFILE_REPORT', 2, 'DRAFT', 0, NULL, ?)`, t, t, t);
  sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, currency, current_period_end, cancel_at_period_end, started_at, created_at, updated_at)
       VALUES ('55555555-5555-4555-8555-555555555555', 'cust', 'biz', 'offer_mc', 'ov_mc', 'STRIPE', 'sub_1', 'cus_1', 'ACTIVE', 'MONTH', 17900, 'USD', '2026-11-01T00:00:00.000Z', 0, ?, ?, ?)`, t, t, t);
  for (const code of ['MENU_CARE', 'REVIEW_REPLIES', 'ACCESSIBILITY_MONITORING', 'GOOGLE_PROFILE_CARE']) {
    sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES (?, 'cust', 'biz', '55555555-5555-4555-8555-555555555555', ?, 'ACTIVE', ?, ?, ?)`, `ent_${code}`, code, t, t, t);
  }
  const emails = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const env = { DB, ASSETS: createR2(), PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (path, init) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, ctx);
  const signIn = (email) => call('/api/account/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const linkIn = (email) => /https:\/\/menu-made\.com(\/api\/account\/open\/[^\s"]+)/.exec(email.text)[1];
  async function openAndPost(path) {
    const url = new URL('https://menu-made.com' + path);
    const t = url.searchParams.get('t');
    return call(url.pathname, { method: 'POST', body: new URLSearchParams({ t }) });
  }
  return { env, call, signIn, emails, row, sql, linkIn, openAndPost, restore: () => { globalThis.fetch = realFetch; } };
}

test('sign-in sends a link only to buyers, and the answer never reveals which emails have accounts', async () => {
  const h = setup();
  try {
    const buyer = await h.signIn('Joe@JoesPizza.example');
    const stranger = await h.signIn('nobody@example.com');
    const lead = await h.signIn('lead@example.com');
    assert.equal(buyer.status, 200); assert.equal(stranger.status, 200); assert.equal(lead.status, 200);
    assert.deepEqual(await buyer.json(), await stranger.json());
    assert.equal(h.emails.length, 1);
    assert.deepEqual([h.emails[0].to].flat(), ['joe@joespizza.example']);
    assert.equal((await h.signIn('not-an-email')).status, 400);
  } finally { h.restore(); }
});

test('the link works once: GET only shows a button, POST signs in and sets an HttpOnly cookie', async () => {
  const h = setup();
  try {
    await h.signIn('joe@joespizza.example');
    const path = h.linkIn(h.emails[0]);
    const page = await h.call(path);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<form method="post">/);
    assert.equal(h.row(`SELECT used_at FROM account_sign_ins`).used_at, null, 'GET must not use the link');
    const res = await h.openAndPost(path);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('Location'), 'https://menu-made.com/account.html');
    const cookie = res.headers.get('Set-Cookie');
    assert.match(cookie, /^mm_account=[0-9a-f-]{36}\./);
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    assert.equal((await h.openAndPost(path)).status, 410, 'second use is refused');
  } finally { h.restore(); }
});

test('the account lists plans with their private links, real orders with next steps, and deliveries', async () => {
  const h = setup();
  try {
    await h.signIn('joe@joespizza.example');
    const cookie = (await h.openAndPost(h.linkIn(h.emails[0]))).headers.get('Set-Cookie').split(';')[0];
    const res = await h.call('/api/account/me', { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null, 'never readable cross-site');
    const me = await res.json();
    assert.equal(me.email, 'joe@joespizza.example');
    assert.equal(me.plans.length, 1);
    const labels = me.plans[0].links.map((l) => l.label);
    for (const label of ['Manage billing or switch plan', 'Plan settings', 'Request menu changes', 'Add photos to your library', 'Connect your Google profile']) assert(labels.includes(label), label);
    assert.deepEqual(me.plans[0].google, { connected: false });
    assert.equal(me.orders.length, 1, 'subscription period orders are not listed');
    const actions = me.orders[0].actions.map((a) => a.label);
    assert(actions.includes('Connect your Google profile'));
    assert(actions.includes('Tell us about your website'));
    assert.equal(me.deliveries.length, 1, 'drafts are never shown');
    assert.match(me.deliveries[0].url, /^https:\/\/menu-made\.com\/api\/delivery\/33333333-3333-4333-8333-333333333333\?t=/);
    for (const l of [...me.plans[0].links, ...me.orders[0].actions]) assert.match(l.url, /^https:\/\/menu-made\.com\/api\/[\w/-]+\?t=/);
  } finally { h.restore(); }
});

test('without a valid session nothing is returned, and signing out ends the session', async () => {
  const h = setup();
  try {
    assert.equal((await h.call('/api/account/me')).status, 401);
    assert.equal((await h.call('/api/account/me', { headers: { Cookie: 'mm_account=55555555-5555-4555-8555-555555555555.forged' } })).status, 401);
    await h.signIn('joe@joespizza.example');
    const cookie = (await h.openAndPost(h.linkIn(h.emails[0]))).headers.get('Set-Cookie').split(';')[0];
    const out = await h.call('/api/account/sign-out', { method: 'POST', headers: { Cookie: cookie } });
    assert.match(out.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.equal((await h.call('/api/account/me', { headers: { Cookie: cookie } })).status, 401);
  } finally { h.restore(); }
});

test('expired links are refused and sign-in emails are capped at five an hour', async () => {
  const h = setup();
  try {
    await h.signIn('joe@joespizza.example');
    h.sql(`UPDATE account_sign_ins SET expires_at = '2000-01-01T00:00:00.000Z'`);
    assert.equal((await h.openAndPost(h.linkIn(h.emails[0]))).status, 410);
    for (let i = 0; i < 8; i++) await h.signIn('joe@joespizza.example');
    assert.equal(h.emails.length, 5);
  } finally { h.restore(); }
});

test('the ACCOUNT_SIGNIN self-test signs the self-test buyer in and out and passes', async () => {
  const h = setup();
  try {
    const { advanceAccountSelfTests } = await import('./src/selftest/account-selftest.js');
    h.sql(`UPDATE customers SET email = 'delivered@resend.dev' WHERE id = 'cust'`);
    h.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('acc1', 'ACCOUNT_SIGNIN', 'REQUESTED', 'test', ?, ?)`, new Date().toISOString(), new Date().toISOString());
    const delivered = [];
    const results = await advanceAccountSelfTests(h.env, { now: new Date('2026-10-29T03:00:00Z'), fetch: async (url) => { delivered.push(url); return new Response('ok', { status: 200 }); } });
    assert.equal(results[0].status, 'PASSED', results[0].error);
    assert.equal(delivered.length, 1);
    assert.equal(h.row(`SELECT status FROM self_tests WHERE id = 'acc1'`).status, 'PASSED');
    assert.equal(h.row(`SELECT COUNT(*) AS n FROM account_sessions WHERE revoked_at IS NULL`).n, 0);
  } finally { h.restore(); }
});

test('customer emails carry the Your account button; owner alerts and the sign-in email do not', async () => {
  const { isCustomerEmail, withAccountLink, brandedEmailHtml } = await import('./src/lib/email.js');
  const env = { OWNER_EMAIL: 'owner@example.com' };
  assert.equal(isCustomerEmail('joe@joespizza.example', 'ORDER_DELIVERY', env), true);
  assert.equal(isCustomerEmail('owner@example.com', 'ORDER_DELIVERY', env), false);
  assert.equal(isCustomerEmail('joe@joespizza.example', 'AUTOMATION_ALERT', env), false);
  assert.equal(isCustomerEmail('joe@joespizza.example', 'MENU_CARE_BLOCKED_OWNER', env), false);
  assert.equal(isCustomerEmail('joe@joespizza.example', 'ACCOUNT_SIGN_IN', env), false);
  const out = withAccountLink(brandedEmailHtml({ preheader: 'p', eyebrow: 'e', heading: 'h', paragraphs: ['x'] }), 'Hello');
  assert.equal((out.html.match(/https:\/\/menu-made\.com\/account/g) || []).length, 1);
  assert.match(out.html, /Your account<\/a><\/td><\/tr><tr><td style="padding:24px 32px;background-color:#071f2c;">/);
  assert.match(out.text, /Your account .*https:\/\/menu-made\.com\/account$/);
  assert.deepEqual(withAccountLink(out.html, out.text), out, 'never added twice');
});
