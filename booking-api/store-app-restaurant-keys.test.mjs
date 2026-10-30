// Stage 11 part 2: each restaurant's key page (/api/store-keys/app/<store app id>). The owner, invited as Admin in the
// restaurant's App Store Connect and Play Console, makes the restaurant's keys and uploads them here; they are stored
// under the restaurant's business id. Real ES256 and RSA keys are made here; Apple and Google are faked.
// Run: node --no-warnings --test booking-api/store-app-restaurant-keys.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const keys = await import('./src/store-app/keys.js');
const rkeys = await import('./src/store-app/restaurant-keys.js');
const gkeys = await import('./src/store-app/google-keys.js');
const google = await import('./src/store-app/google.js');
const { signLinkToken } = await import('./src/lib/links.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const ID = '11111111-2222-4333-8444-555555555555';
const PKG = 'com.menumade.joespizza';
const ISSUER = '69a6de70-03db-47e3-e053-5b8c7c11a4d1';
const TEAM = 'JOES123456';
const PROJECT = 'menu-made-apps';
const SA_EMAIL = `firebase-adminsdk-x1@${PROJECT}.iam.gserviceaccount.com`;
const RSA = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = JSON.stringify({ type: 'service_account', project_id: PROJECT, private_key_id: 'k1', private_key: RSA, client_email: SA_EMAIL, token_uri: 'https://oauth2.googleapis.com/token' });
const services = (pkg, project = PROJECT) => JSON.stringify({ project_info: { project_id: project, project_number: '1' }, client: [{ client_info: { android_client_info: { package_name: pkg } } }] });

async function p8() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

async function setup({ ownerGoogle = true, play = 200 } = {}) {
  google.tokenCache.clear();
  const DB = createD1(); const ASSETS = createR2();
  for (const m of ['0012_guest_app.sql', '0022_store_credentials.sql', '0025_store_app.sql']) DB.raw.exec(read(m));
  DB.raw.exec('PRAGMA foreign_keys = OFF');
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-30T00:00:00.000Z';
  sql(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES ('ga1', 'joes-pizza', 'p1', 'biz', 'cust', '{"app_name":"Joe''s Pizza"}', ?, ?)`, t, t);
  sql(`INSERT INTO store_apps (id, project_id, business_id, customer_id, bundle_id, status, created_at, updated_at) VALUES (?, 'p1', 'biz', 'cust', ?, 'WAITING_OWNER_SETUP', ?, ?)`, ID, PKG, t, t);
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', OWNER_EMAIL: 'info@menu-made.com' };
  if (ownerGoogle) {
    await keys.saveCredential(env, 'owner', 'FIREBASE_ACCOUNT', { keyId: SA_EMAIL, teamId: PROJECT, p8: SA, status: 'VERIFIED', note: 'ok' });
    await keys.saveCredential(env, 'owner', 'GOOGLE_PLAY_ACCOUNT', { keyId: SA_EMAIL, teamId: PROJECT, p8: SA, status: 'VERIFIED', note: 'ok' });
  }
  const calls = []; const emails = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'e1' }); }
    if (u.startsWith('https://api.appstoreconnect.apple.com/v1/bundleIds')) {
      assert.match(u, new RegExp(PKG.replaceAll('.', '\\.')), "Apple is asked about the restaurant's app, not the test app");
      return Response.json({ data: [{ type: 'bundleIds', id: 'B1', attributes: { identifier: PKG, seedId: TEAM } }] });
    }
    if (u.startsWith('https://api.sandbox.push.apple.com/3/device/')) return Response.json({ reason: 'BadDeviceToken' }, { status: 400 });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
    if (u.includes('androidpublisher')) {
      assert.match(u, new RegExp(`applications/${PKG.replaceAll('.', '\\.')}/edits`));
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return play === 200 ? Response.json({ id: 'edit1' }) : Response.json({ error: { status: 'PERMISSION_DENIED', message: 'no' } }, { status: play });
    }
    throw new Error(`Unexpected fetch ${u}`);
  };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, DB, ASSETS, calls, emails, fetchImpl, row };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const PAGE = `https://menu-made.com/api/store-keys/app/${ID}`;
const call = (f, url, init) => withFetch(f.fetchImpl, () => worker.fetch(new Request(url, init), f.env, { waitUntil() {} }));
const token = (f) => signLinkToken(f.env, { kind: rkeys.LINK_KIND, id: ID, ttlDays: 1 / 24 });
async function upload(f, fields, files) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const [k, [name, text]] of Object.entries(files)) form.set(k, new File([text], name, { type: 'application/octet-stream' }));
  return call(f, PAGE, { method: 'POST', body: form });
}

test('no token to remember: the page shows the checklist with the exact values and emails a one-hour link to the owner inbox', async () => {
  const f = await setup();
  const start = await (await call(f, PAGE)).text();
  assert.match(start, /com\.menumade\.joespizza/);
  assert.match(start, new RegExp(SA_EMAIL.replaceAll('.', '\\.')), 'shows the Play account email to invite');
  assert.match(start, /menu-made-apps/, 'names the Firebase project to add the app to');
  assert.match(start, /not uploaded yet/);
  const sent = await (await call(f, PAGE, { method: 'POST' })).text();
  assert.match(sent, /Check your email/);
  assert.equal(f.emails.length, 1);
  assert.deepEqual(f.emails[0].to, ['info@menu-made.com']);
  const link = /href="([^"]+\/api\/store-keys\/app\/[^"]+)"/.exec(f.emails[0].html)[1].replaceAll('&amp;', '&');
  const formPage = await (await call(f, link)).text();
  assert.match(formPage, /name="api_file"/);
  assert.match(formPage, /name="services_file"/);
  assert.equal((await call(f, `${PAGE}?t=bad`)).status, 403);
  const other = await signLinkToken(f.env, { kind: rkeys.LINK_KIND, id: '99999999-2222-4333-8444-555555555555', ttlDays: 1 });
  assert.equal((await call(f, `${PAGE}?t=${encodeURIComponent(other)}`)).status, 403, "another app's link doesn't open this one");
  const ownerPageToken = await signLinkToken(f.env, { kind: keys.LINK_KIND, id: 'owner', ttlDays: 1 });
  assert.equal((await call(f, `${PAGE}?t=${encodeURIComponent(ownerPageToken)}`)).status, 403, "the owner's own key link doesn't open a restaurant's page");
  assert.equal((await call(f, 'https://menu-made.com/api/store-keys/app/99999999-2222-4333-8444-555555555555')).status, 404);
});

test("all three files: Apple checks the restaurant's app, Play access is copied and checked, everything stored under the business id", async () => {
  const f = await setup();
  const t = await token(f);
  const res = await upload(f, { t, issuer_id: ISSUER }, {
    api_file: ['AuthKey_APIKEY1234.p8', await p8()], push_file: ['AuthKey_PUSHKEY123.p8', await p8()], services_file: ['google-services.json', services(PKG)]
  });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Keys saved/);
  assert.match(html, /Everything the build needs is here/);
  const api = f.row(`SELECT * FROM store_credentials WHERE scope = 'biz' AND kind = 'APPLE_API_KEY'`);
  assert.equal(api.check_status, 'VERIFIED');
  assert.equal(api.team_id, TEAM, "team id read from the restaurant's App ID");
  assert.ok(api.sealed.startsWith('v1.') && !api.sealed.includes('PRIVATE'), 'stored sealed');
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE scope = 'biz' AND kind = 'APPLE_PUSH_KEY'`).check_status, 'VERIFIED');
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE scope = 'biz' AND kind = 'GOOGLE_PLAY_ACCOUNT'`).check_status, 'VERIFIED');
  assert.ok(await f.ASSETS.get(gkeys.servicesKey('biz')), 'google-services.json kept for the build');
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM store_credentials WHERE scope = 'owner'`).n, 2, "the owner's own keys are untouched");
  const play = await keys.loadCredential(f.env, 'biz', 'GOOGLE_PLAY_ACCOUNT');
  assert.equal(play.p8, SA, "the restaurant's Play copy is the owner's current key");
  assert.deepEqual(await rkeys.keysReady(f.env, { business_id: 'biz' }), { ready: true, missing: [] });
});

test('wrong files are refused before anything is stored; partial uploads say what is still needed', async () => {
  const f = await setup();
  const t = await token(f);
  let html = await (await upload(f, { t }, { services_file: ['google-services.json', services('com.menumade.samplecafe')] })).text();
  assert.match(html, /is for com\.menumade\.samplecafe, not com\.menumade\.joespizza/);
  html = await (await upload(f, { t }, { services_file: ['google-services.json', services(PKG, 'someone-else')] })).text();
  assert.match(html, /Firebase project someone-else/);
  html = await (await upload(f, { t }, { services_file: ['google-services.json', SA] })).text();
  assert.match(html, /isn&#039;t a google-services\.json|isn't a google-services\.json/);
  assert.equal(await f.ASSETS.get(gkeys.servicesKey('biz')), null);
  html = await (await upload(f, { t }, { api_file: ['AuthKey_APIKEY1234.p8', await p8()] })).text();
  assert.match(html, /Issuer ID too/);
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM store_credentials WHERE scope = 'biz'`).n, 0);

  html = await (await upload(f, { t }, { services_file: ['google-services.json', services(PKG)] })).text();
  assert.match(html, /Saved so far/);
  assert.match(html, /Still needed: a working App Store Connect API key, the Apple push key/);
  const ready = await rkeys.keysReady(f.env, { business_id: 'biz' });
  assert.equal(ready.ready, false);
});

