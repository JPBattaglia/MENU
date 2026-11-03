// Marketing plan v4 (Nov 3, 2026): the owner's Friday numbers email counts sales by the campaign each visit came from.
// Run: node --no-warnings --test booking-api/weekly-numbers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createD1 } from './test-support/d1.mjs';

const { weeklyNumbers, maxSpend, CAMPAIGNS } = await import('./src/marketing/weekly-numbers.js');

// Friday Nov 27, 2026, 9 am PST: twelve days into the Nov 16 campaigns.
const NOW = Date.parse('2026-11-27T17:00:00Z');

function ninoDb(rows) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE commerce_orders (id TEXT, snapshot_json TEXT, payment_status TEXT, live_mode INTEGER, paid_total_cents INTEGER, paid_at INTEGER)`);
  for (const r of rows) db.prepare(`INSERT INTO commerce_orders VALUES (?, ?, ?, ?, ?, ?)`).run(...r);
  const stmt = (sql, args = []) => ({ bind: (...v) => stmt(sql, v), async all() { return { results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }; } });
  return { prepare: (sql) => stmt(sql) };
}

function seed(env) {
  const raw = env.DB.raw;
  const t = '2026-11-20T18:00:00.000Z';
  raw.prepare(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('c1', ?, ?, 'a@b.example')`).run(t, t);
  const order = (id, total, status) => raw.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, subtotal_cents, total_cents, payment_status, status) VALUES (?, ?, ?, 'c1', ?, ?, ?, ?)`).run(id, t, t, total, total, status, status === 'PAID' ? 'PAID' : 'CREATED');
  const started = (id, order, campaign, env2 = 'live') => raw.prepare(`INSERT INTO funnel_events (id, created_at, event_type, order_id, campaign, metadata_json) VALUES (?, ?, 'CHECKOUT_STARTED', ?, ?, ?)`).run(id, t, order, campaign, JSON.stringify({ environment: env2 }));
  order('o1', 14400, 'PAID'); started('f1', 'o1', 'mm-search'); started('f1b', 'o1', 'mm-search');
  order('o2', 14400, 'UNPAID'); started('f2', 'o2', 'mm-search');
  order('o3', 19900, 'PAID'); started('f3', 'o3', 'nino-design');
  order('o4', 14400, 'PAID'); started('f4', 'o4', 'mm-search', 'sandbox');
  order('o5', 14400, 'PAID'); started('f5', 'o5', 'demo-menu');
  raw.prepare(`INSERT INTO prospects (id, name, status, sent_at, found_at, checked_at, updated_at) VALUES ('node/1', 'A', 'SENT', ?, ?, ?, ?)`).run(t, t, t, t);
}

test('the most a campaign can have spent grows by its daily budget and stops at its cap', () => {
  const shop = CAMPAIGNS.find((c) => c.key === 'nino-shop');
  assert.equal(maxSpend(shop, Date.parse('2026-11-10T12:00:00Z')), 0);
  assert.equal(maxSpend(shop, Date.parse('2026-11-16T12:00:00-08:00')), 225);
  assert.equal(maxSpend(shop, Date.parse('2027-01-01T12:00:00Z')), 6500);
});

test('Friday numbers count live paid sales once each, by campaign, and the shop by its order attribution', async () => {
  const env = { DB: createD1() };
  seed(env);
  const paid = Math.floor(Date.parse('2026-11-25T18:00:00Z') / 1000);
  env.NINO_DB = ninoDb([
    ['n1', JSON.stringify({ attribution: { source: 'google', medium: 'cpc', campaign: 'nino-shop' } }), 'paid', 1, 3319, paid],
    ['n2', JSON.stringify({ attribution: { source: 'pinterest', medium: 'product_pin' } }), 'paid', 1, 2800, paid],
    ['n3', JSON.stringify({}), 'paid', 0, 2800, paid]
  ]);
  const r = await weeklyNumbers(env, NOW);
  const row = (name) => r.rows.find(([k]) => k === name)?.[1] || '';
  assert.match(row('Menu-made search ads'), /^1 sale this week \(\$144\)/);
  assert.match(row('Menu-made search ads'), /2 checkouts started/);
  assert.match(row('Menu-made search ads'), /at most \$40\.80 spent, at most \$40\.80 per sale \(break-even \$135: under break-even\)/);
  assert.match(row('Nino design search ads'), /^1 sale this week \(\$199\)/);
  assert.match(row('Nino shopping ads'), /^1 sale this week \(\$33\.19\)/);
  assert.match(row('Nino shop, other'), /^1 order this week/);
  assert.match(row('Prospect emails'), /1 sent this week.*Sales from the emails since Nov 16: 1 \(\$144\)/);
  assert.equal(r.subject, 'Friday numbers: 5 sales this week');
});

test('without the shop database the email says so instead of reporting zero', async () => {
  const env = { DB: createD1() };
  const r = await weeklyNumbers(env, NOW);
  assert.match(r.rows.find(([k]) => k === 'Nino shopping ads')[1], /isn't connected/);
  assert.match(r.rows.find(([k]) => k === 'Menu-made search ads')[1], /no sale yet/);
});
