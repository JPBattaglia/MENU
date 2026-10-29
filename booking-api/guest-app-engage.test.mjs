// Stage 11 part 1: Guest App notifications and rewards. Web Push encryption against the RFC 8291 test vector, VAPID,
// the app's own API (config, subscribe, loyalty), the signed restaurant pages, the 5-minute sender, the automatic
// notification for a new special, the client served to apps built before stage 11, and the live self-test.
// Run: node --no-warnings --test booking-api/guest-app-engage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const webpush = await import('./src/lib/webpush.js');
const { base64UrlDecode, base64UrlEncode, signLinkToken } = await import('./src/lib/links.js');
const engage = await import('./src/producers/guest-app/engage.js');
const { buildApp } = await import('./src/producers/guest-app/build.js');
const { advanceGuestAppPushSelfTests } = await import('./src/selftest/guest-app-push-selftest.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

test('push encryption matches the RFC 8291 test vector and round-trips', async () => {
  const asPub = base64UrlDecode('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: base64UrlEncode(asPub.slice(1, 33)), y: base64UrlEncode(asPub.slice(33)) };
  const ephemeral = { privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), publicKey: await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, true, []) };
  const sub = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  const body = await webpush.encryptPushPayload(sub, 'When I grow up, I want to be a watermelon', { ephemeral, salt: base64UrlDecode('DGv6ra1nlYgDCS1FRnbzlw') });
  assert.equal(base64UrlEncode(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  const uaPub = base64UrlDecode(sub.p256dh);
  const uaPrivate = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', x: base64UrlEncode(uaPub.slice(1, 33)), y: base64UrlEncode(uaPub.slice(33)) }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  assert.equal(await webpush.decryptPushPayload({ privateKey: uaPrivate, ...sub }, await webpush.encryptPushPayload(sub, '{"title":"Hi"}')), '{"title":"Hi"}');
});

test('only real push services are allowed as endpoints', () => {
  assert.ok(webpush.pushEndpointAllowed('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(webpush.pushEndpointAllowed('https://web.push.apple.com/QGv'));
  assert.ok(webpush.pushEndpointAllowed('https://updates.push.services.mozilla.com/wpush/v2/x'));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://menu-made.com/api/x']) assert.ok(!webpush.pushEndpointAllowed(bad), bad);
});

function setup() {
  const DB = createD1(); const ASSETS = createR2();
  DB.raw.exec(read('0009_website_package.sql')); DB.raw.exec(read('0012_guest_app.sql')); DB.raw.exec(read('0021_guest_app_engagement.sql')); DB.raw.exec(read('0021_guest_app_engagement.sql'));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe', 'Rossi')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Joe''s Pizza')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_g', ?, ?, 'GUEST_APP', 'Guest App', 'APP', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 'GUEST_APP_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_g', 'offer_g', 1, ?, ?, 'ACTIVE', 2900, '{}')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o1', ?, ?, 'cust', 'biz', 'DELIVERED', 0, 0, 'PAID')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'offer_g', 'ov_g', 0, 0)`);
  sql(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES ('11111111-2222-4333-8444-555555555555', 'joes-pizza', 'p1', 'biz', 'cust', ?, ?, ?)`,
    JSON.stringify({ app_name: "Joe's Pizza", loyalty_reward: 'a free slice', loyalty_visits: '3', push_specials: 'yes' }), t, t);
  const emails = [];
  const pushes = [];
  const fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (webpush.pushEndpointAllowed(String(url))) { pushes.push({ url: String(url), init }); return new Response(null, { status: String(url).includes('gone') ? 410 : 201 }); }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, DB, ASSETS, sql, row, emails, pushes, fetch, appId: '11111111-2222-4333-8444-555555555555' };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = (f, url, init) => worker.fetch(new Request(url, init), f.env, { waitUntil() {} });
