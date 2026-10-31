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
  expected.delete('SITE_CHECK'); // runs in GitHub Actions
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
  assert.deepEqual(r1, { sent: false, ok: true });
  assert.equal(emails.length, 0);

  const red = setup({ offers: [['MENU_CARE', 1], ['GUEST_APP_SETUP', 1]] });
  allSystemsPass(red, 2);
  red.DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, error, created_at, updated_at, finished_at) VALUES ('m', 'MENU_CARE_EDIT', 'FAILED', 'Hosted menu still shows the old price', ?, ?, ?)`).run(new Date(at - 3600000).toISOString(), 'x', new Date(at - 3600000).toISOString());
  assert.deepEqual(await cov.dailyCoverageReport(env(red), at + 3600000), { sent: false }, 'only in the 22:00 UTC slot');
  assert.deepEqual(await cov.dailyCoverageReport(red.f || red.env, at), { sent: false }, 'off outside the deployed worker');
  const r2 = await cov.dailyCoverageReport(env(red), at);
  assert.equal(r2.sent, true);
  assert.deepEqual(r2.gaps.sort(), ['GUEST_APP_SETUP', 'MENU_CARE']);
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to, ['info@menu-made.com']);
  assert.match(emails[0].subject, /2 Menu-made checks need a look/);
  assert.match(emails[0].text, /MENU_CARE_EDIT failed: Hosted menu still shows the old price/);
  assert.match(emails[0].text, /GUEST_APP_RUN has never passed/);
  assert.match(emails[0].html, /\/api\/system\/coverage\?t=/, 'links the page; no token to remember');
});
