// Stage 11 part 2, Android: the Google files page (checklist, live checks, files sorted by what they are), Android
// phones registering and getting notifications from the worker through Firebase, and what the signed Android build
// gets from the worker (Google files, a kept upload key, the first-upload email with a download link).
// Run: node --no-warnings --test booking-api/store-app-android.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const engage = await import('./src/producers/guest-app/engage.js');
const native = await import('./src/store-app/native-push.js');
const google = await import('./src/store-app/google.js');
const gkeys = await import('./src/store-app/google-keys.js');
const keys = await import('./src/store-app/keys.js');
const { signLinkToken } = await import('./src/lib/links.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const APP_ID = '11111111-2222-4333-8444-555555555555';
const PKG = 'com.menumade.samplecafe';
const PROJECT = 'menu-made-apps';
const EMAIL = `firebase-adminsdk-x1@${PROJECT}.iam.gserviceaccount.com`;
const RSA = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = JSON.stringify({ type: 'service_account', project_id: PROJECT, private_key_id: 'k1', private_key: RSA, client_email: EMAIL, token_uri: 'https://oauth2.googleapis.com/token' });
const SERVICES = JSON.stringify({ project_info: { project_id: PROJECT, project_number: '123' }, client: [{ client_info: { android_client_info: { package_name: PKG } } }] });
const FCM_A = `fA:${'a'.repeat(140)}`;
const FCM_B = `fB:${'b'.repeat(140)}`;

async function setup() {
  google.tokenCache.clear();
  const DB = createD1(); const ASSETS = createR2();
  for (const m of ['0009_website_package.sql', '0012_guest_app.sql', '0021_guest_app_engagement.sql', '0022_store_credentials.sql', '0023_native_push.sql', '0024_android.sql']) DB.raw.exec(read(m));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Sample Cafe')`, t, t);
  sql(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES (?, 'sample-cafe', 'p1', 'biz', 'cust', '{"app_name":"Sample Cafe"}', ?, ?)`, APP_ID, t, t);
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret' };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : r; };
  return { env, DB, ASSETS, sql, row };
}
const call = (f, url, init) => worker.fetch(new Request(url, init), f.env, { waitUntil() {} });

// A fake Google: token endpoint, FCM and Play answers chosen per test.
function fakeGoogle({ fcm = () => [400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }], play = () => [404, { error: { status: 'NOT_FOUND', message: 'Package not found' } }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
    if (String(url).includes('fcm.googleapis.com')) { const [s, b] = fcm(JSON.parse(init.body)); return Response.json(b, { status: s }); }
    if (String(url).includes('androidpublisher')) { const [s, b] = play(url, init); return Response.json(b, { status: s }); }
    return new Response('no', { status: 500 });
  };
  return { calls, fetchImpl };
}

async function upload(f, fields, files, fetchImpl) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const [k, [name, text]] of Object.entries(files)) form.set(k, new File([text], name, { type: 'application/json' }));
  return gkeys.handleGoogleKeys(new Request('https://menu-made.com/api/store-keys/google', { method: 'POST', body: form }), f.env, { fetchImpl });
}
const linkToken = (f) => signLinkToken(f.env, { kind: gkeys.LINK_KIND, id: 'owner', ttlDays: 1 / 24 });

test('parsers: service account keys and google-services.json are recognised, other files are not', () => {
  assert.equal(google.parseServiceAccount(SA).client_email, EMAIL);
  assert.equal(google.parseServiceAccount(SERVICES), null);
  assert.equal(google.parseServiceAccount(JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: RSA, token_uri: 'https://evil.example/token' })), null, 'tokens only go to Google');
  assert.deepEqual(google.parseGoogleServices(SERVICES), { projectId: PROJECT, packages: [PKG] });
  assert.equal(google.parseGoogleServices(SA), null);
});

test('Google files page: checklist without a link; upload checks with Google, stores, and shows the email to invite', async () => {
  const f = await setup();
  const landing = await (await call(f, 'https://menu-made.com/api/store-keys/google')).text();
  assert.match(landing, /Menu-made apps/);
  assert.match(landing, new RegExp(PKG.replace(/\./g, '\\.')));
  assert.match(landing, /Email me the upload link/);
  assert.equal((await call(f, 'https://menu-made.com/api/store-keys/google?t=bad')).status, 403);
  const g = fakeGoogle();
  const t = await linkToken(f);
  // the two files in each other's boxes still work
  const res = await upload(f, { t }, { sa_file: ['google-services.json', SERVICES], services_file: ['key.json', SA] }, g.fetchImpl);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, new RegExp(EMAIL.replace(/\./g, '\\.')));
  assert.match(html, /✅ <strong>Push \(Firebase\)<\/strong>/);
  assert.match(html, /⚠️ <strong>Google Play<\/strong>: Saved\. Google Play doesn&#039;t know/);
  const fcmCall = g.calls.find((c) => c.url.includes('fcm.googleapis.com'));
  assert.match(fcmCall.url, /projects\/menu-made-apps\/messages:send$/);
  assert.equal(JSON.parse(fcmCall.init.body).validate_only, true, 'the check never sends a real notification');
  assert.equal((await keys.loadCredential(f.env, 'owner', 'FIREBASE_ACCOUNT')).p8, SA);
  assert.deepEqual(f.row(`SELECT key_id, team_id, check_status FROM store_credentials WHERE kind = 'FIREBASE_ACCOUNT'`), { key_id: EMAIL, team_id: PROJECT, check_status: 'VERIFIED' });
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE kind = 'GOOGLE_PLAY_ACCOUNT'`).check_status, 'UNVERIFIED');
  assert.equal(await gkeys.loadGoogleServices(f.env, 'owner'), SERVICES);

  // after the Play invite: check again without files
  const g2 = fakeGoogle({ play: (url, init) => (init.method === 'DELETE' ? [204, {}] : [200, { id: 'edit1' }]) });
  google.tokenCache.clear();
  const again = await (await upload(f, { t }, {}, g2.fetchImpl)).text();
  assert.match(again, /✅ <strong>Google Play<\/strong>/);
  assert.ok(g2.calls.some((c) => c.init.method === 'DELETE' && c.url.endsWith('/edits/edit1')), 'the check discards its edit');
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE kind = 'GOOGLE_PLAY_ACCOUNT'`).check_status, 'VERIFIED');
});

test('Google files page: refuses the wrong app, mismatched projects and a refused key', async () => {
  const f = await setup();
  const t = await linkToken(f);
  const other = JSON.stringify({ project_info: { project_id: PROJECT }, client: [{ client_info: { android_client_info: { package_name: 'com.other.app' } } }] });
  assert.match(await (await upload(f, { t }, { services_file: ['google-services.json', other] }, fakeGoogle().fetchImpl)).text(), /is for com\.other\.app/);
  const otherProject = JSON.stringify({ ...JSON.parse(SA), project_id: 'some-other' });
  assert.match(await (await upload(f, { t }, { sa_file: ['k.json', otherProject], services_file: ['g.json', SERVICES] }, fakeGoogle().fetchImpl)).text(), /Both must come from the same Firebase project/);
  google.tokenCache.clear();
  const denied = fakeGoogle({ fcm: () => [403, { error: { status: 'PERMISSION_DENIED', message: 'Firebase Cloud Messaging API has not been used in project 123 before or it is disabled' } }] });
  assert.match(await (await upload(f, { t }, { sa_file: ['k.json', SA] }, denied.fetchImpl)).text(), /Firebase Cloud Messaging API is turned off/);
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE kind = 'FIREBASE_ACCOUNT'`).check_status, 'FAILED');
  assert.match(await (await upload(f, { t }, { sa_file: ['notes.json', '{"hello":1}'] }, fakeGoogle().fetchImpl)).text(), /aren&#039;t the Firebase service account key/);
});

