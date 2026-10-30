// Stage 11 part 2: the Store App as a product. Catalog rows (not public), checkout pairing with the app tier and its
// 90-day trial, the bundle id, and the store steps after the app content is approved: buyer checklist, reminders,
// buyer Done -> owner checklist, owner Done -> ready to build.
// Run: node --no-warnings --test booking-api/store-app-product.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { buildSubscriptionCart } = await import('./src/subscriptions/checkout.js');
const flow = await import('./src/store-app/store-flow.js');
const sw = await import('./src/lib/switches.js');
const { signLinkToken } = await import('./src/lib/links.js');
const keys = await import('./src/store-app/keys.js');
const gkeys = await import('./src/store-app/google-keys.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

// Resend stand-in: records every email.
const emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com/')) { const body = JSON.parse(init.body); emails.push(body); return Response.json({ id: `em_${emails.length}` }); }
  return realFetch(url, init);
};
after(() => { globalThis.fetch = realFetch; });

function setup() {
  emails.length = 0;
  const DB = createD1();
  for (const m of ['0001_subscription_catalog.sql', '0009_website_package.sql', '0010_website_care.sql', '0012_guest_app.sql', '0022_store_credentials.sql', '0025_store_app.sql']) DB.raw.exec(read(m));
  DB.raw.exec('PRAGMA foreign_keys = OFF');
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : r; };
  const ASSETS = createR2();
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'runner-secret', RESEND_API_KEY: 're_test', OWNER_EMAIL: 'info@menu-made.com' };
  return { env, DB, ASSETS, sql, row };
}
const call = (f, url, init) => worker.fetch(new Request(url, init), f.env, { waitUntil() {} });

test('catalog: Store App Setup $999 and the app tier $99 / $990 exist, not public, with the live Stripe prices', () => {
  const f = setup();
  assert.deepEqual(f.row(`SELECT o.is_public, v.price_cents, v.stripe_price_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'STORE_APP_SETUP'`),
    { is_public: 0, price_cents: 99900, stripe_price_id: 'price_1UWAUVHw7f6jhUv8RCyjWwVi' });
  const care = DB_rows(f, `SELECT v.billing_interval, v.price_cents FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'STORE_APP_CARE' ORDER BY v.version_number`);
  assert.deepEqual(care, [{ billing_interval: 'MONTH', price_cents: 9900 }, { billing_interval: 'YEAR', price_cents: 99000 }]);
  const catalog = JSON.parse(readFileSync(new URL('./subscription-catalog.json', import.meta.url), 'utf8'));
  assert.equal(catalog.launch_pending.one_time.STORE_APP_SETUP.amount, 99900);
  assert.equal(catalog.subscriptions.STORE_APP_CARE, undefined, 'stays out of the public lineup until exit');
});
function DB_rows(f, q) { return f.DB.raw.prepare(q).all().map((r) => ({ ...r })); }

