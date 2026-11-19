// MΞNU Plus and MΞNU Pro daily self-tests (src/selftest/menu-plan-selftest.js): scheduled once a day each, in their own
// slot, and listed on the coverage map. The buyer's path itself is proven by the live runs (Stripe test clock).
// Run: node --no-warnings --test booking-api/menu-plan-selftest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './test-support/d1.mjs';

const plan = await import('./src/selftest/menu-plan-selftest.js');
const { OFFER_TESTS } = await import('./src/selftest/coverage.js');

test('MΞNU Plus and MΞNU Pro each run once a day in their own slot, after the Guest App test', async () => {
  const DB = createD1();
  const env = { DB };
  const at = (h, m) => new Date(Date.UTC(2026, 10, 16, h, m));
  const kinds = () => DB.raw.prepare(`SELECT kind FROM self_tests ORDER BY kind`).all().map((r) => r.kind);
  await plan.maybeScheduleDaily(env, at(20, 10));
  assert.deepEqual(kinds(), [], 'nothing before 20:20 UTC');
  await plan.maybeScheduleDaily(env, at(20, 25));
  assert.deepEqual(kinds(), ['MENU_PLUS_RUN']);
  await plan.maybeScheduleDaily(env, at(20, 35));
  await plan.maybeScheduleDaily(env, at(20, 45));
  assert.deepEqual(kinds(), ['MENU_PLUS_RUN', 'MENU_PRO_RUN'], 'once each');
  await plan.maybeScheduleDaily(env, at(20, 55));
  assert.equal(kinds().length, 2);
});

test('the runs buy the right plans and expect the right services and period work', () => {
  const runs = plan.MENU_PLAN_RUNS;
  assert.deepEqual(plan.MENU_PLAN_SELF_TEST_KINDS, ['MENU_PLUS_RUN', 'MENU_PRO_RUN']);
  assert.equal(runs.MENU_PLUS_RUN.plan, 'MENU_PLUS');
  assert.deepEqual(runs.MENU_PLUS_RUN.entitlements, ['MENU_PLUS']);
  assert.deepEqual(runs.MENU_PLUS_RUN.jobs, [], 'Plus does no work each period');
  assert.equal(runs.MENU_PRO_RUN.plan, 'BUNDLE_PREMIUM', 'MΞNU Max keeps the offer code BUNDLE_PREMIUM');
  assert.deepEqual(runs.MENU_PRO_RUN.entitlements, ['ACCESSIBILITY_MONITORING', 'GOOGLE_PROFILE_CARE', 'MENU_CARE', 'MENU_PLUS', 'MENU_PRO', 'REVIEW_REPLIES']);
  assert.equal(runs.MENU_PLUS_RUN.setupFree, false, 'Plus pays the $149 setup');
  assert.equal(runs.MENU_PRO_RUN.setupFree, true, 'Max has no setup fee');
  assert.deepEqual(runs.MENU_PRO_RUN.jobs, ['ACCESSIBILITY_MONITORING', 'GOOGLE_PROFILE_CARE', 'MENU_CARE', 'REVIEW_REPLIES']);
  assert.notEqual(runs.MENU_PLUS_RUN.business, runs.MENU_PRO_RUN.business, 'each run has its own test business');
  assert.notEqual(runs.MENU_PLUS_RUN.design, 'classic', 'a lost design choice shows');
});

test('the coverage map lists both plans with their self-tests', () => {
  assert.deepEqual(OFFER_TESTS.MENU_PLUS.map(([kind]) => kind), ['MENU_PLUS_RUN']);
  assert.deepEqual(OFFER_TESTS.BUNDLE_PREMIUM.map(([kind]) => kind), ['MENU_PRO_RUN']);
});