test("Play not invited yet is reported but doesn't block; no owner Google files says where to upload them", async () => {
  const f = await setup({ play: 403 });
  const t = await token(f);
  const html = await (await upload(f, { t, issuer_id: ISSUER }, {
    api_file: ['AuthKey_APIKEY1234.p8', await p8()], push_file: ['AuthKey_PUSHKEY123.p8', await p8()], services_file: ['google-services.json', services(PKG)]
  })).text();
  assert.match(html, /❌ <strong>Google Play<\/strong>: Google Play refused this account/);
  assert.match(html, /Everything the build needs is here/, 'the first Android file goes up by hand anyway');
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE scope = 'biz' AND kind = 'GOOGLE_PLAY_ACCOUNT'`).check_status, 'FAILED');

  const g = await setup({ ownerGoogle: false });
  const html2 = await (await upload(g, { t: await token(g) }, { services_file: ['google-services.json', services(PKG)] })).text();
  assert.match(html2, /store-keys\/google/);
});

test('saved keys are checked again with no upload (empty form)', async () => {
  const f = await setup();
  const t = await token(f);
  await upload(f, { t, issuer_id: ISSUER }, { api_file: ['AuthKey_APIKEY1234.p8', await p8()], push_file: ['AuthKey_PUSHKEY123.p8', await p8()], services_file: ['google-services.json', services(PKG)] });
  const before = f.calls.length;
  const html = await (await upload(f, { t }, {})).text();
  assert.match(html, /API key APIKEY1234/);
  assert.match(html, /Push key PUSHKEY123/);
  assert.ok(f.calls.slice(before).some((u) => u.startsWith('https://api.appstoreconnect.apple.com/')), 'checked with Apple again');
});
