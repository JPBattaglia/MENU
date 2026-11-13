import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createD1 } from './test-support/d1.mjs';
const { advanceSandboxCancels } = await import('./src/admin/sandbox-cancel.js');
test('cancels only listed ids with the sandbox key', async () => {
  const DB = createD1(); const calls = [];
  DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, state_json, created_at, updated_at) VALUES ('t1','SANDBOX_CANCEL','REQUESTED',?, 'x','x')`).run(JSON.stringify({ subscriptions: ['sub_1Ub7TGHw7f6jhUv8gDrDKKI7', 'bad id'] }));
  globalThis.fetch = async (url, init) => { calls.push([url, init.method, init.headers.Authorization]); return Response.json({ id: 'x', status: 'canceled' }); };
  await advanceSandboxCancels({ DB, STRIPE_SECRET_KEY_TEST: 'sk_test_1', STRIPE_SECRET_KEY: 'sk_live_1' });
  assert.deepEqual(calls, [['https://api.stripe.com/v1/subscriptions/sub_1Ub7TGHw7f6jhUv8gDrDKKI7', 'DELETE', 'Bearer sk_test_1']]);
  assert.equal(DB.raw.prepare(`SELECT status FROM self_tests`).get().status, 'PASSED');
  await advanceSandboxCancels({ DB, STRIPE_SECRET_KEY_TEST: 'sk_test_1' }); assert.equal(calls.length, 1, 'runs once');
});
