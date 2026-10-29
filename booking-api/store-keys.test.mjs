// Stage 11 part 2: the Apple key upload page (/api/store-keys/owner) and the Apple checks behind it.
// Real ES256 keys made here; App Store Connect and APNs are faked.
// Run: node --no-warnings --test booking-api/store-keys.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const keys = await import('./src/store-app/keys.js');
const apple = await import('./src/store-app/apple.js');
const { base64UrlDecode, signLinkToken } = await import('./src/lib/links.js');

async function p8() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  return { text: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}
async function verifyJwt(jwt, publicKey) {
  const [h, p, s] = jwt.split('.');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, base64UrlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  return { ok, header: JSON.parse(new TextDecoder().decode(base64UrlDecode(h))), payload: JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) };
}

const ISSUER = '69a6de70-03db-47e3-e053-5b8c7c11a4d1';
const TEAM = 'ABCDE12345';
function setup({ ascStatus = 200, apnsStatus = 400, apnsReason = 'BadDeviceToken', apnsThrows = false } = {}) {
  const DB = createD1();
  DB.raw.exec(readFileSync(new URL('./migrations/0022_store_credentials.sql', import.meta.url), 'utf8'));
  const calls = []; const emails = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'e1' }); }
    if (u.startsWith('https://api.appstoreconnect.apple.com/v1/bundleIds')) {
      return ascStatus === 200 ? Response.json({ data: [{ type: 'bundleIds', id: 'B1', attributes: { identifier: 'com.menumade.samplecafe', seedId: TEAM } }] }) : new Response('{}', { status: ascStatus });
    }
    if (u.startsWith('https://api.sandbox.push.apple.com/3/device/')) {
      if (apnsThrows) throw new Error('protocol error');
      return Response.json({ reason: apnsReason }, { status: apnsStatus });
    }
    throw new Error(`Unexpected fetch ${u}`);
  };
  const env = { DB, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test' };
  return { env, DB, calls, emails, fetchImpl, row: (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; } };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = (f, url, init) => worker.fetch(new Request(url, init), f.env, { waitUntil() {} });
const PAGE = 'https://menu-made.com/api/store-keys/owner';
async function upload(f, fields, files) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const [k, [name, text]] of Object.entries(files)) form.set(k, new File([text], name, { type: 'application/octet-stream' }));
  return withFetch(f.fetchImpl, () => call(f, PAGE, { method: 'POST', body: form }));
}
const token = (f) => signLinkToken(f.env, { kind: keys.LINK_KIND, id: keys.OWNER, ttlDays: 1 / 24 });