test('checkout: the Store App brings the app tier with a 90-day trial; other plans and the Website Package are refused', async () => {
  const f = setup();
  const cart = await buildSubscriptionCart([{ code: 'STORE_APP_SETUP' }], { interval: 'month' }, f.env, 'sandbox');
  assert.equal(cart.plan.offerCode, 'STORE_APP_CARE');
  assert.equal(cart.trialDays, 90);
  assert.equal(cart.orderItem().priceCents, 0, 'nothing charged for the plan during the trial');
  const annual = await buildSubscriptionCart([{ code: 'STORE_APP_SETUP' }], { interval: 'year' }, f.env, 'sandbox');
  assert.equal(annual.plan.priceCents, 99000);
  await assert.rejects(buildSubscriptionCart([{ code: 'STORE_APP_SETUP' }, { code: 'MENU_CARE', interval: 'month' }], { interval: 'month' }, f.env, 'sandbox'), /check it out on its own/);
  await assert.rejects(buildSubscriptionCart([{ code: 'STORE_APP_SETUP' }, { code: 'WEBSITE_PACKAGE' }], { interval: 'month' }, f.env, 'sandbox'), /separately/);
  await assert.rejects(buildSubscriptionCart([{ code: 'STORE_APP_SETUP' }], { interval: 'month' }, f.env, 'live'), /isn't available yet/, 'not on sale live until exit');
});

test('bundle ids are valid for both stores', () => {
  assert.equal(flow.bundleIdFor('joes-pizza'), 'com.menumade.joespizza');
  assert.equal(flow.bundleIdFor('99-bottles'), 'com.menumade.app99bottles');
  assert.match(flow.bundleIdFor(''), /^com\.menumade\.app$/);
  assert.ok(sw.SERVICES.some((s) => s.key === 'STORE_APP' && s.workflows.includes('STORE_APP_SETUP_V1')), 'has on/off switches');
});

function storeFixture(f, { approved = true } = {}) {
  const t = '2026-10-30T00:00:00.000Z';
  f.sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe')`, t, t);
  f.sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Joe''s Pizza')`, t, t);
  f.sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o1', ?, ?, 'cust', 'biz', 'PAID', 99900, 99900, 'PAID')`, t, t);
  f.sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES ('p1', 'o1', 'i1', 'biz', 'cust', 'APP', 'IN_PROGRESS', 'STORE_APP_SETUP_V1', ?, ?)`, t, t);
  f.sql(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES ('ga1', 'joes-pizza', 'p1', 'biz', 'cust', '{"app_name":"Joe''s Pizza"}', ?, ?)`, t, t);
  f.sql(`INSERT INTO store_apps (id, project_id, business_id, customer_id, bundle_id, status, created_at, updated_at) VALUES ('11111111-2222-4333-8444-555555555555', 'p1', 'biz', 'cust', 'com.menumade.joespizza', 'WAITING_APP', ?, ?)`, t, t);
  if (approved) {
    f.sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES ('a1', 'biz', 'cust', 'p1', 'DELIVERABLE', 'R2', 'k', 'build.json', 'application/json', 1, 'x', 'VALID', ?)`, t);
    f.sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d1', 'p1', 'a1', 'APP_BUILD', 1, 'FINAL', 1, ?, ?)`, t, t);
  }
  return '11111111-2222-4333-8444-555555555555';
}

test('store steps: buyer checklist after approval, reminders, buyer Done -> owner checklist, owner Done -> ready to build', async () => {
  const f = setup();
  const id = storeFixture(f, { approved: false });
  await flow.advanceStoreApps(f.env);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'WAITING_APP', 'nothing before the content is approved');
  assert.equal(emails.length, 0);
  f.sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES ('a1', 'biz', 'cust', 'p1', 'DELIVERABLE', 'R2', 'k', 'build.json', 'application/json', 1, 'x', 'VALID', 'x')`);
  f.sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d1', 'p1', 'a1', 'APP_BUILD', 1, 'FINAL', 1, 'x', 'x')`);
  await flow.advanceStoreApps(f.env);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'WAITING_STORE_ACCESS');
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to, ['joe@joespizza.example']);
  assert.match(emails[0].html, /as an organization/);
  assert.match(emails[0].html, /isn&#039;t guaranteed|isn't guaranteed/);
  await flow.advanceStoreApps(f.env);
  assert.equal(emails.length, 1, 'no reminder the same day');
  await flow.advanceStoreApps(f.env, Date.now() + 4 * 86400000);
  assert.equal(emails.length, 2);
  assert.match(emails[1].subject, /^Reminder/);

  const buyerToken = await signLinkToken(f.env, { kind: flow.BUYER_KIND, id, ttlDays: 90 });
  const page = await (await call(f, `https://menu-made.com/api/store-app/${id}/done?t=${encodeURIComponent(buyerToken)}`)).text();
  assert.match(page, /Yes, both invites are sent/);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'WAITING_STORE_ACCESS', 'a GET never changes anything (link scanners)');
  const form = new FormData(); form.set('t', buyerToken);
  await call(f, `https://menu-made.com/api/store-app/${id}/done`, { method: 'POST', body: form });
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'WAITING_OWNER_SETUP');
  const ownerMail = emails[emails.length - 1];
  assert.deepEqual(ownerMail.to, ['info@menu-made.com']);
  assert.match(ownerMail.html, /com\.menumade\.joespizza/);

  const wrongKind = new FormData(); wrongKind.set('t', buyerToken);
  await call(f, `https://menu-made.com/api/store-app/${id}/done`, { method: 'POST', body: wrongKind });
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'WAITING_OWNER_SETUP', "the buyer's link can't finish the owner's step");
  assert.match(ownerMail.html, new RegExp(`/api/store-keys/app/${id}`), 'the owner checklist links the restaurant key page');
  const ownerToken = await signLinkToken(f.env, { kind: flow.OWNER_KIND, id, ttlDays: 30 });
  const ownerForm = () => { const fd = new FormData(); fd.set('t', ownerToken); return fd; };
  const refused = await call(f, `https://menu-made.com/api/store-app/${id}/done`, { method: 'POST', body: ownerForm() });
  assert.equal(refused.status, 409);
  const refusedText = await refused.text();
  assert.match(refusedText, /App Store Connect API key/);
  assert.match(refusedText, /google-services\.json/);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'WAITING_OWNER_SETUP', "Done waits for the restaurant's keys");
  // The restaurant's keys, as the key page stores them (scope = business id).
  await keys.saveCredential(f.env, 'biz', 'APPLE_API_KEY', { keyId: 'API1234567', issuerId: 'i', teamId: 'T', p8: 'x', status: 'VERIFIED', note: 'ok' });
  await keys.saveCredential(f.env, 'biz', 'APPLE_PUSH_KEY', { keyId: 'PUSH123456', teamId: 'T', p8: 'x', status: 'UNVERIFIED', note: 'saved' });
  await f.ASSETS.put(gkeys.servicesKey('biz'), '{}');
  await call(f, `https://menu-made.com/api/store-app/${id}/done`, { method: 'POST', body: ownerForm() });
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'READY_TO_BUILD');
  assert.equal((await call(f, `https://menu-made.com/api/store-app/${id}/done?t=bad`)).status, 403);
});

