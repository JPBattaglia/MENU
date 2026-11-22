// Stage 15: translated menus, paid plans only (owner, Nov 14, 2026). Run: node --no-warnings --test booking-api/menu-translations.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { buildDesignedMenuHtml } = await import('./src/producers/menu-qr/design.js');
const { MENU_DESIGNS, HOLIDAY_DESIGNS, designStyle } = await import('./src/producers/menu-qr/menu-designs.js');
const { pageStrings, translateMenuHtml } = await import('./src/producers/menu-qr/translate.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const BIZ = '66666666-6666-4666-8666-666666666666';
const PROJECT = '77777777-7777-4777-8777-777777777777';
const MENU = { sections: [{ name: 'Pizza', items: [{ name: 'Margherita', description: 'Tomato & basil', price: '$14' }, { name: 'Pepperoni', description: '', price: '$16', sold_out: true }] }, { name: 'Drinks', items: [{ name: 'Lemonade', description: 'Fresh', price: '$4' }] }], notes: 'Cash only' };
const URL_ = 'https://menu-made.com/api/menu/joes-pizza-abcd';

test('every design and holiday theme: each text on the page is found and translated, prices and the name are not', () => {
  for (const d of [...MENU_DESIGNS, ...(HOLIDAY_DESIGNS || [])]) {
    const html = buildDesignedMenuHtml({ businessName: "Joe's Pizza", brandColors: '#7a1f2b', menu: MENU, style: designStyle(d.key, MENU), subtitle: 'Dinner Menu' });
    const texts = pageStrings(html);
    assert.deepEqual(texts.sort(), ['Cash only', 'Dinner Menu', 'Drinks', 'Fresh', 'Lemonade', 'Margherita', 'Pepperoni', 'Pizza', 'Tomato & basil'].sort(), d.key);
    const row = { strings: { es: Object.fromEntries(texts.map((t) => [t, `ES ${t}`])) }, overrides: { es: { Lemonade: 'Limonada' } } };
    const page = translateMenuHtml(html, { lang: 'es', chosen: ['es'], row, hostedUrl: URL_ });
    assert.match(page, /<html lang="es">/);
    assert.match(page, /<span class="item">ES Margherita<\/span>/);
    assert.match(page, /<span class="item">Limonada<\/span>/, 'the owner\'s fix wins');
    assert.match(page, /<p class="desc">ES Tomato &amp; basil<\/p>/);
    assert.match(page, /<a href="#s1">ES Pizza<\/a>/);
    assert.match(page, /<h2 id="s1-h">ES Pizza<\/h2>/);
    assert.match(page, /Agotado<\/span>/);
    assert.match(page, /<p class="notes">ES Cash only<\/p>/);
    assert.match(page, /\$14<\/span>/);
    assert.match(page, /<h1[^>]*>Joe&#039;s Pizza<\/h1>/);
    assert.match(page, /<nav class="mm-langs" aria-label="Language"><a href="https:\/\/menu-made\.com\/api\/menu\/joes-pizza-abcd" lang="en"/);
    assert.match(page, /\?lang=es" lang="es" hreflang="es" aria-current="page">Español<\/a>/);
    assert.doesNotMatch(page, /<script/i, 'the page stays script-free');
  }
});

async function setup() {
  const DB = createD1();
  for (const m of ['0007_plan_settings.sql', '0009_website_package.sql', '0017_customer_accounts.sql', '0018_menu_hosting_index.sql', '0057_menu_translations.sql']) DB.raw.exec(read(m));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Joe''s Pizza')`, BIZ, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o1', ?, ?, 'cust', ?, 'COMPLETED', 5900, 5900, 'PAID')`, t, t, BIZ);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_m', ?, ?, 'MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_m', 'offer_m', 1, ?, ?, 'ACTIVE', 5900, '{}')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'offer_m', 'ov_m', 5900, 5900)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES (?, 'o1', 'i1', ?, 'cust', 'MENU', 'DELIVERED', 'MENU_QR_V1', 1, ?, ?)`, PROJECT, BIZ, t, t);
  sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, status, value_text, created_at, updated_at) VALUES ('pi1', ?, 'qr_destination', 'URL', 'VALID', ?, ?, ?)`, PROJECT, URL_, t, t);
  const ASSETS = createR2();
  const delivered = new Date(Date.now() - 864e5).toISOString();
  await ASSETS.put('r/menu-v1.html', new TextEncoder().encode(buildDesignedMenuHtml({ businessName: "Joe's Pizza", brandColors: '#7a1f2b', menu: MENU, style: null, subtitle: 'Menu' })));
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES ('a1', ?, 'cust', ?, 'DELIVERABLE', 'R2', 'r/menu-v1.html', 'menu.html', 'text/html', 10, 'x', 'VALID', ?)`, BIZ, PROJECT, delivered);
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d1', ?, 'a1', 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`, PROJECT, delivered, delivered);
  const emails = [];
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (String(url) === 'https://api.anthropic.com/v1/messages') {
      const prompt = JSON.parse(init.body).messages[0].content;
      const lang = /Target language: ([^.]+)\./.exec(prompt)[1];
      const texts = JSON.parse(/\n(\[[\s\S]*\])\n/.exec(prompt)[1]);
      asked.push({ lang, texts });
      const tag = lang.startsWith('Spanish') ? 'ES' : 'ZH';
      return Response.json({ model: 'test', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: 'tool_use', name: 'record_output', input: { translations: texts.map((x) => `${tag} ${x}`) } }] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-test' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (path, init) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, ctx);
  await call('/api/account/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'joe@joespizza.example' }) });
  const link = new URL('https://menu-made.com' + /https:\/\/menu-made\.com(\/api\/account\/open\/[^\s"]+)/.exec(emails.at(-1).text)[1]);
  const opened = await call(link.pathname, { method: 'POST', body: new URLSearchParams({ t: link.searchParams.get('t') }) });
  const cookie = opened.headers.get('Set-Cookie').split(';')[0];
  const post = (path, body) => call(path, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const get = (path) => call(path, { headers: { Cookie: cookie } });
  const addPlan = () => {
    sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_c', ?, ?, 'MENU_CARE', 'Menu Care', 'MENU', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 'MENU_CARE_V1')`, t, t);
    sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_c', 'offer_c', 1, ?, ?, 'ACTIVE', 2900, '{}')`, t, t);
    sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, started_at, created_at, updated_at) VALUES ('sub1', 'cust', ?, 'offer_c', 'ov_c', 'sub_x', 'cus_x', 'ACTIVE', 'MONTH', 2900, ?, ?, ?)`, BIZ, t, t, t);
    sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('ent1', 'cust', ?, 'sub1', 'MENU_CARE', 'ACTIVE', ?, ?, ?)`, BIZ, t, t, t);
  };
  return { call, post, get, sql, asked, addPlan, restore: () => { globalThis.fetch = realFetch; } };
}

test('no paid plan: no language links, and picking languages asks for a plan', async () => {
  const h = await setup();
  try {
    const got = await (await h.get(`/api/account/menu?business=${BIZ}`)).json();
    assert.equal(got.languages.paid, false);
    assert.ok(got.languages.available.some((l) => l.code === 'zh-Hans'));
    const res = await h.post('/api/account/menu/languages', { business: BIZ, languages: ['es'] });
    assert.equal(res.status, 402);
    assert.equal((await res.json()).needs_plan, true);
    const page = await (await h.call('/api/menu/joes-pizza-abcd?lang=es')).text();
    assert.doesNotMatch(page, /mm-langs/);
    assert.match(page, /<span class="item">Margherita<\/span>/);
    assert.equal(h.asked.length, 0, 'nothing sent for translation');
  } finally { h.restore(); }
});

test('paid plan: pick Spanish and Chinese, guests switch languages, an edit translates only what is new, owner fixes win, a lapsed plan goes back to English', async () => {
  const h = await setup();
  try {
    h.addPlan();
    assert.equal((await (await h.get(`/api/account/menu?business=${BIZ}`)).json()).languages.paid, true);
    const res = await h.post('/api/account/menu/languages', { business: BIZ, languages: ['es', 'zh-Hans', 'xx'] });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.deepEqual(out.chosen, ['es', 'zh-Hans']);
    assert.deepEqual(out.translated, { es: true, 'zh-Hans': true });
    assert.equal(out.links.es, `${URL_}?lang=es`);
    assert.equal(h.asked.length, 2);

    const english = await (await h.call('/api/menu/joes-pizza-abcd')).text();
    assert.match(english, /<nav class="mm-langs"[\s\S]*Español[\s\S]*中文（简体）/);
    assert.match(english, /<span class="item">Margherita<\/span>/);
    const es = await (await h.call('/api/menu/joes-pizza-abcd?lang=es')).text();
    assert.match(es, /<html lang="es">/);
    assert.match(es, /<span class="item">ES Margherita<\/span>/);
    assert.match(es, /\$14/);
    assert.match(es, /Agotado/);
    const zh = await (await h.call('/api/menu/joes-pizza-abcd?lang=zh-Hans')).text();
    assert.match(zh, /ZH Lemonade/);
    assert.equal(h.asked.length, 2, 'guests\' visits cost nothing once translated');

    const menu = (await (await h.get(`/api/account/menu?business=${BIZ}`)).json()).menu;
    menu.sections[1].items.push({ name: 'Iced tea', description: '', price: '$4' });
    menu.sections[0].items[0].price = '$15';
    assert.equal((await h.post('/api/account/menu', { business: BIZ, sections: menu.sections, notes: menu.notes })).status, 200);
    assert.deepEqual(h.asked.slice(2).map((a) => a.texts), [['Iced tea'], ['Iced tea']], 'only the new item is translated, once per language');
    const es2 = await (await h.call('/api/menu/joes-pizza-abcd?lang=es')).text();
    assert.match(es2, /ES Iced tea/);
    assert.match(es2, /\$15/);

    const pairs = await (await h.get(`/api/account/menu/translations?business=${BIZ}&lang=es`)).json();
    assert.ok(pairs.pairs.some((p) => p.source === 'Lemonade' && p.text === 'ES Lemonade' && !p.own));
    const fix = await (await h.post('/api/account/menu/translations', { business: BIZ, lang: 'es', edits: { Lemonade: 'Limonada', 'Not on the menu': 'x' } })).json();
    assert.ok(fix.pairs.some((p) => p.source === 'Lemonade' && p.text === 'Limonada' && p.own));
    assert.match(await (await h.call('/api/menu/joes-pizza-abcd?lang=es')).text(), /<span class="item">Limonada<\/span>/);

    h.sql(`UPDATE entitlements SET status = 'EXPIRED'`);
    const lapsed = await (await h.call('/api/menu/joes-pizza-abcd?lang=es')).text();
    assert.doesNotMatch(lapsed, /mm-langs/);
    assert.match(lapsed, /<span class="item">Lemonade<\/span>/);
    assert.equal((await h.post('/api/account/menu/languages', { business: BIZ, languages: ['es'] })).status, 402);
  } finally { h.restore(); }
});

test('owner comp (My Happy Donut, Nov 22, 2026): counts as paid and may show every language, not just five', async () => {
  const h = await setup();
  try {
    const { LANGUAGES, MAX_LANGUAGES } = await import('./src/producers/menu-qr/translate.js');
    // A paying business stays capped.
    h.addPlan();
    let res = await (await h.post('/api/account/menu/languages', { business: BIZ, languages: LANGUAGES.map((l) => l.code) })).json();
    assert.equal(res.chosen.length, MAX_LANGUAGES);
    h.sql(`DELETE FROM entitlements`);
    // The owner's comp: no plan at all, but the project says it was comped by the owner.
    h.sql(`UPDATE projects SET metadata_json = ? WHERE id = ?`, JSON.stringify({ comp: { preview: 'x', design: 'bistro', by: 'owner' } }), PROJECT);
    const state = (await (await h.get(`/api/account/menu?business=${BIZ}`)).json()).languages;
    assert.equal(state.paid, true);
    assert.equal(state.max, LANGUAGES.length);
    res = await (await h.post('/api/account/menu/languages', { business: BIZ, languages: LANGUAGES.map((l) => l.code) })).json();
    assert.deepEqual(res.chosen, LANGUAGES.map((l) => l.code));
    const page = await (await h.call('/api/menu/joes-pizza-abcd')).text();
    for (const l of LANGUAGES) assert.match(page, new RegExp(`hreflang="${l.code}"`), l.code);
    const es = await (await h.call('/api/menu/joes-pizza-abcd?lang=es')).text();
    assert.match(es, /<span class="item">ES Margherita<\/span>/);
  } finally { h.restore(); }
});
