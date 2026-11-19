// Stage 15 task 5 (Nov 17, 2026): owner stats. Menu views and QR scans counted, shown in the editor, emailed on
// Mondays, and pushed to a phone the owner linked in the MΞNU app.
// Run: node --no-warnings --test booking-api/menu-stats.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const stats = await import('./src/marketing/menu-stats.js');
const engage = await import('./src/producers/guest-app/engage.js');

const MENU = { sections: [{ name: 'Starters', items: [{ name: 'Garlic Bread', description: 'House focaccia', price: '$9' }] }], notes: '', unreadable: '', colors: [] };
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
const APP_ID = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'c'.repeat(64);
const read = (m) => readFileSync(new URL(`./migrations/${m}`, import.meta.url), 'utf8');

function setup(t) {
  const env = { DB: createD1(), ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-test', RESEND_API_KEY: 're_test', PRODUCTION_RUNNER_SECRET: 'test-runner-secret', MENU_FREE_PLAN: 'on' };
  for (const m of ['0007_plan_settings.sql', '0009_website_package.sql', '0012_guest_app.sql', '0017_customer_accounts.sql', '0018_menu_hosting_index.sql',
    '0021_guest_app_engagement.sql', '0022_store_credentials.sql', '0023_native_push.sql', '0024_android.sql', '0062_menu_stats.sql', '0063_push_owner_link.sql']) env.DB.raw.exec(read(m));
  const call = (path, init = {}) => worker.fetch(new Request(path.startsWith('http') ? path : `https://menu-made.com${path}`, init), env, { waitUntil() {} });
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url === 'https://api.anthropic.com/v1/messages') return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: { input_tokens: 1, output_tokens: 1 } });
    if (url === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return Response.json({ id: `em_${sent.length}` }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  return { env, call, sent, sql: (q, ...a) => env.DB.raw.prepare(q).all(...a), run: (q, ...a) => env.DB.raw.prepare(q).run(...a) };
}

// A free live menu (the preview flow), as an owner would get it.
async function liveFreeMenu(f, email = 'owner@cafe.example') {
  const id = crypto.randomUUID();
  const storageKey = `private/inquiries/${id}/abc`;
  await f.env.ASSETS.put(storageKey, new Uint8Array([37, 80, 68, 70]));
  f.run(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at) VALUES (?, ?, ?, ?)`, id,
    JSON.stringify({ type: 'inquiry', purpose: 'checkout', email, name: 'Cafe', document: { storageKey, contentType: 'application/pdf', name: `menu-${id}.pdf`, size: 4 } }), `net-${id}`, Math.floor(Date.now() / 1000));
  const token = (await (await f.call('/api/menu-preview/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: id, email, business: 'Sample Cafe' }) })).json()).token;
  await f.call(`/api/menu-preview/free/${token}`, { method: 'POST', headers: { Accept: 'application/json' } });
  const mail = [...f.sent].reverse().find((m) => /free menu live/i.test(m.subject));
  const link = new URL(/https:\/\/menu-made\.com(\/api\/menu-free\/confirm\/[a-f0-9]{36}\?t=[^\s"]+)/.exec(mail.text)[1], 'https://menu-made.com');
  const done = await f.call(link.pathname, { method: 'POST', body: new URLSearchParams({ t: link.searchParams.get('t') }) });
  const cookie = done.headers.get('Set-Cookie').split(';')[0];
  const [project] = f.sql(`SELECT id, business_id, customer_id FROM projects`);
  const url = f.sql(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = 'qr_destination'`, project.id)[0].value_text;
  return { ...project, url, cookie };
}

test('QR codes open the menu with ?s=qr; other destinations are left alone', () => {
  assert.equal(stats.qrScanUrl('https://menu-made.com/api/menu/sample-cafe-ab12'), 'https://menu-made.com/api/menu/sample-cafe-ab12?s=qr');
  assert.equal(stats.qrScanUrl('https://menu-made.com/api/menu/x?s=qr'), 'https://menu-made.com/api/menu/x?s=qr');
  assert.equal(stats.qrScanUrl('https://joescafe.example/menu'), 'https://joescafe.example/menu');
});

test('views and QR scans are counted, bots are not, and the editor shows the last 7 days', async (t) => {
  const f = setup(t);
  const menu = await liveFreeMenu(f);
  const path = new URL(menu.url).pathname;
  for (const init of [{ headers: { 'User-Agent': PHONE } }, { headers: { 'User-Agent': PHONE } }]) assert.equal((await f.call(path, init)).status, 200);
  await f.call(`${path}?s=qr`, { headers: { 'User-Agent': PHONE } });
  await f.call(path, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
  await f.call(path);
  const [row] = f.sql(`SELECT views, qr_scans FROM menu_stats_daily WHERE business_id = ?`, menu.business_id);
  assert.deepEqual({ ...row }, { views: 3, qr_scans: 1 });

  const out = await (await f.call(`/api/account/menu?business=${menu.business_id}`, { headers: { Cookie: menu.cookie } })).json();
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.stats.views, 3);
  assert.equal(out.stats.qr_scans, 1);
  assert.equal(out.stats.daily.length, 7);
  assert.equal(out.stats.google, null, 'no Google connection, no Google line');
});

