// Free Online Menu + QR preview (Nov 4, 2026): anyone can see their menu as a phone page before paying, but the
// preview can't stand in for the paid product. Run: node --no-warnings --test booking-api/public-preview.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { publicPreviewPage, menuPreviewChoice, runPreviewReminders, PER_NETWORK_DAY, PER_EMAIL } = await import('./src/marketing/public-preview.js');
const { MENU_DESIGNS } = await import('./src/producers/menu-qr/menu-designs.js');
const { buildDesignedMenuHtml } = await import('./src/producers/menu-qr/design.js');
const { parseMenuHtml } = await import('./src/producers/menu-care/menu-edit.js');

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
  const calls = { claude: 0, email: 0, sent: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url === 'https://api.anthropic.com/v1/messages') { calls.claude++; return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: { input_tokens: 1, output_tokens: 1 } }); }
    if (url === 'https://api.resend.com/emails') { calls.email++; try { calls.sent.push(JSON.parse(init?.body)); } catch { /* not JSON */ } return Response.json({ id: 'em_1' }); }
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
  // "Your printed menu" (last of the designs since Nov 10, 2026) keeps the menu's own colours.
  const yours = await (await f.get(`${new URL(out.url).pathname}/yours`)).text();
  assert.match(yours, /--primary: #a8322d/, "the menu's own colour, not black and white; the cream paper colour is skipped");
  assert.match(yours, /Design 9 of 9: Your printed menu/);
  assert.match(html, /PREVIEW%20%C2%B7%20NOT%20LIVE/);
  assert.match(html, /@media print/);
  assert.match(html, /\/api\/menu-preview\/choose\/[a-f0-9]{36}\/classic/, '"Make it live" saves the design on screen first');
  // Inside the Menu-made app the page sits in a frame and the app draws the buttons, so a framed page hides its bar.
  assert.match(html, /mm-framed \.mm-preview/);
  assert.match(html, /Design 1 of 9: Classic/);
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

test('a preview opens as often as wanted for 3 days, then ends (no open limit: owner, Nov 7, 2026)', async (t) => {
  const f = setup();
  stubClaude(t);
  const { token } = await (await f.create({ request_id: await f.upload(), email: 'owner@cafe.example', business: 'Sample Cafe' })).json();
  for (let i = 0; i < 120; i++) assert.equal((await f.get(`/api/menu-preview/view/${token}`)).status, 200);
  f.env.DB.raw.prepare(`UPDATE menu_previews SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString());
  const ended = await f.get(`/api/menu-preview/view/${token}`);
  assert.equal(ended.status, 410);
  assert.match(await ended.text(), /Free previews last 3 days/);
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

test('owner sandbox: test mode skips the per-email and per-network limits, is tagged sandbox, and leaves the public allowance alone', async (t) => {
  const f = setup();
  stubClaude(t);
  for (let i = 0; i < PER_EMAIL + PER_NETWORK_DAY + 1; i++) {
    const out = await (await f.create({ request_id: await f.upload({ email: 'owner@menu-made.example' }), email: 'owner@menu-made.example', business: 'Same Cafe', sandbox: true })).json();
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.reused, undefined, 'each test run gets a new preview');
  }
  assert.equal(f.env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM menu_previews WHERE campaign = 'sandbox'`).get().n, PER_EMAIL + PER_NETWORK_DAY + 1);
  // Only a real true counts, and without it the same network is back under the public limit.
  const plain = await f.create({ request_id: await f.upload({ email: 'buyer@cafe.example' }), email: 'buyer@cafe.example', business: 'Buyer Cafe', sandbox: 'true' });
  assert.equal(plain.status, 429, 'a buyer on that network gets the public network limit');
});

// ---------- Menu generator (owner, Nov 7, 2026) ----------

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

async function madePreview(t) {
  const f = setup();
  const calls = stubClaude(t);
  const requestId = await f.upload();
  const { token } = await (await f.create({ request_id: requestId, email: 'owner@cafe.example', business: 'Sample Cafe' })).json();
  const customize = (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return worker.fetch(new Request(`https://menu-made.com/api/menu-preview/customize/${token}`, { method: 'POST', body: form }), f.env, { waitUntil() {} });
  };
  return { f, calls, token, requestId, customize };
}

