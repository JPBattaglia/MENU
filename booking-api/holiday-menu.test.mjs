// Holiday Menu (owner, Nov 10, 2026): a Christmas or New Year's Eve online menu made in a holiday-only generator,
// $59 ($30 for a second one this season), kept apart from the business's regular menu, ended after the holiday.
// Run: node --no-warnings --test booking-api/holiday-menu.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { handlePreviewCreate, menuPreviewChoice } = await import('./src/marketing/public-preview.js');
const { HOLIDAY_DESIGNS, MENU_DESIGNS, designsFor, menuDesignFor } = await import('./src/producers/menu-qr/menu-designs.js');
const { normalizeStyle, styleCss } = await import('./src/producers/menu-qr/style.js');
const { normalizeCheckoutItems, appendCheckoutLineItem } = await import('./src/checkout/quote.js');
const holiday = await import('./src/checkout/holiday.js');
const { hostedMenuSlug } = await import('./src/onboarding/menu-inputs.js');

const MENU = { sections: [{ name: 'Christmas Eve', items: [{ name: 'Prime Rib', description: 'au jus', price: '$48' }] }], notes: '', unreadable: '' };
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
const NOV_20 = Date.parse('2026-11-20T18:00:00Z');
const migration = readFileSync(new URL('./migrations/0054_holiday_menu.sql', import.meta.url), 'utf8');
// The test schema already has the new columns; the offer rows come from the migration itself.
const offerRows = (db) => { for (const stmt of migration.split(/;\s*\n/)) if (/^\s*INSERT/m.test(stmt)) db.exec(stmt.replace(/^--.*$/gm, '')); };

