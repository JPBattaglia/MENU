// Stage 11 part 2: store listing. Pictures from the build, the owner's preview (editable) and approval, submission
// to Apple and Google with the restaurant's keys, hourly review checks, the buyer's "live" email, and the paths where
// a store refuses, Apple rejects, Google wants its first release sent by hand, or the order is a test.
// Run: node --no-warnings --test booking-api/store-app-listing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const keys = await import('./src/store-app/keys.js');
const listing = await import('./src/store-app/store-listing.js');
const google = await import('./src/store-app/google.js');
const { signLinkToken } = await import('./src/lib/links.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const ID = '11111111-2222-4333-8444-555555555555';
const PKG = 'com.menumade.joespizza';
const PNG = (w = 1290, h = 2796) => { const b = new Uint8Array(200); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h); return b; };
const RSA = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = JSON.stringify({ type: 'service_account', project_id: 'menu-made-apps', private_key: RSA, client_email: 'play@menu-made-apps.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token' });
const APP_DATA = { app_name: "Joe's Pizza", address: '12 Main St, Petaluma, CA 94952', phone: '(707) 555-0101', menu: 'Pizzas\nMargherita | $14\n\nSalads\nCaesar | $9', hours: 'Mon-Sun 11-9', loyalty_reward: 'a free slice', loyalty_visits: '8', order_url: 'https://order.example/joes' };

async function p8() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

// A fake App Store Connect and Google Play that remember what they were sent.
function fakeStores({ appleFail = null, playDraft = false, appleState = 'WAITING_FOR_REVIEW', playLive = false } = {}) {
  const seen = { apple: [], play: [], uploads: 0 };
  const state = { appleState, playLive };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url); const m = init.method || 'GET';
    if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'ya29', expires_in: 3600 });
    if (u.startsWith('https://play.google.com/store/apps/details')) return new Response('', { status: state.playLive ? 200 : 404 });
    if (u.startsWith('https://upload.appstore.example/')) { seen.uploads++; return new Response(null, { status: 200 }); }
    if (u.startsWith('https://api.appstoreconnect.apple.com/v1')) {
      const path = u.replace('https://api.appstoreconnect.apple.com/v1', '');
      seen.apple.push(`${m} ${path.split('?')[0]}`);
      const body = init.body ? JSON.parse(init.body) : null;
      if (appleFail && path.startsWith(appleFail.path) && m === appleFail.method) return Response.json({ errors: [{ detail: appleFail.detail }] }, { status: 409 });
      if (path.startsWith('/apps?')) return Response.json({ data: [{ id: 'APP1' }] });
      if (path.startsWith('/apps/APP1/appStoreVersions')) return Response.json({ data: [{ id: 'V1', attributes: { appStoreState: 'PREPARE_FOR_SUBMISSION' } }] });
      if (path.startsWith('/builds?')) return Response.json({ data: [{ id: 'B9' }], included: [{ type: 'preReleaseVersions', attributes: { version: '1.0.0' } }] });
      if (path === '/appStoreVersions/V1' && m === 'PATCH') { seen.versionPatch = body; return Response.json({ data: { id: 'V1' } }); }
      if (path === '/appStoreVersions/V1' && m === 'GET') return Response.json({ data: { id: 'V1', attributes: { appStoreState: state.appleState } } });
      if (path === '/appStoreVersions/V1/appStoreVersionLocalizations') return Response.json({ data: [{ id: 'L1', attributes: { locale: 'en-US' } }] });
      if (path === '/appStoreVersionLocalizations/L1') { seen.description = body.data.attributes; return Response.json({ data: { id: 'L1' } }); }
      if (path === '/apps/APP1/appInfos') return Response.json({ data: [{ id: 'I1', attributes: { appStoreState: 'PREPARE_FOR_SUBMISSION' } }] });
      if (path === '/appInfos/I1/appInfoLocalizations') return Response.json({ data: [{ id: 'IL1', attributes: { locale: 'en-US' } }] });
      if (path === '/appInfoLocalizations/IL1') { seen.info = body.data.attributes; return Response.json({ data: {} }); }
      if (path === '/appStoreVersionLocalizations/L1/appScreenshotSets') return Response.json({ data: [] });
      if (path === '/appScreenshotSets' && m === 'POST') return Response.json({ data: { id: 'S1' } });
      if (path === '/appScreenshotSets/S1/appScreenshots') return Response.json({ data: [{ id: 'OLD1' }] });
      if (path === '/appScreenshots/OLD1' && m === 'DELETE') return new Response(null, { status: 204 });
      if (path === '/appScreenshots' && m === 'POST') return Response.json({ data: { id: `SH${seen.apple.length}`, attributes: { uploadOperations: [{ method: 'PUT', url: 'https://upload.appstore.example/part', offset: 0, length: 200, requestHeaders: [] }] } } });
      if (path.startsWith('/appScreenshots/SH') && m === 'PATCH') return Response.json({ data: {} });
      if (path === '/appStoreVersions/V1/appStoreReviewDetail') return Response.json({ data: null });
      if (path === '/appStoreReviewDetails' && m === 'POST') { seen.review = body.data.attributes; return Response.json({ data: { id: 'R1' } }); }
      if (path.startsWith('/reviewSubmissions?')) return Response.json({ data: [] });
      if (path === '/reviewSubmissions' && m === 'POST') return Response.json({ data: { id: 'RS1' } });
      if (path === '/reviewSubmissionItems') return Response.json({ data: { id: 'RSI1' } });
      if (path === '/reviewSubmissions/RS1' && m === 'PATCH') { seen.submitted = body.data.attributes.submitted; return Response.json({ data: {} }); }
      throw new Error(`Unexpected Apple call ${m} ${path}`);
    }
    if (u.includes('androidpublisher.googleapis.com')) {
      const path = u.replace(/^https:\/\/androidpublisher\.googleapis\.com\/(upload\/)?androidpublisher\/v3\/applications\/[^/]+/, '');
      seen.play.push(`${m} ${path.split('?')[0]}`);
      if (path === '/edits' && m === 'POST') return Response.json({ id: `E${seen.play.length}` });
      if (/\/listings\/en-US$/.test(path)) { seen.playListing = JSON.parse(init.body); return Response.json({}); }
      if (/\/listings\/en-US\/\w+$/.test(path.split('?')[0])) return m === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ image: {} });
      if (/\/tracks\/internal$/.test(path)) return Response.json({ releases: [{ versionCodes: ['12', '14'] }] });
      if (/\/tracks\/production$/.test(path)) { const b = JSON.parse(init.body); seen.release = b.releases[0]; return Response.json(b); }
      if (/:commit$/.test(path)) return playDraft && seen.release.status !== 'draft' ? Response.json({ error: { message: 'Only releases with status draft may be created on draft app.' } }, { status: 400 }) : Response.json({ id: 'done' });
      throw new Error(`Unexpected Play call ${m} ${path}`);
    }
    throw new Error(`Unexpected fetch ${u}`);
  };
  return { fetchImpl, seen, state };
}

