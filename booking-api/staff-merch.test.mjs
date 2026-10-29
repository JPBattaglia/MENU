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
const { emailMerchTracking, externalIdFor } = await import('./src/producers/staff-merch/order.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]);

test('pricing: shop price, +$5 with a logo, 10% from 12 shirts and 15% from 24', () => {
  const lines = (n) => [{ unit_price_cents: 2600, quantity: n }];
  assert.equal(priceMerch(lines(11)).subtotal_cents, 11 * 2600);
  const twelve = priceMerch(lines(12), { logo: true });
  assert.equal(twelve.discount_percent, 10);
  assert.equal(twelve.lines[0].unit_cents, Math.round(3100 * 0.9));
  assert.equal(twelve.discount_cents, 12 * 3100 - twelve.subtotal_cents);
  assert.equal(priceMerch([{ unit_price_cents: 2600, quantity: 20 }, { unit_price_cents: 2600, quantity: 4 }]).discount_percent, 15);
});

function setup() {
  const DB = createD1(); const ASSETS = createR2();
  ASSETS.head = async (key) => (ASSETS.objects.has(key) ? {} : null);
  DB.raw.exec(read('0019_stage10_nino_link.sql'));
  const emails = []; const stripe = []; const merchCalls = [];
  const MERCH = {
    async quote(args) { merchCalls.push(['quote', args]); return { ok: true, recipient: args.recipient, lines: args.items.map((i) => ({ ...i, title: 'Skull Wave', color: 'Black', size: i.variant_id === '501' ? 'M' : 'L', image: 'https://nino.example/m.jpg', unit_price_cents: 2600, catalog_variant_id: 4011, fingerprint: 'fp' })), rates: [{ id: 'STANDARD', name: 'Flat Rate', amount_cents: 1299, currency: 'usd' }] }; },
    async placeOrder(args) { merchCalls.push(['placeOrder', args]); return { ok: true, printful_order_id: '777', status: args.confirm ? 'pending' : 'draft', cost_cents: 20000 }; },
    async orderStatus(args) { merchCalls.push(['orderStatus', args]); return { ok: true, found: true, status: 'fulfilled', shipments: [{ carrier: 'USPS', tracking_number: '9400', tracking_url: 'https://track.example/9400' }] }; }
  };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (u === 'https://api.stripe.com/v1/checkout/sessions') {
      const p = new URLSearchParams(init.body); stripe.push(p);
      let total = 0; for (let i = 0; p.get(`line_items[${i}][quantity]`); i++) total += Number(p.get(`line_items[${i}][quantity]`)) * Number(p.get(`line_items[${i}][price_data][unit_amount]`));
      total += Number(p.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'));
      return Response.json({ id: 'cs_test_merch1', url: 'https://checkout.stripe.com/c/pay/cs_test_merch1', amount_total: total });
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

async function buy(f, { logo }) {
  let logoId = null;
  if (logo) {
    const form = new FormData(); form.append('logo', new File([PNG], 'logo.png', { type: 'image/png' }));
    const up = await call(f, '/api/merch/logo', { method: 'POST', body: form });
    assert.equal(up.status, 200); logoId = up.body.logo_id;
  }
  const quote = await post(f, '/api/merch/quote', { environment: 'sandbox', logo_id: logoId, recipient: ADDRESS, items: [{ product_id: '101', variant_id: '501', quantity: 8 }, { product_id: '101', variant_id: '502', quantity: 4 }] });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.pricing.discount_percent, 10);
  assert.equal(quote.body.lines[0].fingerprint, undefined, 'internal fields stay server-side');
  const checkout = await post(f, '/api/merch/checkout', { quote_id: quote.body.quote_id, rate_id: 'STANDARD', customer: { name: 'Ana', email: 'ana@proof.example', business: 'Proof Cafe' } });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  const order = f.row(`SELECT * FROM orders WHERE id = ?`, checkout.body.order_id);
  assert.equal(order.total_cents, quote.body.pricing.subtotal_cents + 1299);
  assert.equal((await post(f, '/api/merch/checkout', { quote_id: quote.body.quote_id, rate_id: 'STANDARD', customer: { email: 'x@y.co', business: 'X' } })).status, 409, 'a quote is used once');
  await handleCheckoutCompleted({ id: 'evt_1', data: { object: { id: 'cs_test_merch1', metadata: { order_id: order.id }, payment_intent: 'pi_1', amount_total: order.total_cents, currency: 'usd' } } }, f.env);
  await api.runScheduledProduction(f.env); await Promise.all(f.pending);
  return order.id;
}

test('logo order: quote, checkout, paid, proof waits for the owner, approval places a Printful draft (test order) and emails the buyer', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const orderId = await buy(f, { logo: true });
    assert.equal(f.stripe[0].get('line_items[0][price_data][unit_amount]'), String(Math.round(3100 * 0.9)));
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
    const logo = await api.default.fetch(new Request(placed.logo_url), f.env, f.ctx);
    assert.equal(logo.status, 200, 'Printful can download the logo');
    assert.equal(f.row(`SELECT status FROM projects`).status, 'DELIVERED');
    assert.ok(f.emails.some((e) => /being printed/.test(e.subject)));
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
