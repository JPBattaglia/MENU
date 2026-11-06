// Free Online Menu + QR preview (Nov 4, 2026): anyone can see their menu as a phone page before paying, but the
// preview can't stand in for the paid product. Run: node --no-warnings --test booking-api/public-preview.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { publicPreviewPage, MAX_OPENS, PER_NETWORK_DAY, PER_EMAIL } = await import('./src/marketing/public-preview.js');

const MENU = { sections: [{ name: 'Starters', items: [{ name: 'Garlic Bread', description: 'House focaccia', price: '$9' }] }], notes: '', unreadable: '', colors: ['#a8322d', '#f3ead8', 'not-a-colour'] };
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';

function setup() {
  const env = { DB: createD1(), ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-test', RESEND_API_KEY: 're_test' };
  const call = (path, init = {}) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, { waitUntil() {} });
  const create = (body) => call('/api/menu-preview/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const get = (path, agent = PHONE) => call(path, { headers: { 'User-Agent': agent } });
  // An upload as /api/inquiry stores it: purpose "checkout", file in R2, rate-limit hash per network.
  const upload = async ({ email = 'owner@cafe.example', ip = 'net-1', type = 'application/pdf', age = 0, name = 'menu.pdf', size = 4 } = {}) => {
    const id = crypto.randomUUID();
    const storageKey = `private/inquiries/${id}/abc`;
    await env.ASSETS.put(storageKey, new Uint8Array([37, 80, 68, 70]));
    env.DB.raw.prepare(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at) VALUES (?, ?, ?, ?)`).run(id,
      JSON.stringify({ type: 'inquiry', purpose: 'checkout', email, name: 'Cafe', document: { storageKey, contentType: type, name, size } }), ip, Math.floor(Date.now() / 1000) - age);
    return id;
  };
  return { env, create, get, upload };
}

function stubClaude(t) {
  const calls = { claude: 0, email: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === 'https://api.anthropic.com/v1/messages') { calls.claude++; return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: { input_tokens: 1, output_tokens: 1 } }); }
    if (url === 'https://api.resend.com/emails') { calls.email++; return Response.json({ id: 'em_1' }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('an upload becomes a watermarked, unprintable phone preview with no QR, and the link is emailed', async (t) => {
  const f = setup();
  const calls = stubClaude(t);
  const requestId = await f.upload();
  const res = await f.create({ request_id: requestId, email: 'Owner@Cafe.example', business: 'Sample Cafe', tracking: { campaign: 'mm-search' } });
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));
  assert.match(out.url, /^https:\/\/menu-made\.com\/api\/menu-preview\/view\/[a-f0-9]{36}$/);
  const page = await f.get(new URL(out.url).pathname);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const html = await page.text();
  assert.match(html, /Garlic Bread/);
  assert.match(html, /Make it live: \$144 for the first year/, 'the price keeps its dollar sign');
  assert.match(html, /--primary: #a8322d/, "the menu's own colour, not black and white; the cream paper colour is skipped");
  assert.match(html, /PREVIEW%20%C2%B7%20NOT%20LIVE/);
  assert.match(html, /@media print/);
  assert.match(html, /contact\.html\?service=menu&amp;preview=[a-f0-9]{36}/);
  assert.doesNotMatch(html, /<svg[^>]*qr|data-qr|\/api\/menu\//i, 'no QR code and no hosted menu address');
  assert.equal(calls.claude, 1);
  assert.equal(calls.email, 1);
  const row = f.env.DB.raw.prepare(`SELECT campaign, status, email FROM menu_previews`).get();
  assert.deepEqual({ ...row }, { campaign: 'mm-search', status: 'READY', email: 'owner@cafe.example' });
});

test('the same email and menu get the existing preview back, and after it ends cannot get another free one', async (t) => {
  const f = setup();
  const calls = stubClaude(t);
  const first = await (await f.create({ request_id: await f.upload(), email: 'owner@cafe.example', business: 'Sample Cafe' })).json();
  const again = await (await f.create({ request_id: await f.upload(), email: 'owner@cafe.example', business: 'Sample Cafe' })).json();
  assert.equal(again.reused, true);
  assert.equal(again.token, first.token);
  f.env.DB.raw.prepare(`UPDATE menu_previews SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
  const res = await f.create({ request_id: await f.upload(), email: 'owner@cafe.example', business: 'Sample Cafe' });
  assert.equal(res.status, 409);
  const out = await res.json();
  assert.equal(out.used, true);
  assert.match(out.start, /preview=/);
  assert.equal(calls.claude, 1, 'only one Claude read for one email');
  assert.equal((await f.get(`/api/menu-preview/view/${first.token}`)).status, 410, 'an ended preview is gone');
});

test(`a different menu file gets a new preview, up to ${PER_EMAIL} per email a month`, async (t) => {
  const f = setup();
  const calls = stubClaude(t);
  const make = async (name, size, ip) => (await f.create({ request_id: await f.upload({ name, size, ip }), email: 'owner@cafe.example', business: 'Sample Cafe' })).json();
  const first = await make('lunch.pdf', 100, 'net-a');
  const second = await make('dinner.pdf', 200, 'net-b');
  assert.equal(second.ok, true);
  assert.notEqual(second.token, first.token, 'the new menu, not the first preview again');
  assert.equal(second.reused, undefined);
  const again = await make('dinner.pdf', 200, 'net-c');
  assert.equal(again.token, second.token, 'the same file again reuses its preview');
  await make('brunch.pdf', 300, 'net-c');
  const res = await f.create({ request_id: await f.upload({ name: 'drinks.pdf', size: 400, ip: 'net-d' }), email: 'owner@cafe.example', business: 'Sample Cafe' });
  assert.equal(res.status, 409);
  const out = await res.json();
  assert.match(out.error, new RegExp(`made ${PER_EMAIL} free previews`));
  assert.match(out.start, /preview=/);
  assert.equal(calls.claude, PER_EMAIL);
});

test(`a preview stops opening after ${MAX_OPENS} views, so it can't be used as the table menu`, async (t) => {
  const f = setup();
  stubClaude(t);
  const { token } = await (await f.create({ request_id: await f.upload(), email: 'owner@cafe.example', business: 'Sample Cafe' })).json();
  assert.equal((await f.get(`/api/menu-preview/view/${token}`, 'Mimecast link scanner')).status, 200);
  for (let i = 0; i < MAX_OPENS; i++) assert.equal((await f.get(`/api/menu-preview/view/${token}`)).status, 200);
  const ended = await f.get(`/api/menu-preview/view/${token}`);
  assert.equal(ended.status, 410);
  assert.match(await ended.text(), /Make it live/);
});

test('limits: per network per day, only fresh uploads, only the uploader, only PDFs or photos', async (t) => {
  const f = setup();
  const calls = stubClaude(t);
  for (let i = 0; i < PER_NETWORK_DAY; i++) {
    const r = await f.create({ request_id: await f.upload({ email: `o${i}@x.example` }), email: `o${i}@x.example`, business: 'Cafe' });
    assert.equal(r.status, 200);
  }
  assert.equal((await f.create({ request_id: await f.upload({ email: 'o9@x.example' }), email: 'o9@x.example', business: 'Cafe' })).status, 429);
  assert.equal((await f.create({ request_id: await f.upload({ email: 'a@y.example', ip: 'net-2', age: 3 * 3600 }), email: 'a@y.example', business: 'Cafe' })).status, 410);
  assert.equal((await f.create({ request_id: await f.upload({ email: 'a@y.example', ip: 'net-2' }), email: 'someone-else@y.example', business: 'Cafe' })).status, 404);
  assert.equal((await f.create({ request_id: await f.upload({ email: 'b@y.example', ip: 'net-2', type: 'application/msword' }), email: 'b@y.example', business: 'Cafe' })).status, 415);
  assert.equal(calls.claude, PER_NETWORK_DAY);
});

test('a menu Claude cannot read does not use up the free preview', async (t) => {
  const f = setup();
  const original = globalThis.fetch;
  let fail = true;
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === 'https://api.anthropic.com/v1/messages') return fail ? new Response('overloaded', { status: 529 }) : Response.json({ model: 'm', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: {} });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'em' });
    throw new Error(url);
  };
  t.after(() => { globalThis.fetch = original; });
  assert.equal((await f.create({ request_id: await f.upload(), email: 'owner@cafe.example', business: 'Cafe' })).status, 422);
  fail = false;
  assert.equal((await f.create({ request_id: await f.upload(), email: 'owner@cafe.example', business: 'Cafe' })).status, 200);
});