function setup() {
  const env = { DB: createD1(), ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-test', RESEND_API_KEY: 're_test' };
  offerRows(env.DB.raw);
  const call = (path, init = {}) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, { waitUntil() {} });
  const get = (path) => call(path, { headers: { 'User-Agent': PHONE } });
  const upload = async (email = 'owner@harbor.example') => {
    const id = crypto.randomUUID();
    const storageKey = `private/inquiries/${id}/abc`;
    await env.ASSETS.put(storageKey, new Uint8Array([37, 80, 68, 70]));
    env.DB.raw.prepare(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at) VALUES (?, ?, ?, ?)`).run(id,
      JSON.stringify({ type: 'inquiry', purpose: 'checkout', email, name: 'Harbor', document: { storageKey, contentType: 'application/pdf', name: 'xmas.pdf', size: 4 } }), 'net-1', Math.floor(NOV_20 / 1000));
    return id;
  };
  const create = (body, now = NOV_20) => handlePreviewCreate(new Request('https://menu-made.com/api/menu-preview/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { now });
  return { env, call, get, upload, create };
}

function stubFetch(t) {
  const calls = { claude: 0, sent: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url === 'https://api.anthropic.com/v1/messages') { calls.claude++; return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: { input_tokens: 1, output_tokens: 1 } }); }
    if (url === 'https://api.resend.com/emails') { calls.sent.push(JSON.parse(init?.body)); return Response.json({ id: 'em_1' }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('nine holiday designs: three per holiday and three for either; a holiday shows its own three, then the shared three', () => {
  assert.equal(HOLIDAY_DESIGNS.length, 9);
  assert.deepEqual(HOLIDAY_DESIGNS.filter((d) => d.occasion === 'either').map((d) => d.key), ['winterlights', 'candlelight', 'silvergold']);
  assert.deepEqual(HOLIDAY_DESIGNS.filter((d) => d.occasion === 'christmas').map((d) => d.key), ['evergreen', 'candycane', 'silentnight']);
  assert.deepEqual(HOLIDAY_DESIGNS.filter((d) => d.occasion === 'newyear').map((d) => d.key), ['midnight', 'champagne', 'confetti']);
  assert.equal(designsFor(null), MENU_DESIGNS, 'the regular generator is unchanged');
  // Owner, Nov 12, 2026: the other holiday's designs are left out.
  assert.deepEqual(designsFor('newyear').map((d) => d.occasion), ['newyear', 'newyear', 'newyear', 'either', 'either', 'either']);
  assert.deepEqual(designsFor('christmas').map((d) => d.key), ['evergreen', 'candycane', 'silentnight', 'winterlights', 'candlelight', 'silvergold']);
  assert.match(styleCss(normalizeStyle(menuDesignFor('winterlights').style)), /main::before \{ content: ""; display: block; height: 30px;/, 'a string of lights under the header');
  assert.ok(menuDesignFor('evergreen') && menuDesignFor('classic'));
  const looks = new Set(HOLIDAY_DESIGNS.map((d) => styleCss(normalizeStyle(d.style))));
  assert.equal(looks.size, 9);
  assert.match(styleCss(normalizeStyle(menuDesignFor('evergreen').style)), /main::before \{ content: ""; display: block; height: 34px;/, 'holly under the header');
  assert.match(styleCss(normalizeStyle(menuDesignFor('candycane').style)), /border-image: repeating-linear-gradient\(45deg, #c62828/, 'candy cane stripes');
  assert.match(styleCss(normalizeStyle(menuDesignFor('confetti').style)), /data:image\/svg\+xml,/, 'confetti drawn inline (the hosted page allows only data: images)');
  assert.doesNotMatch(styleCss(normalizeStyle(menuDesignFor('classic').style)), /main::before/, 'regular designs are untouched');
});

test('dates: on sale until the holiday, shown through the day after, a second menu this season is $30', async () => {
  assert.equal(holiday.holidayEndsOn('christmas', NOV_20), '2026-12-26');
  assert.equal(holiday.holidayEndsOn('newyear', NOV_20), '2027-01-01');
  assert.equal(holiday.holidayEndsOn('newyear', Date.parse('2027-01-01T12:00:00-08:00')), '2027-01-01', 'January belongs to the December before');
  assert.equal(holiday.holidayOnSale('christmas', Date.parse('2026-12-25T20:00:00-08:00')), true);
  assert.equal(holiday.holidayOnSale('christmas', Date.parse('2026-12-26T08:00:00-08:00')), false);
  assert.equal(holiday.holidayOnSale('newyear', Date.parse('2026-12-31T22:00:00-08:00')), true);
  assert.equal(holiday.holidayOnSale('easter', NOV_20), false);
  assert.equal(holiday.holidayEnded('2026-12-26', Date.parse('2026-12-26T23:00:00-08:00')), false);
  assert.equal(holiday.holidayEnded('2026-12-26', Date.parse('2026-12-27T00:30:00-08:00')), true);
  const env = { DB: createD1() };
  offerRows(env.DB.raw);
  assert.equal(await holiday.holidayPriceCents(env, 'owner@harbor.example', NOV_20), 5900);
  const sql = (q, ...a) => env.DB.raw.prepare(q).run(...a);
  sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('c', '2026-11-01', '2026-11-01', 'Owner@Harbor.example')`);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o', '2026-11-12T00:00:00.000Z', '2026-11-12', 'c', 'ONBOARDING_REQUIRED', 5900, 5900, 'PAID')`);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i', 'o', 'offer_holiday_menu', 'offerv1_holiday_menu', 5900, 5900)`);
  assert.equal(await holiday.holidayPriceCents(env, 'owner@harbor.example', NOV_20), 3000, 'second holiday menu this season');
  assert.equal(await holiday.holidayPriceCents(env, 'owner@harbor.example', Date.parse('2027-11-20T12:00:00Z')), 5900, 'next season starts over');
});

test('both holidays: $89 once, the other holiday then checks out at $0, and anything after that is $30', async () => {
  const env = { DB: createD1() };
  offerRows(env.DB.raw);
  const q = (occasion, both, now = NOV_20) => holiday.holidayQuote(env, 'owner@harbor.example', occasion, { both, now });
  assert.deepEqual(await q('christmas', false), { price_cents: 5900 });
  assert.deepEqual(await q('christmas', true), { price_cents: 8900, both_other: 'newyear' });
  assert.deepEqual(await q('newyear', true), { price_cents: 8900, both_other: 'christmas' });
  assert.deepEqual(await q('newyear', true, Date.parse('2026-12-27T12:00:00-08:00')), { price_cents: 5900 }, 'Christmas is over, so there is no both');
  assert.deepEqual(await q('christmas', 'true'), { price_cents: 5900 }, 'only a real true asks for both');
  const sql = (text, ...a) => env.DB.raw.prepare(text).run(...a);
  sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('c', '2026-11-01', '2026-11-01', 'Owner@Harbor.example')`);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o', '2026-11-12T00:00:00.000Z', '2026-11-12', 'c', 'ONBOARDING_REQUIRED', 8900, 8900, 'PAID')`);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json) VALUES ('i', 'o', 'offer_holiday_menu', 'offerv1_holiday_menu', 8900, 8900, ?)`,
    JSON.stringify({ holiday_menu: { occasion: 'christmas', both_other: 'newyear', price_cents: 8900 } }));
  assert.deepEqual(await q('newyear', false), { price_cents: 0, prepaid: true }, 'the other holiday is already covered');
  assert.deepEqual(await q('newyear', true), { price_cents: 0, prepaid: true });
  assert.deepEqual(await q('christmas', false), { price_cents: 3000 }, 'another menu for the holiday already bought is a second menu');
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o2', '2026-11-20T00:00:00.000Z', '2026-11-20', 'c', 'ONBOARDING_REQUIRED', 0, 0, 'PAID')`);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json) VALUES ('i2', 'o2', 'offer_holiday_menu', 'offerv1_holiday_menu', 0, 0, ?)`,
    JSON.stringify({ holiday_menu: { occasion: 'newyear', prepaid: true, price_cents: 0 } }));
  assert.deepEqual(await q('newyear', false), { price_cents: 3000 }, 'the covered menu is used once');
});

