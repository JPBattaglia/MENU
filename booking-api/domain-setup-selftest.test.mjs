// Custom domain setup self-test (Cloudflare for SaaS): read-only check of the worker settings, token and fallback origin.
// Run: node --no-warnings --test booking-api/domain-setup-selftest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './test-support/d1.mjs';

const { advanceDomainSetupSelfTests } = await import('./src/selftest/domain-setup-selftest.js');

function setup(config = { CF_ZONE_ID: 'zone_1', CF_SAAS_TOKEN: 'cf_token' }) {
  const DB = createD1();
  const t = new Date().toISOString();
  DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('st', 'CUSTOM_DOMAIN_SETUP', 'REQUESTED', 'test', ?, ?)`).run(t, t);
  const env = { DB, RESEND_API_KEY: 're_test', ...config };
  const row = () => ({ ...DB.raw.prepare(`SELECT status, error, log_json FROM self_tests WHERE id = 'st'`).get() });
  return { env, row, DB };
}

// A fake Cloudflare API: fallback origin and custom hostname list, with switches for each way it can be wrong.
function cloudflare({ origin = 'sites.menu-made.com', status = 'active', denied = false } = {}) {
  const calls = []; const emails = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'e' }); }
    calls.push({ url: u, method: init.method || 'GET', auth: init.headers?.Authorization });
    if (denied) return Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 });
    if (u.endsWith('/zones/zone_1/custom_hostnames/fallback_origin')) return Response.json({ success: true, result: { origin, status } });
    if (u.includes('/zones/zone_1/custom_hostnames?per_page=1')) return Response.json({ success: true, result: [], result_info: { total_count: 0 } });
    return Response.json({ success: false }, { status: 404 });
  };
  return { fetch, calls, emails };
}
async function run(f, cf) {
  const original = globalThis.fetch; globalThis.fetch = cf.fetch;
  try { return await advanceDomainSetupSelfTests(f.env, { fetch: cf.fetch }); } finally { globalThis.fetch = original; }
}

test('a working setup passes, reads only, and emails nobody', async () => {
  const f = setup(); const cf = cloudflare();
  await run(f, cf);
  assert.equal(f.row().status, 'PASSED');
  assert.match(f.row().log_json, /sites\.menu-made\.com is active/);
  assert.ok(cf.calls.every((c) => c.method === 'GET'), 'nothing is created or changed at Cloudflare');
  assert.ok(cf.calls.every((c) => c.auth === 'Bearer cf_token'));
  assert.equal(cf.emails.length, 0);
});

test('each way the setup can be wrong fails with its own reason and emails the owner', async () => {
  for (const [config, cfOptions, reason] of [
    [{ CF_ZONE_ID: 'zone_1' }, {}, /CF_ZONE_ID or CF_SAAS_TOKEN is not set/],
    [undefined, { denied: true }, /HTTP 403\): Authentication error/],
    [undefined, { status: 'pending_deployment' }, /pending_deployment, not active/],
    [undefined, { origin: 'fallback.menu-made.com' }, /fallback\.menu-made\.com, expected sites\.menu-made\.com/]
  ]) {
    const f = setup(config); const cf = cloudflare(cfOptions);
    await run(f, cf);
    assert.equal(f.row().status, 'FAILED', String(reason));
    assert.match(f.row().error, reason);
    assert.match(cf.emails[0].subject, /Custom domain setup check failed/);
  }
});

test('the daily check is scheduled only once custom domains are configured', async () => {
  const at9amPacific = new Date('2026-10-28T16:05:00Z');
  const off = setup({}); off.DB.raw.prepare(`DELETE FROM self_tests`).run();
  await advanceDomainSetupSelfTests(off.env, { now: at9amPacific, fetch: cloudflare().fetch });
  assert.equal(off.DB.raw.prepare(`SELECT COUNT(*) AS n FROM self_tests`).get().n, 0);
  const on = setup(); on.DB.raw.prepare(`DELETE FROM self_tests`).run();
  await run(on, cloudflare()).catch(() => null);
  const original = globalThis.fetch; globalThis.fetch = cloudflare().fetch;
  try { await advanceDomainSetupSelfTests(on.env, { now: at9amPacific, fetch: cloudflare().fetch }); } finally { globalThis.fetch = original; }
  assert.equal(on.DB.raw.prepare(`SELECT status FROM self_tests WHERE requested_by = 'daily'`).get().status, 'PASSED');
});
