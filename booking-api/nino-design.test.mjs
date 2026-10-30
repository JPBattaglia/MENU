// Stage 10, Nino design services: layouts, pricing at checkout, the brief form, production through the renderer
// (rasterizer injected), owner approval and delivery. Mocked Anthropic and Resend; real SQLite schema and migrations.
// Run: node --no-warnings --test booking-api/nino-design.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = { ...(await import('./src/worker.js')), ...(await import('./src/workflows/runner.js')) };
const { flyerSvg, logoOptions, menuPageSvgs, socialSvg, paletteFor } = await import('./src/producers/nino-design/design-svg.js');
const { quoteMenuDesign, NINO_PRODUCTS } = await import('./src/producers/nino-design/products.js');
const { normalizeCheckoutItems, appendCheckoutLineItem } = await import('./src/checkout/quote.js');
const { checkPack } = await import('./src/producers/social-posts/render-jobs.js');
const { startDesignBrief, LINK_KIND } = await import('./src/producers/nino-design/brief.js');
const { checkSocialPosts } = await import('./src/producers/nino-design/produce.js');
const { signLinkToken } = await import('./src/lib/links.js');
const { cartInputFromItems } = await import('./src/checkout/abandoned.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const MENU = { sections: [
  { name: 'Coffee', items: [{ name: 'Espresso', description: 'Double shot', price: '$3.50' }, { name: 'Cappuccino', description: 'With whole or oat milk', price: '$4.75' }] },
  { name: 'Bakery', items: [{ name: 'Sourdough Loaf', description: 'Baked every morning', price: '$9' }, { name: 'Almond Croissant', description: '', price: '$4.25' }] }
], notes: '' };

test('layouts: flyer, social graphics, six logo options and menu pages fit; text that cannot fit is refused', () => {
  const brief = { business_name: 'Sample Cafe', headline: 'Live Jazz Fridays', details: 'Every Friday 7 to 10 pm\nNo cover', call_to_action: 'Bring a friend', contact: '123 Main Street', style: 'elegant' };
  for (const size of ['print', 'square']) {
    const r = flyerSvg(brief, { size, hasLogo: true });
    assert.ok(r.svg && !r.error, r.error);
    assert.ok(r.svg.includes('Live Jazz Fridays') || r.svg.includes('Live Jazz'), 'headline printed');
    assert.ok(r.svg.includes('__LOGO_DATA_URI__'), 'logo slot for the renderer');
  }
  assert.equal(flyerSvg({ ...brief, headline: 'Supercalifragilisticexpialidociousness'.repeat(2) }, {}).error, 'The headline does not fit the flyer');
  const logos = logoOptions({ business_name: 'Sample Cafe', tagline: 'Coffee & Bakery', style: 'modern' });
  assert.equal(logos.options.length, 6);
  assert.equal(logos.options.flatMap((o) => o.files).length, 18);
  assert.ok(logos.options[0].files[0].svg.includes('Coffee &amp; Bakery'));
  const again = logoOptions({ business_name: 'Sample Cafe', style: 'modern' }, { variant: 1 });
  assert.notEqual(again.options[0].face, logos.options[0].face, 'request changes rotates the faces');
  const social = socialSvg({ headline: 'Fresh sourdough daily', subline: 'Baked at dawn' }, { businessName: 'Sample Cafe', style: 'classic', hasLogo: false }, 'story');
  assert.equal(social.height, 1920);
  const pages = menuPageSvgs(MENU, { business_name: 'Sample Cafe', style: 'classic', footer: 'Ask about allergens' }, { pages: 4, hasLogo: false });
  assert.equal(pages.pages.length, 1, 'a short menu takes one page even when four are paid');
  for (const p of ['$3.50', '$4.75', '$9', '$4.25', 'Almond']) assert.ok(pages.pages[0].svg.includes(p), p);
  const long = { sections: [{ name: 'All', items: Array.from({ length: 160 }, (_, i) => ({ name: `Dish number ${i}`, description: 'A long description of the dish with many words in it to wrap', price: `$${i}` })) }] };
  assert.match(menuPageSvgs(long, { business_name: 'X', style: 'bold' }, { pages: 1 }).error, /does not fit on 1 page/);
  const pal = paletteFor('classic', '#ffff00, #ffffff');
  assert.equal(pal.ink, '#1f2a2e', 'ink stays readable on the buyer\'s background');
});

