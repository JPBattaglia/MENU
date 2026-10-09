import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
const source = await readFile(new URL('./menu-checkout-with-booking.mjs', import.meta.url), 'utf8');
const { runNextProductionStep } = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport {runNextProductionStep};').toString('base64'));
const run = '6bcab908-a2d9-4320-a8e9-3208b9be1b66';
function fixture(selected = true) {
  const reads = [], writes = [];
  const env = { PRODUCTION_RUNNER_SECRET: 'fixture-only', DB: { prepare(sql) {
    let args;
    return { bind(...values) { args = values; return this; }, async first() {
      reads.push({ sql, args });
      return selected ? { workflow_step_id: 'qc', workflow_run_id: run, step_key: 'QUALITY_CHECK', step_status: 'QUEUED', workflow_key: 'MENU_QR_V1', workflow_status: 'RUNNING', project_id: 'proof' } : null;
    }, async run() { writes.push({ sql, args }); return { meta: { changes: 1 } }; } };
  } } };
  return { env, reads, writes };
}
function request(payload, authorized = true) {
  return new Request('https://menu-made.com/api/production/run-next', { method: 'POST', headers: { Authorization: authorized ? 'Bearer fixture-only' : 'Bearer wrong' }, body: JSON.stringify(payload) });
}
test('exact-run preview binds both constraints and writes nothing', async () => {
  const f = fixture();
  const r = await runNextProductionStep(request({ workflow_run_id: run, step_key: 'QUALITY_CHECK', dry_run: true }), f.env);
  const data = await r.json();
  assert.equal(r.status, 200); assert.equal(data.dry_run, true); assert.equal(data.processed, false);
  assert.equal(data.workflow_run.id, run); assert.equal(data.selected_step.key, 'QUALITY_CHECK');
  assert.deepEqual(f.reads[0].args, [run, run, 'QUALITY_CHECK', 'QUALITY_CHECK']);
  assert.match(f.reads[0].sql, /previous.status !=/); assert.equal(f.writes.length, 0);
});
test('no matching runnable step does not fall back to another workflow', async () => {
  const f = fixture(false);
  const r = await runNextProductionStep(request({ workflow_run_id: run, step_key: 'QUALITY_CHECK', dry_run: true }), f.env);
  assert.equal((await r.json()).processed, false); assert.equal(f.reads.length, 1); assert.equal(f.writes.length, 0);
});
test('auth and malformed selections fail before reading or changing workflows', async () => {
  for (const payload of [{ workflow_run_id: 'not-a-run' }, { step_key: 'PACKAGE_DELIVERABLES' }, { dry_run: 'true' }, { reset: true }, []]) {
    const f = fixture(); assert.equal((await runNextProductionStep(request(payload), f.env)).status, 400);
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); assert.equal((await runNextProductionStep(request({ dry_run: true }, false), f.env)).status, 403);
  assert.equal(f.reads.length, 0);
});
test('omitting selection preserves the global runnable-step filters', async () => {
  const f = fixture(false);
  await runNextProductionStep(new Request('https://menu-made.com/api/production/run-next', { method: 'POST', headers: { Authorization: 'Bearer fixture-only' } }), f.env);
  assert.deepEqual(f.reads[0].args, [null, null, null, null]); assert.equal(f.writes.length, 0);
});
