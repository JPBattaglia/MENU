// Stage 12, task 4: the daily site check's result reaches the worker over the workflow's OIDC token and is stored
// as a SITE_CHECK self-test, which the coverage map counts; anything else is refused.
// Run: node --no-warnings --test booking-api/site-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const sc = await import('./src/selftest/site-check.js');
const cov = await import('./src/selftest/coverage.js');

const RESULT = { ok: true, axe: true, sites: [
  { site: 'https://menu-made.com', pages: [{ path: '/', status: 200, ms: 900 }], failures: [], warnings: ['/plans.html: took 4.2 s to load'] },
  { site: 'https://ninobattaglia.com', pages: [{ path: '/', status: 200, ms: 700 }, { path: '/art.html', status: 200, ms: 800 }], failures: [], warnings: [] }
] };

async function setup() {
  const env = { DB: createD1() };
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const kid = `kid-site-${crypto.randomUUID()}`;
  env.RENDER_OIDC_FETCH = async () => Response.json({ keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' }] });
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-site-check', exp: now + 300, nbf: now - 5, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master',
    job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/site-check.yml@refs/heads/master', event_name: 'schedule' };
  const sign = async (claims) => { const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })); const b = b64u(JSON.stringify(claims));
    return `${h}.${b}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${b}`))))}`; };
  const post = async (body, claims = good) => worker.fetch(new Request('https://menu-made.com/api/system/site-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await sign(claims)}` }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  const rows = () => env.DB.raw.prepare(`SELECT kind, status, error, log_json, requested_by FROM self_tests`).all().map((r) => ({ ...r }));
  return { env, post, rows, good };
}

test('a passing result from the workflow is stored as SITE_CHECK PASSED, with the run link and warnings in the log', async () => {
  const f = await setup();
  const res = await f.post({ ...RESULT, run_id: '123456' });
  assert.deepEqual(await res.json(), { ok: true, status: 'PASSED' });
  const [row] = f.rows();
  assert.equal(row.kind, 'SITE_CHECK'); assert.equal(row.status, 'PASSED'); assert.equal(row.requested_by, 'github-site-check');
  assert.match(row.log_json, /menu-made\.com: 1 pages, 0 failures, 1 warnings; ninobattaglia\.com: 2 pages/);
  assert.match(row.log_json, /actions\/runs\/123456/);
  assert.match(row.log_json, /took 4\.2 s/);
});

test('failures make it FAILED with the first problems in the error, and the coverage map turns red for it', async () => {
  const f = await setup();
  const bad = structuredClone(RESULT);
  bad.ok = false; bad.sites[1].failures = ['/shop.html: broken link /assets/x.webp (404)', '/: arrow on a "Shop now →" (house rule: no arrows on buttons or links)'];
  assert.equal((await (await f.post(bad)).json()).status, 'FAILED');
  assert.match(f.rows()[0].error, /^2 problems: ninobattaglia\.com \/shop\.html: broken link .* \| ninobattaglia\.com \/: arrow on a "Shop now/);
  const map = await cov.buildCoverage(f.env);
  const site = map.systems.find((s) => s.code === 'SITE_CHECK');
  assert.equal(site.name, 'Website checks (both sites)');
  assert.equal(site.status, 'NEVER_PASSED');
  assert.ok(map.gaps.some((g) => g.code === 'SITE_CHECK'));
});

test('refused: no token, another workflow, a push event, or a body that is not a result', async () => {
  const f = await setup();
  const plain = await worker.fetch(new Request('https://menu-made.com/api/system/site-check', { method: 'POST', body: '{}' }), f.env, { waitUntil() {} });
  assert.equal(plain.status, 401);
  assert.equal((await f.post(RESULT, { ...f.good, job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/other.yml@refs/heads/master' })).status, 403);
  assert.equal((await f.post(RESULT, { ...f.good, event_name: 'push' })).status, 403);
  assert.equal((await f.post({ ok: true })).status, 400);
  assert.equal(f.rows().length, 0);
});

test('the full run does not queue SITE_CHECK (it runs in GitHub Actions)', async () => {
  const f = await setup();
  const started = await cov.startFullRun(f.env);
  assert.ok(!started.includes('SITE_CHECK'));
  assert.ok(started.includes('ACCOUNT_SIGNIN'));
});