test('Both picked in the holiday picker: the Make it live button and the checkout link say both', async () => {
  const { publicPreviewPage } = await import('./src/marketing/public-preview.js');
  const html = '<html><head></head><body class="m"><main>Menu</main></body></html>';
  const one = publicPreviewPage(html, 'a'.repeat(36), { occasion: 'christmas' });
  const two = publicPreviewPage(html, 'a'.repeat(36), { occasion: 'christmas', both: true });
  assert.match(one, /Make it live: \$59</);
  assert.match(two, /Make it live: \$89 for both</);
  assert.doesNotMatch(two, /Make it live: \$59/);
  // The second menu of an order for both holidays: no price on the button.
  const paid = publicPreviewPage(html, 'a'.repeat(36), { occasion: 'newyear', prepaid: true });
  assert.match(paid, /Complete your order: already paid</);
  assert.doesNotMatch(paid, /\$59|\$89/);
});

test('a holiday preview: six holiday designs (that holiday first), the holiday price, and checkout for Holiday Menu', async (t) => {
  const f = setup();
  const calls = stubFetch(t);
  const res = await f.create({ request_id: await f.upload(), email: 'owner@harbor.example', business: 'Harbor Kitchen', occasion: 'christmas' });
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));
  const token = out.token;
  f.env.DB.raw.prepare(`UPDATE menu_previews SET expires_at = '2999-01-01T00:00:00.000Z' WHERE token = ?`).run(token);
  assert.equal(f.env.DB.raw.prepare(`SELECT occasion FROM menu_previews`).get().occasion, 'christmas');
  assert.equal(calls.claude, 1);
  assert.match(calls.sent[0].subject, /Your Christmas menu preview/);
  assert.match(calls.sent[0].html, /Make it live for \$59/);
  const first = await (await f.get(`/api/menu-preview/view/${token}`)).text();
  assert.match(first, /Design 1 of 6: Evergreen \(Christmas\)/);
  assert.match(first, /Make it live: \$59</);
  assert.match(first, /<p>Christmas Menu<\/p>/, 'the line under the name says Christmas Menu');
  assert.ok(first.includes(`/api/menu-preview/view/${token}/candycane">Generate menu`));
  const last = await (await f.get(`/api/menu-preview/view/${token}/silvergold`)).text();
  assert.match(last, /Design 6 of 6: Silver and Gold<\/strong>/, 'a design for either holiday names no holiday');
  assert.match(last, /Make it live: \$59</, 'one holiday: $59 on the button');
  // The same stored page once this email's order for both holidays covers Christmas: the button is checked on
  // every open, so it stops naming a price. Without that order it is $59 again.
  const raw = f.env.DB.raw;
  raw.prepare(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('cb', '2026-11-01', '2026-11-01', 'owner@harbor.example')`).run();
  raw.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, status, subtotal_cents, total_cents, payment_status) VALUES ('ob', ?, ?, 'cb', 'ONBOARDING_REQUIRED', 8900, 8900, 'PAID')`).run(new Date().toISOString(), new Date().toISOString());
  raw.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json) VALUES ('ib', 'ob', 'offer_holiday_menu', 'offerv1_holiday_menu', 8900, 8900, ?)`).run(JSON.stringify({ holiday_menu: { occasion: 'newyear', both_other: 'christmas' } }));
  const covered = await (await f.get(`/api/menu-preview/view/${token}/silvergold`)).text();
  assert.match(covered, /Complete your order: already paid</);
  assert.doesNotMatch(covered, /Make it live: \$59/);
  raw.prepare(`DELETE FROM order_items WHERE id = 'ib'`).run(); raw.prepare(`DELETE FROM orders WHERE id = 'ob'`).run(); raw.prepare(`DELETE FROM customers WHERE id = 'cb'`).run();
  assert.match(await (await f.get(`/api/menu-preview/view/${token}/silvergold`)).text(), /Make it live: \$59</);
  assert.equal((await f.get(`/api/menu-preview/view/${token}/confetti`)).status, 410, "New Year's Eve designs are not in a Christmas preview");
  assert.ok(last.includes(`/api/menu-preview/view/${token}/evergreen">Generate menu`), 'goes round to the first');
  assert.equal((await f.get(`/api/menu-preview/view/${token}/classic`)).status, 410, 'regular designs are not in a holiday preview');
  const state = await (await f.call(`/api/menu-preview/state/${token}`)).json();
  assert.equal(state.designs.length, 6);
  assert.equal(state.occasion, 'christmas');
  assert.equal(state.choose_label, 'Make it live: $59 for Christmas');
  const chose = await f.get(`/api/menu-preview/choose/${token}/silentnight`);
  assert.equal(chose.status, 303);
  assert.equal(chose.headers.get('location'), `https://menu-made.com/contact.html?service=holiday&preview=${token}`);
  const handoff = await (await f.call(`/api/menu-preview/handoff/${token}`)).json();
  assert.equal(handoff.occasion, 'christmas');
  assert.equal(handoff.design, 'Silent Night');
  assert.ok(handoff.request_id, 'the menu file rides along to checkout');

  // Checkout: $59, a holiday line on Stripe, metadata the webhook turns into the project's holiday.
  const items = await normalizeCheckoutItems([{ code: 'HOLIDAY_MENU' }], f.env, { holiday_preview: token, customer: { email: 'owner@harbor.example' } }, { now: NOV_20 });
  assert.equal(items.length, 1);
  assert.equal(items[0].priceCents, 5900);
  assert.deepEqual(items[0].extraMetadata.holiday_menu, { occasion: 'christmas', ends_on: '2026-12-26', preview: token, design: 'silentnight', pages: 3, price_cents: 5900 });
  const params = new URLSearchParams();
  appendCheckoutLineItem(params, items[0], 0, 'live');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '5900');
  assert.equal(params.get('line_items[0][price_data][product_data][name]'), 'Holiday Menu: Christmas');
  assert.match(params.get('line_items[0][price_data][product_data][description]'), /live through 2026-12-26.*nothing renews/);
  await assert.rejects(normalizeCheckoutItems([{ code: 'HOLIDAY_MENU' }], f.env, {}, { now: NOV_20 }), /holiday menu generator first/);
  await assert.rejects(normalizeCheckoutItems([{ code: 'HOLIDAY_MENU' }], f.env, { holiday_preview: token }, { now: Date.parse('2026-12-27T12:00:00-08:00') }), /Christmas menus are finished/);
  await assert.rejects(normalizeCheckoutItems([{ code: 'HOLIDAY_MENU' }, { code: 'HOLIDAY_MENU' }], f.env, { holiday_preview: token }, { now: NOV_20 }), /One holiday menu per order/);

  // The paid build finds the chosen design and keeps the holiday line under the name.
  f.env.DB.raw.prepare(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('c', 'x', 'x', 'owner@harbor.example')`).run();
  f.env.DB.raw.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, status, subtotal_cents, total_cents, payment_status, notes) VALUES ('o', 'x', 'x', 'c', 'PAID', 5900, 5900, 'PAID', ?)`).run(`Document ref: ${handoff.request_id}`);
  const choice = await menuPreviewChoice(f.env, 'o');
  assert.equal(choice.design, 'silentnight');
  assert.equal(choice.occasion, 'christmas');
  assert.equal(choice.custom.subtitle, 'Christmas Menu');
});

