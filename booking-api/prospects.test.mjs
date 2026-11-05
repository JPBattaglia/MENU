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
  return { env, post, rows, good, sign };
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

test('the drafts job gets the best NEW prospects with an email, one per address, and moves them through outreach statuses', async () => {
  const f = await setup();
  await f.post({ prospects: [CAFE, { ...CAFE, id: 'node/102', name: 'Same Owner', score: 9 }, { ...CAFE, id: 'node/103', name: 'No Email', email: null, score: 20 },
    { ...CAFE, id: 'node/104', name: 'Other Spot', email: 'owner@other.example', score: 3 }] });
  const drafts = { ...f.good, aud: 'menu-made-prospect-drafts', job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/prospect-drafts.yml@refs/heads/master' };
  const call = async (path, body, claims = drafts) => {
    const req = new Request(`https://menu-made.com/api/system/prospects/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await f.sign(claims)}` }, body: JSON.stringify(body) });
    return worker.fetch(req, f.env, { waitUntil() {} });
  };
  assert.equal((await call('batch', { limit: 25 }, f.good)).status, 403, 'the finder job may not take batches');
  let batch = (await (await call('batch', { limit: 25 })).json()).prospects;
  assert.deepEqual(batch.map((p) => p.id), ['node/102', 'node/104'], 'best first, one per email, none without an email');
  let res = await (await call('status', { updates: [{ id: 'node/102', status: 'DRAFTED' }, { id: 'node/104', status: 'BOGUS' }] })).json();
  assert.equal(res.changed, 1);
  batch = (await (await call('batch', { limit: 25 })).json()).prospects;
  assert.deepEqual(batch.map((p) => p.id), ['node/104'], 'an address already drafted is never offered again, even under another listing');
  res = await (await call('status', { updates: [{ email: 'hello@samplecafe.example', status: 'OPTED_OUT' }] })).json();
  assert.equal(res.changed, 2, 'an opt-out covers every listing with that address');
  const rows = Object.fromEntries(f.rows().map((r) => [r.id, r]));
  assert.equal(rows['node/102'].status, 'OPTED_OUT'); assert.ok(rows['node/102'].drafted_at);
  res = await (await call('status', { updates: [{ id: 'node/102', status: 'SENT' }] })).json();
  assert.equal(res.changed, 0, 'an opted-out prospect never goes back');
});

test('menu-file prospects (they get their own menu preview) come before higher-scored prospects for other offers', async () => {
  const f = await setup();
  await f.post({ prospects: [{ ...CAFE, score: 2 }, { ...CAFE, id: 'node/106', name: 'Slow Site', email: 'x@slow.example', gaps: ['no_tap_to_call'], menu_url: null, offer_code: 'CONVERSION_FIX', score: 60 }] });
  const drafts = { ...f.good, aud: 'menu-made-prospect-drafts', job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/prospect-drafts.yml@refs/heads/master' };
  const req = new Request('https://menu-made.com/api/system/prospects/batch', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await f.sign(drafts)}` }, body: JSON.stringify({ limit: 25 }) });
  const batch = (await (await worker.fetch(req, f.env, { waitUntil() {} })).json()).prospects;
  assert.deepEqual(batch.map((p) => p.id), [CAFE.id, 'node/106']);
});

test('browser-confirmed gaps replace the finder guesses; failed checks are skipped', async () => {
  const f = await setup();
  await f.post({ prospects: [CAFE, { ...CAFE, id: 'node/105', email: 'b@other.example' }] });
  const drafts = { ...f.good, aud: 'menu-made-prospect-drafts', job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/prospect-drafts.yml@refs/heads/master' };
  const req = new Request('https://menu-made.com/api/system/prospects/status', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await f.sign(drafts)}` },
    body: JSON.stringify({ updates: [{ id: 'node/101', status: 'NEW', gaps: ['no_tap_to_call'], offer_code: 'CONVERSION_FIX' }, { id: 'node/105', status: 'SKIPPED' }, { id: 'node/101', status: 'NEW' }] }) });
  assert.equal((await (await worker.fetch(req, f.env, { waitUntil() {} })).json()).changed, 2);
  const rows = Object.fromEntries(f.rows().map((r) => [r.id, r]));
  assert.equal(rows['node/101'].gaps_json, '["no_tap_to_call"]'); assert.equal(rows['node/101'].offer_code, 'CONVERSION_FIX'); assert.match(rows['node/101'].notes, /browser-checked/);
  assert.equal(rows['node/105'].status, 'SKIPPED');
});

test('auto-send warm-up: 3 a day for the first week of business days, rising to 10, counted from the first auto-send', async () => {
  const { businessDays, sendCap, sendPlan } = await import('./src/marketing/prospects.js');
  assert.equal(businessDays('2026-11-06', '2026-11-06'), 1);
  assert.equal(businessDays('2026-11-06', '2026-11-09'), 2, 'Fri to Mon skips the weekend');
  assert.deepEqual([1, 5, 6, 10, 11, 15, 16, 40].map(sendCap), [3, 3, 6, 6, 8, 8, 10, 10]);
  const f = await setup();
  const now = Date.parse('2026-11-10T18:00:00Z'); // Tue 10 am PT
  let plan = await sendPlan(f.env, now);
  assert.deepEqual(plan, { day: 1, cap: 3, sent_today: 0, left: 3, warmup_done: false });
  await f.post({ prospects: [CAFE, { ...CAFE, id: 'node/107', email: 'z@z.example' }] });
  f.env.DB.raw.prepare(`UPDATE prospects SET status='SENT', sent_via='getmenumade', sent_at=? WHERE id=?`).run('2026-11-06T17:00:00Z', CAFE.id);
  f.env.DB.raw.prepare(`UPDATE prospects SET status='SENT', sent_via='getmenumade', sent_at=? WHERE id='node/107'`).run('2026-11-10T17:30:00Z');
  plan = await sendPlan(f.env, now);
  assert.deepEqual(plan, { day: 3, cap: 3, sent_today: 1, left: 2, warmup_done: false });
  plan = await sendPlan(f.env, Date.parse('2026-12-01T18:00:00Z'));
  assert.equal(plan.warmup_done, true); assert.equal(plan.cap, 10);
});

test('a SENT update from the auto-sender is marked sent_via getmenumade', async () => {
  const f = await setup();
  await f.post({ prospects: [CAFE] });
  const drafts = { ...f.good, aud: 'menu-made-prospect-drafts', job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/prospect-drafts.yml@refs/heads/master' };
  const req = new Request('https://menu-made.com/api/system/prospects/status', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await f.sign(drafts)}` },
    body: JSON.stringify({ updates: [{ id: CAFE.id, status: 'SENT', via: 'getmenumade', sent_at: new Date(Date.now() - 60000).toISOString() }] }) });
  assert.equal((await (await worker.fetch(req, f.env, { waitUntil() {} })).json()).changed, 1);
  const row = f.env.DB.raw.prepare(`SELECT status, sent_via, sent_at FROM prospects`).get();
  assert.equal(row.status, 'SENT'); assert.equal(row.sent_via, 'getmenumade'); assert.ok(row.sent_at);
});
