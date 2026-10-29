// Stage 10, staff merch: pricing, logo upload, quote and checkout routes (Nino shop and Stripe mocked), the paid
// webhook, the proof with owner approval for logos, and the Printful order placed only after release.
// Run: node --no-warnings --test booking-api/staff-merch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = { ...(await import('./src/worker.js')), ...(await import('./src/workflows/runner.js')) };
const { priceMerch } = await import('./src/producers/staff-merch/pricing.js');
const { handleCheckoutCompleted } = await import('./src/checkout/webhook.js');
const { emailMerchTracking, externalIdFor, imageSize } = await import('./src/producers/staff-merch/order.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 2, 0x58, 0, 0, 1, 0x90]); // 600 x 400
const TINY_PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]);

test('pricing: shop price, +$5 with a logo, 10% from 12 shirts and 15% from 24', () => {
  const lines = (n) => [{ unit_price_cents: 2600, quantity: n }];
  assert.equal(priceMerch(lines(11)).subtotal_cents, 11 * 2600);
  const twelve = priceMerch(lines(12), { logo: true });
  assert.equal(twelve.discount_percent, 10);
  assert.equal(twelve.lines[0].unit_cents, Math.round(3100 * 0.9));
  assert.equal(twelve.discount_cents, 12 * 3100 - twelve.subtotal_cents);
  assert.equal(priceMerch([{ unit_price_cents: 2600, quantity: 20 }, { unit_price_cents: 2600, quantity: 4 }]).discount_percent, 15);
});

test('pricing: logo items are Printful x 2 ending in .99; the discount counts every item; embroidery set-up x 2', () => {
  const p = priceMerch([{ unit_price_cents: 2600, quantity: 10 }], { logo: true, logoLines: [{ base_cents: 1247, quantity: 1 }, { base_cents: 1500, quantity: 1 }], costs: { digitization_cents: 650 } });
  assert.equal(p.logo_lines[0].list_unit_cents, 2499, '$12.47 x 2 = $24.94 -> $24.99');
  assert.equal(p.logo_lines[1].list_unit_cents, 3099, '$30.00 -> $30.99');
  assert.equal(p.items, 12); assert.equal(p.discount_percent, 10);
  assert.equal(p.logo_lines[0].unit_cents, Math.round(2499 * 0.9));
  assert.equal(p.setup_cents, 1300);
  assert.equal(p.subtotal_cents, p.lines[0].line_cents + p.logo_lines[0].line_cents + p.logo_lines[1].line_cents + 1300);
  assert.equal(priceMerch([], { logo: true, logoLines: [{ base_cents: 900, quantity: 2 }] }).logo_fee_cents, 0, 'no $5 fee without Nino shirts');
});

test('logo size is read from PNG and JPG headers', () => {
  assert.deepEqual(imageSize(PNG), { width: 600, height: 400 });
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 1, 0x2c, 3, 0x20, 3]);
  assert.deepEqual(imageSize(jpg), { width: 800, height: 300 });
});