async function withFirebase(f) {
  await keys.saveCredential(f.env, 'owner', 'FIREBASE_ACCOUNT', { keyId: EMAIL, teamId: PROJECT, p8: SA, status: 'UNVERIFIED' });
}
const register = (f, token) => call(f, 'https://menu-made.com/api/site/sample-cafe/app/api/push/native', {
  method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'android', token, bundle_id: PKG })
});

test('Android push: phones register from the Android origin, the tick sends through Firebase and retires dead tokens', async () => {
  const f = await setup();
  await withFirebase(f);
  assert.equal((await register(f, FCM_A)).status, 200);
  assert.equal((await register(f, FCM_B)).status, 200);
  assert.equal((await register(f, 'short')).status, 400);
  assert.equal(f.row(`SELECT token FROM native_push_devices WHERE token = ?`, FCM_A).token, FCM_A, 'Firebase tokens keep their case');
  const queued = await engage.queuePush(f.env, APP_ID, { title: 'Soup', body: 'Tomato basil today' });
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM native_push_jobs`).n, 0, 'no iOS job without iPhones');
  assert.deepEqual(f.row(`SELECT message_id, status FROM android_push_jobs`), { message_id: queued.id, status: 'QUEUED' });
  const g = fakeGoogle({ fcm: (body) => (body.message.token === FCM_A ? [200, { name: 'projects/x/messages/1' }] : [404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }]) });
  const out = await native.sendAndroidPushes(f.env, { fetchImpl: g.fetchImpl });
  assert.equal(out.sent, 1);
  const sent = JSON.parse(g.calls.find((c) => c.url.includes('fcm') && c.init.body.includes(FCM_A)).init.body);
  assert.deepEqual(sent.message.notification, { title: 'Soup', body: 'Tomato basil today' });
  assert.equal(sent.validate_only, undefined);
  assert.equal(f.row(`SELECT status FROM native_push_devices WHERE token = ?`, FCM_B).status, 'GONE');
  assert.deepEqual(f.row(`SELECT status, sent_count, gone_count FROM android_push_jobs`), { status: 'SENT', sent_count: 1, gone_count: 1 });
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE kind = 'FIREBASE_ACCOUNT'`).check_status, 'VERIFIED');
});