test('site: the Store App page exists but stays hidden until the exit (noindex, linked from nowhere, prices from the catalog)', () => {
  const { readdirSync } = fs;
  const root = new URL('../', import.meta.url);
  const page = readFileSync(new URL('store-app.html', root), 'utf8');
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.match(page, /data-price-for="STORE_APP_SETUP"/);
  assert.match(page, /data-price-for="STORE_APP_CARE" data-price-interval="month"/);
  assert.match(page, /data-plan-cta="STORE_APP_SETUP"/, 'the button reads "Opening soon" while the offer is not on sale');
  assert.match(page, /isn’t guaranteed/);
  assert.doesNotMatch(page, /\$(999|99\/mo|990)/, 'no hard-coded Menu-made prices (Apple and Google fees are theirs)');
  for (const f of readdirSync(root).filter((n) => n.endsWith('.html') && n !== 'store-app.html')) {
    assert.doesNotMatch(readFileSync(new URL(f, root), 'utf8'), /store-app\.html/, `${f} links the hidden page`);
  }
  assert.doesNotMatch(readFileSync(new URL('sitemap.xml', root), 'utf8'), /store-app/);
});

test('self-test STORE_APP_RUN passes through the real steps, reaches no store or GitHub, emails only the test inbox, and leaves nothing behind', async () => {
  const f = setup();
  for (const m of ['0026_store_app_builds.sql', '0027_store_app_listings.sql', '0029_store_app_live_version.sql']) f.DB.raw.exec(read(m));
  f.env.GITHUB_DISPATCH_TOKEN = 'real-token';
  f.env.GITHUB_DISPATCH_FETCH = async () => { throw new Error('the real GitHub was called'); };
  const { advanceStoreAppSelfTests } = await import('./src/selftest/store-app-selftest.js');
  emails.length = 0;
  f.sql(`INSERT INTO self_tests (id, kind, status, created_at, updated_at) VALUES ('st-store', 'STORE_APP_RUN', 'REQUESTED', 'x', 'x')`);
  const [result] = await advanceStoreAppSelfTests(f.env);
  assert.equal(result.status, 'PASSED', result.error || '');
  assert.match(result.log_json, /sandbox live and buyer email/);
  assert.ok(emails.length >= 4, 'buyer checklist, owner checklist, preview and live email');
  for (const e of emails) assert.deepEqual(e.to, ['delivered@resend.dev'], `${e.subject} went to ${e.to}`);
  for (const table of ['store_apps', 'store_app_listings', 'store_app_builds', 'store_credentials']) assert.equal(f.row(`SELECT COUNT(*) AS n FROM ${table}`).n, 0, `${table} left behind`);
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM guest_apps`).n, 0);
});