async function setup({ testOrder = false, status = 'WAITING_SUBMIT_APPROVAL' } = {}) {
  google.tokenCache.clear();
  const DB = createD1(); const ASSETS = createR2();
  for (const m of ['0012_guest_app.sql', '0022_store_credentials.sql', '0025_store_app.sql', '0026_store_app_builds.sql', '0027_store_app_listings.sql']) DB.raw.exec(read(m));
  DB.raw.exec('PRAGMA foreign_keys = OFF');
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-30T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe', 'Russo')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Joe''s Pizza LLC')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES ('o1', ?, ?, 'cust', 'biz', 'PAID', 99900, 99900, 'PAID', ?)`, t, t, testOrder ? 'cs_test_1' : 'cs_live_1');
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES ('p1', 'o1', 'i1', 'biz', 'cust', 'APP', 'IN_PROGRESS', 'STORE_APP_SETUP_V1', ?, ?)`, t, t);
  sql(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES ('ga1', 'joes-pizza', 'p1', 'biz', 'cust', ?, ?, ?)`, JSON.stringify(APP_DATA), t, t);
  sql(`INSERT INTO store_apps (id, project_id, business_id, customer_id, bundle_id, status, created_at, updated_at) VALUES (?, 'p1', 'biz', 'cust', ?, ?, ?, ?)`, ID, PKG, status, t, t);
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'runner-secret', RESEND_API_KEY: 're_test', OWNER_EMAIL: 'info@menu-made.com' };
  await keys.saveCredential(env, 'biz', 'APPLE_API_KEY', { keyId: 'API1234567', issuerId: '69a6de70-03db-47e3-e053-5b8c7c11a4d1', teamId: 'T', p8: await p8(), status: 'VERIFIED', note: 'ok' });
  await keys.saveCredential(env, 'biz', 'GOOGLE_PLAY_ACCOUNT', { keyId: 'play@x', teamId: 'menu-made-apps', p8: SA, status: 'VERIFIED', note: 'ok' });
  const emails = [];
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, DB, ASSETS, sql, row, emails };
}
async function withEmails(f, fn) {
  const o = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://api.resend.com/')) { f.emails.push(JSON.parse(init.body)); return Response.json({ id: 'e' }); } return o(url, init); };
  try { return await fn(); } finally { globalThis.fetch = o; }
}
const call = (f, url, init) => withEmails(f, () => worker.fetch(new Request(url, init), f.env, { waitUntil() {} }));
const tick = (f, stores, now = Date.now()) => withEmails(f, () => listing.advanceStoreListings(f.env, now, { fetchImpl: stores.fetchImpl }));
async function pictures(f, names = ['ios-1', 'ios-2', 'ios-3', 'android-1', 'android-2', 'android-3', 'play-icon', 'feature']) {
  const images = {};
  for (const n of names) { await f.ASSETS.put(listing.imageKey(ID, n), PNG()); images[n] = { w: 1290, h: 2796, at: 'x' }; }
  f.sql(`INSERT OR REPLACE INTO store_app_listings (store_app_id, images_json, created_at, updated_at) VALUES (?, ?, 'x', 'x')`, ID, JSON.stringify(images));
}
const previewUrl = (mail) => /href="([^"]+\/listing\?t=[^"]+)"/.exec(mail.html)[1].replaceAll('&amp;', '&');
async function approve(f, url, edits = {}) {
  const form = new FormData(); form.set('t', new URL(url).searchParams.get('t'));
  for (const [k, v] of Object.entries(edits)) form.set(k, v);
  return call(f, `https://menu-made.com/api/store-app/${ID}/listing`, { method: 'POST', body: form });
}

