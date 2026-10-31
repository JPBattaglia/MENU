// Stage 12, task 1: the coverage map. Every active offer is matched to its self-tests from the live offers and
// self_tests rows; gaps (no test, never passed, stale) make it red; hidden offers are listed but don't count; the owner
// page comes from an emailed 7-day link and the JSON from the admin token.
// Run: node --no-warnings --test booking-api/coverage.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const cov = await import('./src/selftest/coverage.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com/')) { emails.push(JSON.parse(init.body)); return Response.json({ id: `em_${emails.length}` }); }
  return realFetch(url, init);
};
after(() => { globalThis.fetch = realFetch; });

const NOW = Date.parse('2026-10-31T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

function setup({ offers = [['MENU_CARE', 1], ['GUEST_APP_SETUP', 1], ['STORE_APP_SETUP', 0]] } = {}) {
  emails.length = 0;
  const DB = createD1();
  DB.raw.exec(read('0030_self_tests_kind_index.sql'));
  DB.raw.exec('PRAGMA foreign_keys = OFF');
  DB.raw.exec('DELETE FROM offers');
  let i = 0;
  for (const [code, pub] of offers) {
    DB.raw.prepare(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, default_workflow_key, is_public, sort_order)
      VALUES (?, 'x', 'x', ?, ?, 'OTHER', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 'X_V1', ?, ?)`).run(`o_${code}`, code, code.replace(/_/g, ' '), pub, i++);
  }
  const pass = (kind, h, status = 'PASSED', error = null) => DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, error, created_at, updated_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), kind, status, error, hoursAgo(h), hoursAgo(h), hoursAgo(h));
  const env = { DB, PRODUCTION_RUNNER_SECRET: 'runner-secret', RESEND_API_KEY: 're_test', OWNER_EMAIL: 'info@menu-made.com', ADMIN_API_TOKEN: 'admin-secret' };
  return { env, DB, pass };
}
const allSystemsPass = (f, h = 2) => cov.SYSTEMS.forEach(([, kind]) => f.pass(kind, h));

test('every public offer in the live catalog has at least one self-test listed', () => {
  // The offers on sale on Oct 30, 2026 (plus the two Store App offers waiting to launch).
  const live = ['ACCESSIBILITY_MONITORING', 'BUNDLE_GROWTH', 'BUNDLE_PRO', 'BUNDLE_STARTER', 'CONVERSION_FIX', 'GOOGLE_PROFILE_CARE', 'GOOGLE_VISIBILITY', 'GUEST_APP',
    'GUEST_APP_SETUP', 'MENU_CARE', 'NINO_FLYER', 'NINO_LOGO', 'NINO_MENU_DESIGN', 'NINO_SOCIAL_PACK', 'ONLINE_MENU_QR', 'REVIEW_REPLIES', 'SOCIAL_POSTS', 'STAFF_MERCH',
    'WEBSITE_CARE', 'WEBSITE_PACKAGE', 'STORE_APP_SETUP', 'STORE_APP_CARE'];
  for (const code of live) assert.ok(cov.OFFER_TESTS[code]?.length, `${code} has no self-test listed`);
});

test('green when every public offer and shared system passed within 36 hours; hidden offers do not count', async () => {
  const f = setup();
  allSystemsPass(f);
  f.pass('MENU_CARE_EDIT', 5);
  f.pass('GUEST_APP_RUN', 30);
  const map = await cov.buildCoverage(f.env, NOW);
  assert.equal(map.ok, true, JSON.stringify(map.gaps));
  const store = map.offers.find((o) => o.code === 'STORE_APP_SETUP');
  assert.equal(store.public, false);
  assert.equal(store.status, 'NEVER_PASSED', 'listed with its real status, but not counted while hidden');
});

test('an offer taken off sale with no self-test is left off the map', async () => {
  const f = setup({ offers: [['MENU_CARE', 1], ['ACCESSIBILITY_UPGRADE', 0], ['STORE_APP_SETUP', 0]] });
  allSystemsPass(f);
  f.pass('MENU_CARE_EDIT', 1);
  const map = await cov.buildCoverage(f.env, NOW);
  assert.deepEqual(map.offers.map((o) => o.code), ['MENU_CARE', 'STORE_APP_SETUP']);
  assert.equal(map.ok, true);
});

test('red for a stale test, a test that never passed, and an offer with no self-test; the last failure is shown', async () => {
  const f = setup({ offers: [['MENU_CARE', 1], ['GUEST_APP_SETUP', 1], ['WEBSITE_PACKAGE', 1], ['BRAND_NEW_THING', 1]] });
  allSystemsPass(f);
  f.pass('MENU_CARE_EDIT', 40);
  f.pass('MENU_CARE_EDIT', 3, 'FAILED', 'Hosted menu still shows the old price');
  f.pass('WEBSITE_PACKAGE_RUN', 2); // its trial test never ran
  const map = await cov.buildCoverage(f.env, NOW);
  assert.equal(map.ok, false);
  const by = Object.fromEntries(map.offers.map((o) => [o.code, o]));
  assert.equal(by.MENU_CARE.status, 'STALE');
  assert.equal(by.MENU_CARE.tests[0].lastError, 'Hosted menu still shows the old price');
  assert.equal(by.GUEST_APP_SETUP.status, 'NEVER_PASSED');
  assert.equal(by.WEBSITE_PACKAGE.status, 'NEVER_PASSED', 'every listed test must have passed');
  assert.equal(by.BRAND_NEW_THING.status, 'NO_TEST', 'a new offer shows up as a gap by itself');
  assert.deepEqual(map.gaps.map((g) => g.code).sort(), ['BRAND_NEW_THING', 'GUEST_APP_SETUP', 'MENU_CARE', 'WEBSITE_PACKAGE']);
});

test('a shared system that stopped passing makes it red', async () => {
  const f = setup({ offers: [['MENU_CARE', 1]] });
  allSystemsPass(f);
  f.pass('MENU_CARE_EDIT', 1);
  f.DB.raw.exec(`DELETE FROM self_tests WHERE kind = 'ACCOUNT_SIGNIN'`);
  f.pass('ACCOUNT_SIGNIN', 50);
  const map = await cov.buildCoverage(f.env, NOW);
  assert.deepEqual(map.gaps, [{ code: 'ACCOUNT_SIGNIN', name: 'Customer accounts', status: 'STALE' }]);
});

test('owner page: emailed 7-day link, no token to remember; admin token gives JSON; nothing without either', async () => {
  const f = setup();
  allSystemsPass(f);
  const call = (url, init) => worker.fetch(new Request(url, init), f.env, { waitUntil() {} });
  const start = await call('https://menu-made.com/api/system/coverage');
  assert.equal(start.status, 200);
  assert.match(await start.text(), /Email me the link/);
  const sent = await call('https://menu-made.com/api/system/coverage', { method: 'POST' });
  assert.match(await sent.text(), /Check your email/);
  assert.deepEqual(emails[0].to, ['info@menu-made.com']);
  const link = /href="([^"]+\/api\/system\/coverage\?t=[^"]+)"/.exec(emails[0].html)[1].replaceAll('&amp;', '&');
  const page = await call(link);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /What's for sale/);
  assert.match(html, /GUEST_APP_RUN: passed never/);
  assert.equal(page.headers.get('X-Robots-Tag'), 'noindex');
  const bad = await call('https://menu-made.com/api/system/coverage?t=forged');
  assert.equal(bad.status, 403);
  const json = await call('https://menu-made.com/api/system/coverage', { headers: { Authorization: 'Bearer admin-secret' } });
  const body = await json.json();
  assert.equal(body.ok, false);
  assert.ok(Array.isArray(body.offers) && body.systems.length === cov.SYSTEMS.length);
  assert.equal((await call('https://menu-made.com/api/system/coverage', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
});

test('stage 12 gaps: the Guest App, website trial and Store App trial self-tests are scheduled daily, once a day each', async () => {
  const guest = await import('./src/selftest/guest-app-selftest.js');
  const trial = await import('./src/selftest/website-trial-selftest.js');
  const f = setup();
  const at = (h, m) => new Date(Date.UTC(2026, 9, 31, h, m));
  const kinds = () => f.DB.raw.prepare(`SELECT kind, requested_by FROM self_tests ORDER BY kind`).all().map((r) => ({ ...r }));
  await guest.maybeScheduleDaily(f.env, at(19, 59));
  await trial.maybeScheduleDaily(f.env, at(20, 19));
  assert.deepEqual(kinds(), [], 'nothing outside the slots');
  await guest.maybeScheduleDaily(f.env, at(20, 0));
  await guest.maybeScheduleDaily(f.env, at(20, 5));
  await trial.maybeScheduleDaily(f.env, at(20, 20));
  await trial.maybeScheduleDaily(f.env, at(20, 25));
  await trial.maybeScheduleDaily(f.env, at(20, 40));
  await trial.maybeScheduleDaily(f.env, at(20, 45));
  assert.deepEqual(kinds(), [
    { kind: 'GUEST_APP_RUN', requested_by: 'daily' },
    { kind: 'STORE_APP_TRIAL_RUN', requested_by: 'daily' },
    { kind: 'WEBSITE_TRIAL_RUN', requested_by: 'daily' }
  ], 'one of each, even with several ticks in the slot');
  await trial.maybeScheduleDaily(f.env, at(21, 0));
  assert.equal(kinds().length, 3);
  assert.equal(await guest.maybeScheduleDaily({ DB: f.DB }), undefined, 'off outside the deployed worker (no SELFTEST_SCHEDULE)');
});

test('full run: "Run every self-test now" starts each self-test once, skipping any already running', async () => {
  const f = setup();
  allSystemsPass(f);
  f.DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, created_at, updated_at) VALUES ('busy', 'MENU_CARE_EDIT', 'RUNNING', 'x', 'x')`).run();
  const call = (url, init) => worker.fetch(new Request(url, init), f.env, { waitUntil() {} });
  await call('https://menu-made.com/api/system/coverage', { method: 'POST' });
  const link = /href="([^"]+\/api\/system\/coverage\?t=[^"]+)"/.exec(emails[0].html)[1].replaceAll('&amp;', '&');
  const page = await (await call(link)).text();
  assert.match(page, /Run every self-test now/);
  const form = new FormData(); form.set('t', new URL(link).searchParams.get('t')); form.set('run', '1');
  const after = await (await call('https://menu-made.com/api/system/coverage', { method: 'POST', body: form })).text();
  assert.match(after, /Started \d+ self-tests/);
  const requested = f.DB.raw.prepare(`SELECT kind FROM self_tests WHERE status = 'REQUESTED'`).all().map((r) => r.kind);
  const expected = new Set([...Object.values(cov.OFFER_TESTS).flat().map(([k]) => k), ...cov.SYSTEMS.map(([, k]) => k)]);
  expected.delete('MENU_CARE_EDIT');
  expected.delete('SITE_CHECK'); expected.delete('D1_USAGE'); // reported by GitHub Actions
  assert.deepEqual(new Set(requested), expected);
  assert.equal(requested.length, expected.size, 'one each');
  assert.equal((await cov.startFullRun(f.env)).length, 0, 'pressing again starts nothing new');
});