test('checkout: design services carry inline prices on live, Menu Redesign is priced by pages, abandoned carts keep pages and the Nino return', async () => {
  assert.deepEqual(quoteMenuDesign(5), { pages: 5, included_pages: 4, extra_pages: 1, total_cents: 22400 });
  assert.equal(quoteMenuDesign(13), null);
  const DB = createD1(); DB.raw.exec(read('0019_stage10_nino_link.sql'));
  DB.raw.exec(`UPDATE offers SET is_public = 1 WHERE code LIKE 'NINO_%'`);
  const env = { DB };
  const items = await normalizeCheckoutItems([{ key: 'NINO_MENU_DESIGN' }, { key: 'NINO_LOGO' }], env, { design_pages: 6 }, { requirePublic: true });
  assert.equal(items[0].priceCents, 19900 + 2 * 2500);
  assert.equal(items[0].extraMetadata.design_pages, 6);
  const params = new URLSearchParams();
  appendCheckoutLineItem(params, items[1], 0, 'live');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '24900');
  assert.match(params.get('line_items[0][price_data][product_data][name]'), /Nino Battaglia design: Logo/);
  assert.equal(params.get('line_items[0][price_data][product_data][tax_code]'), null, 'the logo is not taxed');
  const [flyer] = await normalizeCheckoutItems([{ key: 'NINO_FLYER' }], env, {}, { requirePublic: true });
  const fp = new URLSearchParams(); appendCheckoutLineItem(fp, flyer, 0, 'live');
  assert.equal(fp.get('line_items[0][price_data][product_data][tax_code]'), 'txcd_10505001', 'the flyer is taxed');
  assert.equal(fp.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  for (const key of ['NINO_SOCIAL_PACK', 'NINO_MENU_DESIGN']) assert.equal((await normalizeCheckoutItems([{ key }], env, {}, { requirePublic: true }))[0].taxCode, null, `${key} is not taxed`);
  // All four services in one cart (the self-test cart): the flyer turns automatic tax on, and Stripe then rejects any
  // line item without a tax behavior, so the untaxed three must be marked non-taxable.
  const four = await normalizeCheckoutItems(['NINO_SOCIAL_PACK', 'NINO_FLYER', 'NINO_MENU_DESIGN', 'NINO_LOGO'].map((key) => ({ key })), env, {}, { requirePublic: true });
  const autoTax = four.some((item) => item.taxCode);
  assert.ok(autoTax);
  const all = new URLSearchParams(); four.forEach((item, i) => appendCheckoutLineItem(all, item, i, 'live', { autoTax }));
  four.forEach((item, i) => {
    assert.equal(all.get(`line_items[${i}][price_data][tax_behavior]`), 'exclusive', `${item.offerName} has a tax behavior`);
    assert.equal(all.get(`line_items[${i}][price_data][product_data][tax_code]`), item.taxCode || 'txcd_00000000');
  });
  await assert.rejects(normalizeCheckoutItems([{ key: 'NINO_MENU_DESIGN' }], env, { design_pages: 40 }), /page count from 1 to 12/);
  const cart = cartInputFromItems([{ offer_code: 'NINO_MENU_DESIGN', quantity: 1, metadata_json: JSON.stringify({ design_pages: 6, return_to: 'nino' }) }]);
  assert.equal(cart.design_pages, 6); assert.equal(cart.return_to, 'nino');
});

test('the renderer\'s ZIP must hold the preview page when one was asked for', () => {
  const png = (w, h) => { const b = new Uint8Array(3000); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h); return b; };
  const spec = { files: [{ name: 'a.png', width: 10, height: 10 }], extra: [], preview: { title: 't', sections: [] } };
  assert.equal(checkPack([{ name: 'a.png', data: png(10, 10) }], spec), 'preview.html is missing');
  assert.equal(checkPack([{ name: 'a.png', data: png(10, 10) }, { name: 'preview.html', data: new Uint8Array(5) }], spec), null);
});

test('social posts: invented facts and missing hashtags fail the check', () => {
  const posts = Array.from({ length: 9 }, (_, i) => ({ headline: `Fresh bread day ${i}`, subline: '', caption: 'Our sourdough comes out of the oven every morning, warm and ready.', hashtags: ['#bread', '#cafe', '#local'] }));
  assert.deepEqual(checkSocialPosts(posts, 'sourdough bread cafe').problems, []);
  posts[2].caption = 'Call us at 512-555-0100 for 20% off this week only, every morning.';
  posts[3].hashtags = ['#ok'];
  const { problems } = checkSocialPosts(posts, 'sourdough bread cafe');
  assert.ok(problems.some((p) => /Post 3: phone/.test(p)), problems.join());
  assert.ok(problems.some((p) => /Post 4: use 3-10/.test(p)));
});

