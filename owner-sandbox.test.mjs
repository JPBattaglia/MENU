// Owner sandbox switch (Nov 12, 2026): off unless this browser turned it on, never linked from a page, and the two
// pages that start a checkout load the switch before their own script.
// Run: node --no-warnings --test owner-sandbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('.', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const nav = read('site-nav.js');

function visit(search, stored = {}) {
  const store = { ...stored };
  const bars = [];
  const el = () => ({ append() {}, setAttribute() {}, addEventListener() {} });
  const context = {
    URLSearchParams, URL,
    location: { search, href: `https://menu-made.com/plans.html${search}`, replace() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { body: { prepend: (bar) => bars.push(bar) }, createElement: el, querySelector: () => null, getElementById: () => null, addEventListener() {} }
  };
  context.window = context;
  vm.runInNewContext(nav, context);
  return { on: context.MenuMadeSandbox, store, bars: bars.length };
}

test('a normal visit is live: no test mode, no bar', () => {
  assert.deepEqual(visit(''), { on: false, store: {}, bars: 0 });
  assert.deepEqual(visit('?plan=STARTER&interval=year'), { on: false, store: {}, bars: 0 });
});

test('?sandbox=on turns it on for this browser, it stays on for later pages, and ?sandbox=off ends it', () => {
  const first = visit('?sandbox=on');
  assert.equal(first.on, true); assert.equal(first.bars, 1);
  const later = visit('', first.store);
  assert.equal(later.on, true); assert.equal(later.bars, 1);
  assert.deepEqual(visit('?sandbox=off', later.store), { on: false, store: {}, bars: 0 });
});

test('a browser that blocks storage stays live', () => {
  const context = { URLSearchParams, URL, location: { search: '?sandbox=on', href: 'https://menu-made.com/?sandbox=on' },
    localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} },
    document: { body: { prepend() { throw new Error('no bar expected'); } }, querySelector: () => null, getElementById: () => null, addEventListener() {} } };
  context.window = context;
  vm.runInNewContext(nav, context);
  assert.equal(context.MenuMadeSandbox, false);
});

test('no page or script links to the switch, so a buyer never lands in test mode', () => {
  for (const name of readdirSync(root).filter((n) => /\.(html|js)$/.test(n))) {
    if (name !== 'site-nav.js') assert.doesNotMatch(read(name), /[?&]sandbox=on/, `${name} must not link to ?sandbox=on`);
    if (name !== 'start.js' && name !== 'staff-merch.js') assert.doesNotMatch(read(name), /checkout=test/, `${name} must not link to ?checkout=test`);
  }
});

test('the checkout pages load the switch before their own script and use it', () => {
  for (const [page, script] of [['contact.html', 'start.js'], ['staff-merch.html', 'staff-merch.js']]) {
    const html = read(page);
    assert.ok(html.indexOf('site-nav.js') > 0 && html.indexOf('site-nav.js') < html.indexOf(`${script}?`), `${page}: site-nav.js comes first`);
    assert.match(read(script), /window\.MenuMadeSandbox === true/);
  }
  assert.match(read('start.js'), /TEST_CHECKOUT \? '\/api\/create-checkout-test' : '\/api\/create-checkout'/);
});
