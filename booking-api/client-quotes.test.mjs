// Private client quote pages (owner ask, Nov 9, 2026): prices come only from the worker; the page can't change the total.
// Run: node --no-warnings --test booking-api/client-quotes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const { handleClientQuote, getQuote, selectItems, checkoutParams } = await import('./src/checkout/client-quotes.js');
const ID = 'fahys-6ei9nqt74rzw';

test('Fahy\'s quote: website renewal is required, totals follow the ticked items', () => {
  const quote = getQuote(ID);
  assert.throws(() => selectItems(quote, ['GOOGLE_VISIBILITY']), /included with every choice/);
  assert.throws(() => selectItems(quote, ['WEBSITE_CARE_2027', 'FREE_STUFF']), /isn't on this page/);
  assert.throws(() => selectItems(quote, ['WEBSITE_CARE_2027', 'WEBSITE_CARE_2027']), /only be chosen once/);
  assert.throws(() => selectItems(quote, []), /at least one/);
  const one = checkoutParams(ID, quote, selectItems(quote, ['WEBSITE_CARE_2027']));
  assert.equal(one.totalCents, 49000);
  const menu = checkoutParams(ID, quote, selectItems(quote, ['MENU_ONLINE_CARE', 'WEBSITE_CARE_2027']));
  assert.equal(menu.totalCents, 70200, 'Website + Menu matches the letter');
  const google = checkoutParams(ID, quote, selectItems(quote, ['WEBSITE_CARE_2027', 'GOOGLE_VISIBILITY']));
  assert.equal(google.totalCents, 63900, 'Website + Google matches the letter');
  assert.equal(menu.params.get('mode'), 'payment');
  assert.equal(menu.params.get('line_items[0][price_data][unit_amount]'), '49000', 'items keep the quote order');
  assert.equal(menu.params.get('line_items[1][price_data][unit_amount]'), '21200');
  assert.equal(menu.params.get('metadata[purpose]'), 'client_quote');
  assert.equal(menu.params.get('metadata[order_id]'), null, 'the order webhook passes it over');
  assert.equal(menu.params.get('success_url'), 'https://menu-made.com/q/fahys-6ei9nqt74rzw?done=1');
});

test('unknown quote ids are 404 and the checkout calls Stripe live with the server prices', async () => {
  const missing = await handleClientQuote(new Request('https://menu-made.com/api/client-quote/nope-12345678'), {}, 'nope-12345678', '');
  assert.equal(missing.status, 404);
  const listed = await (await handleClientQuote(new Request('https://menu-made.com/api/client-quote/' + ID), {}, ID, '')).json();
  assert.equal(listed.quote.items[0].code, 'WEBSITE_CARE_2027');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_live_x' }), { status: 200 }); };
  try {
    const response = await handleClientQuote(new Request('https://menu-made.com/api/client-quote/' + ID + '/checkout', {
      method: 'POST', body: JSON.stringify({ items: ['WEBSITE_CARE_2027', 'BUSINESS_CARDS'], cents: 1 })
    }), { STRIPE_SECRET_KEY: 'sk_live_x' }, ID, 'checkout');
    const body = await response.json();
    assert.equal(body.url, 'https://checkout.stripe.com/c/pay/cs_live_x');
    assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.match(calls[0].init.headers.Authorization, /sk_live_x/);
    const sent = new URLSearchParams(calls[0].init.body);
    assert.equal(sent.get('metadata[total_cents]'), '59000', 'a price sent by the page is ignored');
  } finally { globalThis.fetch = realFetch; }
});

test('the private page exists, stays out of search and fetches its prices', () => {
  const page = new URL('../q/fahys-6ei9nqt74rzw.html', import.meta.url);
  assert(existsSync(page));
  const html = readFileSync(page, 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /'\/api\/client-quote\/'/); assert.match(html, /const QUOTE = 'fahys-6ei9nqt74rzw'/);
  assert.doesNotMatch(html, /\$\d/, 'no prices typed into the page');
  assert.doesNotMatch(readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8'), /\/q\//);
});