test('Android push: a refused key fails the job and keeps the phones; no key on file fails it too', async () => {
  const f = await setup();
  await withFirebase(f);
  await register(f, FCM_A);
  await engage.queuePush(f.env, APP_ID, { title: 'Soup', body: 'Tomato basil today' });
  const g = fakeGoogle({ fcm: () => [403, { error: { status: 'PERMISSION_DENIED', message: 'denied' } }] });
  await native.sendAndroidPushes(f.env, { fetchImpl: g.fetchImpl });
  assert.equal(f.row(`SELECT status FROM android_push_jobs`).status, 'FAILED');
  assert.equal(f.row(`SELECT status FROM native_push_devices`).status, 'ACTIVE');
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE kind = 'FIREBASE_ACCOUNT'`).check_status, 'FAILED');

  const h = await setup();
  await register(h, FCM_A);
  await engage.queuePush(h.env, APP_ID, { title: 'Soup', body: 'Tomato basil today' });
  await native.sendAndroidPushes(h.env, { fetchImpl: fakeGoogle().fetchImpl });
  assert.deepEqual(h.row(`SELECT status, note FROM android_push_jobs`), { status: 'FAILED', note: 'No Firebase key on file' });
});

async function oidc(f) {
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const kid = `kid-android-${crypto.randomUUID()}`;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
  f.env.RENDER_OIDC_FETCH = async () => Response.json({ keys: [jwk] });
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-store-build', exp: now + 300, nbf: now - 5, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master',
    job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/store-app-build.yml@refs/heads/master', event_name: 'workflow_dispatch' };
  const sign = async (claims) => { const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })); const b = b64u(JSON.stringify(claims));
    return `${h}.${b}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${b}`))))}`; };
  return async (path, init = {}, claims = good) => call(f, `https://menu-made.com${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await sign(claims)}` } });
}

