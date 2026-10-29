// Start page (contact.html + start.js): one plan or bundle plus one-time services, priced from the catalog.
// Runs start.js in a small fake DOM with a stubbed site catalog. Run: node --no-warnings --test menu-order.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const script = await readFile(new URL('./start.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('./contact.html', import.meta.url), 'utf8');

const OFFERS = [
  { code: 'BUNDLE_STARTER', name: 'Starter Plan', kind: 'BUNDLE', on_sale: true, prices: { month: 7900, year: 79000 }, includes: ['MENU_CARE', 'REVIEW_REPLIES', 'ACCESSIBILITY_MONITORING'], requires_setup: null },
  { code: 'BUNDLE_GROWTH', name: 'Growth Plan', kind: 'BUNDLE', on_sale: true, prices: { month: 17900, year: 179000 }, includes: ['MENU_CARE', 'REVIEW_REPLIES', 'ACCESSIBILITY_MONITORING', 'GOOGLE_PROFILE_CARE'], requires_setup: null },
  { code: 'BUNDLE_PRO', name: 'Pro Plan', kind: 'BUNDLE', on_sale: false, prices: { month: 29900, year: 299000 }, includes: ['MENU_CARE', 'REVIEW_REPLIES', 'ACCESSIBILITY_MONITORING', 'GOOGLE_PROFILE_CARE', 'SOCIAL_POSTS', 'WEBSITE_CARE'], requires_setup: null },
  { code: 'MENU_CARE', name: 'Menu Care', kind: 'PLAN', on_sale: true, prices: { month: 2900, year: 29000 }, includes: ['MENU_CARE'], requires_setup: null },
  { code: 'REVIEW_REPLIES', name: 'Review Replies', kind: 'PLAN', on_sale: true, prices: { month: 4900, year: 49000 }, includes: ['REVIEW_REPLIES'], requires_setup: null },
  { code: 'GOOGLE_PROFILE_CARE', name: 'Google Profile Care', kind: 'PLAN', on_sale: true, prices: { month: 14900, year: 149000 }, includes: ['GOOGLE_PROFILE_CARE'], requires_setup: null },
  { code: 'SOCIAL_POSTS', name: 'Social Posts', kind: 'PLAN', on_sale: true, prices: { month: 12900, year: 129000 }, includes: ['SOCIAL_POSTS'], requires_setup: null },
  { code: 'WEBSITE_CARE', name: 'Website Care', kind: 'PLAN', on_sale: true, prices: { month: 4900, year: 49000 }, includes: ['WEBSITE_CARE'], requires_setup: null },
  { code: 'ACCESSIBILITY_MONITORING', name: 'Accessibility Monitoring', kind: 'PLAN', on_sale: true, prices: { month: 3900, year: 39000 }, includes: ['ACCESSIBILITY_MONITORING'], requires_setup: null },
  { code: 'GUEST_APP', name: 'Guest App', kind: 'PLAN', on_sale: true, prices: { month: 2900, year: 29000 }, includes: ['GUEST_APP'], requires_setup: 'GUEST_APP_SETUP' },
  { code: 'GUEST_APP_SETUP', name: 'Guest App Setup', kind: 'ONE_TIME', on_sale: true, price_cents: 29900 },
  { code: 'ONLINE_MENU_QR', name: 'Online Menu + QR', kind: 'ONE_TIME', on_sale: true, price_cents: 12900, menu_package: { setup_cents: 12900, hosting_first_year_cents: 1500, included_pages: 3, additional_page_cents: 2000, max_pages: 50 } },
  { code: 'WEBSITE_PACKAGE', name: 'Website Package', kind: 'ONE_TIME', on_sale: true, price_cents: 49900 },
  { code: 'GOOGLE_VISIBILITY', name: 'Google Visibility', kind: 'ONE_TIME', on_sale: true, price_cents: 14900 },
  { code: 'CONVERSION_FIX', name: 'Conversion Fix', kind: 'ONE_TIME', on_sale: true, price_cents: 29900 }
];

