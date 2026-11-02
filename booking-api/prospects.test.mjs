// Marketing (Nov 1, 2026): the weekly prospect finder posts its rows over the workflow's OIDC token; rows are cleaned,
// existing clients are dropped, and a re-found business keeps its outreach status.
// Run: node --no-warnings --test booking-api/prospects.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { prospectRow } = await import('./src/marketing/prospects.js');

const CAFE = { id: 'node/101', name: 'Sample Cafe', kind: 'cafe', city: 'San Francisco', website: 'https://samplecafe.example/', email: 'Hello@SampleCafe.example',
  email_source: 'mailto', gaps: ['menu_pdf', 'no_tap_to_call', 'made_up'], menu_url: 'https://samplecafe.example/menu.pdf', offer_code: 'ONLINE_MENU_QR', score: 7 };

async function setup() {
  const env = { DB: createD1() };
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const kid = `kid-prospects-${crypto.randomUUID()}`;
  env.RENDER_OIDC_FETCH = async () => Response.json({ keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' }] });
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-prospects', exp: now + 300, nbf: now - 5, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master',
    job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/prospects.yml@refs/heads/master', event_name: 'schedule' };
  const sign = async (claims) => { const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })); const b = b64u(JSON.stringify(claims));
    return `${h}.${b}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${b}`))))}`; };
  const post = async (body, claims = good) => worker.fetch(new Request('https://menu-made.com/api/system/prospects', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await sign(claims)}` }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  const rows = () => env.DB.raw.prepare(`SELECT * FROM prospects ORDER BY id`).all().map((r) => ({ ...r }));
  return { env, post, rows, good };
}

test('rows are cleaned: unknown gaps dropped, email lowercased, clients and bad ids refused', () => {
  const row = prospectRow(CAFE);
  assert.equal(row.email, 'hello@samplecafe.example');
  assert.deepEqual(JSON.parse(row.gaps_json), ['menu_pdf', 'no_tap_to_call']);
  assert.equal(prospectRow({ ...CAFE, website: 'https://www.myhappydonut.com/' }), null, 'existing clients are never prospected');
  assert.equal(prospectRow({ ...CAFE, id: 'x/1' }), null);
  assert.equal(prospectRow({ ...CAFE, email: 'not an email' }).email, null);
  assert.equal(prospectRow({ ...CAFE, offer_code: 'BUNDLE_PRO' }).offer_code, null);
});

test('the workflow stores new prospects, and a re-found business keeps its outreach status and email', async () => {
  const f = await setup();
  let res = await f.post({ run_id: '1', prospects: [CAFE, { ...CAFE, id: 'node/102', name: 'Second Spot', email: null }, { id: 'bad' }] });
  assert.deepEqual(await res.json(), { ok: true, stored: 2, rejected: 1 });
  assert.equal(f.rows()[0].status, 'NEW');
  f.env.DB.raw.prepare(`UPDATE prospects SET status = 'SENT' WHERE id = 'node/101'`).run();
  res = await f.post({ run_id: '2', prospects: [{ ...CAFE, email: null, score: 4, gaps: ['menu_image'] }] });
  assert.equal(res.status, 200);
  const row = f.rows()[0];
  assert.equal(row.status, 'SENT', 'outreach status survives a re-run');
  assert.equal(row.email, 'hello@samplecafe.example', 'a known email is kept when the new run found none');
  assert.equal(row.score, 4); assert.equal(row.gaps_json, '["menu_image"]');
});

test('only the prospects workflow on master may post', async () => {
  const f = await setup();
  for (const claims of [{ ...f.good, aud: 'menu-made-site-check' }, { ...f.good, ref: 'refs/heads/other' },
    { ...f.good, job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/site-check.yml@refs/heads/master' }, { ...f.good, event_name: 'push' }]) {
    const res = await f.post({ prospects: [CAFE] }, claims);
    assert.equal(res.status, 403);
  }
  const res = await worker.fetch(new Request('https://menu-made.com/api/system/prospects', { method: 'POST', body: '{}' }), f.env, { waitUntil() {} });
  assert.equal(res.status, 401);
  assert.equal(f.rows().length, 0);
});
