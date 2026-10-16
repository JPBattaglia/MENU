import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const script = await readFile(new URL('./start.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('./contact.html', import.meta.url), 'utf8');
function element() {
  const classes = new Set(), listeners = new Map();
  return {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, checked: false,
    style: {}, dataset: {}, files: [], children: [], attrs: {},
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle(name, on = !classes.has(name)) { on ? classes.add(name) : classes.delete(name); } },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(listener); },
    async fire(name, event = {}) { for (const listener of listeners.get(name) || []) await listener({ preventDefault() {}, target: this, ...event }); },
    appendChild(child) { this.children.push(child); }, focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; }
  };
}
function page(search = '') {
  const els = new Map();
  const get = id => { if (!els.has(id)) els.set(id, element()); return els.get(id); };
  get('menuPages').value = '3';
  const cards = new Map();
  for (const match of markup.matchAll(/<article class="service-card" ([^>]*data-sku[^>]*)>/g)) {
    const card = element();
    for (const attr of match[1].matchAll(/data-([\w-]+)="([^"]*)"/g)) card.dataset[attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attr[2];
    cards.set(card.dataset.sku, card);
  }
  const addButtons = [...cards.values()].map(card => ({ ...element(), closest: () => card }));
  const startButtons = [element(), element()];
  const sent = [], documents = [], tracking = [], cartSection = element();
  let failCheckout = false;
  const location = { search, href: 'https://menu-made.com/contact.html' + search };
  const context = {
    location, URLSearchParams, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    window: { location, matchMedia: () => ({ matches: true }), MenuMadeFunnel: { track: (...args) => tracking.push(args), tracking: () => ({ session_id: 'test-session' }) },
      MenuMadeDocuments: { validate() {}, fingerprint: async () => 'test-fingerprint', send: async (payload, file) => { documents.push({ payload, file }); } } },
    document: { getElementById: get, createElement: () => element(),
      querySelectorAll(selector) { return selector === '.js-add' ? addButtons : selector === '[data-start-menu]' ? startButtons : []; },
      querySelector(selector) { return selector === '.cart' ? cartSection : cards.get(/data-sku="([^"]+)"/.exec(selector)?.[1]) || null; } },
    fetch: async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: !failCheckout, json: async () => failCheckout ? { error: 'Please retry checkout.' } : { url: 'https://checkout.stripe.com/test' } }; }
  };
  vm.runInNewContext(script, context);
  const fill = () => {
    get('lead_name').value = 'Test Buyer'; get('lead_business').value = 'Test Cafe'; get('lead_email').value = 'test@example.com'; get('scopeConfirm').checked = true;
  };
  const cart = () => JSON.parse(vm.runInNewContext('JSON.stringify(cart)', context));
  return { get, fill, sent, documents, tracking, startButtons, addButtons, cards, cart, cartSection, fail() { failCheckout = true; }, recover() { failCheckout = false; } };
}

test('generic start and supported menu links open one complete first-year menu package', async () => {
  for (const search of ['', '?service=menu', '?service=online_menu_qr', '?service=online-menu-qr']) {
    const p = page(search);
    assert.equal(p.get('cartTotal').textContent, '$144.00');
    assert.equal(p.get('menuConfig').hidden, false);
    assert.equal(p.get('intakeStep').classList.contains('show'), true);
    assert.equal(p.cart().online_menu_qr.qty, 1);
    await p.startButtons[0].fire('click');
    await p.startButtons[0].fire('click');
    await p.addButtons[0].fire('click');
    assert.equal(p.cart().online_menu_qr.qty, 1);
    assert.equal(p.get('cartTotal').textContent, '$144.00');
  }
});

test('page count updates the complete displayed quote and refuses invalid totals', async () => {
  const p = page();
  for (const [pages, total, extra] of [['1', '$144.00', '$0.00'], ['3', '$144.00', '$0.00'], ['4', '$164.00', '$20.00'], ['5', '$184.00', '$40.00'], ['50', '$1084.00', '$940.00']]) {
    p.get('menuPages').value = pages;
    await p.get('menuPages').fire('input');
    assert.equal(p.get('cartTotal').textContent, total);
    assert.equal(p.get('extraPagesAmount').textContent, extra);
    assert.equal(p.get('checkoutBtn').disabled, false);
  }
  for (const pages of ['', '0', '-1', '51', '2.5', 'bad']) {
    p.get('menuPages').value = pages;
    await p.get('menuPages').fire('input');
    assert.equal(p.get('cartTotal').textContent, 'Enter page count');
    assert.equal(p.get('checkoutBtn').disabled, true);
    assert.equal(p.get('menuPages').attrs['aria-invalid'], 'true');
    await p.get('checkoutBtn').fire('click');
    assert.equal(p.sent.length, 0);
  }
});

