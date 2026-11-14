// Stage 15: the owner's own menu editor (GET/POST /api/account/menu). Run: node --no-warnings --test booking-api/menu-editor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { buildDesignedMenuHtml } = await import('./src/producers/menu-qr/design.js');
const { parseMenuHtml } = await import('./src/producers/menu-care/menu-edit.js');
const { cleanMenu } = await import('./src/account/menu-editor.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const BIZ = '66666666-6666-4666-8666-666666666666';
const PROJECT = '77777777-7777-4777-8777-777777777777';
const MENU = { sections: [{ name: 'Pizza', items: [{ name: 'Margherita', description: 'Tomato, basil', price: '$14' }, { name: 'Pepperoni', description: '', price: '$16' }] }], notes: 'Cash only' };

async function setup({ delivered = new Date(Date.now() - 864e5).toISOString() } = {}) {
  const DB = createD1();
  for (const m of ['0007_plan_settings.sql', '0009_website_package.sql', '0017_customer_accounts.sql', '0018_menu_hosting_index.sql']) DB.raw.exec(read(m));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe'), ('other', ?, ?, 'x@other.example', 'X')`, t, t, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Joe''s Pizza')`, BIZ, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o1', ?, ?, 'cust', ?, 'COMPLETED', 5900, 5900, 'PAID')`, t, t, BIZ);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('88888888-8888-4888-8888-888888888888', ?, ?, 'Other Cafe')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o2', ?, ?, 'other', '88888888-8888-4888-8888-888888888888', 'COMPLETED', 5900, 5900, 'PAID')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_m', ?, ?, 'MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_m', 'offer_m', 1, ?, ?, 'ACTIVE', 5900, '{}')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'offer_m', 'ov_m', 5900, 5900)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES (?, 'o1', 'i1', ?, 'cust', 'MENU', 'DELIVERED', 'MENU_QR_V1', 1, ?, ?)`, PROJECT, BIZ, t, t);
  sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, status, value_text, created_at, updated_at) VALUES ('pi1', ?, 'qr_destination', 'URL', 'VALID', 'https://menu-made.com/api/menu/joes-pizza-abcd', ?, ?)`, PROJECT, t, t);
  const ASSETS = createR2();
  const html = buildDesignedMenuHtml({ businessName: "Joe's Pizza", brandColors: '#7a1f2b', menu: MENU, style: null, subtitle: 'Menu' });
  await ASSETS.put('r/menu-v1.html', new TextEncoder().encode(html));
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES ('a1', ?, 'cust', ?, 'DELIVERABLE', 'R2', 'r/menu-v1.html', 'menu.html', 'text/html', 10, 'x', 'VALID', ?)`, BIZ, PROJECT, delivered);
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d1', ?, 'a1', 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`, PROJECT, delivered, delivered);
  const emails = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (path, init) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, ctx);
  async function cookieFor(email) {
    await call('/api/account/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const link = new URL('https://menu-made.com' + /https:\/\/menu-made\.com(\/api\/account\/open\/[^\s"]+)/.exec(emails.at(-1).text)[1]);
    const res = await call(link.pathname, { method: 'POST', body: new URLSearchParams({ t: link.searchParams.get('t') }) });
    return res.headers.get('Set-Cookie').split(';')[0];
  }
  const save = (cookie, body) => call('/api/account/menu', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { env, call, sql, cookieFor, save, row: (q, ...a) => DB.raw.prepare(q).get(...a), restore: () => { globalThis.fetch = realFetch; } };
}

test('signed in: the owner reads the live menu, saves a price change and a sold-out item, and the menu address shows it at once', async () => {
  const h = await setup();
  try {
    assert.equal((await h.call(`/api/account/menu?business=${BIZ}`)).status, 401, 'not signed in');
    const cookie = await h.cookieFor('joe@joespizza.example');
    const got = await (await h.call(`/api/account/menu?business=${BIZ}`, { headers: { Cookie: cookie } })).json();
    assert.equal(got.ok, true);
    assert.equal(got.menu_url, 'https://menu-made.com/api/menu/joes-pizza-abcd');
    assert.deepEqual(got.menu.sections[0].items.map((i) => i.price), ['$14', '$16']);
    const sections = structuredClone(got.menu.sections);
    sections[0].items[0].price = '$15';
    sections[0].items[1].sold_out = true;
    sections.unshift({ name: "Today's specials", items: [{ name: 'Burrata', description: 'With peaches', price: '$12' }] });
    const res = await h.save(cookie, { business: BIZ, sections, notes: 'Cash only' });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.ok(out.changes.some((c) => /Margherita.*\$14 → \$15/.test(c)), out.changes.join(' | '));
    assert.ok(out.changes.includes('Sold out: Pepperoni'));
    assert.ok(out.changes.some((c) => /Added Burrata/.test(c)));
    const page = await (await h.call('/api/menu/joes-pizza-abcd')).text();
    assert.match(page, /\$15/);
    assert.match(page, /<li class="sold-out">/);
    assert.match(page, /Sold out<\/span>/);
    const parsed = parseMenuHtml(page);
    assert.equal(parsed.menu.sections[0].name, "Today's specials");
    assert.equal(parsed.menu.sections[1].items[1].sold_out, true, 'sold out survives a re-read');
    assert.equal(h.row(`SELECT COUNT(*) AS n FROM deliverables WHERE project_id = ? AND status = 'FINAL' AND customer_visible = 1`, PROJECT).n, 2);
    // Back on: the mark comes off again.
    const again = await (await h.call(`/api/account/menu?business=${BIZ}`, { headers: { Cookie: cookie } })).json();
    again.menu.sections[1].items[1].sold_out = false;
    const back = await (await h.save(cookie, { business: BIZ, sections: again.menu.sections, notes: again.menu.notes })).json();
    assert.deepEqual(back.changes, ['Back on: Pepperoni']);
    // Nothing changed: nothing published.
    const same = await (await h.save(cookie, { business: BIZ, sections: again.menu.sections, notes: again.menu.notes })).json();
    assert.equal(same.unchanged, true);
    assert.equal(h.row(`SELECT COUNT(*) AS n FROM deliverables WHERE project_id = ?`, PROJECT).n, 3);
  } finally { h.restore(); }
});

test('another account cannot read or change the menu; an empty menu and an offline menu are refused', async () => {
  const h = await setup();
  try {
    const stranger = await h.cookieFor('x@other.example');
    {
      assert.equal((await h.call(`/api/account/menu?business=${BIZ}`, { headers: { Cookie: stranger } })).status, 404);
      assert.equal((await h.save(stranger, { business: BIZ, sections: MENU.sections })).status, 404);
    }
    const cookie = await h.cookieFor('joe@joespizza.example');
    const empty = await h.save(cookie, { business: BIZ, sections: [{ name: 'Pizza', items: [{ name: '  ', price: '$1' }] }] });
    assert.equal(empty.status, 400);
    assert.match((await empty.json()).error, /at least one item/);
  } finally { h.restore(); }
  const old = await setup({ delivered: new Date(Date.now() - 500 * 864e5).toISOString() });
  try {
    const cookie = await old.cookieFor('joe@joespizza.example');
    const res = await old.save(cookie, { business: BIZ, sections: MENU.sections, notes: 'x' });
    assert.equal(res.status, 409, 'menu past its hosting year and grace is offline');
  } finally { old.restore(); }
});

test('cleanMenu trims to the page limits, names unnamed sections and drops empty items', () => {
  const { menu, problems } = cleanMenu({ sections: [{ name: '', items: [{ name: ' Soup ', price: '$5', sold_out: 'yes' }, { name: '' }] }], notes: 'n'.repeat(2000) });
  assert.deepEqual(problems, []);
  assert.equal(menu.sections[0].name, 'Menu');
  assert.deepEqual(menu.sections[0].items, [{ name: 'Soup', description: '', price: '$5' }], 'only a real true marks sold out');
  assert.equal(menu.notes.length, 1000);
});
