// Stage 12, task 7: failure drills. Each failure must reach the owner as one alert with one action.
// Here: Resend down (the GitHub fallback), GitHub refusing a job, and D1 near its daily limit. Elsewhere:
// Store App builds refused (store-app-build.test.mjs), Apple and Firebase keys refused (store-app-push.test.mjs,
// store-app-android.test.mjs), Stripe webhook retries (subscriptions.test.mjs duplicate event, webhook-retry.test.mjs).
// Run: node --no-warnings --test booking-api/failure-drills.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { sendTransactionalEmail } = await import('./src/lib/email.js');
const { dispatchRefused } = await import('./src/lib/dispatch-alert.js');
const d1 = await import('./src/selftest/d1-usage.js');

function setup({ resend = 503 } = {}) {
  const DB = createD1();
  DB.raw.exec(readFileSync(new URL('./migrations/0021_guest_app_engagement.sql', import.meta.url), 'utf8'));
  const github = []; const sent = [];
  const env = {
    DB, RESEND_API_KEY: 're_test', OWNER_EMAIL: 'info@menu-made.com', GITHUB_DISPATCH_TOKEN: 'github_pat_test',
    GITHUB_DISPATCH_FETCH: async (url, init) => { github.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
  };
  const state = { resend };
  const withResend = async (fn) => {
    const o = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://api.resend.com/')) {
        if (state.resend !== 200) return Response.json({ message: 'Service unavailable' }, { status: state.resend });
        sent.push(JSON.parse(init.body)); return Response.json({ id: `em_${sent.length}` });
      }
      return o(url, init);
    };
    try { return await fn(); } finally { globalThis.fetch = o; }
  };
  const mail = (to, key) => withResend(() => sendTransactionalEmail(env, { to, subject: 'Hello', html: '<p>Hi</p>', text: 'Hi', idempotencyKey: key, purpose: 'ORDER_DELIVERY', templateKey: 'drill_v1' }));
  const n = (q) => DB.raw.prepare(q).get().n;
  return { env, DB, github, sent, state, mail, n };
}

test('Resend down: three failed customer emails start one GitHub alert; more failures stay quiet for 6 hours', async () => {
  const f = setup();
  await f.mail('a@example.com', 'k1');
  await f.mail('b@example.com', 'k2');
  assert.equal(f.github.length, 0, 'two failures could be a blip');
  await f.mail('c@example.com', 'k3');
  assert.equal(f.github.length, 1);
  assert.match(f.github[0].url, /owner-alert\.yml\/dispatches$/);
  assert.equal(f.github[0].body.inputs.title, "Menu-made can't send email");
  assert.match(f.github[0].body.inputs.message, /Service unavailable/);
  assert.match(f.github[0].body.inputs.message, /resend-status\.com/);
  for (let i = 0; i < 4; i++) await f.mail('info@menu-made.com', `owner-${i}`);
  assert.equal(f.github.length, 1, 'one alert, not one per failure');
  assert.equal(f.n(`SELECT COUNT(*) AS n FROM communications WHERE status = 'FAILED'`), 7, 'every failure is still logged (deliveries retry from it)');
});

test('Resend down: a failed owner alert goes through GitHub at once; a success resets the count', async () => {
  const f = setup();
  await f.mail('info@menu-made.com', 'alert-1');
  assert.equal(f.github.length, 1, 'the owner would otherwise hear nothing');

  const g = setup();
  await g.mail('a@example.com', 'k1');
  await g.mail('b@example.com', 'k2');
  g.state.resend = 200;
  await g.mail('c@example.com', 'k3');
  g.state.resend = 503;
  await g.mail('d@example.com', 'k4');
  await g.mail('e@example.com', 'k5');
  assert.equal(g.github.length, 0, 'the streak restarted after the success');
});

test('GitHub refusing a job: one email a day for a token problem, none for a short outage', async () => {
  const f = setup({ resend: 200 });
  const now = Date.parse('2026-11-01T10:00:00Z');
  const run = (status, at) => (async () => { const o = globalThis.fetch; globalThis.fetch = async (url, init) => { f.sent.push(JSON.parse(init.body)); return Response.json({ id: 'e' }); }; try { return await dispatchRefused(f.env, status, 'a Store App build', at); } finally { globalThis.fetch = o; } })();
  await run(502, now);
  assert.equal(f.sent.length, 0);
  await run(401, now);
  await run(403, now + 300000);
  await run(401, now + 3 * 3600000);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].subject, 'GitHub refused to start a job');
  assert.match(f.sent[0].text, /HTTP 401/);
  assert.match(f.sent[0].text, /tell Claude "GitHub token refused"/);
  await run(401, now + 25 * 3600000);
  assert.equal(f.sent.length, 2, 'still broken the next day: one more');
});

test('D1 usage: normal usage passes; near the limit fails and emails once a day; an unreadable report fails without email', async () => {
  const f = setup({ resend: 200 });
  const at = Date.parse('2026-11-01T12:00:00Z'); // half the UTC day gone
  const report = (read, written = 1000) => ({ date: '2026-11-01', run_id: '1', databases: [{ id: '1387bcdc-e462-41ce-bc6b-5cc1b0a47ad0', rows_read: read, rows_written: written }, { id: '3b48a25e-1854-48ca-b821-ef1552d385cc', rows_read: 100000, rows_written: 0 }] });
  const record = (body, now) => (async () => { const o = globalThis.fetch; globalThis.fetch = async (url, init) => { f.sent.push(JSON.parse(init.body)); return Response.json({ id: 'e' }); }; try { return await d1.recordUsage(f.env, body, now); } finally { globalThis.fetch = o; } })();

  assert.equal((await record(report(400000), at)).status, 'PASSED');
  const row = () => ({ ...f.DB.raw.prepare(`SELECT id, status, error, log_json FROM self_tests WHERE kind = 'D1_USAGE'`).get() });
  assert.equal(row().id, 'd1-usage-2026-11-01');
  assert.match(row().log_json, /reads: 500,000 of 5,000,000 today \(10%, on pace for 20%; Menu-made 400,000, Nino shop 100,000\)/);

  assert.equal((await record(report(2100000), at + 3600000)).status, 'FAILED', 'on pace for over 80%');
  await record(report(2600000), at + 2 * 3600000);
  assert.equal(f.sent.length, 1, 'one email a day');
  assert.equal(f.sent[0].subject, 'The database is near its free daily limit');
  assert.match(f.sent[0].text, /upgrade Cloudflare to Workers Paid/);
  assert.equal(f.n(`SELECT COUNT(*) AS n FROM self_tests WHERE kind = 'D1_USAGE'`), 1, 'one row per day, updated hourly');

  const g = setup({ resend: 200 });
  const r = await d1.recordUsage(g.env, { date: '2026-11-01', error: 'Authentication error', databases: [] }, at);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.alerted, false);
  assert.match({ ...g.DB.raw.prepare(`SELECT error FROM self_tests`).get() }.error, /couldn't be read: Authentication error/);
});

test('D1 usage: early in the day the pace is not judged; writes count too', () => {
  const early = d1.assessUsage({ databases: [{ id: 'x', rows_read: 300000, rows_written: 10 }] }, Date.parse('2026-11-01T01:00:00Z'));
  assert.equal(early.ok, true);
  const writes = d1.assessUsage({ databases: [{ id: 'x', rows_read: 10, rows_written: 60000 }] }, Date.parse('2026-11-01T20:00:00Z'));
  assert.equal(writes.ok, false);
  assert.match(writes.problem, /writes 60% used/);
});