test('the menu generator: one read, nine designs, "Generate menu" goes round them all', async (t) => {
  const { f, calls, token } = await madePreview(t);
  assert.equal(calls.claude, 1, 'the menu is read once for all designs');
  assert.equal(MENU_DESIGNS.length, 9);
  const seen = new Set();
  for (const [i, d] of MENU_DESIGNS.entries()) {
    const res = await f.get(`/api/menu-preview/view/${token}/${d.key}`);
    assert.equal(res.status, 200, d.key);
    const html = await res.text();
    assert.match(html, new RegExp(`Design ${i + 1} of 9: ${d.label}`));
    assert.match(html, /Garlic Bread/);
    assert.match(html, /PREVIEW%20%C2%B7%20NOT%20LIVE/, 'every design is watermarked');
    const next = MENU_DESIGNS[(i + 1) % MENU_DESIGNS.length].key;
    assert.ok(html.includes(`/api/menu-preview/view/${token}/${next}">Generate menu`), `${d.key} -> ${next}`);
    assert.ok(html.includes(`/api/menu-preview/choose/${token}/${d.key}`));
    seen.add(/<meta name="mm-style" content="([^"]*)"/.exec(html)?.[1] || 'standard');
  }
  assert.equal(seen.size, 9, 'nine different looks');
  const modern = await (await f.get(`/api/menu-preview/view/${token}/modern`)).text();
  assert.match(modern, /header \{ text-align: left;/, 'Modern has its own split header');
  const diner = await (await f.get(`/api/menu-preview/view/${token}/diner`)).text();
  assert.match(diner, /repeating-conic-gradient/, 'Diner has its checkered edge');
  for (const key of ['classic', 'modern', 'diner', 'night']) {
    assert.match(await (await f.get(`/api/menu-preview/view/${token}/${key}`)).text(), /\.jump a:first-child \{ margin-left: auto; \}/, `${key} nav is centred`);
  }
  assert.equal((await f.get(`/api/menu-preview/view/${token}/nosuch`)).status, 410);
  assert.equal(f.env.DB.raw.prepare(`SELECT open_count FROM menu_previews`).get().open_count, 15, 'every design opened counts');
});

test('Customize: logo, colour and the line under the name reach every design, with no new read', async (t) => {
  const { f, calls, token, customize } = await madePreview(t);
  const res = await customize({ design: 'diner', logo: new File([PNG], 'logo.png', { type: 'image/png' }), brand: '#1d4e89', use_brand: '1', subtitle: 'Dinner Menu' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `https://menu-made.com/api/menu-preview/view/${token}/diner`);
  for (const key of ['yours', 'diner', 'night']) {
    const html = await (await f.get(`/api/menu-preview/view/${token}/${key}`)).text();
    assert.match(html, /<header>\s*<img src="data:image\/png;base64,/, `${key} has the logo`);
    assert.match(html, /<p>Dinner Menu<\/p>/, `${key} has the line`);
    assert.match(html, /Using your logo, your colour, your line under the name/);
  }
  const classic = await (await f.get(`/api/menu-preview/view/${token}/classic`)).text();
  const meta = /<meta name="mm-style" content="([^"]*)"/.exec(classic)[1];
  assert.match(meta, /&quot;accent&quot;:&quot;#1d4e89&quot;/, 'the chosen colour is the highlight');
  assert.match(meta, /&quot;heading&quot;:&quot;#7a1f2b&quot;/, 'the design keeps its own header and heading colour');
  assert.equal(calls.claude, 1);

  const bad = await customize({ design: 'diner', logo: new File([new Uint8Array([1, 2, 3, 4, 5])], 'x.png', { type: 'image/png' }) });
  assert.equal(bad.status, 400);
  const off = await customize({ design: 'classic', brand: '#1d4e89', subtitle: 'Menu' });
  assert.equal(off.status, 303);
  const plain = await (await f.get(`/api/menu-preview/view/${token}/classic`)).text();
  assert.doesNotMatch(/<meta name="mm-style" content="([^"]*)"/.exec(plain)[1], /#1d4e89/, 'unticked colour goes back to the design\'s own');
  assert.match(plain, /<p>Menu<\/p>/);
  assert.match(plain, /<img src="data:image\/png/, 'the logo stays');
});

test('"Make it live" saves the design and opens checkout; the paid menu finds the choice from the order', async (t) => {
  const { f, token, requestId, customize } = await madePreview(t);
  await customize({ design: 'bistro', brand: '#7a1f2b', use_brand: '1', subtitle: 'Since 1998' });
  const res = await f.get(`/api/menu-preview/choose/${token}/bistro`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `https://menu-made.com/contact.html?service=menu&preview=${token}`);
  assert.equal(f.env.DB.raw.prepare(`SELECT design FROM menu_previews`).get().design, 'bistro');
  assert.equal((await f.get(`/api/menu-preview/choose/${token}/nosuch`)).status, 404);

  f.env.DB.raw.exec(`PRAGMA foreign_keys = OFF`);
  f.env.DB.raw.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, status, subtotal_cents, total_cents, payment_status, notes) VALUES ('o1', '2026-11-07', '2026-11-07', 'c1', 'PAID', 0, 0, 'PAID', ?)`).run(`Brief\nDocument ref: ${requestId}`);
  const choice = await menuPreviewChoice(f.env, 'o1');
  assert.equal(choice.design, 'bistro');
  assert.equal(choice.custom.color, '#7a1f2b');
  assert.equal(choice.custom.subtitle, 'Since 1998');
  assert.equal(await menuPreviewChoice(f.env, 'missing'), null);
  // A file added at checkout gives the order a new document reference: the preview named on the order still decides.
  f.env.DB.raw.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, status, subtotal_cents, total_cents, payment_status, notes) VALUES ('o2', '2026-11-12', '2026-11-12', 'c1', 'PAID', 0, 0, 'PAID', ?)`).run(`Menu: 3 pages\nPreview ref: ${token}\nDocument ref: 11111111-2222-4333-8444-555555555555`);
  const replaced = await menuPreviewChoice(f.env, 'o2');
  assert.equal(replaced.design, 'bistro');
  assert.equal(replaced.custom.subtitle, 'Since 1998');
});

