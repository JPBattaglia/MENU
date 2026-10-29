// D1 read-cost guard (Oct 27, 2026). The scheduled handler runs every 5 minutes, so any query in it that scans a
// whole table is multiplied by 288 a day (this exhausted the free-tier daily read limit).
// This test applies migration 0003 to the production-schema copy, runs one full scheduled tick, records every SELECT
// the worker issued, and fails if any of them scans a table that grows with orders, subscriptions or events.
// Run: node --no-warnings --test booking-api/read-cost.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const migration = readFileSync(new URL('./migrations/0003_read_cost_indexes.sql', import.meta.url), 'utf8')
  + readFileSync(new URL('./migrations/0018_menu_hosting_index.sql', import.meta.url), 'utf8')
  + readFileSync(new URL('./migrations/0020_stage10_read_indexes.sql', import.meta.url), 'utf8');

// Tables that grow without bound. A full SCAN of one of these inside the scheduled tick is a failure.
const GROWING = ['workflow_steps', 'workflow_runs', 'business_events', 'approvals', 'projects', 'orders', 'communications', 'deliverables'];
// Partial indexes (migration 0003) that contain only pending rows.
const PARTIAL_INDEXES = ['idx_approvals_owner_pending', 'idx_projects_payment_required', 'idx_projects_awaiting_inputs', 'idx_projects_merch_delivered'];
// Aliases the worker uses for those tables inside its queries.
const ALIASES = { ws: 'workflow_steps', previous: 'workflow_steps', wr: 'workflow_runs', px: 'projects', p: 'projects', d: 'deliverables' };

// Wraps the D1 stand-in so every SELECT (with its bound values) is recorded, then runs it unchanged.
function recordingDb(db) {
  const selects = [];
  const record = (sql, values) => { if (/^\s*SELECT/i.test(sql)) selects.push({ sql, values }); };
  return {
    selects,
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...values) { record(sql, values); return statement.bind(...values); },
        first: (...args) => { record(sql, []); return statement.first(...args); },
        all: (...args) => { record(sql, []); return statement.all(...args); },
        run: (...args) => statement.run(...args)
      };
    },
    batch: (statements) => db.batch(statements),
    raw: db.raw
  };
}

async function scheduledTick(env) {
  const pending = [];
  await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil: (p) => pending.push(p) });
  await Promise.allSettled(pending);
}

test('migration 0003 applies cleanly and can be applied twice', () => {
  const DB = createD1();
  DB.raw.exec(migration);
  DB.raw.exec(migration);
  const names = DB.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all().map((r) => r.name);
  for (const expected of ['idx_workflow_steps_status', 'idx_business_events_type_created', 'idx_approvals_owner_pending', 'idx_projects_payment_required']) {
    assert.ok(names.includes(expected), `${expected} missing`);
  }
});

test('one scheduled tick never full-scans a table that grows with orders or events', async () => {
  const base = createD1();
  base.raw.exec(migration);
  const DB = recordingDb(base);
  const env = {
    DB,
    ASSETS: createR2(),
    PRODUCTION_RUNNER_SECRET: 'runner-secret-for-tests',
    RESEND_API_KEY: 're_test_placeholder',
    BOOKING_FROM: 'Menu-made <hello@menu-made.com>',
    BOOKING_TO: 'owner@menu-made.com',
    OWNER_EMAIL: 'owner@menu-made.com',
    PUBLIC_BASE_URL: 'https://menu-made.com'
  };
  // Run twice: the second tick is the steady state (daily pass already marked, nothing queued).
  await scheduledTick(env);
  await scheduledTick(env);
  assert.ok(DB.selects.length > 5, `expected the tick to run several queries, saw ${DB.selects.length}`);

  const offenders = [];
  for (const { sql, values } of DB.selects) {
    let plan;
    try {
      plan = base.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values);
    } catch (error) {
      continue; // a statement that cannot be planned here (missing optional table) is not a scan finding
    }
    for (const row of plan) {
      const match = /^SCAN (\w+)/.exec(row.detail);
      if (!match) continue;
      // Walking a partial index is fine: it holds only the few pending rows, never the whole table.
      if (PARTIAL_INDEXES.some((name) => row.detail.includes(name))) continue;
      const table = ALIASES[match[1]] || match[1];
      if (GROWING.includes(table)) offenders.push(`${row.detail}  <=  ${sql.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
    }
  }
  assert.deepEqual(offenders, [], `full table scans inside the scheduled tick:\n${offenders.join('\n')}`);
});