test('Monday email: once a week, with the numbers, and a link that stops them', async (t) => {
  const f = setup(t);
  const menu = await liveFreeMenu(f);
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  f.run(`INSERT INTO menu_stats_daily (business_id, day, views, qr_scans) VALUES (?, ?, 12, 5)`, menu.business_id, yesterday);

  assert.equal((await stats.runWeeklyMenuStats(f.env, { now: Date.parse('2026-11-18T17:01:00Z') })).ran, false, 'only on Mondays');
  const before = f.sent.length;
  const run = await stats.runWeeklyMenuStats(f.env, { force: true });
  assert.equal(run.sent, 1, JSON.stringify(run));
  const mail = f.sent.at(-1);
  assert.equal(f.sent.length, before + 1);
  assert.match(mail.subject, /^Sample Cafe's menu last week: 12 views$/);
  assert.match(mail.text, /From the QR code: 5/);
  assert.match(mail.html, /Stop these weekly emails/);

  const off = new URL(/(https:\/\/menu-made\.com\/api\/menu-stats\/off\?[^\s]+)/.exec(mail.text)[1]);
  assert.match(await (await f.call(off.pathname + off.search)).text(), /<form method="post"/, 'a button first');
  await f.call(off.pathname, { method: 'POST', body: new URLSearchParams({ b: off.searchParams.get('b'), t: off.searchParams.get('t') }) });
  f.run(`DELETE FROM worker_settings WHERE key LIKE 'menu-stats-run:%'`);
  assert.equal((await stats.runWeeklyMenuStats(f.env, { force: true })).sent, 0, 'stopped');
});

test('a phone linked in the MΞNU app gets the weekly numbers; nobody else does', async (t) => {
  const f = setup(t);
  const menu = await liveFreeMenu(f);
  const t0 = '2026-10-01T00:00:00.000Z';
  f.run(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES (?, 'menumade', 'p-own', 'biz-own', 'cust-own', '{"app_name":"MENU-MADE"}', ?, ?)`, APP_ID, t0, t0);
  f.run(`CREATE TABLE IF NOT EXISTS store_apps (id TEXT PRIMARY KEY, project_id TEXT, bundle_id TEXT, own_app INTEGER)`);
  f.run(`INSERT INTO store_apps (id, project_id, bundle_id, own_app) VALUES ('s1', 'p-own', 'com.menumade.menumade', 1)`);
  const APP = 'https://menu-made.com/api/site/menumade/app/api/';
  const post = (path, body) => f.call(`${APP}${path}`, { method: 'POST', headers: { Origin: 'capacitor://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('push/native', { platform: 'ios', token: TOKEN, bundle_id: 'com.menumade.menumade' })).status, 200);
  f.run(`INSERT INTO native_push_devices (id, app_id, platform, token, bundle_id, environment, status, failures, created_at, updated_at) VALUES ('other-phone', ?, 'IOS', ?, 'com.menumade.menumade', 'production', 'ACTIVE', 0, ?, ?)`, APP_ID, 'd'.repeat(64), t0, t0);

  // An email with no menu gets the same answer and no email.
  const sentBefore = f.sent.length;
  const nobody = await (await post('menu-stats/link', { email: 'someone@else.example', token: TOKEN })).json();
  assert.equal(nobody.ok, true);
  assert.equal(f.sent.length, sentBefore);

  const asked = await (await post('menu-stats/link', { email: 'Owner@Cafe.example', token: TOKEN })).json();
  assert.equal(asked.ok, true);
  const mail = f.sent.at(-1);
  assert.equal([mail.to].flat()[0], 'owner@cafe.example');
  const link = new URL(/(https:\/\/menu-made\.com\/api\/menu-stats\/phone\?[^\s]+)/.exec(mail.text)[1]);
  assert.match(await (await f.call(link.pathname + link.search)).text(), /<form method="post"/);
  const body = new URLSearchParams({ d: link.searchParams.get('d'), c: link.searchParams.get('c'), t: link.searchParams.get('t') });
  assert.equal((await f.call(link.pathname, { method: 'POST', body })).status, 200);
  assert.deepEqual(f.sql(`SELECT customer_id FROM native_push_devices ORDER BY id`).map((r) => r.customer_id).sort(), [menu.customer_id, null].sort());

  // A forged link for another customer fails.
  body.set('c', 'someone-else');
  assert.equal((await f.call(link.pathname, { method: 'POST', body })).status, 403);

  const run = await stats.runWeeklyMenuStats(f.env, { force: true });
  assert.equal(run.pushed, 1, JSON.stringify(run));
  const [message] = f.sql(`SELECT title, body, target_customer_id FROM push_messages`);
  assert.equal(message.target_customer_id, menu.customer_id);
  assert.match(message.title, /Sample Cafe: your menu this week/);
  // The app-wide daily limit isn't spent by owner messages.
  for (let i = 0; i < 5; i++) await engage.queuePush(f.env, APP_ID, { title: 'x', body: 'y', target: menu.customer_id });
  assert.equal((await engage.queuePush(f.env, APP_ID, { title: 'Everyone', body: 'Hello' })).ok, true);
});