test('a preview made before the generator still opens as it was', async (t) => {
  const f = setup();
  const token = 'b'.repeat(36);
  f.env.DB.raw.prepare(`INSERT INTO menu_previews (token, request_id, email, business, status, created_at, expires_at) VALUES (?, ?, 'o@x.example', 'Old Cafe', 'READY', ?, ?)`).run(token, crypto.randomUUID(), new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());
  await f.env.ASSETS.put(`menu-previews/${token}.html`, '<html><body>old page</body></html>');
  const res = await f.get(`/api/menu-preview/view/${token}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /old page/);
});

test('the line under the name and the design structure survive a Menu Care update', () => {
  const html = buildDesignedMenuHtml({ businessName: 'Cafe', brandColors: '', menu: { sections: [{ name: 'Mains', items: [{ name: 'Soup', price: '8' }] }] }, logoDataUri: null,
    style: MENU_DESIGNS.find((d) => d.key === 'diner').style, subtitle: 'All Day Menu' });
  const live = parseMenuHtml(html);
  assert.equal(live.subtitle, 'All Day Menu');
  assert.equal(live.style.header, 'ticket');
  assert.equal(live.style.section, 'banner');
  assert.equal(live.style.layout, 'badge');
  assert.equal(parseMenuHtml(buildDesignedMenuHtml({ businessName: 'Cafe', menu: { sections: [{ name: 'Mains', items: [{ name: 'Soup', price: '8' }] }] }, logoDataUri: null })).subtitle, 'Menu');
});

test('logo legibility: each design picks none, halo, badge or border from the logo and the header behind it', () => {
  const menu = { sections: [{ name: 'Mains', items: [{ name: 'Soup', price: '8' }] }] };
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const page = (key, info, mode = 'auto', uri = png) => buildDesignedMenuHtml({ businessName: 'Cafe', menu, logoDataUri: uri, style: MENU_DESIGNS.find((d) => d.key === key).style,
    logo: { info, mode } });
  const kind = (html) => /<header>\s*<img [^>]*class="logo-([a-z]+)"/.exec(html)?.[1];
  const darkThin = { t: 1, l: 0.01, c: 0.25, b: 0 };
  const darkBold = { t: 1, l: 0.02, c: 0.6, b: 0 };
  const white = { t: 1, l: 1, c: 0.6, b: 0 };
  assert.equal(kind(page('bistro', darkBold)), 'badge', 'dark logo on a black header gets a light badge');
  assert.match(page('bistro', darkBold), /--plate: #[0-9a-f]{6}/);
  assert.equal(kind(page('modern', darkBold)), 'none', 'dark logo on white needs nothing');
  assert.equal(kind(page('modern', white)), 'badge', 'white logo on white gets a dark badge');
  assert.equal(kind(page('fine', darkThin)), 'none');
  assert.equal(kind(page('bistro', { t: 0, l: 0.9, c: 1, b: 1 })), 'boxed', 'a logo with its own box gets a border');
  assert.equal(kind(page('bistro', null, 'auto', 'data:image/jpeg;base64,/9j/')), 'boxed', 'an unmeasured JPEG is a box');
  assert.equal(kind(page('bistro', null)), 'halo', 'an unmeasured PNG gets a halo');
  assert.equal(kind(page('modern', darkBold, 'dark')), 'badge', 'the buyer can choose a badge');
  assert.equal(kind(page('bistro', darkBold, 'none')), 'none', '...or none');
  const live = parseMenuHtml(page('bistro', darkBold, 'light'));
  assert.deepEqual(live.logo, { info: darkBold, mode: 'light' }, 'Menu Care keeps the measurement and the choice');
  assert.match(live.logoDataUri, /^data:image\/png/);
});

test('Chalkboard is hand-lettered in a wooden frame', () => {
  const html = buildDesignedMenuHtml({ businessName: 'Cafe', menu: { sections: [{ name: 'Mains', items: [{ name: 'Soup', price: '8' }] }] }, logoDataUri: null,
    style: MENU_DESIGNS.find((d) => d.key === 'chalkboard').style });
  assert.match(html, /body \{ font-family: "Chalkboard SE", Chalkduster, "Marker Felt", "Comic Sans MS"/);
  assert.match(html, /border: 16px ridge/);
  assert.equal(parseMenuHtml(html).style.frame, 'chalk');
  assert.match(html, /<footer>Menu by <a href="https:\/\/menu-made.com\/">MENU-MADE<\/a><\/footer>/, 'footer links to menu-made.com');
});

test('Customize: change the business name, or hide it when the logo already spells it', async (t) => {
  const { f, token, customize } = await madePreview(t);
  await customize({ design: 'classic', business_name: 'Sample Café & Bar' });
  let html = await (await f.get(`/api/menu-preview/view/${token}/classic`)).text();
  assert.match(html, /<h1>Sample Café &amp; Bar<\/h1>/);
  assert.match(html, /<title>Sample Café &amp; Bar — Menu<\/title>/);
  await customize({ design: 'classic', business_name: 'Sample Café & Bar', hide_name: '1' });
  html = await (await f.get(`/api/menu-preview/view/${token}/classic`)).text();
  assert.match(html, /<h1>Sample Café &amp; Bar<\/h1>/, 'no logo yet: the name stays visible');
  await customize({ design: 'classic', business_name: 'Sample Café & Bar', hide_name: '1', logo: new File([PNG], 'logo.png', { type: 'image/png' }) });
  html = await (await f.get(`/api/menu-preview/view/${token}/modern`)).text();
  assert.match(html, /<h1 class="name-hidden">Sample Café &amp; Bar<\/h1>/, 'hidden from view, kept for screen readers');
  assert.match(html, /name="hide_name" value="1" checked/);
  const live = parseMenuHtml(html.replace(/<aside[\s\S]*?<\/aside>/, ''));
  assert.equal(live.businessName, 'Sample Café & Bar');
  assert.equal(live.hideName, true, 'Menu Care keeps the name hidden');
  await customize({ design: 'classic', business_name: '' });
  assert.match(await (await f.get(`/api/menu-preview/view/${token}/classic`)).text(), /<h1>Sample Cafe<\/h1>/, 'emptied: back to the original name');
});

test('one reminder about 2 days in, only when no order came from the preview', async (t) => {
  const { f, calls, token, requestId } = await madePreview(t);
  const created = Date.parse(f.env.DB.raw.prepare(`SELECT created_at FROM menu_previews WHERE token = ?`).get(token).created_at);

  const reminders = () => calls.sent.filter((e) => /menu preview ends/.test(e.subject));
  assert.deepEqual(await runPreviewReminders(f.env, { now: created + 30 * 3600000, force: true }), [], 'not on day 1');
  assert.deepEqual(await runPreviewReminders(f.env, { now: created + 47 * 3600000, force: true }), [token]);
  const mail = reminders()[0];
  assert.ok(mail.to.includes('owner@cafe.example'));
  assert.match(mail.html, new RegExp(`/api/menu-preview/view/${token}`));
  assert.match(mail.html, /Sample Cafe&#039;s menu preview ends soon/);
  assert.doesNotMatch(mail.html, /&amp;#39;|&amp;amp;/, 'no double escaping');
  assert.deepEqual(await runPreviewReminders(f.env, { now: created + 50 * 3600000, force: true }), [], 'only once');
  assert.equal(reminders().length, 1);

  // Outside 9 am to 7 pm Pacific nothing goes out.
  const g = await madePreview(t);
  const gCreated = Date.parse(g.f.env.DB.raw.prepare(`SELECT created_at FROM menu_previews`).get().created_at);
  let night = gCreated + 47 * 3600000;
  while (Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Los_Angeles' }).format(new Date(night))) !== 2) night += 3600000;
  night -= new Date(night).getUTCMinutes() * 60000;
  assert.deepEqual(await runPreviewReminders(g.f.env, { now: night }), [], 'not at 2 am');

  // Ordered from the same menu file: no reminder.
  const h = await madePreview(t);
  h.f.env.DB.raw.exec(`PRAGMA foreign_keys = OFF`);
  h.f.env.DB.raw.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, status, subtotal_cents, total_cents, payment_status, notes) VALUES ('o9', 'x', 'x', 'c', 'PAID', 0, 0, 'PAID', ?)`).run(`Document ref: ${h.requestId}`);
  const hCreated = Date.parse(h.f.env.DB.raw.prepare(`SELECT created_at FROM menu_previews`).get().created_at);
  assert.deepEqual(await runPreviewReminders(h.f.env, { now: hCreated + 47 * 3600000, force: true }), []);
  assert.ok(h.f.env.DB.raw.prepare(`SELECT reminder_sent_at FROM menu_previews`).get().reminder_sent_at, 'marked so it is not checked again');
});

