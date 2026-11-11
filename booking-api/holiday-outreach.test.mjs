// Holiday Menu outreach (owner, Nov 10, 2026): through the season the prospect drafts are holiday emails, one per
// business ever, to prospects already emailed first and then new ones, never to anyone who replied, opted out or bounced.
// Run: node --no-warnings --test booking-api/holiday-outreach.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { handleHolidayOutreach, holidaySeason } = await import('./src/marketing/holiday-outreach.js');
const { buildHoliday } = await import('../tools/prospects/email.mjs');
const { default: worker } = await import('./src/worker.js');

const MENU = { sections: [{ name: 'Mains', items: [{ name: 'Cioppino', description: 'Dungeness crab', price: '$38' }] }], notes: '', unreadable: '' };
const NOV_20 = Date.parse('2026-11-20T18:00:00Z');

async function setup() {
  const env = { DB: createD1(), ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-test' };
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const kid = `kid-holiday-${crypto.randomUUID()}`;
  env.RENDER_OIDC_FETCH = async () => Response.json({ keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' }] });
  const sec = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-prospect-drafts', exp: sec + 300, nbf: sec - 5, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master',
    job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/prospect-drafts.yml@refs/heads/master', event_name: 'workflow_dispatch' };
  const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })); const b = b64u(JSON.stringify(claims));
  const jwt = `${h}.${b}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${b}`))))}`;
  const fetcher = async (url) => url === 'https://harbor.example/menu.pdf' ? new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Type': 'application/pdf' } }) : new Response('no', { status: 404 });
  const call = async (body, now = NOV_20) => (await handleHolidayOutreach(new Request('https://menu-made.com/api/system/prospects/holiday', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }), env, { now, fetcher })).json();
  const t = '2026-11-01T00:00:00.000Z';
  const add = (id, status, extra = {}) => env.DB.raw.prepare(`INSERT INTO prospects (id, name, status, email, menu_url, score, sent_at, found_at, checked_at, updated_at, offer_code, gaps_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ONLINE_MENU_QR', '[]')`)
    .run(id, `Biz ${id}`, status, extra.email === undefined ? `${id.replace('/', '')}@biz.example` : extra.email, extra.menu || null, extra.score || 0, extra.sent || null, t, t, t);
  add('node/1', 'NEW', { score: 10 });
  add('node/2', 'NEW', { score: 90, menu: 'https://harbor.example/menu.pdf' });
  add('node/3', 'SENT', { sent: '2026-11-04T18:00:00.000Z' });
  add('node/4', 'SENT', { sent: '2026-11-19T18:00:00.000Z' });   // emailed yesterday: not again so soon
  add('node/5', 'REPLIED', { sent: '2026-11-04T18:00:00.000Z' });
  add('node/6', 'OPTED_OUT');
  add('node/7', 'BOUNCED');
  add('node/8', 'NEW', { email: null });
  return { env, call };
}

test('the season runs Nov 1 to Dec 20', () => {
  assert.equal(holidaySeason(Date.parse('2026-10-31T12:00:00-07:00')), false);
  assert.equal(holidaySeason(NOV_20), true);
  assert.equal(holidaySeason(Date.parse('2026-12-20T20:00:00-08:00')), true);
  assert.equal(holidaySeason(Date.parse('2026-12-21T09:00:00-08:00')), false);
});