const BASE = 'https://menu-made.com/api/site/joes-pizza/app/';
const post = (f, path, body, headers = { Origin: 'https://menu-made.com' }) => call(f, `${BASE}api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function phone(endpoint) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { endpoint, privateKey: pair.privateKey, p256dh: base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))) };
}

test('config, subscribe, the daily limit and the sender: a phone gets a VAPID-signed, encrypted notification', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const config = await (await call(f, `${BASE}api/config`)).json();
    assert.ok(config.push.enabled); assert.match(config.push.key, /^[A-Za-z0-9_-]{87}$/);
    assert.deepEqual(config.loyalty, { enabled: true, reward: 'a free slice', goal: 3 });
    assert.equal((await (await call(f, `${BASE}api/config`)).json()).push.key, config.push.key, 'the VAPID key is made once and kept');
    assert.match(f.row(`SELECT value FROM worker_settings`).value, /^v1\./, 'stored sealed');
    const a = await phone('https://fcm.googleapis.com/fcm/send/aaa'); const gone = await phone('https://fcm.googleapis.com/fcm/send/gone');
    assert.equal((await post(f, 'push/subscribe', { endpoint: a.endpoint, keys: a }, {})).status, 403);
    assert.equal((await post(f, 'push/subscribe', { endpoint: 'https://evil.example/x', keys: a })).status, 400);
    assert.equal((await post(f, 'push/subscribe', { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } })).status, 200);
    assert.equal((await post(f, 'push/subscribe', { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } })).status, 200, 'subscribing again is an update');
    await post(f, 'push/subscribe', { endpoint: gone.endpoint, keys: { p256dh: gone.p256dh, auth: gone.auth } });
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM push_subscriptions`).n, 2);
    assert.equal((await call(f, 'https://joes-pizza.menu-made.com/app/api/push/subscribe', { method: 'POST', body: '{}' })).status !== 405, true, 'POST reaches the app API on the customer address');
    assert.equal((await call(f, 'https://joes-pizza.menu-made.com/app/', { method: 'POST' })).status, 405, 'only the app API takes POSTs');

    const token = await signLinkToken(f.env, { kind: 'apppush', id: f.appId, ttlDays: 1 });
    assert.equal((await call(f, `https://menu-made.com/api/app-push/${f.appId}?t=${token}`)).status, 403, 'needs an active Guest App plan');
    f.sql(`INSERT INTO entitlements (id, customer_id, business_id, order_item_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('ent', 'cust', 'biz', 'i1', 'GUEST_APP', 'ACTIVE', 'x', 'x', 'x')`);
    assert.match(await (await call(f, `https://menu-made.com/api/app-push/${f.appId}?t=${token}`)).text(), /<strong>2<\/strong> phones have notifications/);
    assert.equal((await call(f, `https://menu-made.com/api/app-push/${f.appId}?t=forged.token`)).status, 403);
    const send = (body) => { const form = new FormData(); form.append('t', token); form.append('title', "Joe's Pizza"); form.append('body', body); return call(f, `https://menu-made.com/api/app-push/${f.appId}`, { method: 'POST', body: form }); };
    assert.equal((await send('Two slices for $6 today')).status, 200);
    assert.equal((await send('Open late tonight')).status, 200);
    const third = await send('Too many');
    assert.equal(third.status, 400); assert.match(await third.text(), /last 24 hours/);

    await engage.sendQueuedPushes(f.env);
    assert.equal(f.pushes.length, 3, 'two phones for the first message; the second skips the phone that answered 410');
    const toA = f.pushes.find((p) => p.url === a.endpoint);
    const vapid = await webpush.verifyVapidHeader(toA.init.headers.Authorization, a.endpoint);
    assert.ok(vapid.ok); assert.equal(vapid.publicKey, config.push.key); assert.equal(vapid.claims.aud, 'https://fcm.googleapis.com');
    assert.equal(toA.init.headers['Content-Encoding'], 'aes128gcm');
    const payload = JSON.parse(await webpush.decryptPushPayload(a, toA.init.body));
    assert.equal(payload.title, "Joe's Pizza"); assert.equal(payload.body, 'Two slices for $6 today'); assert.equal(payload.url, './');
    assert.equal(f.row(`SELECT status FROM push_subscriptions WHERE endpoint = ?`, gone.endpoint).status, 'GONE');
    assert.deepEqual({ ...f.row(`SELECT COUNT(*) AS n FROM push_messages WHERE status = 'SENT'`) }, { n: 2 });
    await engage.sendQueuedPushes(f.env);
    assert.equal(f.pushes.length, 3, 'nothing is sent twice');
    assert.equal((await post(f, 'push/unsubscribe', { endpoint: a.endpoint })).status, 200);
    assert.equal(f.row(`SELECT status FROM push_subscriptions WHERE endpoint = ?`, a.endpoint).status, 'GONE');
  });
});

test('the sender works through a large list in batches and keeps its place', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const one = await phone('x');
    for (let i = 0; i < 130; i++) f.sql(`INSERT INTO push_subscriptions (id, app_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x')`, `s${String(i).padStart(3, '0')}`, f.appId, `https://fcm.googleapis.com/fcm/send/${i}`, one.p256dh, one.auth);
    const queued = await engage.queuePush(f.env, f.appId, { title: 'Hi', body: 'News' });
    assert.ok(queued.ok);
    await engage.sendQueuedPushes(f.env);
    assert.equal(f.pushes.length, 120); assert.equal(f.row(`SELECT status, cursor FROM push_messages`).status, 'SENDING');
    await engage.sendQueuedPushes(f.env);
    assert.equal(f.pushes.length, 130); assert.equal(new Set(f.pushes.map((p) => p.url)).size, 130);
    assert.equal(f.row(`SELECT status, sent_count FROM push_messages`).status, 'SENT'); assert.equal(f.row(`SELECT sent_count FROM push_messages`).sent_count, 130);
  });
});