function setup(product) {
  const DB = createD1(); const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  DB.raw.exec(read('0004_ai_usage_index.sql')); DB.raw.exec(read('0019_stage10_nino_link.sql'));
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name) VALUES ('cust', ?, ?, 'ana@cafe.example', 'Ana')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Sample Cafe')`, t, t);
  const p = NINO_PRODUCTS[product];
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES ('o1', ?, ?, 'cust', 'biz', 'ONBOARDING_REQUIRED', 0, 0, 'PAID', 'cs_live_x')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json) VALUES ('i1', 'o1', ?, ?, 0, 0, ?)`, `offer_${product.toLowerCase()}`, `offerv1_${product.toLowerCase()}`, JSON.stringify({ design_pages: 4 }));
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES ('11111111-2222-4333-8444-555555555555', 'o1', 'i1', 'biz', 'cust', 'DESIGN', 'AWAITING_INPUTS', ?, 1, ?, ?)`, p.workflow, t, t);
  const emails = []; const state = { outputs: [] };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      if (body.tools[0].name === 'record_menu') return Response.json({ model: body.model, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', name: 'record_menu', input: { ...MENU, unreadable: '' } }] });
      const output = state.outputs.shift(); if (!output) throw new Error('Unexpected AI call');
      return Response.json({ model: body.model, usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: 'tool_use', name: 'record_output', input: output }] });
    }
    throw new Error(`Unexpected fetch ${u}`);
  };
  const fakePng = async (svg, w) => { const b = new Uint8Array(3000); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(b.buffer).setUint32(16, w); return b; };
  const env = { DB, ASSETS, SOCIAL_RASTERIZER: fakePng, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = []; const ctx = { waitUntil: (pr) => pending.push(pr) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, DB, ASSETS, emails, state, fetch, ctx, pending, row, sql, projectId: '11111111-2222-4333-8444-555555555555' };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map((m) => m[0].replaceAll('&amp;', '&'));
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]);

async function briefAndProduce(f, product, values, files = {}) {
  await startDesignBrief(f.env, { projectId: f.projectId });
  const [link] = linksIn(f.emails[0].text, '/api/design-brief/');
  assert.ok(link, 'brief link emailed');
  const page = await (await call(f, link)).text();
  assert.match(page, /Sample Cafe/, 'business name pre-filled');
  const form = new FormData();
  form.append('t', await signLinkToken(f.env, { kind: LINK_KIND, id: f.projectId, ttlDays: 1 }));
  for (const [k, v] of Object.entries(values)) form.append(k, v);
  for (const [k, v] of Object.entries(files)) form.append(k, v);
  const res = await call(f, `https://menu-made.com/api/design-brief/${f.projectId}`, { method: 'POST', body: form });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  await api.runScheduledProduction(f.env); await Promise.all(f.pending);
}

async function approveAndDeliver(f) {
  assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');
  const owner = f.emails.find((e) => /Approve Sample Cafe/.test(e.subject));
  assert.ok(owner, 'owner asked to approve');
  const [approveUrl] = linksIn(owner.text, '/api/approvals/');
  const form = new FormData(); form.append('t', new URL(approveUrl).searchParams.get('t'));
  assert.equal((await call(f, approveUrl.split('?')[0], { method: 'POST', body: form })).status, 200);
  await api.runScheduledProduction(f.env); await Promise.all(f.pending);
  assert.equal(f.row(`SELECT status FROM projects`).status, 'DELIVERED');
  const buyer = f.emails.find((e) => /from Nino Battaglia is ready/.test(e.subject));
  assert.ok(buyer, 'buyer emailed');
  assert.match(buyer.text, /See your designs/);
  assert.match(buyer.text, /staff-merch/);
  return buyer;
}

