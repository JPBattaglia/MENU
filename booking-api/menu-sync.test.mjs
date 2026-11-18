// Stage 15 (Nov 17, 2026): a menu edit reaches the hosted website and Google; the free plan + editor daily self-test.
// Run: node --no-warnings --test booking-api/menu-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { foodMenusFromMenu, googlePrice, syncWebsiteMenu } = await import('./src/producers/menu-qr/menu-sync.js');
const { storeDeliverable } = await import('./src/producers/shared/deliverables.js');
const { buildDesignSite } = await import('./src/producers/website/templates/index.js');
const { advanceFreeMenuSelfTests } = await import('./src/selftest/free-menu-selftest.js');
const read = (m) => readFileSync(new URL(`./migrations/${m}`, import.meta.url), 'utf8');

test('Google gets the menu as food menus: plain prices, vegetarian / vegan / spicy marks, nothing sold out', () => {
  assert.deepEqual(googlePrice('$12.5'), { currencyCode: 'USD', units: '12', nanos: 500000000 });
  assert.deepEqual(googlePrice('14'), { currencyCode: 'USD', units: '14', nanos: 0 });
  assert.equal(googlePrice('12 / 18'), null);
  const out = foodMenusFromMenu({ sections: [{ name: 'Mains', items: [
    { name: 'Tofu Curry', description: 'Coconut', price: '$15', tags: ['VG', 'HOT'] },
    { name: 'Gone', description: '', price: '$9', sold_out: true },
    { name: 'Market Fish', description: '', price: 'MP' }
  ] }] }, 'Leaf Cafe');
  const items = out.menus[0].sections[0].items;
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].attributes, { price: { currencyCode: 'USD', units: '15', nanos: 0 }, dietaryRestriction: ['VEGAN', 'VEGETARIAN'], spiciness: 'HOT' });
  assert.deepEqual(items[1].attributes, {});
  assert.equal(out.menus[0].labels[0].displayName, 'Leaf Cafe menu');
});

test('an edited menu rebuilds the hosted generator website\'s menu and goes live at once', async () => {
  const DB = createD1(); const ASSETS = createR2();
  DB.raw.exec(read('0009_website_package.sql'));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-11-07T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name) VALUES ('cust', ?, ?, 'owner@oliva.example', 'Ana')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Oliva Kitchen')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o1', ?, ?, 'cust', 'biz', 'COMPLETED', 29900, 29900, 'PAID')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('x', ?, ?, 'SITE_FILES', 'Your Website', 'WEBSITE', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 0, 'SITE_FILES_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('y', 'x', 1, ?, ?, 'ACTIVE', 29900, '{}')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'x', 'y', 29900, 29900)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES ('p1', 'o1', 'i1', 'biz', 'cust', 'WEBSITE', 'DELIVERED', 'SITE_FILES_V1', 1, ?, ?)`, t, t);
  sql(`INSERT INTO website_sites (id, slug, project_id, business_id, customer_id, style, created_at, updated_at) VALUES ('w1', 'oliva', 'p1', 'biz', 'cust', 'generator:taproom', ?, ?)`, t, t);
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret' };
  const site = { name: 'Oliva Kitchen', kind: 'restaurant', about: 'Pasta.', offerings: '# Pasta\nCacio e Pepe | $18', phone: '', address: '', hours: '', email: '', photos: [], logo: null };
  const copy = { tagline: 'Pasta in North Beach', intro: 'Welcome.', about: ['Oliva Kitchen makes pasta.'] };
  const files = buildDesignSite(site, copy, 'taproom', {});
  const build = { version: 1, slug: 'oliva', style: 'generator:taproom', pages: Object.fromEntries(Object.entries(files).filter(([f]) => f.endsWith('.html'))), images: [], site, copy };
  const context = { id: 'p1', customer_id: 'cust', business_id: 'biz', order_id: 'o1' };
  const first = await storeDeliverable(env, context, { type: 'SITE_BUILD', filename: 'oliva-site.json', mime: 'application/json', bytes: new TextEncoder().encode(JSON.stringify(build)), folder: 'site-build', metadata: { website: { slug: 'oliva', style: 'generator:taproom' } } });
  sql(`UPDATE deliverables SET status = 'FINAL', customer_visible = 1, delivered_at = ? WHERE id = ?`, t, first.deliverableId);

  const out = await syncWebsiteMenu(env, 'biz', { sections: [{ name: 'Pasta', items: [{ name: 'Cacio e Pepe', description: '', price: '$19' }, { name: 'Carbonara', description: 'Guanciale', price: '$21' }] }] });
  assert.equal(out.done, true, JSON.stringify(out));
  const live = DB.raw.prepare(`SELECT a.storage_key, d.status FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = 'p1' AND d.deliverable_type = 'SITE_BUILD' ORDER BY d.version`).all();
  assert.deepEqual(live.map((r) => r.status), ['SUPERSEDED', 'FINAL']);
  const next = JSON.parse(await (await ASSETS.get(live[1].storage_key)).text());
  const pages = Object.values(next.pages).join('\n');
  assert.match(pages, /Carbonara/);
  assert.match(pages, /\$19/);
  assert.doesNotMatch(pages, /\$18/);
  assert.equal(next.copy.tagline, 'Pasta in North Beach', 'wording kept');
  // A second sync with the same menu changes nothing.
  assert.equal((await syncWebsiteMenu(env, 'biz', { sections: [{ name: 'Pasta', items: [{ name: 'Cacio e Pepe', description: '', price: '$19' }, { name: 'Carbonara', description: 'Guanciale', price: '$21' }] }] })).unchanged, true);
  assert.equal((await syncWebsiteMenu(env, 'nobody', { sections: [] })).reason, 'no_site');
});

test('the free plan self-test passes end to end and leaves nothing behind', async (t) => {
  const env = { DB: createD1(), ASSETS: createR2(), RESEND_API_KEY: 're_test', PRODUCTION_RUNNER_SECRET: 'test-runner-secret' };
  for (const m of ['0007_plan_settings.sql', '0009_website_package.sql', '0017_customer_accounts.sql', '0018_menu_hosting_index.sql']) env.DB.raw.exec(read(m));
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'em' });
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  const app = (request) => worker.fetch(request, env, { waitUntil() {} });
  const now = new Date().toISOString();
  env.DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('st1', 'FREE_MENU_RUN', 'REQUESTED', 'test', ?, ?)`).run(now, now);
  const [result] = await advanceFreeMenuSelfTests(env, app);
  const row = env.DB.raw.prepare(`SELECT status, error, log_json FROM self_tests WHERE id = 'st1'`).get();
  assert.equal(result.status, 'PASSED', row.error || '');
  assert.match(row.log_json, /editor saved 3 changes/);
  for (const table of ['menu_previews', 'projects', 'deliverables', 'orders', 'menu_stats_daily']) {
    assert.equal(env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, `${table} cleaned up`);
  }
  assert.equal(env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM businesses WHERE name = 'Free Self-Test Deli'`).get().n, 0);
});
