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

test('site: the Mobile App page is public (owner, Nov 3), paired with the Guest App, prices from the catalog', () => {
  const root = new URL('../', import.meta.url);
  const page = readFileSync(new URL('store-app.html', root), 'utf8');
  assert.doesNotMatch(page, /noindex/);
  assert.doesNotMatch(page, /Store App|restaurant/i, 'customer wording is Mobile App and business');
  assert.match(page, /data-price-for="STORE_APP_SETUP"/);
  assert.match(page, /data-price-for="STORE_APP_CARE" data-price-interval="month"/);
  assert.match(page, /data-plan-cta="STORE_APP_SETUP"/);
  assert.match(page, /isn’t guaranteed/);
  assert.match(page, /href="services.html#guest-app"/, 'links down to the Guest App');
  // Prices are written in from tools/catalog-snapshot.json (Site prices workflow) and refreshed live; never typed in.
  // So every Menu-made amount on the page sits inside a catalog price span.
  const outside = page.replace(/<span class="mm-price"[^>]*>[^<]*<\/span>/g, '');
  assert.doesNotMatch(outside, /\$(999|99\/mo|990)/, 'no Menu-made price outside a catalog price span (Apple and Google fees are theirs)');
  // Nov 6, 2026 (owner, simpler offers): the two apps are paired on the Apps page and Services; home and plans link there.
  for (const f of ['apps.html', 'services.html']) {
    const html = readFileSync(new URL(f, root), 'utf8');
    assert.match(html, /id="mobile-app"/, `${f} has the apps section`);
    assert.match(html, /data-plan-cta="GUEST_APP"[\s\S]*data-plan-cta="STORE_APP_SETUP"/, `${f} pairs Guest App and Mobile App`);
  }
  for (const f of ['index.html', 'plans.html']) assert.match(readFileSync(new URL(f, root), 'utf8'), /href="apps.html"/, `${f} links to the Apps page`);
  assert.match(readFileSync(new URL('sitemap.xml', root), 'utf8'), /menu-made\.com\/store-app</);
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

test("owner's own apps: made once by the tick at no charge, owner keys, no buyer step, Apple App ID and Firebase done for him, then Done -> ready to build", async () => {
  const f = setup();
  f.DB.raw.exec(read('0040_own_store_apps.sql'));
  for (const m of ['0026_store_app_builds.sql']) f.DB.raw.exec(read(m));
  const own = await import('./src/store-app/own-apps.js');
  const scope = await import('./src/store-app/restaurant-keys.js');
  const google = await import('./src/store-app/google.js');
  const { generateKeyPairSync } = await import('node:crypto');
  const LOGO = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const logoFetch = async (url) => (String(url).includes('menu-made.com') || String(url).includes('ninobattaglia.com') ? new Response(LOGO) : new Response('no', { status: 404 }));
  // Not on the hour: nothing. Forced: both apps, once.
  assert.deepEqual((await own.ensureOwnStoreApps(f.env, { now: new Date('2026-11-07T10:30:00Z'), fetchImpl: logoFetch })).created, []);
  const first = await own.ensureOwnStoreApps(f.env, { force: true, fetchImpl: logoFetch });
  assert.deepEqual(first.created.map((c) => [c.key, c.logo]), [['menumade', true], ['nino', true]]);
  assert.deepEqual((await own.ensureOwnStoreApps(f.env, { force: true, fetchImpl: logoFetch })).created, [], 'never twice');
  // A logo that failed the first time is attached on a later pass, before the content is approved.
  f.sql(`DELETE FROM assets WHERE json_extract(metadata_json, '$.app_image') = 'logo' AND project_id = (SELECT project_id FROM store_apps WHERE bundle_id = 'com.menumade.ninobattaglia')`);
  await own.ensureOwnStoreApps(f.env, { force: true, fetchImpl: logoFetch });
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM assets WHERE json_extract(metadata_json, '$.app_image') = 'logo'`).n, 2);
  const apps = DB_rows(f, `SELECT bundle_id, status, own_app FROM store_apps ORDER BY bundle_id`);
  assert.deepEqual(apps, [{ bundle_id: 'com.menumade.menumade', status: 'WAITING_APP', own_app: 1 }, { bundle_id: 'com.menumade.ninobattaglia', status: 'WAITING_APP', own_app: 1 }]);
  assert.deepEqual(DB_rows(f, `SELECT total_cents, payment_status, stripe_checkout_session_id FROM orders`), [{ total_cents: 0, payment_status: 'PAID', stripe_checkout_session_id: null }, { total_cents: 0, payment_status: 'PAID', stripe_checkout_session_id: null }], 'no charge and not a test order, so it reaches the real stores');
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM projects WHERE workflow_key = 'STORE_APP_SETUP_V1' AND status = 'READY'`).n, 2, 'released to production like a filled-in intake');
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_key = 'STORE_APP_SETUP_V1'`).n, 2);
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM entitlements WHERE entitlement_type = 'STORE_APP_CARE' AND status = 'ACTIVE'`).n, 2);
  const nino = f.row(`SELECT s.*, g.data_json FROM store_apps s JOIN guest_apps g ON g.project_id = s.project_id WHERE s.bundle_id = 'com.menumade.ninobattaglia'`);
  assert.equal(JSON.parse(nino.data_json).business_type, 'shop');
  assert.equal(scope.storeScope(nino), 'owner', "his own apps use his keys");
  const mm = f.row(`SELECT id FROM store_apps WHERE bundle_id = 'com.menumade.menumade'`);

  // Content approved: no buyer email; the worker registers the App ID and adds the Firebase Android app, then emails the owner.
  f.sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES ('a9', ?, ?, ?, 'DELIVERABLE', 'R2', 'k', 'build.json', 'application/json', 1, 'x', 'VALID', 'x')`, nino.business_id, nino.customer_id, nino.project_id);
  f.sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d9', ?, 'a9', 'APP_BUILD', 1, 'FINAL', 1, 'x', 'x')`, nino.project_id);
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  await keys.saveCredential(f.env, 'owner', 'APPLE_API_KEY', { keyId: 'API1234567', issuerId: 'iss', teamId: 'TEAM', p8: ec, status: 'VERIFIED', note: 'ok' });
  await keys.saveCredential(f.env, 'owner', 'APPLE_PUSH_KEY', { keyId: 'PUSH123456', teamId: 'TEAM', p8: ec, status: 'VERIFIED', note: 'ok' });
  await keys.saveCredential(f.env, 'owner', 'FIREBASE_ACCOUNT', { keyId: 'fb@menu-made-apps.iam.gserviceaccount.com', teamId: 'menu-made-apps', p8: JSON.stringify({ type: 'service_account', client_email: 'fb@menu-made-apps.iam.gserviceaccount.com', private_key: rsa, project_id: 'menu-made-apps', token_uri: 'https://oauth2.googleapis.com/token' }), status: 'VERIFIED', note: 'ok' });
  const sample = { project_info: { project_id: 'menu-made-apps' }, client: [{ client_info: { android_client_info: { package_name: 'com.menumade.samplecafe' } } }] };
  await f.ASSETS.put(gkeys.servicesKey('owner'), JSON.stringify(sample));
  const calls = [];
  let firebaseApps = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/')) { emails.push(JSON.parse(init.body)); return Response.json({ id: `em_${emails.length}` }); }
    calls.push(`${init.method || 'GET'} ${u.replace(/\?.*$/, '')}`);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'ya29.x', expires_in: 3600 });
    if (u.includes('/bundleIds?')) return Response.json({ data: [] });
    if (u.endsWith('/bundleIds')) return Response.json({ data: { id: 'BID1' } }, { status: 201 });
    if (u.endsWith('/bundleIdCapabilities')) return Response.json({}, { status: 201 });
    if (u.includes('/androidApps?')) return Response.json({ apps: firebaseApps });
    if (u.endsWith('/androidApps') && init.method === 'POST') { firebaseApps = [...firebaseApps, { appId: `1:2:android:${firebaseApps.length}`, packageName: JSON.parse(init.body).packageName }]; return Response.json({ name: 'operations/x' }); }
    if (u.endsWith('/config')) { const cfg = { project_info: { project_id: 'menu-made-apps' }, client: [sample.client[0], { client_info: { android_client_info: { package_name: 'com.menumade.ninobattaglia' } } }] }; return Response.json({ configFileContents: btoa(JSON.stringify(cfg)) }); }
    return new Response('unexpected', { status: 500 });
  };
  try {
    google.tokenCache?.clear?.();
    emails.length = 0;
    await flow.advanceStoreApps(f.env);
    const after1 = f.row(`SELECT status, note FROM store_apps WHERE id = ?`, nino.id);
    assert.equal(after1.status, 'WAITING_OWNER_SETUP', 'straight to the owner: no buyer step');
    assert.match(after1.note, /Apple done; Firebase not done \(Android app added in Firebase/);
    assert.ok(calls.includes('POST https://api.appstoreconnect.apple.com/v1/bundleIds') && calls.includes('POST https://api.appstoreconnect.apple.com/v1/bundleIdCapabilities'));
    // Both are site apps (the whole website in the app), so neither waits for app screens to be approved.
    assert.equal(emails.length, 2);
    const ninoMail = emails.find((e) => /Nino Battaglia/.test(e.subject));
    assert.deepEqual(ninoMail.to, ['info@menu-made.com']);
    assert.match(ninoMail.subject, /Your own Mobile App: store setup for Nino Battaglia/);
    assert.match(ninoMail.html, /Already done for you: the Apple App ID/);
    assert.match(ninoMail.html, /New App/); assert.match(ninoMail.html, /Create app/); assert.match(ninoMail.html, /firebase-adminsdk-fbsvc/);
    assert.doesNotMatch(ninoMail.html, /D-U-N-S|invite|Guest App/i, 'no buyer account steps');
    // Done is refused until google-services.json names the app.
    const ownerToken = await signLinkToken(f.env, { kind: flow.OWNER_KIND, id: nino.id, ttlDays: 30 });
    const press = () => { const fd = new FormData(); fd.set('t', ownerToken); return call(f, `https://menu-made.com/api/store-app/${nino.id}/done`, { method: 'POST', body: fd }); };
    const refused = await press();
    assert.equal(refused.status, 409);
    assert.match(await refused.text(), /google-services\.json with the Android app com\.menumade\.ninobattaglia/);
    // An hour later the tick reads the Firebase config and merges it into the owner's file (Sample Cafe kept).
    await flow.advanceStoreApps(f.env, Date.now() + 2 * 3600000);
    assert.match(f.row(`SELECT note FROM store_apps WHERE id = ?`, nino.id).note, /Apple done; Firebase done/);
    const merged = google.parseGoogleServices(await (await f.ASSETS.get(gkeys.servicesKey('owner'))).text());
    assert.deepEqual(merged.packages, ['com.menumade.samplecafe', 'com.menumade.ninobattaglia']);
    await press();
    assert.equal(f.row(`SELECT status FROM store_apps WHERE id = ?`, nino.id).status, 'READY_TO_BUILD');
    // A site app: the build config carries the website and its three screenshot pages.
    const { buildConfigFor } = await import('./src/store-app/store-build.js');
    f.DB.raw.exec(read('0027_store_app_listings.sql'));
    f.DB.raw.exec(read('0029_store_app_live_version.sql'));
    const cfg = await buildConfigFor(f.env, { ...nino, status: 'READY_TO_BUILD' });
    assert.equal(cfg.body.config.site_url, 'https://ninobattaglia.com/shop.html');
    assert.deepEqual(cfg.body.config.site_screens, ['/shop.html', '/shirts/skull-wave.html', '/']);
  } finally {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://api.resend.com/')) { const body = JSON.parse(init.body); emails.push(body); return Response.json({ id: `em_${emails.length}` }); }
      return realFetch(url, init);
    };
  }
});

test('the Mobile App approval and delivery emails never call it a Guest App', async () => {
  const { presenterFor } = await import('./src/approvals/presenters.js');
  const p = presenterFor('STORE_APP_SETUP_V1');
  const context = { id: 'p1', business_name: 'Nino Battaglia', customer_email: 'info@menu-made.com', first_name: 'JP', stripe_checkout_session_id: null };
  const files = [{ deliverable_type: 'APP_BUILD', metadata_json: JSON.stringify({ app: { name: 'Nino Battaglia', slug: 'ninos-ts', has_logo: true } }) }];
  const owner = await p.ownerEmail({ context, files, previews: [{ label: 'Preview the app screens', url: 'https://x' }], approveUrl: 'https://y' });
  const buyer = await p.buyerEmail({ context, files, env: {} });
  for (const text of [owner.subject, owner.html, owner.text, buyer.subject, buyer.html, buyer.text]) assert.doesNotMatch(text, /Guest App|home screen|QR/i);
  assert.match(owner.subject, /Mobile App/);
  assert.match(presenterFor('GUEST_APP_SETUP_V1').ownerLabel(context), /Guest App/, 'the Guest App product keeps its own wording');
});
