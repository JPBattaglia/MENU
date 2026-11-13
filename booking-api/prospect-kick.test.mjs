// Prospect outreach on time (Nov 9, 2026): the worker starts the prospect search, drafts and send jobs itself,
// once per Pacific day per slot, because GitHub's own timer ran them hours late or not at all.
// Run: node --no-warnings --test booking-api/prospect-kick.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { kickProspectJobs, dueSlots, pacific } = await import('./src/marketing/prospect-kick.js');

// Pacific Standard Time is UTC-8 in November.
const at = (iso) => Date.parse(iso);
const MON_1030_PST = at('2026-11-09T18:30:00Z');

function setup(status = 204) {
  const calls = [];
  const DB = createD1();
  DB.raw.exec(readFileSync(new URL('./migrations/0021_guest_app_engagement.sql', import.meta.url), 'utf8'));
  const env = {
    DB, GITHUB_DISPATCH_TOKEN: 'test-token',
    GITHUB_DISPATCH_FETCH: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status }); }
  };
  return { env, calls };
}

test('Pacific clock and due slots: Monday 10:30 am has the search, the drafts and the send due', () => {
  assert.deepEqual(pacific(MON_1030_PST), { day: '2026-11-09', weekday: 1, minutes: 630 });
  assert.deepEqual(dueSlots(MON_1030_PST).map((s) => s.key).sort(), ['drafts', 'prospects', 'send']);
  assert.deepEqual(dueSlots(at('2026-11-09T18:10:00Z')).map((s) => s.key).sort(), ['drafts', 'prospects'], 'send waits for 10:19');
  assert.deepEqual(dueSlots(at('2026-11-10T18:30:00Z')).map((s) => s.key).sort(), ['prospects-us', 'send'], 'Tuesday 10:30 am: the nationwide search (Tuesday to Friday since Nov 13) and the send');
  assert.deepEqual(dueSlots(at('2026-11-10T19:30:00Z')).map((s) => s.key), ['send'], 'Tuesday 11:30 am: the search is more than 6 hours past');
  assert.deepEqual(dueSlots(at('2026-11-13T13:00:00Z')).map((s) => s.key), ['prospects-us'], 'Friday 5 am: the nationwide search');
  assert.deepEqual(dueSlots(at('2026-11-09T13:00:00Z')).map((s) => s.key), [], 'Monday 5 am: no nationwide search (the Bay Area search is at 5:23)');
  assert.deepEqual(dueSlots(at('2026-11-12T17:00:00Z')).map((s) => s.key).sort(), ['drafts', 'prospects-us'], 'Thursday 9 am: drafts and the nationwide search');
  assert.deepEqual(dueSlots(at('2026-11-14T18:30:00Z')), [], 'nothing on Saturdays');
  assert.deepEqual(dueSlots(at('2026-11-11T02:00:00Z')), [], 'more than 6 hours late is skipped');
});

test('each slot starts once a day, with send=true only for the sender', async () => {
  const { env, calls } = setup();
  assert.deepEqual((await kickProspectJobs(env, MON_1030_PST)).sort(), ['drafts', 'prospects', 'send']);
  assert.equal(calls.length, 3);
  const send = calls.find((c) => c.body.inputs);
  assert.match(send.url, /prospect-drafts\.yml\/dispatches$/);
  assert.deepEqual(send.body, { ref: 'master', inputs: { send: 'true' } });
  assert.ok(calls.some((c) => /prospects\.yml\/dispatches$/.test(c.url) && !c.body.inputs));
  assert.deepEqual(await kickProspectJobs(env, MON_1030_PST + 5 * 60000), [], 'the next tick starts nothing');
  assert.equal(calls.length, 3);
  assert.deepEqual(await kickProspectJobs(env, at('2026-11-10T19:30:00Z')), ['send'], 'Tuesday gets its own send');
});

test('a refused start is retried after 15 minutes, and nothing runs without the token', async () => {
  const { env, calls } = setup(500);
  assert.deepEqual(await kickProspectJobs(env, at('2026-11-10T19:30:00Z')), []);
  assert.deepEqual(await kickProspectJobs(env, at('2026-11-10T19:35:00Z')), []);
  assert.equal(calls.length, 1, 'no retry within 15 minutes');
  await kickProspectJobs(env, at('2026-11-10T19:46:00Z'));
  assert.equal(calls.length, 2);
  assert.deepEqual(await kickProspectJobs({ DB: env.DB }, at('2026-11-11T19:30:00Z')), []);
});