test('no token to remember: the page emails a one-hour link to the owner inbox, and the link opens the form', async () => {
  const f = setup();
  const start = await call(f, PAGE);
  assert.match(await start.text(), /Email me the link/);
  const sent = await withFetch(f.fetchImpl, () => call(f, PAGE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' }));
  assert.match(await sent.text(), /Check your email/);
  assert.equal(f.emails.length, 1);
  assert.equal(f.emails[0].to[0] || f.emails[0].to, 'info@menu-made.com');
  const link = /https:\/\/menu-made\.com\/api\/store-keys\/owner\?t=[^"\s]+/.exec(f.emails[0].text)[0];
  const form = await call(f, link);
  assert.equal(form.status, 200);
  assert.match(await form.text(), /name="api_file"[\s\S]*name="issuer_id"[\s\S]*name="push_file"/);
  assert.equal((await call(f, `${PAGE}?t=forged`)).status, 403);
});

test('both keys: checked live with Apple, team id read from the App ID, stored sealed, JWTs signed correctly', async () => {
  const f = setup();
  const api = await p8(); const push = await p8();
  const res = await upload(f, { t: await token(f), issuer_id: ISSUER }, { api_file: ['AuthKey_APIKEY1234.p8', api.text], push_file: ['AuthKey_PUSHKEY123.p8', push.text] });
  const html = await res.text();
  assert.match(html, /Keys saved and working/);
  const apiRow = f.row(`SELECT * FROM store_credentials WHERE kind = 'APPLE_API_KEY'`);
  const pushRow = f.row(`SELECT * FROM store_credentials WHERE kind = 'APPLE_PUSH_KEY'`);
  assert.deepEqual([apiRow.key_id, apiRow.issuer_id, apiRow.team_id, apiRow.check_status], ['APIKEY1234', ISSUER, TEAM, 'VERIFIED']);
  assert.deepEqual([pushRow.key_id, pushRow.team_id, pushRow.check_status], ['PUSHKEY123', TEAM, 'VERIFIED']);
  for (const row of [apiRow, pushRow]) { assert.match(row.sealed, /^v1\./); assert.ok(!row.sealed.includes('PRIVATE KEY')); }
  assert.ok(!html.includes('PRIVATE KEY'), 'never shown back');
  assert.equal((await keys.loadCredential(f.env, 'owner', 'APPLE_API_KEY')).p8, api.text, 'unseals to the same file');

  const asc = await verifyJwt(f.calls.find((c) => c.url.includes('appstoreconnect')).init.headers.Authorization.slice(7), api.publicKey);
  assert.ok(asc.ok);
  assert.deepEqual([asc.header.alg, asc.header.kid, asc.payload.iss, asc.payload.aud], ['ES256', 'APIKEY1234', ISSUER, 'appstoreconnect-v1']);
  assert.equal(asc.payload.exp - asc.payload.iat, 900, '15 minutes: under Apple\'s 20-minute limit even if its clock lags');
  const apnsCall = f.calls.find((c) => c.url.includes('push.apple.com'));
  const apns = await verifyJwt(apnsCall.init.headers.authorization.slice(7), push.publicKey);
  assert.ok(apns.ok);
  assert.deepEqual([apns.header.kid, apns.payload.iss], ['PUSHKEY123', TEAM]);
  assert.equal(apnsCall.init.headers['apns-topic'], 'com.menumade.samplecafe');
  assert.match(apnsCall.url, /\/3\/device\/0{64}$/, 'a device token that cannot exist: nothing reaches a phone');
});

test('Apple refusing a key is reported per key; an unreachable push service saves the key as unconfirmed', async () => {
  const bad = setup({ ascStatus: 401 });
  const api = await p8();
  const html = await (await upload(bad, { t: await token(bad), issuer_id: ISSUER }, { api_file: ['AuthKey_APIKEY1234.p8', api.text] })).text();
  assert.match(html, /Apple refused the key/);
  assert.equal(bad.row(`SELECT check_status FROM store_credentials`).check_status, 'FAILED');

  const wrongPush = setup({ apnsStatus: 403, apnsReason: 'InvalidProviderToken' });
  const push = await p8();
  await upload(wrongPush, { t: await token(wrongPush), issuer_id: ISSUER }, { api_file: ['AuthKey_APIKEY1234.p8', api.text], push_file: ['AuthKey_PUSHKEY123.p8', push.text] });
  assert.equal(wrongPush.row(`SELECT check_status FROM store_credentials WHERE kind = 'APPLE_PUSH_KEY'`).check_status, 'FAILED');

  const down = setup({ apnsThrows: true });
  const page = await (await upload(down, { t: await token(down), issuer_id: ISSUER }, { api_file: ['AuthKey_APIKEY1234.p8', api.text], push_file: ['AuthKey_PUSHKEY123.p8', push.text] })).text();
  assert.match(page, /couldn&#039;t be reached/);
  assert.equal(down.row(`SELECT check_status FROM store_credentials WHERE kind = 'APPLE_PUSH_KEY'`).check_status, 'UNVERIFIED');
});

test('the form refuses wrong input before anything is stored', async () => {
  const f = setup();
  const api = await p8();
  const t = await token(f);
  const cases = [
    [{ t }, {}, /Choose at least one key file/],
    [{ t, issuer_id: ISSUER }, { api_file: ['AuthKey_APIKEY1234.p8', 'hello'] }, /not an Apple \.p8 key file/],
    [{ t, issuer_id: 'nope' }, { api_file: ['AuthKey_APIKEY1234.p8', api.text] }, /Issuer ID should look like/],
    [{ t, issuer_id: ISSUER }, { api_file: ['key.p8', api.text] }, /was renamed/],
    [{ t, issuer_id: ISSUER }, { api_file: ['AuthKey_SAMEKEY123.p8', api.text], push_file: ['AuthKey_SAMEKEY123.p8', api.text] }, /two different files/]
  ];
  for (const [fields, files, expected] of cases) assert.match(await (await upload(f, fields, files)).text(), expected);
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM store_credentials`).n, 0);
  const expired = await upload(f, { t: 'forged', issuer_id: ISSUER }, { api_file: ['AuthKey_APIKEY1234.p8', api.text] });
  assert.equal(expired.status, 403);
});

test('a renamed file works with the typed key id; a push key alone waits for the team id', async () => {
  const f = setup();
  const push = await p8();
  const html = await (await upload(f, { t: await token(f), push_key_id: 'pushkey123' }, { push_file: ['key (1).p8', push.text] })).text();
  assert.match(html, /checked once the API key works/);
  const row = f.row(`SELECT key_id, check_status FROM store_credentials`);
  assert.deepEqual([row.key_id, row.check_status], ['PUSHKEY123', 'UNVERIFIED']);
  assert.equal(keys.keyIdOf({ name: 'AuthKey_AB12CD34EF.p8' }, ''), 'AB12CD34EF');
});

test('saved keys are checked again without uploading anything, with a corrected Issuer ID; the push key follows once the API key works', async () => {
  const f = setup({ ascStatus: 401 });
  const api = await p8(); const push = await p8();
  const t = await token(f);
  await upload(f, { t, issuer_id: ISSUER }, { api_file: ['AuthKey_APIKEY1234.p8', api.text], push_file: ['AuthKey_PUSHKEY123.p8', push.text] });
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE kind = 'APPLE_API_KEY'`).check_status, 'FAILED');
  const failedPage = await (await upload(f, { t }, {})).text();
  assert.match(failedPage, /Check saved keys again/);
  // Apple now accepts (the fixed token, or a corrected Issuer ID).
  const ok = setup();
  f.fetchImpl = ok.fetchImpl; f.calls = ok.calls;
  const fixed = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const html = await (await upload(f, { t, issuer_id: fixed }, {})).text();
  assert.match(html, /Keys saved and working/);
  const apiRow = f.row(`SELECT issuer_id, team_id, check_status FROM store_credentials WHERE kind = 'APPLE_API_KEY'`);
  assert.deepEqual([apiRow.issuer_id, apiRow.team_id, apiRow.check_status], [fixed, TEAM, 'VERIFIED']);
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE kind = 'APPLE_PUSH_KEY'`).check_status, 'VERIFIED');
  assert.equal((await keys.loadCredential(f.env, 'owner', 'APPLE_PUSH_KEY')).p8, push.text, 'the saved file was reused');
});
