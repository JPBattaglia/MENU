// Marketing plan v4 (Nov 3, 2026): prospect emails link to a private preview of the owner's own menu as a phone page.
// Run: node --no-warnings --test booking-api/demo-menu.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { previewPage } = await import('./src/marketing/demo-menu.js');

const MENU = { sections: [{ name: 'Starters', items: [{ name: 'Garlic Bread', description: 'House focaccia', price: '$9' }, { name: 'Soup of the Day', description: '', price: '$8' }] }], notes: '', unreadable: '' };

async function setup() {
  const env = { DB: createD1(), ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-test' };
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const kid = `kid-demo-${crypto.randomUUID()}`;
  env.RENDER_OIDC_FETCH = async () => Response.json({ keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' }] });
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-prospect-drafts', exp: now + 300, nbf: now - 5, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master',
    job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/prospect-drafts.yml@refs/heads/master', event_name: 'workflow_dispatch' };
  const sign = async (claims) => { const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })); const b = b64u(JSON.stringify(claims));
    return `${h}.${b}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${b}`))))}`; };
  const post = async (path, body, claims = good) => worker.fetch(new Request(`https://menu-made.com${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await sign(claims)}` }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  const get = (path, agent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)') => worker.fetch(new Request(`https://menu-made.com${path}`, { headers: { 'User-Agent': agent } }), env, { waitUntil() {} });
  const t = new Date().toISOString();
  env.DB.raw.prepare(`INSERT INTO prospects (id, name, status, gaps_json, menu_url, offer_code, email, found_at, checked_at, updated_at) VALUES
    ('node/1', 'Sample Cafe', 'NEW', '["menu_pdf"]', 'https://samplecafe.example/menu.pdf', 'ONLINE_MENU_QR', 'hi@samplecafe.example', ?, ?, ?),
    ('node/2', 'Web Shop', 'NEW', '["no_phone_layout"]', null, 'WEBSITE_PACKAGE', 'hi@webshop.example', ?, ?, ?)`).run(t, t, t, t, t, t);
  return { env, post, get, good };
}

