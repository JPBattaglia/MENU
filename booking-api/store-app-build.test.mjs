// Stage 11 part 2: each restaurant's Store App build. The tick starts the GitHub workflow for apps ready to build,
// the workflow gets the restaurant's build config and keys by store app id, reports each platform back, and the app
// moves to WAITING_SUBMIT_APPROVAL; failures and silence email the owner a signed "Build again" link.
// Run: node --no-warnings --test booking-api/store-app-build.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const keys = await import('./src/store-app/keys.js');
const gkeys = await import('./src/store-app/google-keys.js');
const build = await import('./src/store-app/store-build.js');
const { signLinkToken } = await import('./src/lib/links.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const ID = '11111111-2222-4333-8444-555555555555';
const TEST_ID = '22222222-2222-4333-8444-555555555555';
const PKG = 'com.menumade.joespizza';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

async function setup({ status = 'READY_TO_BUILD', logo = true } = {}) {
  const DB = createD1(); const ASSETS = createR2();
  for (const m of ['0012_guest_app.sql', '0022_store_credentials.sql', '0024_android.sql', '0025_store_app.sql', '0026_store_app_builds.sql', '0027_store_app_listings.sql', '0029_store_app_live_version.sql']) DB.raw.exec(read(m));
  DB.raw.exec('PRAGMA foreign_keys = OFF');
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-30T00:00:00.000Z';
  sql(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES ('ga1', 'joes-pizza', 'p1', 'biz', 'cust', '{"app_name":"Joe''s Pizza","brand_color":"#aa2200"}', ?, ?)`, t, t);
  sql(`INSERT INTO store_apps (id, project_id, business_id, customer_id, bundle_id, status, created_at, updated_at) VALUES (?, 'p1', 'biz', 'cust', ?, ?, ?, ?)`, ID, PKG, status, t, t);
  if (logo) {
    sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, metadata_json) VALUES ('logo1', 'biz', 'cust', 'p1', 'LOGO', 'R2', 'logos/joes.png', 'joes.png', 'image/png', 8, 'x', 'VALID', ?, '{"app_image":"logo"}')`, t);
    await ASSETS.put('logos/joes.png', PNG);
  }
  const dispatches = []; const emails = [];
  const env = {
    DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'runner-secret', RESEND_API_KEY: 're_test', OWNER_EMAIL: 'info@menu-made.com', GITHUB_DISPATCH_TOKEN: 'ghp_test',
    GITHUB_DISPATCH_FETCH: async (url, init) => { dispatches.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
  };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, DB, ASSETS, sql, row, dispatches, emails };
}
async function giveKeys(f, scope = 'biz') {
  await keys.saveCredential(f.env, scope, 'APPLE_API_KEY', { keyId: 'API1234567', issuerId: 'i', teamId: 'T', p8: 'x', status: 'VERIFIED', note: 'ok' });
  await keys.saveCredential(f.env, scope, 'APPLE_PUSH_KEY', { keyId: 'PUSH123456', teamId: 'T', p8: 'x', status: 'VERIFIED', note: 'ok' });
  await f.ASSETS.put(gkeys.servicesKey(scope), JSON.stringify({ project_info: { project_id: 'menu-made-apps' }, client: [{ client_info: { android_client_info: { package_name: PKG } } }] }));
}

async function withEmails(f, fn) {
  const o = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://api.resend.com/')) { f.emails.push(JSON.parse(init.body)); return Response.json({ id: 'e' }); } return o(url, init); };
  try { return await fn(); } finally { globalThis.fetch = o; }
}
const call = (f, url, init) => withEmails(f, () => worker.fetch(new Request(url, init), f.env, { waitUntil() {} }));

// GitHub OIDC stand-in (a real RS256 signature over the claims).
async function oidc(f) {
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const kid = `kid-build-${crypto.randomUUID()}`;
  f.env.RENDER_OIDC_FETCH = async () => Response.json({ keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' }] });
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-store-build', exp: now + 300, nbf: now - 5, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master',
    job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/store-app-build.yml@refs/heads/master', event_name: 'workflow_dispatch' };
  const sign = async (claims) => { const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })); const b = b64u(JSON.stringify(claims));
    return `${h}.${b}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${b}`))))}`; };
  return async (path, init = {}, claims = good) => call(f, `https://menu-made.com${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await sign(claims)}` } });
}

