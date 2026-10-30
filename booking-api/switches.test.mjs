// Owner on/off switches (src/lib/switches.js): the emailed-link page, and what each switch actually stops:
// production waits (self-tests still run), live checkout refuses, notifications and reminder emails pause.
// Run: node --no-warnings --test booking-api/switches.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const sw = await import('./src/lib/switches.js');
const engage = await import('./src/producers/guest-app/engage.js');
const { signLinkToken } = await import('./src/lib/links.js');

function setup() {
  const DB = createD1();
  DB.raw.exec(readFileSync(new URL('./migrations/0021_guest_app_engagement.sql', import.meta.url), 'utf8'));
  DB.raw.exec('PRAGMA foreign_keys = OFF');
  const env = { DB, PRODUCTION_RUNNER_SECRET: 'runner-secret' };
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  return { env, DB, sql };
}
const call = (f, url, init) => worker.fetch(new Request(url, init), f.env, { waitUntil() {} });
const token = (f) => signLinkToken(f.env, { kind: sw.LINK_KIND, id: 'owner', ttlDays: 7 });
async function save(f, onIds) {
  const form = new FormData();
  form.set('t', await token(f));
  for (const id of onIds) form.append('on', id);
  return call(f, 'https://menu-made.com/api/switches', { method: 'POST', body: form });
}
const allIds = () => ['prod:ALL', 'sell:ALL', ...sw.SERVICES.flatMap((s) => [`prod:${s.key}`, `sell:${s.key}`]), ...sw.AUTOMATIONS.map((a) => `auto:${a.key}`)];

test('page: link by email, everything on by default, unticking saves only those switches off', async () => {
  const f = setup();
  assert.match(await (await call(f, 'https://menu-made.com/api/switches')).text(), /Email me the link/);
  assert.equal((await call(f, 'https://menu-made.com/api/switches?t=nope')).status, 403);
  const page = await (await call(f, `https://menu-made.com/api/switches?t=${encodeURIComponent(await token(f))}`)).text();
  assert.match(page, /Everything is on/);
  assert.equal((page.match(/ checked/g) || []).length, allIds().length);
  const off = ['prod:MENU_CARE', 'sell:STAFF_MERCH', 'auto:PUSH'];
  const saved = await (await save(f, allIds().filter((id) => !off.includes(id)))).text();
  assert.match(saved, /Saved: 3 changes/);
  assert.match(saved, /3 switches are off/);
  assert.deepEqual([...(await sw.offSwitches(f.env))].sort(), off.sort());
  // tick them back on
  assert.match(await (await save(f, allIds())).text(), /Saved: 3 changes/);
  assert.equal((await sw.offSwitches(f.env)).size, 0);
});

test('making: a paused service waits in the runner; self-test orders and other services still run; Everything pauses all', async () => {
  const f = setup();
  const t = '2026-10-29T00:00:00.000Z';
  f.sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('real', ?, ?, 'owner@cafe.example'), ('bot', ?, ?, 'delivered@resend.dev')`, t, t, t, t);
  const run = (id, key, customer, minute) => {
    const at = `2026-10-29T00:0${minute}:00.000Z`;
    f.sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, workflow_key, created_at, updated_at, status) VALUES (?, 'o', 'i', 'b', ?, 'X', ?, ?, ?, 'IN_PROGRESS')`, `p-${id}`, customer, key, at, at);
    f.sql(`INSERT INTO workflow_runs (id, project_id, workflow_key, workflow_version, trigger_type, created_at, status) VALUES (?, ?, ?, 1, 'TEST', ?, 'QUEUED')`, id, `p-${id}`, key, at);
    f.sql(`INSERT INTO workflow_steps (id, workflow_run_id, step_key, step_order, status) VALUES (?, ?, 'PRODUCE', 1, 'QUEUED')`, `s-${id}`, id);
  };
  run('11111111-1111-4111-8111-111111111111', 'MENU_CARE_V1', 'real', 1);
  run('22222222-2222-4222-8222-222222222222', 'MENU_CARE_V1', 'bot', 2);
  run('33333333-3333-4333-8333-333333333333', 'SOCIAL_POSTS_V1', 'real', 3);
  const next = async () => {
    const res = await call(f, 'https://menu-made.com/api/production/run-next', { method: 'POST', headers: { Authorization: 'Bearer runner-secret' }, body: JSON.stringify({ dry_run: true }) });
    const body = await res.json();
    return body.workflow_run?.id || body.selected_step?.workflow_run_id || (body.processed === false && !body.dry_run ? null : body.workflow_run_id) || null;
  };
  const picks = async () => {
    // dry run shows the first runnable step; mark it and look again to list the order
    const seen = [];
    for (let i = 0; i < 3; i++) {
      const id = await next();
      if (!id) break;
      seen.push(id);
      f.sql(`UPDATE workflow_steps SET status = 'SKIPPED' WHERE workflow_run_id = ?`, id);
    }
    f.sql(`UPDATE workflow_steps SET status = 'QUEUED' WHERE status = 'SKIPPED'`);
    return seen.map((id) => id.slice(0, 1));
  };
  assert.deepEqual(await picks(), ['1', '2', '3']);
  await save(f, allIds().filter((id) => id !== 'prod:MENU_CARE'));
  assert.deepEqual(await picks(), ['2', '3'], 'the real Menu Care order waits; its self-test and Social Posts run');
  await save(f, allIds().filter((id) => id !== 'prod:ALL'));
  assert.deepEqual(await picks(), ['2'], 'Everything off: only self-tests run');
  await save(f, allIds());
  assert.deepEqual(await picks(), ['1', '2', '3'], 'back on: the waiting order runs first, in order');
});

test('selling: paused services and bundles that include them; Everything pauses all', async () => {
  const f = setup();
  assert.equal(await sw.pausedForSale(f.env, ['MENU_CARE']), null);
  await save(f, allIds().filter((id) => id !== 'sell:REVIEW_REPLIES'));
  assert.equal((await sw.pausedForSale(f.env, ['BUNDLE_STARTER', 'MENU_CARE', 'REVIEW_REPLIES'])).label, 'Review Replies', 'a bundle that includes it is paused too');
  assert.equal(await sw.pausedForSale(f.env, ['ONLINE_MENU_QR']), null);
  assert.match(sw.pausedMessage({ label: 'Review Replies' }), /^Review Replies is paused for a short while/);
  await save(f, allIds().filter((id) => id !== 'sell:ALL'));
  assert.equal((await sw.pausedForSale(f.env, ['ONLINE_MENU_QR'])).label, 'Ordering');
});

test('automations: notifications refuse to queue while off (held self-test messages still allowed)', async () => {
  const f = setup();
  const app = '11111111-2222-4333-8444-555555555555';
  await save(f, allIds().filter((id) => id !== 'auto:PUSH'));
  assert.deepEqual(await engage.queuePush(f.env, app, { title: 'Hi', body: 'Soup' }), { ok: false, reason: 'paused' });
  assert.equal((await engage.queuePush(f.env, app, { title: 'Test', body: 'Self-test', source: 'SELFTEST', status: 'HELD' })).ok, true);
  assert.equal((await engage.sendQueuedPushes(f.env)).paused, true);
  assert.equal(await sw.automationOff(f.env, 'ABANDONED_EMAILS'), false);
});

test('without the settings table every switch reads as on', async () => {
  assert.equal((await sw.offSwitches({ DB: createD1() })).size, 0);
  assert.deepEqual(await sw.pausedWorkflows({ DB: createD1() }), { all: false, keys: [] });
});