test('holiday previews stop when the holiday has passed', async (t) => {
  const f = setup();
  stubFetch(t);
  const res = await f.create({ request_id: await f.upload(), email: 'owner@harbor.example', business: 'Harbor Kitchen', occasion: 'christmas' }, Date.parse('2026-12-27T10:00:00-08:00'));
  assert.equal(res.status, 410);
  assert.match((await res.json()).error, /Christmas menus are finished for this year/);
});

test('a holiday menu has its own address, never takes over the regular one, and ends after the holiday', async () => {
  const env = { DB: createD1(), ASSETS: createR2() };
  const sql = (q, ...a) => env.DB.raw.prepare(q).run(...a);
  const t = '2026-11-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email) VALUES ('c', ?, ?, 'owner@harbor.example')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name, website_url) VALUES ('b', ?, ?, 'Harbor Kitchen', 'https://harbor.example')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o', ?, ?, 'c', 'b', 'DELIVERED', 1, 1, 'PAID')`, t, t);
  offerRows(env.DB.raw);
  const project = (id, meta, slug, html, delivered) => {
    sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES (?, 'o', 'offer_holiday_menu', 'offerv1_holiday_menu', 1, 1)`, `oi-${id}`);
    sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at, metadata_json) VALUES (?, 'o', ?, 'b', 'c', 'MENU', 'DELIVERED', 'MENU_QR_V1', ?, ?, ?)`, id, `oi-${id}`, delivered, delivered, meta ? JSON.stringify(meta) : null);
    sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, value_text, required, status, created_at, updated_at) VALUES (?, ?, 'qr_destination', 'URL', ?, 1, 'VALID', ?, ?)`, `in-${id}`, id, `https://menu-made.com/api/menu/${slug}`, t, t);
    sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES (?, 'b', 'c', ?, 'DELIVERABLE', ?, 'menu.html', 'text/html', 1, 'VALID', ?)`, `a-${id}`, id, `k/${id}.html`, t);
    sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES (?, ?, ?, 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`, `d-${id}`, id, `a-${id}`, delivered, t);
    return env.ASSETS.put(`k/${id}.html`, html);
  };
  await project('reg', null, 'harbor-kitchen-11111111', '<p>Regular menu</p>', '2026-11-02T00:00:00.000Z');
  await project('xmas', { holiday_menu: { occasion: 'christmas', ends_on: '2999-12-26' } }, 'harbor-kitchen-christmas-22222222', '<p>Christmas menu</p>', '2026-11-20T00:00:00.000Z');
  await project('old', { holiday_menu: { occasion: 'newyear', ends_on: '2020-01-01' } }, 'harbor-kitchen-new-years-eve-33333333', '<p>Old NYE menu</p>', '2026-11-21T00:00:00.000Z');
  const page = async (slug) => (await worker.fetch(new Request(`https://menu-made.com/api/menu/${slug}`), env, { waitUntil() {} })).text();
  assert.match(await page('harbor-kitchen-11111111'), /Regular menu/, 'the regular address keeps the regular menu, though the holiday ones are newer');
  assert.match(await page('harbor-kitchen-christmas-22222222'), /Christmas menu/);
  const ended = await page('harbor-kitchen-new-years-eve-33333333');
  assert.match(ended, /Harbor Kitchen(&#0?39;|&apos;|')s New Year(&#0?39;|&apos;|')s Eve menu has ended/);
  assert.match(ended, /href="https:\/\/menu-made\.com\/api\/menu\/harbor-kitchen-11111111">See our menu/, 'points to the regular menu');
  assert.equal(hostedMenuSlug('12345678-aaaa-4bbb-8ccc-999999999999', 'Harbor Kitchen', 'christmas'), 'harbor-kitchen-christmas-12345678');
  assert.equal(hostedMenuSlug('12345678-aaaa-4bbb-8ccc-999999999999', 'Harbor Kitchen'), 'harbor-kitchen-12345678');
});
