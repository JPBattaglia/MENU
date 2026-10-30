// Stage 11 part 2: native push for the Store App. The phone registers its Apple token; a queued notification makes a
// native job and starts the GitHub sender; only that workflow's OIDC token can claim a batch (with the push key) and
// report results; Apple's answers retire dead tokens, prove the key, or stop on a refused key.
// Run: node --no-warnings --test booking-api/store-app-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const engage = await import('./src/producers/guest-app/engage.js');
const native = await import('./src/store-app/native-push.js');
const keys = await import('./src/store-app/keys.js');
const { patch } = await import('../app-shell/patch-ios.mjs');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const APP_ID = '11111111-2222-4333-8444-555555555555';
const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);
const BUNDLE = 'com.menumade.samplecafe';
const P8 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });

async function setup({ key = 'UNVERIFIED' } = {}) {
  const DB = createD1(); const ASSETS = createR2();
  for (const m of ['0009_website_package.sql', '0012_guest_app.sql', '0021_guest_app_engagement.sql', '0022_store_credentials.sql', '0023_native_push.sql']) DB.raw.exec(read(m));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Sample Cafe')`, t, t);
  sql(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES (?, 'sample-cafe', 'p1', 'biz', 'cust', '{"app_name":"Sample Cafe"}', ?, ?)`, APP_ID, t, t);
  const dispatches = [];
  const env = {
    DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', GITHUB_DISPATCH_TOKEN: 'github_pat_test',
    GITHUB_DISPATCH_FETCH: async (url, init) => { dispatches.push({ url, body: init.body }); return new Response(null, { status: 204 }); }
  };
  if (key) await keys.saveCredential(env, 'owner', 'APPLE_PUSH_KEY', { keyId: 'GWV8T93MNC', teamId: 'TEAM123456', p8: P8, status: key });
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : r; };
  return { env, DB, sql, row, dispatches };
}
const call = (f, url, init) => worker.fetch(new Request(url, init), f.env, { waitUntil() {} });
const APP = 'https://menu-made.com/api/site/sample-cafe/app/api/';
const register = (f, body, origin = 'capacitor://localhost') => call(f, `${APP}push/native`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function oidc(f) {
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const kid = `kid-native-push-${crypto.randomUUID()}`; // the worker caches signing keys by kid
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
  f.env.RENDER_OIDC_FETCH = async () => Response.json({ keys: [jwk] });
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-native-push', exp: now + 300, nbf: now - 5, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master',
    job_workflow_ref: native.PUSH_WORKFLOW, event_name: 'workflow_dispatch' };
  const sign = async (claims) => { const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })); const b = b64u(JSON.stringify(claims));
    return `${h}.${b}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${b}`))))}`; };
  const req = async (path, body, claims = good) => call(f, `https://menu-made.com/api/native-push/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${await sign(claims)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
  });
  return { good, req };
}

test('registration: the Store App registers its Apple token from the native origin only, and only valid tokens', async () => {
  const f = await setup();
  const res = await register(f, { platform: 'ios', token: TOKEN_A.toUpperCase(), bundle_id: BUNDLE, environment: 'production' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'capacitor://localhost');
  const device = f.row(`SELECT * FROM native_push_devices`);
  assert.deepEqual([device.app_id, device.platform, device.token, device.bundle_id, device.environment, device.status], [APP_ID, 'IOS', TOKEN_A, BUNDLE, 'production', 'ACTIVE']);
  // the same phone again: one row, revived if it had gone
  f.sql(`UPDATE native_push_devices SET status = 'GONE', failures = 3`);
  assert.equal((await register(f, { platform: 'ios', token: TOKEN_A, bundle_id: BUNDLE })).status, 200);
  assert.deepEqual(f.row(`SELECT COUNT(*) AS n, status, failures FROM native_push_devices`), { n: 1, status: 'ACTIVE', failures: 0 });
  assert.equal((await register(f, { platform: 'ios', token: 'xyz', bundle_id: BUNDLE })).status, 400);
  assert.equal((await register(f, { platform: 'ios', token: TOKEN_B, bundle_id: 'not a bundle' })).status, 400);
  assert.equal((await register(f, { platform: 'android', token: TOKEN_B, bundle_id: BUNDLE })).status, 400, 'Android waits for Firebase');
  assert.equal((await register(f, { platform: 'ios', token: TOKEN_B, bundle_id: BUNDLE }, 'https://evil.example')).status, 403);
});

test('queue: a queued notification makes one native job and starts the sender; none without phones or for held self-test messages', async () => {
  const f = await setup();
  const none = await engage.queuePush(f.env, APP_ID, { title: 'Hi', body: 'No phones yet' });
  assert.ok(none.ok);
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM native_push_jobs`).n, 0);
  assert.equal(f.dispatches.length, 0);
  await register(f, { platform: 'ios', token: TOKEN_A, bundle_id: BUNDLE });
  const held = await engage.queuePush(f.env, APP_ID, { title: 'Test', body: 'Self-test', source: 'SELFTEST', status: 'HELD' });
  assert.ok(held.ok);
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM native_push_jobs`).n, 0);
  f.sql(`DELETE FROM push_messages`); // daily limit is 2
  const queued = await engage.queuePush(f.env, APP_ID, { title: 'Soup', body: 'Tomato basil today' });
  const job = f.row(`SELECT * FROM native_push_jobs`);
  assert.deepEqual([job.message_id, job.app_id, job.platform, job.status, job.dispatch_status], [queued.id, APP_ID, 'IOS', 'QUEUED', 204]);
  assert.equal(f.dispatches.length, 1);
  assert.match(f.dispatches[0].url, /actions\/workflows\/native-push\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(f.dispatches[0].body), { ref: 'master' });
});

test('sender: only the native-push workflow claims a batch, gets the key, and Apple\'s answers update phones, the key and the job', async () => {
  const f = await setup();
  await register(f, { platform: 'ios', token: TOKEN_A, bundle_id: BUNDLE });
  await register(f, { platform: 'ios', token: TOKEN_B, bundle_id: BUNDLE, environment: 'sandbox' });
  const queued = await engage.queuePush(f.env, APP_ID, { title: 'Soup', body: 'Tomato basil today' });
  const { good, req } = await oidc(f);
  for (const change of [{ event_name: 'schedule' }, { aud: 'menu-made-render' }, { job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/render-social-posts.yml@refs/heads/master' }, { ref: 'refs/heads/x' }]) {
    assert.equal((await req('next', null, { ...good, ...change })).status, 403, JSON.stringify(change));
  }
  const next = await (await req('next')).json();
  assert.equal(next.job.title, 'Soup');
  assert.equal(next.job.tag, queued.id);
  assert.deepEqual(next.job.devices.map((d) => [d.token, d.topic, d.environment]).sort(), [[TOKEN_A, BUNDLE, 'production'], [TOKEN_B, BUNDLE, 'sandbox']]);
  assert.deepEqual([next.apple.key_id, next.apple.team_id, next.apple.p8], ['GWV8T93MNC', 'TEAM123456', P8]);
  assert.equal((await (await req('next')).json()).job, null, 'a claimed batch is not handed out twice');
  assert.equal((await req(next.job.id, { claim: 'wrong', results: [] })).status, 409);
  const byToken = Object.fromEntries(next.job.devices.map((d) => [d.token, d.id]));
  const done = await (await req(next.job.id, { claim: next.job.claim, results: [{ device: byToken[TOKEN_A], status: 200 }, { device: byToken[TOKEN_B], status: 400, reason: 'BadDeviceToken' }] })).json();
  assert.deepEqual([done.status, done.sent, done.gone], ['SENT', 1, 1]);
  assert.equal(f.row(`SELECT status FROM native_push_devices WHERE token = ?`, TOKEN_B).status, 'GONE');
  assert.ok(f.row(`SELECT last_sent_at FROM native_push_devices WHERE token = ?`, TOKEN_A).last_sent_at);
  assert.equal(f.row(`SELECT check_status FROM store_credentials WHERE kind = 'APPLE_PUSH_KEY'`).check_status, 'VERIFIED', 'a delivered notification proves the key');
  assert.deepEqual(f.row(`SELECT status, sent_count, gone_count FROM native_push_jobs`), { status: 'SENT', sent_count: 1, gone_count: 1 });
  assert.equal((await req(next.job.id, { claim: next.job.claim, results: [] })).status, 409, 'a finished job takes no second report');
});

test('sender: a refused key fails the job and marks the key; a missing key never hands anything out', async () => {
  const f = await setup();
  await register(f, { platform: 'ios', token: TOKEN_A, bundle_id: BUNDLE });
  await engage.queuePush(f.env, APP_ID, { title: 'Soup', body: 'Tomato basil today' });
  const { req } = await oidc(f);
  const next = await (await req('next')).json();
  const out = await (await req(next.job.id, { claim: next.job.claim, results: [{ device: next.job.devices[0].id, status: 403, reason: 'InvalidProviderToken' }] })).json();
  assert.equal(out.status, 'FAILED');
  assert.equal(f.row(`SELECT status FROM native_push_jobs`).status, 'FAILED');
  assert.equal(f.row(`SELECT status FROM native_push_devices`).status, 'ACTIVE', 'the phone is not blamed for a key problem');
  assert.equal(f.row(`SELECT check_status FROM store_credentials`).check_status, 'FAILED');

  const g = await setup({ key: null });
  await register(g, { platform: 'ios', token: TOKEN_A, bundle_id: BUNDLE });
  await engage.queuePush(g.env, APP_ID, { title: 'Soup', body: 'Tomato basil today' });
  const gk = await oidc(g);
  assert.equal((await (await gk.req('next')).json()).job, null);
  assert.deepEqual(g.row(`SELECT status, note FROM native_push_jobs`), { status: 'FAILED', note: 'No Apple push key on file' });
});

test('schedule: a job left waiting gets the sender started again, at most every 10 minutes', async () => {
  const f = await setup();
  await register(f, { platform: 'ios', token: TOKEN_A, bundle_id: BUNDLE });
  delete f.env.GITHUB_DISPATCH_TOKEN; // the first start was lost
  await engage.queuePush(f.env, APP_ID, { title: 'Soup', body: 'Tomato basil today' });
  f.env.GITHUB_DISPATCH_TOKEN = 'github_pat_test';
  const created = Date.parse(f.row(`SELECT created_at FROM native_push_jobs`).created_at);
  assert.equal((await native.nudgeNativePushes(f.env, created + 60_000)).nudged, false, 'too early');
  assert.equal((await native.nudgeNativePushes(f.env, created + 4 * 60_000)).nudged, true);
  assert.equal(f.dispatches.length, 1);
  assert.equal((await native.nudgeNativePushes(f.env, Date.now() + 5 * 60_000)).nudged, false, 'started less than 10 minutes ago');
  assert.equal((await native.nudgeNativePushes(f.env, Date.now() + 11 * 60_000)).nudged, true);
});

test('send page counts Store App phones with Guest App phones', async () => {
  const f = await setup();
  await register(f, { platform: 'ios', token: TOKEN_A, bundle_id: BUNDLE });
  f.DB.raw.exec('PRAGMA foreign_keys = OFF'); // only the entitlement matters here, not its order
  f.sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('cust', 'x', 'x', 'owner@cafe.example')`);
  f.sql(`INSERT INTO entitlements (id, customer_id, business_id, order_item_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('e1', 'cust', 'biz', 'i1', 'GUEST_APP', 'ACTIVE', 'x', 'x', 'x')`);
  const link = await engage.pushLink(f.env, APP_ID);
  const html = await (await call(f, link)).text();
  assert.match(html, /<strong>1<\/strong> phone has notifications turned on/);
});

test('iOS project patch adds the push callbacks once', () => {
  const generated = 'import UIKit\nimport Capacitor\n\n@UIApplicationMain\nclass AppDelegate: UIResponder, UIApplicationDelegate {\n    var window: UIWindow?\n}\n';
  const once = patch(generated);
  assert.match(once, /didRegisterForRemoteNotificationsWithDeviceToken[\s\S]*capacitorDidRegisterForRemoteNotifications/);
  assert.match(once, /didFailToRegisterForRemoteNotificationsWithError[\s\S]*capacitorDidFailToRegisterForRemoteNotifications/);
  assert.ok(once.trimEnd().endsWith('}'));
  assert.equal(patch(once), once);
  assert.throws(() => patch('struct Nope {}'));
});

test('app shell: config carries the bundle id and push environment; the page has the opt-in', () => {
  const app = readFileSync(new URL('../app-shell/www/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../app-shell/www/index.html', import.meta.url), 'utf8');
  const configure = readFileSync(new URL('../app-shell/configure.mjs', import.meta.url), 'utf8');
  assert.match(app, /api\("push\/native"/);
  assert.match(html, /id="push-on"/);
  assert.match(configure, /app_id: cfg\.app_id/);
  assert.match(configure, /push_environment/);
});