test('rewards: counter code, wrong and expired codes refused, one visit per visit, reward used once', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const member = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const act = async (body) => { const r = await post(f, 'loyalty', { member, ...body }); return { status: r.status, ...(await r.json()) }; };
    assert.deepEqual((await act({ action: 'me' })).card, { points: 0, visits: 0, goal: 3, reward: 'a free slice', can_redeem: false });
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM loyalty_members`).n, 0, 'looking at a card creates nothing');
    assert.equal((await act({ action: 'earn', code: '12' })).status, 400);
    assert.equal((await act({ action: 'earn', code: await engage.counterCode(f.env, f.appId, engage.windowAt() - 2) })).status, 400);
    const token = await signLinkToken(f.env, { kind: 'appcounter', id: f.appId, ttlDays: 1 });
    const counter = await call(f, `https://menu-made.com/api/app-counter/${f.appId}?t=${token}`);
    const html = await counter.text();
    const now = await engage.counterCode(f.env, f.appId, engage.windowAt());
    assert.ok(html.includes(`${now.slice(0, 3)} ${now.slice(3)}`)); assert.ok(Number(counter.headers.get('Refresh')) >= 2 && Number(counter.headers.get('Refresh')) <= 62);
    assert.match(html, /a free slice after 3 visits/);
    assert.equal((await act({ action: 'earn', code: now })).card.points, 1);
    const again = await act({ action: 'earn', code: now });
    assert.equal(again.status, 409); assert.match(again.error, /already on your card/);
    assert.equal((await act({ action: 'redeem', code: now })).status, 409, 'not enough visits yet');
    // Two more visits on later days.
    f.sql(`UPDATE loyalty_members SET last_earn_at = '2026-01-01T00:00:00.000Z'`);
    assert.equal((await act({ action: 'earn', code: await engage.counterCode(f.env, f.appId, engage.windowAt() - 1) })).card.points, 2, 'last minute\'s code still works');
    f.sql(`UPDATE loyalty_members SET last_earn_at = '2026-01-01T00:00:00.000Z'`);
    assert.equal((await act({ action: 'earn', code: now })).status, 409, 'the same code can not be replayed on a card');
    f.sql(`DELETE FROM loyalty_events WHERE kind = 'EARN' AND code_window = ?`, engage.windowAt());
    const third = await act({ action: 'earn', code: now });
    assert.equal(third.card.points, 3); assert.equal(third.card.can_redeem, true);
    const used = await act({ action: 'redeem', code: now });
    assert.ok(used.ok); assert.equal(used.card.points, 0);
    assert.equal((await act({ action: 'redeem', code: now })).status, 409);
    assert.deepEqual({ ...f.row(`SELECT visits, rewards_redeemed FROM loyalty_members`) }, { visits: 3, rewards_redeemed: 1 });
    for (let i = 0; i < 8; i++) await act({ action: 'earn', code: '000000' === now ? '111111' : '000000' });
    assert.equal((await act({ action: 'earn', code: now })).status, 429, 'too many wrong codes in an hour');
    assert.equal((await post(f, 'loyalty', { member: 'short', action: 'me' })).status, 400);
    f.sql(`UPDATE guest_apps SET data_json = '{"app_name":"Joe''s Pizza"}'`);
    assert.equal((await act({ action: 'me' })).status, 404, 'rewards are off until the owner writes a reward');
    assert.match(await (await call(f, `https://menu-made.com/api/app-counter/${f.appId}?t=${token}`)).text(), /Rewards are off/);
  });
});

test('apps built before stage 11 are served the new app.js and offline worker with push', async () => {
  const old = buildApp({ app_name: 'Old Cafe', menu: 'Tea | 3', phone: '5125550100', address: '1 Main St', hours: 'Mon: 9-5' }, { version: 'ab12cd34', hasLogo: false });
  assert.match(old.files['sw.js'], /guest-app-ab12cd34-e1/);
  assert.match(old.files['sw.js'], /addEventListener\("push"/);
  assert.match(old.files['app.js'], /push\/subscribe/);
  const { CSP } = await import('./src/producers/guest-app/serve.js');
  assert.match(CSP, /connect-src 'self'/, 'the app API is same-origin');
});

test('the live self-test passes against the real routes and leaves nothing behind', async () => {
  const f = setup();
  f.sql(`INSERT INTO self_tests (id, kind, status, created_at, updated_at) VALUES ('st1', 'GUEST_APP_PUSH_RUN', 'REQUESTED', 'x', 'x')`);
  await withFetch(f.fetch, async () => {
    const app = (request) => worker.fetch(request, f.env, { waitUntil() {} });
    const [result] = await advanceGuestAppPushSelfTests(f.env, app);
    assert.equal(result.status, 'PASSED', result.error || '');
    assert.match(result.log_json, /VAPID verified/);
  });
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM guest_apps WHERE slug LIKE 'pushselftest-%'`).n, 0);
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM push_messages`).n, 0);
  assert.equal(f.pushes.length, 0, 'the self-test never sends to the real push services');
});