test('tick: starts the build only when the keys are in, once, with the store app id; then BUILDING', async () => {
  const f = await setup();
  await build.advanceStoreBuilds(f.env);
  assert.equal(f.dispatches.length, 0, 'no keys, no build');
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'READY_TO_BUILD');
  await giveKeys(f);
  await build.advanceStoreBuilds(f.env);
  assert.equal(f.dispatches.length, 1);
  assert.match(f.dispatches[0].url, /store-app-build\.yml\/dispatches$/);
  assert.deepEqual(f.dispatches[0].body, { ref: 'master', inputs: { store_app: ID, upload: 'true', platforms: 'both' } });
  assert.equal(f.row(`SELECT status FROM store_apps`).status, 'BUILDING');
  await build.advanceStoreBuilds(f.env);
  assert.equal(f.dispatches.length, 1, 'started once');

  const g = await setup();
  await giveKeys(g);
  g.env.GITHUB_DISPATCH_FETCH = async () => new Response('{}', { status: 422 });
  await build.advanceStoreBuilds(g.env);
  const r = g.row(`SELECT status, note FROM store_apps`);
  assert.equal(r.status, 'READY_TO_BUILD', 'a refused start is tried again next tick');
  assert.match(r.note, /HTTP 422/);
});

test("build config: the restaurant's id, name, colour, content address and a 1024 px icon with its logo; only for the workflow", async () => {
  const f = await setup({ status: 'BUILDING' });
  const req = await oidc(f);
  const res = await req(`/api/store-build/config?store_app=${ID}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.config, { app_id: PKG, app_name: "Joe's Pizza", brand_color: '#aa2200', api_base: 'https://joes-pizza.menu-made.com/app/api', version: '1.0.0' });
  assert.match(body.icon_svg, /^<svg[^>]+width="1024" height="1024"/);
  assert.match(body.icon_svg, /href="data:image\/png;base64,iVBORw/, 'logo inlined');
  assert.doesNotMatch(body.icon_svg, /rx="/, 'square: the stores round it');
  assert.match(body.feature_svg, /^<svg[^>]+width="1024" height="500"/, 'Play feature graphic');
  assert.match(body.feature_svg, /Joe's Pizza<\/text>/);
  assert.equal((await call(f, `https://menu-made.com/api/store-build/config?store_app=${ID}`)).status, 401);
  assert.equal((await req('/api/store-build/config?store_app=99999999-2222-4333-8444-555555555555')).status, 404);

  const g = await setup({ status: 'WAITING_OWNER_SETUP', logo: false });
  const req2 = await oidc(g);
  assert.equal((await req2(`/api/store-build/config?store_app=${ID}`)).status, 409, 'not before the owner setup is done');
  g.sql(`UPDATE store_apps SET status = 'BUILDING'`);
  const noLogo = await (await req2(`/api/store-build/config?store_app=${ID}`)).json();
  assert.match(noLogo.icon_svg, />JP<\/text>/, 'initials without a logo');
});

test("credentials by store app: the restaurant's own keys and package; the owner's test app uses the owner's keys", async () => {
  const f = await setup({ status: 'BUILDING' });
  const req = await oidc(f);
  assert.equal((await req(`/api/store-build/credentials?store_app=${ID}`)).status, 409, 'no keys yet');
  await giveKeys(f);
  await keys.saveCredential(f.env, 'owner', 'APPLE_API_KEY', { keyId: 'OWNERKEY12', issuerId: 'o', teamId: 'OT', p8: 'owner', status: 'VERIFIED', note: 'ok' });
  const apple = await (await req(`/api/store-build/credentials?store_app=${ID}`)).json();
  assert.equal(apple.apple.key_id, 'API1234567', "the restaurant's key, not the owner's");
  const android = await (await req(`/api/store-build/credentials?store_app=${ID}&platform=android`)).json();
  assert.equal(android.android.package, PKG);
  assert.equal((await req('/api/store-build/credentials?scope=owner')).status, 200, 'the sample build still works');
  assert.equal((await req('/api/store-build/credentials?scope=biz')).status, 404, 'a business id is never a scope by itself');

  f.sql(`INSERT INTO store_apps (id, project_id, business_id, customer_id, bundle_id, status, created_at, updated_at) VALUES (?, 'p2', 'ownerbiz', 'c', 'com.menumade.samplecafe', 'BUILDING', 'x', 'x')`, TEST_ID);
  const test = await (await req(`/api/store-build/credentials?store_app=${TEST_ID}`)).json();
  assert.equal(test.apple.key_id, 'OWNERKEY12', "the owner's test app builds with the owner's keys");

  // First Android file for a restaurant: stored under its scope, emailed with its name, downloaded by its own link.
  const aab = new Uint8Array(5000); aab[0] = 0x50; aab[1] = 0x4b;
  await req(`/api/store-build/android-bundle?store_app=${ID}&version=7`, { method: 'POST', body: aab });
  const mail = f.emails.at(-1);
  assert.match(mail.subject, /Joe's Pizza/);
  const link = /href="([^"]+\/api\/store-build\/bundle\/7\?a=[^"]+)"/.exec(mail.html)[1].replaceAll('&amp;', '&');
  const dl = await call(f, link);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('Content-Disposition'), /joes-pizza-7\.aab/);
  const ownerStyle = await signLinkToken(f.env, { kind: 'storebundle', id: '7', ttlDays: 7 });
  assert.equal((await call(f, `https://menu-made.com/api/store-build/bundle/7?t=${encodeURIComponent(ownerStyle)}`)).status, 404, "an owner link doesn't open a restaurant's file");
});

test('results: both platforms -> waiting for submission approval; a failure emails the owner a Build again link', async () => {
  const f = await setup({ status: 'BUILDING' });
  const req = await oidc(f);
  const report = (body) => req(`/api/store-build/result?store_app=${ID}`, { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await report({ platform: 'mac', outcome: 'UPLOADED' })).status, 400);
  assert.equal((await (await report({ platform: 'ios', outcome: 'UPLOADED', version: 21, run_id: '123' })).json()).status, 'BUILDING');
  assert.equal((await (await report({ platform: 'android', outcome: 'FIRST_UPLOAD', version: 21, run_id: '123' })).json()).status, 'WAITING_SUBMIT_APPROVAL');
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM store_app_builds`).n, 2);

  const g = await setup({ status: 'BUILDING' });
  const req2 = await oidc(g);
  await req2(`/api/store-build/result?store_app=${ID}`, { method: 'POST', body: JSON.stringify({ platform: 'android', outcome: 'FAILED', version: 22, run_id: '456' }) });
  assert.equal(g.row(`SELECT status FROM store_apps`).status, 'BUILDING');
  const mail = g.emails.at(-1);
  assert.deepEqual(mail.to, ['info@menu-made.com']);
  assert.match(mail.html, /actions\/runs\/456/);
  const link = /href="([^"]+\/rebuild\?t=[^"]+)"/.exec(mail.html)[1].replaceAll('&amp;', '&');
  assert.match(await (await call(g, link)).text(), /Build again\?/);
  assert.equal(g.row(`SELECT status FROM store_apps`).status, 'BUILDING', 'a GET changes nothing');
  const form = new FormData(); form.set('t', new URL(link).searchParams.get('t'));
  await call(g, `https://menu-made.com/api/store-app/${ID}/rebuild`, { method: 'POST', body: form });
  assert.equal(g.row(`SELECT status FROM store_apps`).status, 'READY_TO_BUILD');
  assert.equal((await call(g, `https://menu-made.com/api/store-app/${ID}/rebuild?t=bad`)).status, 403);
});

test('silence: a build with no report after 2 hours alerts the owner once', async () => {
  const f = await setup({ status: 'BUILDING' });
  await withEmails(f, () => build.advanceStoreBuilds(f.env, Date.parse('2026-10-30T01:00:00.000Z')));
  assert.equal(f.emails.length, 0, 'not yet');
  await withEmails(f, () => build.advanceStoreBuilds(f.env, Date.parse('2026-10-30T03:00:00.000Z')));
  assert.equal(f.emails.length, 1);
  assert.match(f.emails[0].html, /hasn&#039;t reported|hasn't reported/);
  await withEmails(f, () => build.advanceStoreBuilds(f.env, Date.parse('2026-10-30T04:00:00.000Z')));
  assert.equal(f.emails.length, 1, 'once');
});

test('listing pictures: the build sends PNGs by name for its own store app; anything else is refused', async () => {
  const f = await setup({ status: 'BUILDING' });
  const req = await oidc(f);
  const png = new Uint8Array(300); png.set([0x89, 0x50, 0x4e, 0x47]); new DataView(png.buffer).setUint32(16, 1290); new DataView(png.buffer).setUint32(20, 2796);
  const res = await (await req(`/api/store-build/listing?store_app=${ID}&name=ios-1`, { method: 'POST', body: png })).json();
  assert.deepEqual([res.ok, res.w, res.h], [true, 1290, 2796]);
  assert.ok(await f.ASSETS.get(`store-app/${ID}/listing/ios-1.png`));
  assert.deepEqual(Object.keys(JSON.parse(f.row(`SELECT images_json FROM store_app_listings`).images_json)), ['ios-1']);
  assert.equal((await req(`/api/store-build/listing?store_app=${ID}&name=../x`, { method: 'POST', body: png })).status, 400);
  assert.equal((await req(`/api/store-build/listing?store_app=${ID}&name=ios-2`, { method: 'POST', body: new Uint8Array(300) })).status, 422);
  assert.equal((await call(f, `https://menu-made.com/api/store-build/listing?store_app=${ID}&name=ios-2`, { method: 'POST', body: png })).status, 401);
});

test('build config version: 1.0.0 until the app is live, then one patch above the live version', async () => {
  assert.deepEqual(['', null, '1.0.0', '1.2.9', 'junk'].map(build.nextVersion), ['1.0.0', '1.0.0', '1.0.1', '1.2.10', '1.0.0']);
  const f = await setup();
  const config = async () => (await build.buildConfigFor(f.env, f.row(`SELECT * FROM store_apps WHERE id = ?`, ID))).body.config.version;
  assert.equal(await config(), '1.0.0');
  f.sql(`INSERT INTO store_app_listings (store_app_id, images_json, live_version, created_at, updated_at) VALUES (?, '{}', '1.0.3', 'x', 'x')`, ID);
  assert.equal(await config(), '1.0.4');
});
