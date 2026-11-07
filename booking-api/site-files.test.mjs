// The site generator's paid product (owner, Nov 6, 2026): Your Website, $299 = the chosen design as a zip;
// with Website Care in the same order it also goes live at <slug>.menu-made.com.
// Run: node --no-warnings --test booking-api/site-files.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = { ...(await import('./src/worker.js')), ...(await import('./src/workflows/runner.js')) };
const { DESIGNS, buildDesignSite } = await import('./src/producers/website/templates/index.js');
const { readZip } = await import('./src/producers/social-posts/zip.js');
const { refreshOnboardingState } = await import('./src/onboarding/onboarding.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const TOKEN = 'ab'.repeat(18);
const SITE = { name: 'Oliva Kitchen', kind: 'restaurant', about: 'Pasta made by hand.', offerings: '# Pasta\nCacio e Pepe | Pecorino, pepper | $21\n# Dessert\nTiramisù | Espresso, mascarpone | $10', phone: '(415) 555-0142', address: '512 Columbus Ave, San Francisco, CA', hours: 'Tue-Sun: 11am-9pm', email: '', style: 'modern', brand: '', facebook: '', instagram: '', photos: [], logo: null };
const COPY = { tagline: 'Neighborhood Italian in North Beach', intro: 'Handmade pasta on Columbus Avenue.', about: ['A small neighborhood restaurant.'], meta_description: 'Oliva Kitchen: handmade pasta in North Beach, San Francisco.', meta_about: 'About Oliva Kitchen.' };

test('every design builds a complete, escaped one-page site from the same business', () => {
  assert.equal(DESIGNS.length, 9);
  assert.deepEqual(DESIGNS.map((d) => d.key), ['trattoria', 'bistro', 'night', 'farmhouse', 'fine', 'fresh', 'pop', 'coastal', 'taproom']);
  for (const d of DESIGNS) {
    const files = buildDesignSite({ ...SITE, name: 'Oliva <b>Kitchen</b>' }, COPY, d.key);
    const html = files['index.html'];
    assert.ok(html.startsWith('<!doctype html>'), d.key);
    for (const words of ['Cacio e Pepe', '$21', 'Tiramisù', 'tel:4155550142', 'Tue-Sun', 'id="menu"', 'id="about"', 'id="visit"', 'href="styles.css"', 'class="skip"']) assert.ok(html.includes(words), `${d.key}: ${words}`);
    assert.ok(!html.includes('<b>Kitchen</b>'), `${d.key} escapes what the business typed`);
    assert.ok(files['styles.css'].length > 1000, d.key);
  }
  // No phone, no address, no hours: nothing broken or empty is shown.
  for (const d of DESIGNS) {
    const html = buildDesignSite({ ...SITE, phone: '', address: '', hours: '' }, COPY, d.key)['index.html'];
    assert.ok(!/tel:"|maps\/search|undefined|null/.test(html), d.key);
  }
});

function setup({ hosted }) {
  const DB = createD1(); const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-11-07T00:00:00.000Z';
  DB.raw.exec(read('0009_website_package.sql')); DB.raw.exec(read('0041_site_files.sql'));
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'owner@oliva.example', 'Ana', 'Rossi')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Oliva Kitchen')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES ('o1', ?, ?, 'cust', 'biz', 'ONBOARDING_REQUIRED', 29900, 29900, 'PAID', 'cs_live_x')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json) VALUES ('i1', 'o1', 'offer_site_files', 'offerv1_site_files', 29900, 29900, ?)`, JSON.stringify({ offer_code: 'SITE_FILES', site_preview: TOKEN, site_design: 'taproom' }));
  if (hosted) {
    sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_wc', ?, ?, 'WEBSITE_CARE', 'Website Care', 'WEBSITE', 'ACTIVE', 'RECURRING', 'DIGITAL', 1, 'WEBSITE_CARE_V1')`, t, t);
    sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_wc', 'offer_wc', 1, ?, ?, 'ACTIVE', 4900, '{}')`, t, t);
    sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json) VALUES ('i2', 'o1', 'offer_wc', 'ov_wc', 0, 0, '{"billing":"RECURRING","plan_code":"WEBSITE_CARE"}')`);
  }
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES ('22222222-2222-4333-8444-555555555555', 'o1', 'i1', 'biz', 'cust', 'WEBSITE', 'AWAITING_INPUTS', 'SITE_FILES_V1', 1, ?, ?)`, t, t);
  const emails = [];
  const fetch = async (url, init = {}) => { if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); } throw new Error(`Unexpected fetch ${url}`); };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, DB, ASSETS, emails, fetch, ctx, pending, row, PID: '22222222-2222-4333-8444-555555555555' };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }

async function runOrder(f) {
  await f.ASSETS.put(`website-previews/${TOKEN}/data.json`, JSON.stringify({ site: SITE, copy: COPY }));
  await withFetch(f.fetch, async () => {
    await refreshOnboardingState(f.PID, 'o1', 'cust', 'SITE_FILES_V1', f.env);
    for (let i = 0; i < 4; i++) { await api.runScheduledProduction(f.env); await Promise.all(f.pending); }
  });
}

test('paid: the chosen design is zipped and emailed at once, with no owner approval', async () => {
  const f = setup({ hosted: false });
  await runOrder(f);
  const zipRow = f.row(`SELECT d.status, d.customer_visible, a.storage_key, a.original_filename FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.deliverable_type = 'SITE_ZIP'`);
  assert.ok(zipRow, 'a zip was made');
  assert.equal(zipRow.status, 'FINAL'); assert.equal(zipRow.customer_visible, 1);
  assert.equal(zipRow.original_filename, 'oliva-kitchen-website.zip');
  const entries = readZip(new Uint8Array(await (await f.ASSETS.get(zipRow.storage_key)).arrayBuffer()));
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['oliva-kitchen/README.txt', 'oliva-kitchen/index.html', 'oliva-kitchen/styles.css']);
  const html = new TextDecoder().decode(entries.find((e) => e.name.endsWith('index.html')).data);
  assert.match(html, /Cacio e Pepe/); assert.match(html, /Alfa\+Slab\+One/, 'the chosen design (Taproom), not another');
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM approvals`).n, 0, 'nothing waits for the owner');
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM website_sites`).n, 0, 'not hosted without Website Care');
  const mail = f.emails.find((e) => /Your website is ready/.test(e.subject));
  assert.ok(mail, JSON.stringify(f.emails.map((e) => e.subject)));
  assert.deepEqual(mail.to, ['owner@oliva.example']);
  assert.match(mail.html, /Download your website \(zip\)/); assert.match(mail.html, /Website Care/);
  assert.doesNotMatch(mail.html, /Open your live site/);
});

test('paid with Website Care: the same site also goes live at its own address', async () => {
  const f = setup({ hosted: true });
  await runOrder(f);
  const site = f.row(`SELECT slug FROM website_sites WHERE business_id = 'biz'`);
  assert.equal(site.slug, 'oliva-kitchen');
  const live = await api.default.fetch(new Request('https://menu-made.com/api/site/oliva-kitchen/'), f.env, f.ctx);
  assert.equal(live.status, 200);
  const html = await live.text();
  assert.match(html, /Cacio e Pepe/); assert.match(html, /<style>/, 'styles inside the page');
  assert.match(live.headers.get('Content-Security-Policy'), /fonts\.googleapis\.com/);
  const mail = f.emails.find((e) => /Your website is ready/.test(e.subject));
  assert.match(mail.html, /https:\/\/oliva-kitchen\.menu-made\.com\//);
});

test('a missing preview never sends the buyer anything; the owner is told', async () => {
  const f = setup({ hosted: false });
  await withFetch(f.fetch, async () => {
    await refreshOnboardingState(f.PID, 'o1', 'cust', 'SITE_FILES_V1', f.env);
    for (let i = 0; i < 3; i++) { await api.runScheduledProduction(f.env); await Promise.all(f.pending); }
  });
  assert.equal(f.row(`SELECT COUNT(*) AS n FROM deliverables`).n, 0);
  assert.ok(f.emails.some((e) => /couldn't be found/.test(e.subject)));
  assert.ok(!f.emails.some((e) => /Your website is ready/.test(e.subject)));
});