test('listing text fits every store limit and says what the app does', () => {
  const l = listing.listingText(APP_DATA, { businessName: "Joe's Pizza LLC", baseUrl: 'https://menu-made.com', rewards: true, year: 2026 });
  assert.equal(l.name, "Joe's Pizza");
  assert.equal(l.subtitle, 'Menu, specials and rewards');
  assert.match(l.description, /^The official app of Joe's Pizza in Petaluma\./);
  assert.match(l.description, /order online/);
  assert.match(l.description, /rewards card/);
  assert.ok(l.keywords.length <= 100 && !/\s/.test(l.keywords), l.keywords);
  assert.ok(l.play_short.length <= 80);
  assert.equal(l.copyright, "2026 Joe's Pizza LLC");
  assert.equal(l.privacy_url, 'https://menu-made.com/privacy.html');
  const plain = listing.listingText({ app_name: 'A'.repeat(40) }, { businessName: 'B', baseUrl: 'https://x', rewards: false });
  assert.equal(plain.name.length, 30);
  assert.equal(plain.subtitle, 'Menu, specials and hours');
  assert.doesNotMatch(plain.description, /rewards/);
});

test('preview: waits for the pictures, emails the owner once, GET changes nothing, edits are kept on approve', async () => {
  const f = await setup();
  const stores = fakeStores();
  await tick(f, stores);
  assert.equal(f.emails.length, 0, 'no pictures, no preview');
  await pictures(f);
  await tick(f, stores);
  assert.equal(f.emails.length, 1);
  assert.deepEqual(f.emails[0].to, ['info@menu-made.com']);
  assert.match(f.emails[0].subject, /Approve the store listing for Joe's Pizza/);
  await tick(f, stores);
  assert.equal(f.emails.length, 1, 'once');
  const url = previewUrl(f.emails[0]);
  const page = await (await call(f, url)).text();
  assert.match(page, /Approve and submit/);
  assert.match(page, /listing\/ios-1\.png\?t=/);
  assert.match(page, /The official app of Joe&#039;s Pizza|The official app of Joe's Pizza/);
  assert.equal(f.row(`SELECT approved_at FROM store_app_listings`).approved_at, null, 'GET approves nothing');
  const pic = await call(f, url.replace('/listing?', '/listing/ios-1.png?'));
  assert.equal(pic.headers.get('Content-Type'), 'image/png');
  assert.equal((await call(f, `https://menu-made.com/api/store-app/${ID}/listing?t=bad`)).status, 403);
  assert.equal((await approve(f, url, { subtitle: 'x'.repeat(31) })).status, 400, 'over the limit is refused');
  await approve(f, url, { subtitle: 'Slices, salads and rewards' });
  const saved = JSON.parse(f.row(`SELECT listing_json FROM store_app_listings`).listing_json);
  assert.equal(saved.subtitle, 'Slices, salads and rewards');
  assert.ok(f.row(`SELECT approved_at FROM store_app_listings`).approved_at);
});

test("approved: submitted to Apple and Google with the restaurant's keys, then IN_REVIEW; live in both -> LIVE and the buyer gets the links", async () => {
  const f = await setup();
  const stores = fakeStores();
  await pictures(f);
  await tick(f, stores);
  await approve(f, previewUrl(f.emails[0]), { subtitle: 'Slices, salads and rewards' });
  await tick(f, stores);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'IN_REVIEW');
  const s = stores.seen;
  assert.equal(s.versionPatch.data.relationships.build.data.id, 'B9', 'the newest processed build');
  assert.equal(s.versionPatch.data.attributes.versionString, '1.0.0', "version matches the build's");
  assert.equal(s.info.subtitle, 'Slices, salads and rewards', "the owner's edit went to Apple");
  assert.equal(s.info.privacyPolicyUrl, 'https://menu-made.com/privacy.html');
  assert.ok(s.apple.includes('DELETE /appScreenshots/OLD1'), 'old screenshots replaced');
  assert.equal(s.uploads, 3, 'three iPhone screenshots');
  assert.deepEqual([s.review.contactFirstName, s.review.contactPhone, s.review.contactEmail], ['Joe', '(707) 555-0101', 'joe@joespizza.example'], 'Apple contacts the restaurant');
  assert.equal(s.submitted, true);
  assert.equal(s.playListing.title, "Joe's Pizza");
  assert.equal(s.play.filter((c) => /phoneScreenshots$/.test(c) && c.startsWith('POST')).length, 3);
  assert.deepEqual(s.release, { versionCodes: ['14'], status: 'completed' }, 'the newest internal build goes to production');

  await tick(f, stores);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'IN_REVIEW', 'checked at most hourly, and still in review');
  stores.state.appleState = 'READY_FOR_SALE';
  await tick(f, stores, Date.now() + 2 * 3600000);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'IN_REVIEW', 'Apple live, Google not yet');
  stores.state.playLive = true;
  await tick(f, stores, Date.now() + 4 * 3600000);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'LIVE');
  const live = f.emails.at(-1);
  assert.deepEqual(live.to, ['joe@joespizza.example']);
  assert.match(live.html, /apps\.apple\.com\/app\/idAPP1/);
  assert.match(live.html, /play\.google\.com\/store\/apps\/details\?id=com\.menumade\.joespizza/);
});