test('the app reads a preview\'s designs, buttons and Customize fields, and its Customize gets a JSON answer', async (t) => {
  const f = setup();
  stubClaude(t);
  const requestId = await f.upload();
  const out = await (await f.create({ request_id: requestId, email: 'owner@cafe.example', business: 'Sample Cafe', tracking: {} })).json();
  const token = out.token;
  const state = await (await f.get(`/api/menu-preview/state/${token}`)).json();
  assert.equal(state.ok, true);
  assert.equal(state.designs.length, 9);
  assert.deepEqual([state.designs[0].key, state.designs.at(-1).key, state.design], ['classic', 'yours', 'classic'], 'Classic leads; Your printed menu is last');
  assert.match(state.designs[0].url, new RegExp(`/api/menu-preview/view/${token}/classic$`));
  assert.equal(state.next_label, 'Generate menu');
  assert.match(state.choose_label, /^Make it live: \$144/);
  assert.deepEqual(state.customize.fields.map((x) => x.name), ['logo', 'logo_bg', 'business_name', 'hide_name', 'brand', 'use_brand', 'subtitle']);
  const form = new FormData();
  form.set('design', 'diner'); form.set('subtitle', 'Dinner Menu'); form.set('business_name', 'Sample Cafe');
  const res = await worker.fetch(new Request(`https://menu-made.com/api/menu-preview/customize/${token}`, { method: 'POST', body: form, headers: { Accept: 'application/json' } }), f.env, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, design: 'diner' });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const after = await (await f.get(`/api/menu-preview/state/${token}`)).json();
  assert.equal(after.customize.fields.find((x) => x.name === 'subtitle').value, 'Dinner Menu');
  assert.equal(after.customize.left, state.customize.left - 1);
  assert.equal((await f.get('/api/menu-preview/state/' + 'a'.repeat(36))).status, 410);
});
