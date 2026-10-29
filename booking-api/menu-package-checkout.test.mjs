import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.crypto ??= webcrypto;
const api = {
  ...(await import('./src/worker.js')),
  ...(await import('./src/checkout/quote.js')),
};

const menuOffer = {
  offer_id: 'offer_online_menu_qr', offer_code: 'ONLINE_MENU_QR', offer_name: 'Online Menu + QR',
  offer_version_id: 'offerv1_online_menu_qr', price_cents: 12900, currency: 'USD',
  stripe_price_id: 'price_existing_menu', stripe_product_id: 'prod_existing_menu'
};
const conversionOffer = {
  offer_id: 'offer_conversion_fix', offer_code: 'CONVERSION_FIX', offer_name: 'Conversion Fix',
  offer_version_id: 'offerv1_conversion_fix', price_cents: 29900, currency: 'USD', stripe_price_id: 'price_existing_conversion'
};
function fixture(menuPatch = {}) {
  const writes = [];
  const menu = { ...menuOffer, ...menuPatch };
  const rows = new Map([
    ['online_menu_qr', menu], ['offer_online_menu_qr', menu], ['online-menu-qr', menu],
    ['conversion_fix', conversionOffer]
  ]);
  const env = {
    STRIPE_SECRET_KEY: 'test-live-placeholder', STRIPE_SECRET_KEY_TEST: 'test-sandbox-placeholder',
    DB: { prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() {
          if (sql.includes('FROM offers o')) return rows.get(String(args[3]).toLowerCase()) || null;
          if (sql.includes('FROM customers') || sql.includes('FROM businesses')) return null;
          throw new Error('Unexpected query: ' + sql);
        },
        async run() { writes.push({ sql, args }); return { meta: { changes: 1 } }; }
      };
    } }
  };
  return { env, writes };
}
const body = (patch = {}) => ({
  items: [{ key: 'online_menu_qr', qty: 1 }], menu_pages: 3,
  customer: { name: 'Test Buyer', business: 'Test Cafe', email: 'test@example.com' }, ...patch
});
const request = (data, sandbox = false) => new Request('https://menu-made.com/api/create-checkout' + (sandbox ? '-test' : ''), {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
});

test('quotes the complete first year with three included pages and a bounded page count', () => {
  for (const pages of [1, 2, 3]) assert.equal(api.quoteMenuPackage(pages).total_cents, 14400);
  assert.equal(api.quoteMenuPackage(4).total_cents, 16400);
  assert.equal(api.quoteMenuPackage(5).additional_pages_cents, 4000);
  assert.equal(api.quoteMenuPackage(50).total_cents, 108400);
  const quote = api.quoteMenuPackage(3);
  assert.equal(quote.included_revisions, 2);
  assert.equal(quote.hosting_renewal_cents, 1500);
  assert.equal(quote.hosting_renewal_automatic, false);
  for (const pages of [undefined, null, '3', 0, -1, 51, 3.5, NaN, Infinity, true, {}, []]) {
    assert.throws(() => api.quoteMenuPackage(pages), /page count/);
  }
});

test('public quote endpoint previews the exact checkout price without storage, Stripe, or secrets', async () => {
  for (const [pages, total] of [['1', 14400], ['3', 14400], ['4', 16400], ['5', 18400], ['50', 108400]]) {
    const response = await api.default.fetch(new Request('https://menu-made.com/api/menu-package-quote?pages=' + pages), {}, {});
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.quote.menu_pages, Number(pages));
    assert.equal(result.quote.total_cents, total);
    assert.equal(result.quote.hosting_renewal_automatic, false);
  }
  for (const query of ['', '?pages=', '?pages=0', '?pages=51', '?pages=-1', '?pages=3.5', '?pages=no', '?pages=Infinity']) {
    const response = await api.default.fetch(new Request('https://menu-made.com/api/menu-package-quote' + query), {}, {});
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
  }
});

test('resolves the real catalog offer and ignores client price, currency, and quote fields', async () => {
  const f = fixture();
  const [item] = await api.normalizeCheckoutItems([
    { key: 'online_menu_qr', qty: 1, priceCents: 1, currency: 'EUR', menuPackage: { total_cents: 1 } }
  ], f.env, { menu_pages: 5, total_cents: 1, hosting_first_year_cents: 0 });
  assert.equal(item.priceCents, 18400);
  assert.equal(item.currency, 'USD');
  assert.equal(item.offerId, 'offer_online_menu_qr');
  assert.equal(item.quantity, 1);
  assert.equal(item.menuPackage.menu_pages, 5);
  assert.equal(f.writes.length, 0);
});

test('rejects duplicate menu aliases and quantities that could create ambiguous fulfillment', async () => {
  const f = fixture();
  for (const qty of [0, -1, 2, 1.2, '1', null]) {
    await assert.rejects(api.normalizeCheckoutItems([{ key: 'online_menu_qr', qty }], f.env, { menu_pages: 3 }), /One menu package/);
  }
  await assert.rejects(api.normalizeCheckoutItems([
    { key: 'online_menu_qr', qty: 1 }, { offer_id: 'offer_online_menu_qr', qty: 1 }
  ], f.env, { menu_pages: 3 }), /One menu package/);
  await assert.rejects(api.normalizeCheckoutItems([{ key: 'conversion_fix', qty: 1 }], f.env, { menu_pages: 3 }), /requires an Online Menu/);
  assert.equal(f.writes.length, 0);
});