test('daily report: nothing on a green day; one email with the likely cause when something failed or went stale', async () => {
  const at = Date.parse('2026-10-31T22:01:00.000Z');
  const env = (f) => ({ ...f.env, SELFTEST_SCHEDULE: 'on' });
  const green = setup({ offers: [['MENU_CARE', 1]] });
  allSystemsPass(green, 2);
  green.DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, created_at, updated_at, finished_at) VALUES ('m', 'MENU_CARE_EDIT', 'PASSED', ?, ?, ?)`).run(new Date(at - 3600000).toISOString(), 'x', new Date(at - 3600000).toISOString());
  const r1 = await cov.dailyCoverageReport(env(green), at);
  assert.deepEqual(r1, { sent: false, ok: true, ops: [] });
  assert.equal(emails.length, 0);
  assert.deepEqual({ ...green.DB.raw.prepare(`SELECT id, kind, status, error FROM self_tests WHERE kind = 'DAILY_CHECK'`).get() }, { id: 'daily-check-2026-10-31', kind: 'DAILY_CHECK', status: 'PASSED', error: null }, 'a green day is recorded');

  const red = setup({ offers: [['MENU_CARE', 1], ['GUEST_APP_SETUP', 1]] });
  allSystemsPass(red, 2);
  red.DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, error, created_at, updated_at, finished_at) VALUES ('m', 'MENU_CARE_EDIT', 'FAILED', 'Hosted menu still shows the old price', ?, ?, ?)`).run(new Date(at - 3600000).toISOString(), 'x', new Date(at - 3600000).toISOString());
  assert.deepEqual(await cov.dailyCoverageReport(env(red), at + 3600000), { sent: false }, 'only in the 22:00 UTC slot');
  assert.deepEqual(await cov.dailyCoverageReport(red.f || red.env, at), { sent: false }, 'off outside the deployed worker');
  const r2 = await cov.dailyCoverageReport(env(red), at);
  assert.equal(r2.sent, true);
  const rec = red.DB.raw.prepare(`SELECT status, error FROM self_tests WHERE id = 'daily-check-2026-10-31'`).get();
  assert.equal(rec.status, 'FAILED');
  assert.match(rec.error, /GUEST_APP_SETUP NEVER_PASSED/);
  assert.equal(red.DB.raw.prepare(`SELECT count(*) n FROM self_tests WHERE kind = 'DAILY_CHECK'`).get().n, 1, 'one row per day');
  assert.deepEqual(r2.gaps.sort(), ['GUEST_APP_SETUP', 'MENU_CARE']);
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to, ['info@menu-made.com']);
  assert.match(emails[0].subject, /2 Menu-made items need a look/);
  assert.match(emails[0].text, /MENU_CARE_EDIT failed: Hosted menu still shows the old price/);
  assert.match(emails[0].text, /GUEST_APP_RUN has never passed/);
  assert.match(emails[0].html, /\/api\/system\/coverage\?t=/, 'links the page; no token to remember');
});