test('checkout sends an integer page count and retains first-touch attribution', async () => {
  const p = page('?service=menu'); p.fill();
  p.get('menuPages').value = '5'; await p.get('menuPages').fire('input');
  await p.get('checkoutBtn').fire('click');
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0].url, '/api/create-checkout');
  assert.deepEqual(p.sent[0].body.items, [{ key: 'online_menu_qr', qty: 1 }]);
  assert.equal(p.sent[0].body.menu_pages, 5);
  assert.equal(p.sent[0].body.tracking.session_id, 'test-session');
  assert.equal(p.sent[0].body.customer.business, 'Test Cafe');
});

test('other service links keep their selected offer without adding a menu or page count', async () => {
  for (const [service, sku, total] of [['conversion', 'conversion_fix', '$299.00'], ['google', 'google_visibility', '$149.00'], ['accessibility', 'accessibility_upgrade', '$250.00']]) {
    const p = page('?service=' + service); p.fill();
    assert.equal(p.get('cartTotal').textContent, total);
    assert.equal(p.get('menuConfig').hidden, true);
    await p.get('checkoutBtn').fire('click');
    assert.deepEqual(p.sent[0].body.items, [{ key: sku, qty: 1 }]);
    assert.equal('menu_pages' in p.sent[0].body, false);
  }
  const app = page('?service=app');
  assert.deepEqual(app.cart(), {});
  assert.equal(app.get('inquiryService').value, 'Other project');
  assert.match(app.get('bookingNotes').value, /native menu app/);
  assert.equal(app.get('inquiry').scrolled, true);
});

test('required contact and scope fields block checkout, with a clear focus target', async () => {
  const p = page();
  await p.get('checkoutBtn').fire('click');
  assert.equal(p.get('lead_name').focused, true);
  p.fill(); p.get('lead_email').value = 'invalid';
  await p.get('checkoutBtn').fire('click');
  assert.equal(p.get('lead_email').attrs['aria-invalid'], 'true');
  p.fill(); p.get('scopeConfirm').checked = false;
  await p.get('checkoutBtn').fire('click');
  assert.equal(p.get('scopeConfirm').focused, true);
  assert.equal(p.sent.length, 0);
});

test('a checkout retry reuses its document receipt while keeping the menu quote attached', async () => {
  const p = page(); p.fill(); p.fail();
  p.get('lead_document').files = [{ name: 'test-menu.pdf' }];
  p.get('menuPages').value = '4'; await p.get('menuPages').fire('input');
  await p.get('checkoutBtn').fire('click');
  assert.equal(p.documents.length, 1);
  assert.match(p.documents[0].payload.notes, /Menu scope: 4 pages/);
  assert.match(p.documents[0].payload.notes, /\$164.00/);
  assert.equal(p.sent[0].body.menu_pages, 4);
  p.recover();
  await p.get('checkoutBtn').fire('click');
  assert.equal(p.documents.length, 1);
  assert.equal(p.sent.length, 2);
  assert.match(p.sent[1].body.customer.notes, /Document inquiry reference:/);
});

test('removing or clearing a menu removes the page option and prevents an empty checkout', async () => {
  const p = page();
  await p.get('cartItems').fire('click', { target: { dataset: { remove: 'online_menu_qr' } } });
  assert.deepEqual(p.cart(), {});
  assert.equal(p.get('menuConfig').hidden, true);
  assert.equal(p.get('checkoutBtn').disabled, true);
  await p.startButtons[0].fire('click');
  assert.equal(p.get('cartTotal').textContent, '$144.00');
  await p.get('clearBtn').fire('click');
  assert.deepEqual(p.cart(), {});
  assert.equal(p.get('continueBtn').disabled, true);
});