test('fails closed if the active catalog no longer matches the advertised menu setup price', async () => {
  for (const patch of [{ price_cents: 15900 }, { currency: 'EUR' }]) {
    const f = fixture(patch);
    await assert.rejects(api.normalizeCheckoutItems([{ key: 'online_menu_qr' }], f.env, { menu_pages: 3 }), /pricing is being updated/);
    assert.equal(f.writes.length, 0);
  }
});

test('live and sandbox checkout charge the persisted quote once and retain one menu order item', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const sandbox of [false, true]) {
      const f = fixture();
      let stripeParams;
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
        stripeParams = new URLSearchParams(options.body);
        return Response.json({ id: 'cs_test_quote', url: 'https://checkout.stripe.com/test_quote' });
      };
      const response = await api.default.fetch(request(body({ menu_pages: 5 }), sandbox), f.env, {});
      assert.equal(response.status, 200);
      assert.equal((await response.json()).url, 'https://checkout.stripe.com/test_quote');
      assert.equal(stripeParams.get('mode'), 'payment');
      assert.equal(stripeParams.get('line_items[0][price_data][unit_amount]'), '18400');
      assert.equal(stripeParams.get('line_items[0][price_data][currency]'), 'usd');
      assert.equal(stripeParams.get('line_items[0][quantity]'), '1');
      assert.match(stripeParams.get('line_items[0][price_data][product_data][name]'), /5 menu pages \+ first-year hosting/);
      assert.match(stripeParams.get('line_items[0][price_data][product_data][description]'), /hosting continues with Menu Care/);
      assert.equal(stripeParams.has('line_items[0][price]'), false);
      assert.equal([...stripeParams.keys()].some(key => key.includes('recurring')), false);
      const orders = f.writes.filter(write => write.sql.includes('INSERT INTO orders'));
      assert.equal(orders.length, 1);
      assert.equal(orders[0].args[6], 18400);
      assert.equal(orders[0].args[7], 18400);
      const items = f.writes.filter(write => write.sql.includes('INSERT INTO order_items'));
      assert.equal(items.length, 1);
      assert.equal(items[0].args[2], 'offer_online_menu_qr');
      assert.equal(items[0].args[4], 1);
      assert.equal(items[0].args[5], 18400);
      assert.equal(items[0].args[6], 18400);
      const metadata = JSON.parse(items[0].args[7]);
      assert.equal(metadata.environment, sandbox ? 'sandbox' : 'live');
      assert.equal(metadata.menu_package.menu_pages, 5);
      assert.equal(metadata.menu_package.hosting_first_year_cents, 1500);
      assert.equal(metadata.menu_package.additional_pages, 2);
      assert.equal(f.writes.some(write => write.sql.includes('INSERT INTO projects')), false);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('other services retain their existing live Stripe price and can accompany one menu', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const f = fixture();
    let stripeParams;
    globalThis.fetch = async (_url, options) => {
      stripeParams = new URLSearchParams(options.body);
      return Response.json({ id: 'cs_test_mixed', url: 'https://checkout.stripe.com/test_mixed' });
    };
    const response = await api.default.fetch(request(body({ items: [{ key: 'online_menu_qr', qty: 1 }, { key: 'conversion_fix', qty: 1 }] })), f.env, {});
    assert.equal(response.status, 200);
    assert.equal(stripeParams.get('line_items[0][price_data][unit_amount]'), '14400');
    assert.equal(stripeParams.get('line_items[1][price]'), 'price_existing_conversion');
    assert.equal(stripeParams.has('line_items[1][price_data][unit_amount]'), false);
    assert.equal(f.writes.find(write => write.sql.includes('INSERT INTO orders')).args[7], 44300);
    const normalized = await api.normalizeCheckoutItems([{ key: 'conversion_fix', qty: 1 }], f.env, {});
    assert.equal(normalized[0].priceCents, 29900);
    assert.equal(normalized[0].menuPackage, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid menu quotes return a useful 400 without creating an order or contacting Stripe', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('Unexpected Stripe request'); };
  try {
    for (const sandbox of [false, true]) {
      for (const patch of [{ menu_pages: undefined }, { menu_pages: '5' }, { menu_pages: 0 }, { menu_pages: 51 }, { items: [{ key: 'online_menu_qr', qty: 2 }] }]) {
        const f = fixture();
        const response = await api.default.fetch(request(body(patch), sandbox), f.env, {});
        assert.equal(response.status, 400);
        assert.equal((await response.json()).ok, false);
        assert.equal(f.writes.length, 0);
      }
    }
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('Stripe rejection marks the quoted pending order failed and does not begin fulfillment', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: 'Test rejection' } }, { status: 400 });
  try {
    const response = await api.default.fetch(request(body()), f.env, {});
    assert.equal(response.status, 400);
    assert.ok(f.writes.some(write => write.sql.includes("status = 'FAILED'")));
    assert.equal(f.writes.some(write => write.sql.includes('INSERT INTO projects')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('unsigned checkout-completed webhooks cannot mark any order paid', async () => {
  const f = fixture();
  f.env.STRIPE_WEBHOOK_SECRET = 'test-webhook-placeholder';
  const req = new Request('https://menu-made.com/api/stripe-webhook', {
    method: 'POST', body: JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed', data: { object: { metadata: { order_id: 'forged' } } } })
  });
  const response = await api.default.fetch(req, f.env, {});
  assert.equal(response.status, 400);
  assert.equal(f.writes.length, 0);
});