test('flyer: brief form with a logo -> drawn -> owner approval -> delivered with preview and ZIP', async () => {
  const f = setup('NINO_FLYER');
  await withFetch(f.fetch, async () => {
    await briefAndProduce(f, 'NINO_FLYER', { business_name: 'Sample Cafe', headline: 'Grand Opening', details: 'Saturday 10am\nFree coffee', style: 'bold', brand_colors: '' }, { logo: new File([PNG], 'logo.png', { type: 'image/png' }) });
    const pack = f.row(`SELECT a.original_filename FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.deliverable_type = 'NINO_DESIGN_PACK'`);
    assert.equal(pack.original_filename, 'Sample-Cafe-flyer.zip');
    await approveAndDeliver(f);
  });
});

test('brief form refuses bad colours and a menu redesign without a menu file', async () => {
  const f = setup('NINO_MENU_DESIGN');
  await withFetch(f.fetch, async () => {
    await startDesignBrief(f.env, { projectId: f.projectId });
    const token = await signLinkToken(f.env, { kind: LINK_KIND, id: f.projectId, ttlDays: 1 });
    const post = async (extra) => { const form = new FormData(); form.append('t', token); form.append('business_name', 'Sample Cafe'); form.append('style', 'classic'); for (const [k, v] of Object.entries(extra)) form.append(k, v); return call(f, `https://menu-made.com/api/design-brief/${f.projectId}`, { method: 'POST', body: form }); };
    assert.match(await (await post({ brand_colors: 'red' })).text(), /Colours must look like/);
    assert.match(await (await post({})).text(), /upload your current menu/);
    assert.equal(f.row(`SELECT status FROM projects`).status, 'AWAITING_INPUTS');
    const bad = await call(f, `https://menu-made.com/api/design-brief/${f.projectId}?t=nope`);
    assert.equal(bad.status, 403);
  });
});

test('menu redesign: Claude reads the uploaded menu, every dish and price is laid out, delivered after approval', async () => {
  const f = setup('NINO_MENU_DESIGN');
  await withFetch(f.fetch, async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n% test\n');
    await briefAndProduce(f, 'NINO_MENU_DESIGN', { business_name: 'Sample Cafe', style: 'classic', footer: 'Ask about allergens' }, { menu_file: new File([pdf], 'menu.pdf', { type: 'application/pdf' }) });
    const info = JSON.parse(f.row(`SELECT a.metadata_json FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.deliverable_type = 'NINO_DESIGN_PACK'`).metadata_json).nino_design;
    assert.equal(info.items, 4); assert.equal(info.paid_pages, 4); assert.equal(info.pages, 1);
    await approveAndDeliver(f);
  });
});

test('social pack: posts written from the brief only, then drawn; a claim not in the brief is retried', async () => {
  const f = setup('NINO_SOCIAL_PACK');
  await withFetch(f.fetch, async () => {
    const posts = Array.from({ length: 9 }, (_, i) => ({ headline: `Sourdough moment ${i + 1}`, subline: 'Baked every morning', caption: 'Our sourdough loaf is baked every morning, come and get one warm.', hashtags: ['#sourdough', '#bakery', '#cafe'] }));
    f.state.outputs.push({ posts: posts.map((p, i) => (i === 0 ? { ...p, caption: 'Only $2 today for every loaf, come and get one warm now.' } : p)) }, { posts });
    await briefAndProduce(f, 'NINO_SOCIAL_PACK', { business_name: 'Sample Cafe', about: 'A cafe and bakery.', promote: 'Our sourdough loaf, baked every morning.', voice: '', brand_colors: '#a3322a' });
    assert.equal(f.state.outputs.length, 0, 'the second, clean answer was used');
    const info = JSON.parse(f.row(`SELECT a.metadata_json FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.deliverable_type = 'NINO_DESIGN_PACK'`).metadata_json).nino_design;
    assert.equal(info.posts, 9); assert.equal(info.attempts, 2);
    await approveAndDeliver(f);
  });
});

test('logo: no logo upload asked, 18 files drawn, delivered after approval', async () => {
  const f = setup('NINO_LOGO');
  await withFetch(f.fetch, async () => {
    await startDesignBrief(f.env, { projectId: f.projectId });
    const page = await (await call(f, linksIn(f.emails[0].text, '/api/design-brief/')[0])).text();
    assert.doesNotMatch(page, /name="logo"/);
    f.emails.length = 0;
    await briefAndProduce(f, 'NINO_LOGO', { business_name: 'Sample Cafe', tagline: '', style: 'rustic', brand_colors: '' });
    await approveAndDeliver(f);
  });
});