function element() {
  const classes = new Set(), listeners = new Map();
  return {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, checked: false, dataset: {}, files: [], children: [], attrs: {},
    classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n), toggle(n, on = !classes.has(n)) { on ? classes.add(n) : classes.delete(n); } },
    setAttribute(n, v) { this.attrs[n] = v; }, getAttribute(n) { return this.attrs[n] ?? null; },
    addEventListener(n, fn) { if (!listeners.has(n)) listeners.set(n, []); listeners.get(n).push(fn); },
    async fire(n, event = {}) { for (const fn of listeners.get(n) || []) await fn({ preventDefault() {}, target: this, ...event }); },
    append(...kids) { this.children.push(...kids); }, appendChild(kid) { this.children.push(kid); },
    focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; }
  };
}

async function page(route = '', { catalogFails = false } = {}) {
  const els = new Map(), get = id => { if (!els.has(id)) els.set(id, { ...element(), id }); return els.get(id); };
  get('menuPages').value = '3'; get('optionalServices').open = false;
  const cards = new Map();
  for (const m of markup.matchAll(/<article class="service-card mm-choice" ([^>]*)>/g)) {
    const card = element();
    for (const a of m[1].matchAll(/data-([\w-]+)="([^"]*)"/g)) card.dataset[a[1]] = a[2];
    cards.set(card.dataset.code, card);
  }
  const buttons = new Map([...cards].map(([code, card]) => [code, { ...element(), dataset: { selectLabel: 'Add' }, closest: () => card }]));
  const sent = [], documents = [], tracking = [], cartSection = element();
  let failing = false;
  const [query = '', hash = ''] = route.split('#');
  const location = { search: query, hash: hash ? '#' + hash : '', href: 'https://menu-made.com/contact.html' + route, hostname: 'menu-made.com' };
  let interval = 'month'; const renders = [];
  const offers = new Map(OFFERS.map(o => [o.code, o]));
  const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 });
  const Catalog = {
    API: '', ready: catalogFails ? Promise.reject(new Error('down')) : Promise.resolve(offers),
    get interval() { return interval; },
    setInterval(v) { interval = v === 'year' ? 'year' : 'month'; renders.forEach(fn => fn()); },
    priceOf: (o, i) => o ? (o.prices ? o.prices[i] : o.price_cents) : null,
    label: (o, i) => o ? money(o.prices ? o.prices[i] : o.price_cents) + (o.prices ? (i === 'year' ? '/yr' : '/mo') : '') : '',
    onRender(fn) { renders.push(fn); }
  };
  Catalog.ready.catch(() => {});
  const context = {
    location, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, Map, Set, Promise, crypto: webcrypto,
    window: { location, matchMedia: () => ({ matches: true }), MenuMadeCatalog: Catalog,
      MenuMadeFunnel: { track: (...a) => tracking.push(a), tracking: () => ({ session_id: 'test-session' }) },
      MenuMadeDocuments: { validate() {}, fingerprint: async () => 'fingerprint', send: async (payload, file) => { documents.push({ payload, file }); } } },
    document: {
      getElementById: get, createElement: element, addEventListener() {}, body: { prepend() {} },
      querySelectorAll(sel) {
        if (sel === '.js-add') return [...buttons.values()];
        if (sel === '[data-choose-services]') return [];
        if (sel.includes('#cartItems button')) return [...buttons.values(), ...['clearBtn', 'continueBtn', 'backBtn', 'menuPages', 'lead_document', 'scopeConfirm'].map(get)];
        return [];
      },
      querySelector(sel) { return sel === '.cart' ? cartSection : cards.get(/data-code="([^"]+)"/.exec(sel)?.[1]) || null; }
    },
    fetch: async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: !failing, json: async () => failing ? { error: 'Retry checkout' } : { url: 'https://checkout.stripe.com/test' } }; }
  };
  vm.runInNewContext(script, context);
  await new Promise(r => setTimeout(r, 0));
  const state = () => JSON.parse(vm.runInNewContext('JSON.stringify({ plan: order.plan, once: [...order.once] })', context));
  const fill = () => { for (const [id, v] of Object.entries({ lead_name: 'Test Buyer', lead_business: 'Test Cafe', lead_email: 'test@example.com', conversionUrl: 'https://example.com', conversionGoal: 'More reservations', googleMode: 'existing' })) get(id).value = v; get('scopeConfirm').checked = true; };
  return { get, state, fill, sent, documents, tracking, buttons, cards, setInterval: Catalog.setInterval, fail() { failing = true; }, recover() { failing = false; } };
}

