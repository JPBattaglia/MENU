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