test("a store refusing the submission emails the owner its words; approving again retries", async () => {
  const f = await setup();
  const stores = fakeStores({ appleFail: { method: 'PATCH', path: '/appStoreVersions/V1', detail: 'You must set an age rating.' } });
  await pictures(f);
  await tick(f, stores);
  const url = previewUrl(f.emails[0]);
  await approve(f, url);
  await tick(f, stores);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'WAITING_SUBMIT_APPROVAL');
  const mail = f.emails.at(-1);
  assert.match(mail.subject, /Store submission needs a look/);
  assert.match(mail.html, /You must set an age rating/);
  const calls = stores.seen.apple.length;
  await tick(f, stores);
  assert.equal(stores.seen.apple.length, calls, 'not retried by itself');
  assert.match(await (await call(f, url)).text(), /Last try:.*age rating/s);
  await approve(f, url);
  await tick(f, stores);
  assert.ok(stores.seen.apple.length > calls, 'approve again retries');
});

test('Apple rejects -> REJECTED, owner gets Resolution Center and Build again; Google draft -> one-click email', async () => {
  const f = await setup();
  const stores = fakeStores({ playDraft: true });
  await pictures(f);
  await tick(f, stores);
  await approve(f, previewUrl(f.emails[0]));
  await tick(f, stores);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'IN_REVIEW');
  assert.equal(stores.seen.release.status, 'draft');
  assert.match(f.emails.at(-1).html, /Send changes for review/);
  stores.state.appleState = 'REJECTED';
  await tick(f, stores, Date.now() + 2 * 3600000);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'REJECTED');
  const mail = f.emails.at(-1);
  assert.match(mail.html, /Resolution Center/);
  assert.match(mail.html, /\/rebuild\?t=/);
});

test('a test order never reaches the stores: approval goes straight to LIVE with a [TEST] email', async () => {
  const f = await setup({ testOrder: true });
  const stores = fakeStores();
  await pictures(f);
  await tick(f, stores);
  assert.match(f.emails[0].subject, /^\[TEST\]/);
  await approve(f, previewUrl(f.emails[0]));
  await tick(f, stores);
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'LIVE');
  assert.equal(stores.seen.apple.length + stores.seen.play.length, 0, 'Apple and Google never called');
  assert.match(f.emails.at(-1).subject, /^\[TEST\] Joe's Pizza is live/);
});