test('an empty Start page charges nothing and sends nothing', async () => {
  const p = await page();
  assert.deepEqual(p.state(), { plan: null, once: [] });
  assert.equal(p.get('orderTotalRow').hidden, true);
  assert.equal(p.get('checkoutBtn').disabled, true);
  await p.get('checkoutBtn').fire('click');
  assert.equal(p.sent.length, 0);
});

test('every card on the page is a catalog offer, and no price is typed into the markup', () => {
  const codes = new Set(OFFERS.map(o => o.code));
  for (const m of markup.matchAll(/data-code="([A-Z_]+)"/g)) assert(codes.has(m[1]), m[1]);
  const visible = markup.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(visible, /\$\d/, 'prices come from the catalog');
});

test('a plan link selects that plan with its interval and shows today and the renewal', async () => {
  const p = await page('?plan=BUNDLE_GROWTH&interval=year');
  assert.deepEqual(p.state(), { plan: 'BUNDLE_GROWTH', once: [] });
  assert.equal(p.get('cartTotal').textContent, '$1,790.00');
  assert.equal(p.get('recurringRow').hidden, false);
  assert.match(p.get('recurringTotal').textContent, /\$1,790\/yr, renews yearly/);
  assert.equal(p.get('intakeStep').classList.contains('show'), true);
  p.setInterval('month');
  assert.equal(p.get('cartTotal').textContent, '$179.00');
});

test('one plan per order: choosing another plan replaces it and says so', async () => {
  const p = await page('?plan=BUNDLE_STARTER');
  await p.buttons.get('MENU_CARE').fire('click');
  assert.deepEqual(p.state(), { plan: 'MENU_CARE', once: [] });
  assert.match(p.get('status').textContent, /one plan at a time/);
});

test('Guest App brings its setup, and removing the plan removes the setup', async () => {
  const p = await page();
  await p.buttons.get('GUEST_APP').fire('click');
  assert.deepEqual(p.state(), { plan: 'GUEST_APP', once: ['GUEST_APP_SETUP'] });
  assert.equal(p.get('cartTotal').textContent, '$328.00');
  await p.get('cartItems').fire('click', { target: { dataset: { remove: 'GUEST_APP' } } });
  assert.deepEqual(p.state(), { plan: null, once: [] });
});

test('Website Package alone starts Website Care on a trial; with a plan lacking Website Care it is refused', async () => {
  const p = await page('?service=website');
  assert.equal(p.get('cartTotal').textContent, '$499.00');
  assert.match(p.get('recurringTotal').textContent, /Website Care free for 3 months, then \$49\/mo/);
  await p.buttons.get('BUNDLE_STARTER').fire('click');
  assert.equal(p.get('orderProblem').hidden, false);
  assert.equal(p.get('checkoutBtn').disabled, true);
  const q = await page('?plan=WEBSITE_CARE');
  await q.buttons.get('WEBSITE_PACKAGE').fire('click');
  assert.deepEqual(q.state(), { plan: null, once: ['WEBSITE_PACKAGE'] });
  await q.buttons.get('WEBSITE_CARE').fire('click');
  assert.deepEqual(q.state(), { plan: null, once: ['WEBSITE_PACKAGE'] });
});