test('handoff gives checkout the stored upload for a real preview only', async (t) => {
  const f = setup();
  stubClaude(t);
  const requestId = await f.upload();
  const { token } = await (await f.create({ request_id: requestId, email: 'owner@cafe.example', business: 'Sample Cafe' })).json();
  const out = await (await f.get(`/api/menu-preview/handoff/${token}`)).json();
  assert.deepEqual(out, { ok: true, business: 'Sample Cafe', email: 'owner@cafe.example', request_id: requestId });
  assert.equal((await f.get(`/api/menu-preview/handoff/${'0'.repeat(36)}`)).status, 404);
});

test('the paused Selling switch also pauses previews', async (t) => {
  const f = setup();
  stubClaude(t);
  f.env.DB.raw.exec(`CREATE TABLE IF NOT EXISTS worker_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  f.env.DB.raw.prepare(`INSERT INTO worker_settings (key, value, updated_at) VALUES ('switch:sell:ONLINE_MENU_QR', 'off', '2026-11-04')`).run();
  const res = await f.create({ request_id: await f.upload(), email: 'owner@cafe.example', business: 'Cafe' });
  assert.equal(res.status, 409);
});

test('the preview page keeps the menu and adds the bar and watermark', () => {
  const html = publicPreviewPage('<html><head></head><body class="m"><main>Menu</main></body></html>', 'a'.repeat(36));
  assert.match(html, /<body class="m">\n<aside class="mm-preview"/);
  assert.match(html, /noindex/);
});

test('rep mode: a valid rep link skips the public limits, a forged one does not, and the rep link is emailed only to the owner', async (t) => {
  const f = setup();
  f.env.PRODUCTION_RUNNER_SECRET = 'runner-secret-for-tests';
  f.env.OWNER_EMAIL = 'owner@menu-made.example';
  const calls = stubClaude(t);
  const { repUrl } = await import('./src/marketing/public-preview.js');
  const rep = new URL(await repUrl(f.env)).searchParams.get('rep');
  // The same network and inbox, many times over: the public limit is PER_NETWORK_DAY a day and one per email.
  for (let i = 0; i < PER_NETWORK_DAY + 2; i++) {
    const out = await (await f.create({ request_id: await f.upload({ email: 'info@menu-made.com' }), email: 'info@menu-made.com', business: `Visit ${i}`, rep })).json();
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.reused, undefined, 'each visit gets its own preview');
    assert.ok(Number.isInteger(out.seconds));
    assert.match(out.start, /contact\.html\?service=menu&preview=/);
  }
  assert.equal(f.env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM menu_previews WHERE campaign = 'rep'`).get().n, PER_NETWORK_DAY + 2);
  const forged = await f.create({ request_id: await f.upload({ email: 'x@cafe.example' }), email: 'x@cafe.example', business: 'Forged', rep: rep.slice(0, -2) + 'xx' });
  assert.equal(forged.status, 429, 'a forged rep link gets the public network limit');
  const before = calls.email;
  const page = await (await f.get('/api/menu-preview/rep-link')).text();
  assert.match(page, /owner@menu-made\.example/);
  const res = await worker.fetch(new Request('https://menu-made.com/api/menu-preview/rep-link', { method: 'POST' }), f.env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(calls.email, before + 1);
});
