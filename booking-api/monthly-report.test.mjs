// Stage 14 (owner, Nov 17, 2026): the monthly marketing report email. Run: node --no-warnings --test booking-api/monthly-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { lastMonth, monthlyReport, runMonthlyReport } = await import('./src/marketing/monthly-report.js');
const read = (m) => readFileSync(new URL(`./migrations/${m}`, import.meta.url), 'utf8');

test('last month is the previous calendar month in Pacific time, across a year end', () => {
  const dec = lastMonth(Date.parse('2027-01-01T16:01:00Z'));
  assert.equal(dec.label, 'December 2026');
  assert.equal(dec.days.length, 31);
  assert.equal(dec.startIso, '2026-12-01T08:00:00.000Z');
  assert.equal(dec.endIso, '2027-01-01T08:00:00.000Z');
  assert.equal(lastMonth(Date.parse('2026-12-01T16:01:00Z')).label, 'November 2026');
});

test('the report counts real sales only, sends once a month on the 1st, and reads cleanly', async (t) => {
  const DB = createD1();
  for (const m of ['0021_guest_app_engagement.sql', '0062_menu_stats.sql']) DB.raw.exec(read(m));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t0 = '2026-11-10T20:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('real', ?, ?, 'owner@cafe.example'), ('bot', ?, ?, 'delivered@resend.dev')`, t0, t0, t0, t0);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('b', ?, ?, 'Cafe')`, t0, t0);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES
    ('o1', ?, ?, 'real', 'b', 'COMPLETED', 8900, 8900, 'PAID', 'cs_live_a'),
    ('o2', ?, ?, 'bot', 'b', 'COMPLETED', 5900, 5900, 'PAID', 'cs_live_b'),
    ('o3', ?, ?, 'real', 'b', 'COMPLETED', 5900, 5900, 'PAID', 'cs_test_c'),
    ('o4', '2026-10-05T20:00:00.000Z', ?, 'real', 'b', 'COMPLETED', 1200, 1200, 'PAID', 'cs_live_d')`, t0, t0, t0, t0, t0, t0, t0);
  sql(`INSERT INTO menu_stats_daily (business_id, day, views, qr_scans) VALUES ('b', '2026-11-12', 40, 15), ('b', '2026-10-30', 99, 99)`);
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => { if (String(input?.url || input) === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return Response.json({ id: 'em' }); } throw new Error(`unexpected fetch ${input}`); };
  t.after(() => { globalThis.fetch = original; });
  const env = { DB, RESEND_API_KEY: 're_test' };
  const now = Date.parse('2026-12-01T16:02:00Z');

  const report = await monthlyReport(env, now);
  const line = (k) => report.rows.find(([key]) => key === k)?.[1];
  assert.equal(report.subject, 'November 2026 marketing report: 1 sale');
  assert.match(line('Menu-made sales'), /^1 paid order, \$89\.$/);
  assert.match(line('Guests reading menus'), /40 menu views across 1 live menu, 15 QR scans/);
  assert.ok(!/undefined|NaN|null/.test(report.text), report.text);

  assert.equal((await runMonthlyReport(env, { now: Date.parse('2026-12-02T16:02:00Z') })).ran, false, 'only on the 1st');
  const first = await runMonthlyReport(env, { now });
  assert.equal(first.sent, true);
  assert.equal((await runMonthlyReport(env, { now: now + 60000 })).ran, false, 'once a month');
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /November 2026 marketing report/);
});