function stubFetch(t, { menuStatus = 200 } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    calls.push(url);
    if (url === 'https://samplecafe.example/menu.pdf') return new Response(new Uint8Array([37, 80, 68, 70, 45, 49]), { status: menuStatus, headers: { 'Content-Type': 'application/pdf' } });
    if (url === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      assert.equal(body.messages[0].content[0].type, 'document', 'the PDF goes to Claude as a document');
      return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('a menu-file prospect gets a private preview page built from its own menu, reused on a second call', async (t) => {
  const f = await setup();
  const calls = stubFetch(t);
  let res = await f.post('/api/system/prospects/demo', { id: 'node/1' });
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.match(out.url, /^https:\/\/menu-made\.com\/api\/menu-preview\/[a-f0-9]{36}$/);
  assert.equal(out.item_count, 2);
  const page = await f.get(new URL(out.url).pathname);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const html = await page.text();
  for (const words of ['Garlic Bread', '$9', 'Soup of the Day', 'Preview for Sample Cafe', 'noindex,nofollow', '$144 for the first year', 'utm_campaign=demo-menu']) assert.ok(html.includes(words), words);
  res = await f.post('/api/system/prospects/demo', { id: 'node/1' });
  assert.equal((await res.json()).reused, true);
  assert.equal(calls.filter((u) => u.includes('anthropic')).length, 1, 'the menu is read once');
});

test('opens are counted for browsers only, and an expired or unknown preview shows a plain ended page', async (t) => {
  const f = await setup();
  stubFetch(t);
  const { url } = await (await f.post('/api/system/prospects/demo', { id: 'node/1' })).json();
  const path = new URL(url).pathname;
  await f.get(path, 'Mozilla/5.0 (compatible; Proofpoint URL Defense)');
  await f.get(path);
  await f.get(path);
  const row = f.env.DB.raw.prepare(`SELECT open_count, first_opened_at FROM prospect_demos`).get();
  assert.equal(row.open_count, 2);
  assert.ok(row.first_opened_at);
  f.env.DB.raw.prepare(`UPDATE prospect_demos SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
  const ended = await f.get(path);
  assert.equal(ended.status, 410);
  assert.match(await ended.text(), /preview has ended/);
  assert.equal((await f.get('/api/menu-preview/' + 'a'.repeat(36))).status, 410);
});

test('only Online Menu + QR prospects with a menu file get a preview; a failed read is recorded, not thrown', async (t) => {
  const f = await setup();
  stubFetch(t, { menuStatus: 404 });
  let out = await (await f.post('/api/system/prospects/demo', { id: 'node/2' })).json();
  assert.equal(out.ok, false); assert.match(out.skip, /not an Online Menu/);
  out = await (await f.post('/api/system/prospects/demo', { id: 'node/1' })).json();
  assert.equal(out.ok, false); assert.match(out.skip, /HTTP 404/);
  assert.equal(f.env.DB.raw.prepare(`SELECT status FROM prospect_demos`).get().status, 'FAILED');
});

test('follow-ups list sent prospects who opened their preview 3+ days ago, once each', async (t) => {
  const f = await setup();
  stubFetch(t);
  const { url } = await (await f.post('/api/system/prospects/demo', { id: 'node/1' })).json();
  let list = await (await f.post('/api/system/prospects/followups', {})).json();
  assert.deepEqual(list.prospects, [], 'not sent yet');
  f.env.DB.raw.prepare(`UPDATE prospect_demos SET created_at = ?`).run(new Date(Date.now() - 5 * 86400000).toISOString());
  f.env.DB.raw.prepare(`UPDATE prospects SET status = 'SENT', sent_at = ? WHERE id = 'node/1'`).run(new Date(Date.now() - 4 * 86400000).toISOString());
  list = await (await f.post('/api/system/prospects/followups', {})).json();
  assert.deepEqual(list.prospects, [], 'preview not opened yet');
  await f.get(new URL(url).pathname);
  list = await (await f.post('/api/system/prospects/followups', {})).json();
  assert.equal(list.prospects.length, 1);
  assert.equal(list.prospects[0].kind, 'opened');
  assert.equal(list.prospects[0].url, url);
  assert.equal(list.price, '$144');
  assert.equal((await (await f.post('/api/system/prospects/followups', { mark: ['node/1'] })).json()).changed, 1);
  list = await (await f.post('/api/system/prospects/followups', {})).json();
  assert.deepEqual(list.prospects, [], 'one follow-up per prospect');
});

test('prospects emailed before previews existed get one follow-up, and a preview can be built for them after the send', async (t) => {
  const f = await setup();
  stubFetch(t);
  const sent = new Date(Date.now() - 3.5 * 86400000).toISOString();
  f.env.DB.raw.prepare(`UPDATE prospects SET status = 'SENT', sent_at = ?`).run(sent);
  let list = await (await f.post('/api/system/prospects/followups', {})).json();
  assert.deepEqual(list.prospects.map((p) => [p.id, p.kind, p.offer_code]).sort(), [['node/1', 'no_preview', 'ONLINE_MENU_QR'], ['node/2', 'no_preview', 'WEBSITE_PACKAGE']]);
  const demo = await (await f.post('/api/system/prospects/demo', { id: 'node/1' })).json();
  assert.equal(demo.ok, true, 'a SENT menu-file prospect can get a preview for the follow-up');
  list = await (await f.post('/api/system/prospects/followups', {})).json();
  assert.equal(list.prospects.length, 2, 'a preview built after the send does not hide the prospect');
  assert.equal((await (await f.post('/api/system/prospects/followups', { mark: ['node/1', 'node/2'] })).json()).changed, 2);
  assert.deepEqual((await (await f.post('/api/system/prospects/followups', {})).json()).prospects, []);
});

test('a prospect sent 2 days ago, or 4 weeks ago, gets no follow-up yet / any more', async () => {
  const f = await setup();
  f.env.DB.raw.prepare(`UPDATE prospects SET status = 'SENT', sent_at = ? WHERE id = 'node/1'`).run(new Date(Date.now() - 2 * 86400000).toISOString());
  f.env.DB.raw.prepare(`UPDATE prospects SET status = 'SENT', sent_at = ? WHERE id = 'node/2'`).run(new Date(Date.now() - 28 * 86400000).toISOString());
  assert.deepEqual((await (await f.post('/api/system/prospects/followups', {})).json()).prospects, []);
});

test('only the drafts workflow on master may build previews or read follow-ups', async () => {
  const f = await setup();
  for (const path of ['/api/system/prospects/demo', '/api/system/prospects/followups']) {
    for (const claims of [{ ...f.good, aud: 'menu-made-prospects' }, { ...f.good, ref: 'refs/heads/other' }]) {
      assert.equal((await f.post(path, { id: 'node/1' }, claims)).status, 403);
    }
  }
});

test('the preview bar escapes the business name', () => {
  const html = previewPage('<html><head></head><body><h1>x</h1></body></html>', '<b>Bad & Co</b>');
  assert.ok(html.includes('&lt;b&gt;Bad &amp; Co&lt;/b&gt;'));
  assert.ok(!html.includes('<b>Bad'));
});