test('an offer that is not on sale cannot be bought live, but can in test mode', async () => {
  const p = await page('?plan=BUNDLE_PRO');
  assert.deepEqual(p.state(), { plan: null, once: [] });
  assert.equal(p.buttons.get('BUNDLE_PRO').textContent, 'Opening soon');
  assert.equal(p.buttons.get('BUNDLE_PRO').disabled, true);
  const t = await page('?plan=BUNDLE_PRO&checkout=test');
  assert.deepEqual(t.state(), { plan: 'BUNDLE_PRO', once: [] });
  t.fill();
  await t.get('checkoutBtn').fire('click');
  assert.equal(t.sent[0].url, '/api/create-checkout-test');
});

test('menu page count is priced from the catalog package and invalid counts block checkout', async () => {
  const p = await page('?service=menu');
  for (const [pages, total] of [['1', '$144.00'], ['3', '$144.00'], ['4', '$164.00'], ['50', '$1,084.00']]) {
    p.get('menuPages').value = pages; await p.get('menuPages').fire('input');
    assert.equal(p.get('cartTotal').textContent, total);
  }
  for (const value of ['', '0', '51', '2.5']) {
    p.get('menuPages').value = value; await p.get('menuPages').fire('input');
    assert.equal(p.get('checkoutBtn').disabled, true);
  }
});

test('checkout sends the plan with its interval, one-time items, and the short briefs', async () => {
  const p = await page('?plan=BUNDLE_STARTER&interval=year');
  await p.buttons.get('CONVERSION_FIX').fire('click');
  await p.buttons.get('GOOGLE_VISIBILITY').fire('click');
  p.fill();
  await p.get('checkoutBtn').fire('click');
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0].url, '/api/create-checkout');
  assert.deepEqual(p.sent[0].body.items, [{ key: 'BUNDLE_STARTER', qty: 1, interval: 'year' }, { key: 'CONVERSION_FIX', qty: 1 }, { key: 'GOOGLE_VISIBILITY', qty: 1 }]);
  assert.equal(p.sent[0].body.interval, 'year');
  assert.match(p.sent[0].body.customer.notes, /^Website fix: https:\/\/example.com\/\nGoal: More reservations\nGoogle: existing profile/);
});

test('briefs are validated before payment', async () => {
  const p = await page('?service=conversion');
  p.fill();
  for (const url of ['', 'javascript:alert(1)', 'https://user:password@example.com']) {
    p.get('conversionUrl').value = url;
    await p.get('checkoutBtn').fire('click');
    assert.equal(p.sent.length, 0);
  }
  const g = await page('?service=google');
  g.fill(); g.get('googleMode').value = '';
  await g.get('checkoutBtn').fire('click');
  assert.equal(g.sent.length, 0);
});

test('old service links still work', async () => {
  for (const [service, code] of [['menu', 'ONLINE_MENU_QR'], ['conversion', 'CONVERSION_FIX'], ['google', 'GOOGLE_VISIBILITY'], ['accessibility', 'ACCESSIBILITY_MONITORING'], ['app', 'GUEST_APP'], ['__proto__', null]]) {
    const p = await page('?service=' + service);
    const s = p.state();
    assert.equal(s.plan === code || s.once.includes(code) || (code === null && !s.plan && !s.once.length), true, service);
  }
});

test('a menu upload is sent once even when checkout is retried', async () => {
  const p = await page('?service=menu');
  p.fill(); p.fail();
  p.get('lead_document').files = [{ name: 'menu.pdf' }];
  await p.get('checkoutBtn').fire('click');
  p.recover();
  await p.get('checkoutBtn').fire('click');
  assert.equal(p.documents.length, 1);
  assert.equal(p.sent[1].body.menu_pages, 3);
  assert.match(p.sent[1].body.customer.notes, /^Menu: 3 pages;/);
  assert.match(p.sent[1].body.customer.notes, /Document ref:/);
});

test('if prices cannot load, nothing can be bought and the buyer is told', async () => {
  const p = await page('?plan=BUNDLE_STARTER', { catalogFails: true });
  assert.deepEqual(p.state(), { plan: null, once: [] });
  assert.match(p.get('status').textContent, /Prices could not be loaded/);
  assert.equal(p.buttons.get('BUNDLE_STARTER').disabled, true);
});