test('Android build: gets the Google files, keeps the first upload key, and a first-upload bundle is emailed as a download', async () => {
  const f = await setup();
  const req = await oidc(f);
  assert.equal((await req('/api/store-build/credentials?scope=owner&platform=android')).status, 409, 'nothing before google-services.json');
  await f.ASSETS.put(gkeys.servicesKey('owner'), SERVICES);
  await keys.saveCredential(f.env, 'owner', 'GOOGLE_PLAY_ACCOUNT', { keyId: EMAIL, teamId: PROJECT, p8: SA, status: 'UNVERIFIED' });
  const creds = await (await req('/api/store-build/credentials?scope=owner&platform=android')).json();
  assert.deepEqual([creds.android.package, creds.android.google_services, creds.android.play_account, creds.android.upload_key], [PKG, SERVICES, SA, null]);
  assert.equal((await req('/api/store-build/credentials?scope=owner&platform=android', {}, { event_name: 'push', iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-store-build', exp: Math.floor(Date.now() / 1000) + 300, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master', job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/store-app-build.yml@refs/heads/master' })).status, 403);

  const first = { jks: 'A'.repeat(2400), password: 'p'.repeat(48) };
  const kept = await (await req('/api/store-build/android-key?scope=owner', { method: 'POST', body: JSON.stringify(first) })).json();
  assert.deepEqual(kept.upload_key, first);
  const racing = await (await req('/api/store-build/android-key?scope=owner', { method: 'POST', body: JSON.stringify({ jks: 'B'.repeat(2400), password: 'q'.repeat(48) }) })).json();
  assert.deepEqual(racing.upload_key, first, 'the first key wins');
  assert.ok(!f.row(`SELECT sealed FROM android_upload_keys`).sealed.includes('AAAA'), 'stored sealed');
  assert.deepEqual((await (await req('/api/store-build/credentials?scope=owner&platform=android')).json()).android.upload_key, first);

  const aab = new Uint8Array(5000); aab[0] = 0x50; aab[1] = 0x4b;
  const stored = await (await req('/api/store-build/android-bundle?scope=owner&version=12', { method: 'POST', body: aab })).json();
  assert.equal(stored.stored, 5000);
  assert.equal((await req('/api/store-build/android-bundle?scope=owner&version=13', { method: 'POST', body: new Uint8Array(5000) })).status, 422);
  const t = await signLinkToken(f.env, { kind: 'storebundle', id: '12', ttlDays: 7 });
  const dl = await call(f, `https://menu-made.com/api/store-build/bundle/12?t=${encodeURIComponent(t)}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('Content-Disposition'), /sample-cafe-12\.aab/);
  assert.equal((await dl.arrayBuffer()).byteLength, 5000);
  assert.equal((await call(f, `https://menu-made.com/api/store-build/bundle/13?t=${encodeURIComponent(t)}`)).status, 403, 'a link is for its own build only');
});

test('app shell: Android push only when the build carried google-services.json', () => {
  const app = readFileSync(new URL('../app-shell/www/app.js', import.meta.url), 'utf8');
  const wf = readFileSync(new URL('../.github/workflows/store-app-build.yml', import.meta.url), 'utf8');
  assert.match(app, /p === "android" && cfg\.push_android/);
  assert.match(wf, /\.push_android = true/);
  assert.match(wf, /cp "\$RUNNER_TEMP\/google-services\.json" android\/app\/google-services\.json/);
  assert.match(wf, /android-bundle\?\$TARGET/);
  assert.match(wf, /echo "TARGET=scope=owner"/, 'the sample build keeps the owner scope');
  assert.match(wf, /echo "TARGET=store_app=\$STORE_APP"/, "a restaurant's build asks by store app id");
  assert.match(wf, /api\/store-build\/result\?store_app=/, 'signed jobs report back');
  assert.match(wf, /sips -s format jpeg/, 'the iOS icon loses its alpha channel (Apple refuses it)');
});