function setup() {
  const DB = createD1(); const ASSETS = createR2();
  ASSETS.head = async (key) => (ASSETS.objects.has(key) ? { customMetadata: ASSETS.objects.get(key).customMetadata } : null);
  DB.raw.exec(read('0019_stage10_nino_link.sql'));
  const emails = []; const stripe = []; const merchCalls = [];
  const MERCH = {
    async quote(args) {
      merchCalls.push(['quote', args]);
      const logoLines = (args.logo_items || []).map((i) => ({ ...i, title: i.key === 'cap' ? 'Cap (embroidered)' : 'Mug', color: i.key === 'cap' ? 'Navy' : 'White', size: 'One size', image: `https://files.example/${i.key}.png`, base_cents: i.key === 'cap' ? 1500 : 1247 }));
      return { ok: true, recipient: args.recipient, lines: args.items.map((i) => ({ ...i, title: 'Skull Wave', color: 'Black', size: i.variant_id === '501' ? 'M' : 'L', image: 'https://nino.example/m.jpg', unit_price_cents: 2600, catalog_variant_id: 4011, fingerprint: 'fp' })),
        logo_lines: logoLines, costs: { digitization_cents: logoLines.some((l) => l.key === 'cap') ? 650 : 0 }, rates: [{ id: 'STANDARD', name: 'Flat Rate', amount_cents: 1299, currency: 'usd' }] };
    },
    async products() { merchCalls.push(['products']); return { ok: true, built_at: 1, products: [{ key: 'mug', title: 'Mug', templates: [], variants: [{ id: 1320, base_cents: 1247 }] }] }; },
    async placeOrder(args) { merchCalls.push(['placeOrder', args]); return { ok: true, printful_order_id: '777', status: args.confirm ? 'pending' : 'draft', cost_cents: 20000 }; },
    async orderStatus(args) { merchCalls.push(['orderStatus', args]); return { ok: true, found: true, status: 'fulfilled', shipments: [{ carrier: 'USPS', tracking_number: '9400', tracking_url: 'https://track.example/9400' }] }; }
  };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (u === 'https://api.stripe.com/v1/customers') { const p = new URLSearchParams(init.body); stripe.push(p); return Response.json({ id: 'cus_merch1' }); }
    if (u === 'https://api.stripe.com/v1/checkout/sessions') {
      const p = new URLSearchParams(init.body); stripe.push(p);
      let sub = 0; for (let i = 0; p.get(`line_items[${i}][quantity]`); i++) sub += Number(p.get(`line_items[${i}][quantity]`)) * Number(p.get(`line_items[${i}][price_data][unit_amount]`));
      const ship = Number(p.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'));
      const tax = Math.round((sub + ship) * 0.08625);
      return Response.json({ id: 'cs_test_merch1', url: 'https://checkout.stripe.com/c/pay/cs_test_merch1', amount_subtotal: sub, total_details: { amount_shipping: ship, amount_tax: tax }, amount_total: sub + ship + tax, automatic_tax: { enabled: p.get('automatic_tax[enabled]') === 'true' } });
    }
    throw new Error(`Unexpected fetch ${u}`);
  };
  const env = { DB, ASSETS, MERCH, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_SECRET_KEY_TEST: 'sk_test_x', PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  return { env, DB, ASSETS, emails, stripe, merchCalls, fetch, ctx, pending, row };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = async (f, path, init) => { const r = await api.default.fetch(new Request(`https://menu-made.com${path}`, init), f.env, f.ctx); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (f, path, body) => call(f, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map((m) => m[0].replaceAll('&amp;', '&'));
const ADDRESS = { name: 'Proof Cafe', address1: '1 Main St', city: 'Oakland', state_code: 'CA', country_code: 'US', zip: '94612' };

async function buy(f, { logo, logoItems = [], items = [{ product_id: '101', variant_id: '501', quantity: 8 }, { product_id: '101', variant_id: '502', quantity: 4 }] }) {
  let logoId = null;
  if (logo) {
    const form = new FormData(); form.append('logo', new File([PNG], 'logo.png', { type: 'image/png' }));
    const up = await call(f, '/api/merch/logo', { method: 'POST', body: form });
    assert.equal(up.status, 200); logoId = up.body.logo_id;
  }
  const quote = await post(f, '/api/merch/quote', { environment: 'sandbox', logo_id: logoId, recipient: ADDRESS, items, logo_items: logoItems });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.pricing.discount_percent, 10);
  assert.equal(quote.body.lines[0].fingerprint, undefined, 'internal fields stay server-side');
  const checkout = await post(f, '/api/merch/checkout', { quote_id: quote.body.quote_id, rate_id: 'STANDARD', customer: { name: 'Ana', email: 'ana@proof.example', business: 'Proof Cafe' } });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  const order = f.row(`SELECT * FROM orders WHERE id = ?`, checkout.body.order_id);
  assert.equal(order.total_cents, quote.body.pricing.subtotal_cents + 1299);
  assert.equal((await post(f, '/api/merch/checkout', { quote_id: quote.body.quote_id, rate_id: 'STANDARD', customer: { email: 'x@y.co', business: 'X' } })).status, 409, 'a quote is used once');
  const tax = Math.round(order.total_cents * 0.08625);
  await handleCheckoutCompleted({ id: 'evt_1', data: { object: { id: 'cs_test_merch1', metadata: { order_id: order.id }, payment_intent: 'pi_1', amount_total: order.total_cents + tax, currency: 'usd' } } }, f.env);
  await api.runScheduledProduction(f.env); await Promise.all(f.pending);
  return order.id;
}

test('logo order: quote, checkout, paid, proof waits for the owner, approval places a Printful draft (test order) and emails the buyer', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const orderId = await buy(f, { logo: true });
    const customer = f.stripe.find((p) => p.get('shipping[address][postal_code]'));
    assert.equal(customer.get('shipping[address][state]'), 'CA', 'Stripe Tax gets the delivery address');
    const session = f.stripe.find((p) => p.get('mode'));
    assert.equal(session.get('line_items[0][price_data][unit_amount]'), String(Math.round(3100 * 0.9)));
    assert.equal(session.get('automatic_tax[enabled]'), 'true');
    assert.equal(session.get('line_items[0][price_data][product_data][tax_code]'), 'txcd_30011000');
    assert.equal(session.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
    assert.equal(session.get('customer'), 'cus_merch1');
    const paid = f.row(`SELECT subtotal_cents, tax_cents, total_cents FROM orders WHERE id = ?`, orderId);
    assert.ok(paid.tax_cents > 0); assert.equal(paid.total_cents, paid.subtotal_cents + paid.tax_cents);
    assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');
    assert.ok(!f.merchCalls.some(([m]) => m === 'placeOrder'), 'nothing ordered before approval');
    const owner = f.emails.find((e) => /logo proof/.test(e.subject));
    assert.ok(owner);
    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    const form = new FormData(); form.append('t', new URL(approveUrl).searchParams.get('t'));
    const res = await api.default.fetch(new Request(approveUrl.split('?')[0], { method: 'POST', body: form }), f.env, f.ctx);
    assert.equal(res.status, 200);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    const placed = f.merchCalls.find(([m]) => m === 'placeOrder')[1];
    assert.equal(placed.confirm, false, 'test orders are Printful drafts only');
    assert.equal(placed.external_id, externalIdFor(orderId));
    assert.match(placed.logo_url, /^https:\/\/menu-made\.com\/api\/merch-logo\//);
    assert.equal(placed.lines[0].retail_cents, Math.round(3100 * 0.9));
    assert.equal(placed.max_cost_cents, f.row(`SELECT subtotal_cents FROM orders`).subtotal_cents, 'Printful is capped at shirts + delivery, never the tax');
    const logo = await api.default.fetch(new Request(placed.logo_url), f.env, f.ctx);
    assert.equal(logo.status, 200, 'Printful can download the logo');
    assert.equal(f.row(`SELECT status FROM projects`).status, 'DELIVERED');
    assert.ok(f.emails.some((e) => /being made/.test(e.subject)));
  });
});

test('logo-first order: mug and embroidered cap with set-up, per-item tax codes, logo size sent to Printful', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const products = await call(f, '/api/merch/products');
    assert.equal(products.status, 200); assert.equal(products.body.products[0].key, 'mug');
    const tiny = new FormData(); tiny.append('logo', new File([TINY_PNG], 'logo.png', { type: 'image/png' }));
    assert.equal((await call(f, '/api/merch/logo', { method: 'POST', body: tiny })).status, 400, 'too small to print');
    const orderId = await buy(f, { logo: true, items: [{ product_id: '101', variant_id: '501', quantity: 10 }], logoItems: [{ key: 'mug', variant_id: 1320, quantity: 1 }, { key: 'cap', variant_id: 7854, quantity: 1 }] });
    const quoteArgs = f.merchCalls.find(([m]) => m === 'quote')[1];
    assert.deepEqual([quoteArgs.logo.width, quoteArgs.logo.height], [600, 400]);
    assert.match(quoteArgs.logo.url, /^https:\/\/menu-made\.com\/api\/merch-upload\//);
    assert.equal((await api.default.fetch(new Request(quoteArgs.logo.url), f.env, f.ctx)).status, 200, 'Printful can read the logo at quote time');
    assert.equal((await api.default.fetch(new Request(quoteArgs.logo.url.split('?')[0] + '?t=bad'), f.env, f.ctx)).status, 404);
    const session = f.stripe.find((p) => p.get('mode'));
    const names = []; for (let i = 0; session.get(`line_items[${i}][quantity]`); i++) names.push([session.get(`line_items[${i}][price_data][product_data][name]`), session.get(`line_items[${i}][price_data][product_data][tax_code]`), session.get(`line_items[${i}][price_data][unit_amount]`)]);
    assert.equal(names.length, 4);
    assert.match(names[1][0], /^Mug with your logo/); assert.equal(names[1][1], 'txcd_99999999'); assert.equal(names[1][2], String(Math.round(2499 * 0.9)));
    assert.match(names[2][0], /^Cap \(embroidered\) with your logo/); assert.equal(names[2][1], 'txcd_30011000');
    assert.deepEqual(names[3], ['Embroidery set-up (one-time)', 'txcd_99999999', '1300']);
    const proof = [...f.ASSETS.objects.entries()].find(([k]) => k.includes('merch-proof'))[1];
    assert.match(new TextDecoder().decode(proof.data), /Mug <small>White/);
    const owner = f.emails.find((e) => /logo proof/.test(e.subject));
    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    const form = new FormData(); form.append('t', new URL(approveUrl).searchParams.get('t'));
    assert.equal((await api.default.fetch(new Request(approveUrl.split('?')[0], { method: 'POST', body: form }), f.env, f.ctx)).status, 200);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    const placed = f.merchCalls.find(([m]) => m === 'placeOrder')[1];
    assert.deepEqual(placed.logo_lines.map((l) => [l.key, l.quantity, l.retail_cents]), [['mug', 1, Math.round(2499 * 0.9)], ['cap', 1, Math.round(3099 * 0.9)]]);
    assert.deepEqual([placed.logo.width, placed.logo.height], [600, 400]);
    assert.match(placed.logo.url, /\/api\/merch-logo\//);
    assert.equal(f.row(`SELECT status FROM projects WHERE order_id = ?`, orderId).status, 'DELIVERED');
  });
});

test('no-logo order goes straight to Printful; tracking is emailed once when it ships (live orders)', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await buy(f, { logo: false });
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM approvals`).n, 0);
    assert.ok(f.merchCalls.some(([m]) => m === 'placeOrder'));
    assert.equal(f.row(`SELECT status FROM projects`).status, 'DELIVERED');
    f.DB.raw.exec(`UPDATE projects SET metadata_json = json_set(metadata_json, '$.merch.environment', 'live')`);
    const hour = new Date(); hour.setUTCMinutes(1);
    assert.equal((await emailMerchTracking(f.env, hour)).sent, 1);
    assert.equal((await emailMerchTracking(f.env, hour)).sent, 0);
    assert.ok(f.emails.some((e) => /on the way/.test(e.subject) && e.text.includes('https://track.example/9400')));
  });
});

test('quote refuses an unknown logo; checkout refuses an expired quote', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    assert.equal((await post(f, '/api/merch/quote', { logo_id: 'abc.png', items: [], recipient: ADDRESS })).status, 400);
    const q = await post(f, '/api/merch/quote', { environment: 'sandbox', recipient: ADDRESS, items: [{ product_id: '101', variant_id: '501', quantity: 1 }] });
    f.DB.raw.exec(`UPDATE merch_quotes SET expires_at = '2000-01-01T00:00:00.000Z'`);
    assert.equal((await post(f, '/api/merch/checkout', { quote_id: q.body.quote_id, rate_id: 'STANDARD', customer: { email: 'a@b.co', business: 'B' } })).status, 409);
  });
});

test('Menu-made delivery emails offer staff merch and Nino design; merch and Nino deliveries do not repeat it', async () => {
  const { sendTransactionalEmail, brandedEmailHtml } = await import('./src/lib/email.js');
  const f = setup();
  await withFetch(f.fetch, async () => {
    const html = brandedEmailHtml({ heading: 'Ready', paragraphs: ['Done'] });
    await sendTransactionalEmail(f.env, { to: 'ana@proof.example', subject: 's', html, text: 'Done', idempotencyKey: 'k1', purpose: 'ORDER_DELIVERY', templateKey: 'delivery_generic_v1' });
    await sendTransactionalEmail(f.env, { to: 'ana@proof.example', subject: 's', html, text: 'Done', idempotencyKey: 'k2', purpose: 'ORDER_DELIVERY', templateKey: 'delivery_merch_v1' });
    assert.match(f.emails[0].html, /staff-merch\.html/); assert.match(f.emails[0].text, /ninobattaglia\.com/);
    assert.doesNotMatch(f.emails[1].html, /staff-merch\.html/);
  });
});

test('the runner produces a self-test buyer\'s checkout order (no source tag); only its subscription-period jobs are held', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    f.DB.raw.exec(`UPDATE offers SET is_public = 1 WHERE code = 'STAFF_MERCH'`);
    const quote = await post(f, '/api/merch/quote', { environment: 'sandbox', recipient: ADDRESS, items: [{ product_id: '101', variant_id: '501', quantity: 1 }] });
    const checkout = await post(f, '/api/merch/checkout', { quote_id: quote.body.quote_id, rate_id: 'STANDARD', customer: { email: 'delivered@resend.dev', business: 'Self-Test Cafe' } });
    await handleCheckoutCompleted({ id: 'evt_9', data: { object: { id: 'cs_test_merch1', metadata: { order_id: checkout.body.order_id }, payment_intent: 'pi_9', amount_total: 5000, currency: 'usd' } } }, f.env);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.row(`SELECT status FROM projects`).status, 'DELIVERED');
  });
});