test('who gets a holiday email: already emailed first, then new by score, never replies, opt-outs or bounces', async (t) => {
  const f = await setup();
  const out = await f.call({});
  assert.equal(out.season, true);
  assert.equal(out.occasion, 'christmas');
  assert.deepEqual(out.prospects.map((p) => [p.id, p.contacted]), [['node/3', true], ['node/2', false], ['node/1', false]]);
  assert.deepEqual((await f.call({}, Date.parse('2026-12-22T12:00:00-08:00'))).prospects, [], 'nothing after the season');

  // Their menu in the holiday designs, with no file kept (they upload the holiday menu itself at checkout).
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => String(input?.url || input) === 'https://api.anthropic.com/v1/messages'
    ? Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: { input_tokens: 1, output_tokens: 1 } }) : original(input);
  t.after(() => { globalThis.fetch = original; });
  const demo = await f.call({ id: 'node/2' });
  assert.equal(demo.ok, true, JSON.stringify(demo));
  const token = demo.url.split('/').pop();
  const row = f.env.DB.raw.prepare(`SELECT occasion, campaign, expires_at FROM menu_previews WHERE token = ?`).get(token);
  assert.equal(row.occasion, 'christmas');
  assert.equal(row.campaign, 'prospect');
  assert.equal(row.expires_at, new Date(NOV_20 + 21 * 86400000).toISOString());
  f.env.DB.raw.prepare(`UPDATE menu_previews SET expires_at = '2999-01-01T00:00:00.000Z' WHERE token = ?`).run(token);
  const page = await (await worker.fetch(new Request(`https://menu-made.com/api/menu-preview/view/${token}`, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone)' } }), f.env, { waitUntil() {} })).text();
  assert.match(page, /Design 1 of 6: Evergreen/);
  assert.match(page, /Cioppino/);
  const handoff = await (await worker.fetch(new Request(`https://menu-made.com/api/menu-preview/handoff/${token}`), f.env, { waitUntil() {} })).json();
  assert.equal(handoff.request_id, undefined, 'checkout asks for the holiday menu file');
  assert.equal((await f.call({ id: 'node/2' })).reused, true, 'one preview each');
  assert.equal((await f.call({ id: 'node/1' })).skip, 'no menu link');
  assert.equal((await f.call({ id: 'node/5' })).skip, 'not to be emailed');

  // Drafted: once each, ever; a new prospect is now DRAFTED (the Sent sync makes it SENT); no regular day-3 follow-up.
  assert.equal((await f.call({ mark: ['node/3', 'node/2'] })).changed, 2);
  assert.equal((await f.call({ mark: ['node/3'] })).changed, 0);
  const rows = Object.fromEntries(f.env.DB.raw.prepare(`SELECT id, status, holiday_drafted_at IS NOT NULL AS h, followup_drafted_at IS NOT NULL AS fu FROM prospects WHERE id IN ('node/2', 'node/3')`).all().map((r) => [r.id, { ...r }]));
  assert.deepEqual([rows['node/2'].status, rows['node/2'].h, rows['node/2'].fu], ['DRAFTED', 1, 1]);
  assert.deepEqual([rows['node/3'].status, rows['node/3'].h, rows['node/3'].fu], ['SENT', 1, 1]);
  assert.deepEqual((await f.call({})).prospects.map((p) => p.id), ['node/1']);
});

test('the holiday email: plain, priced from the catalog code, with their preview or the Holiday Menu page', () => {
  const sent = buildHoliday({ name: 'Harbor Kitchen', contacted: true }, 'https://menu-made.com/api/menu-preview/view/abc');
  assert.equal(sent.subject, 'A holiday menu for Harbor Kitchen');
  assert.match(sent.text, /I wrote to you a little while ago/);
  assert.match(sent.text, /\$59 per holiday, or \$89 for both/);
  assert.match(sent.text, /See your menu in the holiday designs: https:\/\/menu-made\.com\/api\/menu-preview\/view\/abc/);
  assert.doesNotMatch(sent.text, /one-time note/, 'not "one-time": some already had an email');
  assert.doesNotMatch(sent.html, /restaurant|[Pp]ay /, 'business, not restaurant; checkout, not pay');
  const fresh = buildHoliday({ name: 'Harbor Kitchen', contacted: false });
  assert.equal(fresh.subject, "Harbor Kitchen's holiday menu, online");
  assert.match(fresh.text, /See holiday menus: https:\/\/menu-made\.com\/holiday-menu\?utm_source=outreach&utm_medium=email&utm_campaign=holiday-menu/);
  assert.doesNotMatch(fresh.text, /I put the menu from your site/);
});