test('daily health summary (stage 13): real-order items that need the owner join the daily email; test orders never count', async () => {
  const at = Date.parse('2026-10-31T22:01:00.000Z');
  const ago = (h) => new Date(at - h * 3600000).toISOString();
  const f = setup({ offers: [['MENU_CARE', 1]] });
  allSystemsPass(f, 2);
  f.DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, created_at, updated_at, finished_at) VALUES ('m', 'MENU_CARE_EDIT', 'PASSED', ?, ?, ?)`).run(ago(1), ago(1), ago(1));
  const sql = (q, ...b) => f.DB.raw.prepare(q).run(...b);
  sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('real', 'x', 'x', 'joe@joespizza.example'), ('bot', 'x', 'x', 'delivered@resend.dev')`);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('b1', 'x', 'x', 'Joe''s Pizza'), ('b2', 'x', 'x', 'Self Test Cafe')`);
  // o1 live checkout, o2 a monthly subscription job (no checkout session), o3 Stripe test mode, o4 the self-test buyer on live.
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES
       ('o1', ?, 'x', 'real', 'b1', 'IN_PRODUCTION', 100, 100, 'PAID', 'cs_live_1'),
       ('o2', ?, 'x', 'real', 'b1', 'IN_PRODUCTION', 100, 100, 'PAID', NULL),
       ('o3', ?, 'x', 'real', 'b2', 'IN_PRODUCTION', 100, 100, 'PAID', 'cs_test_3'),
       ('o4', ?, 'x', 'bot', 'b2', 'IN_PRODUCTION', 100, 100, 'PAID', 'cs_live_4')`, ago(2), ago(30), ago(30), ago(30));
  const project = (id, order, status = 'IN_PROGRESS') => sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at)
       VALUES (?, ?, 'item', (SELECT business_id FROM orders WHERE id = ?), (SELECT customer_id FROM orders WHERE id = ?), 'MENU', ?, 'MENU_CARE_V1', 1, 'x', 'x')`, id, order, order, order, status);
  const run = (id, project, status, created) => sql(`INSERT INTO workflow_runs (id, project_id, workflow_key, workflow_version, status, trigger_type, created_at, failed_at) VALUES (?, ?, 'MENU_CARE_V1', 1, ?, 'ORDER', ?, ?)`, id, project, status, created, status === 'FAILED' ? created : null);
  project('p1', 'o1'); run('r1', 'p1', 'FAILED', ago(3));            // real, failed: counts
  project('p2', 'o2'); run('r2', 'p2', 'QUEUED', ago(30));            // real subscription job, not moving for 30 h: counts
  project('p3', 'o3'); run('r3', 'p3', 'FAILED', ago(3));            // test mode: never counts
  project('p4', 'o4'); run('r4', 'p4', 'FAILED', ago(3));            // self-test buyer on live: never counts
  sql(`INSERT INTO approvals (id, project_id, approval_type, status, requested_at) VALUES ('a1', 'p1', 'OWNER_RELEASE', 'PENDING', ?), ('a3', 'p3', 'OWNER_RELEASE', 'PENDING', ?)`, ago(40), ago(40));

  const items = await (await import('./src/admin/health.js')).operationsNeedingOwner(f.env, at);
  assert.deepEqual(items.map((i) => i.code), ['RUN_FAILED', 'APPROVAL_WAITING', 'RUN_STUCK']);
  assert.match(items[0].name, /^1 order stopped$/);
  assert.match(items[0].detail, /Joe's Pizza/);
  assert.doesNotMatch(JSON.stringify(items), /Self Test Cafe/, 'test orders never count');

  const r = await cov.dailyCoverageReport({ ...f.env, SELFTEST_SCHEDULE: 'on' }, at);
  assert.equal(r.sent, true);
  assert.equal(r.ok, true, 'every self-test passed');
  assert.deepEqual({ ...f.DB.raw.prepare(`SELECT status, error FROM self_tests WHERE id = 'daily-check-2026-10-31'`).get() }, { status: 'PASSED', error: null }, 'the stage 12 record stays self-tests only');
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /3 Menu-made items need a look/);
  assert.match(emails[0].text, /1 order stopped: Joe's Pizza/);
  assert.match(emails[0].text, /Last 24 hours: 1 paid order, 0 subscriptions started, 0 cancelled\./);
  assert.match(emails[0].html, /Something needs you today/);
});

test('daily check makes one query for every self-test result, so the 22:00 tick stays under the free D1 limit', async () => {
  const f = setup({ offers: [['MENU_CARE', 1], ['GUEST_APP_SETUP', 1]] });
  let n = 0;
  const DB = Object.create(f.DB); DB.prepare = (q) => { if (/FROM self_tests/.test(q)) n++; return f.DB.prepare(q); };
  await cov.buildCoverage({ ...f.env, DB }, NOW);
  assert.equal(n, 1);
});
