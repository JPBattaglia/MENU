import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
const script = await readFile(new URL('./funnel.js', import.meta.url), 'utf8');
function page({ storage = new Map(), search = '', pathname = '/contact', privacy = false, dnt = false, fail = false, referrer = '', hostname = 'menu-made.com' } = {}) {
  const sent = [], listeners = {}, window = {};
  const context = { window, location: { hostname, origin: 'https://' + hostname, pathname, search, href: 'https://' + hostname + pathname + search },
    navigator: { globalPrivacyControl: privacy, doNotTrack: dnt ? '1' : undefined }, URL, URLSearchParams, Date, crypto: webcrypto,
    sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    document: { referrer, addEventListener: (k, fn) => listeners[k] = fn, querySelectorAll: () => [] },
    fetch: (_url, options) => { if (fail) throw new Error('offline'); sent.push(JSON.parse(options.body)); return Promise.resolve({ ok: true }); } };
  vm.runInNewContext(script, context);
  const click = (href, start = '') => listeners.click?.({ target: { closest: selector => {
    if (selector === 'a[href]') return href ? { href } : null;
    if (selector === '[data-start-menu]') return start === 'menu' ? {} : null;
    if (selector === '[data-funnel-start]') return start === 'generic' ? {} : null;
    return null;
  } } });
  return { api: window.MenuMadeFunnel, sent, listeners, storage, click };
}
test('preserves first-touch attribution across pages and sends no URL query or contact data', () => {
  const first = page({ search: '?utm_source=restaurant_outreach&utm_medium=email&utm_campaign=menu_oct&email=private@example.com', referrer: 'https://example.com/private?token=secret' });
  const next = page({ storage: first.storage, pathname: '/checkoutsuccess', search: '?order_id=private-order&session_id=secret-checkout' });
  assert.equal(next.api.tracking().session_id, first.api.tracking().session_id);
  assert.equal(next.api.tracking().source, 'restaurant_outreach');
  assert.equal(next.api.tracking().referrer, 'example.com');
  assert.equal(JSON.stringify([...first.sent, ...next.sent]).includes('secret'), false);
  assert.equal(JSON.stringify(first.sent).includes('private@example.com'), false);
});
test('deduplicates stage signals per page and refuses client purchase events', () => {
  const p = page();
  p.api.track('service_selected', 'online_menu_qr'); p.api.track('service_selected', 'online_menu_qr');
  p.api.track('PURCHASE_COMPLETED');
  assert.equal(p.sent.length, 2);
  assert.equal(p.sent[1].offer_id, 'offer_online_menu_qr');
  assert.equal(p.sent[1].event_type, 'CTA_CLICK');
});
test('honors privacy opt-out and measurement failure cannot break a customer action', () => {
  assert.equal(page({ privacy: true }).sent.length, 0);
  assert.equal(page({ dnt: true }).sent.length, 0);
  assert.equal(page({ search: '?mm_measurement=off' }).sent.length, 0);
  assert.equal(page({ hostname: 'localhost' }).sent.length, 0);
  assert.doesNotThrow(() => page({ fail: true }).api.track('checkout_attempt'));
});
test('test attribution survives navigation, while booking clicks are only outbound-link signals', () => {
  const p = page({ search: '?mm_measurement=test' });
  const next = page({ storage: p.storage });
  assert.equal(next.sent[0].metadata.is_test, true);
  assert.equal(next.api.tracking().source, 'internal-test');
  next.click('https://www.everyexpert.com/jpbattaglia');
  assert.equal(next.sent[1].metadata.stage, 'booking_link_clicked');
  assert.equal(next.sent[1].metadata.is_test, true);
});
test('records a sample view on either sample URL without collecting dish searches', () => {
  for (const pathname of ['/sample-menu', '/sample-menu.html']) {
    const p = page({ pathname, search: '?search=private+dietary+request' });
    assert.deepEqual(p.sent.map(event => event.event_type), ['SITE_VISIT', 'CTA_CLICK']);
    assert.equal(p.sent[1].metadata.stage, 'sample_menu_view');
    assert.equal(p.sent[1].metadata.page, pathname);
    assert.equal(p.sent[1].offer_id, 'offer_online_menu_qr');
    assert.equal(JSON.stringify(p.sent).includes('private'), false);
    p.api.track('sample_menu_view', 'online_menu_qr');
    assert.equal(p.sent.length, 2);
  }
});
test('tracks generic starts without attributing a menu offer or selecting a service', () => {
  for (const href of ['https://menu-made.com/contact.html', 'https://menu-made.com/contact', 'https://menu-made.com/contact#checkout']) {
    const p = page({ pathname: '/' });
    p.click(href);
    p.click(href);
    const starts = p.sent.filter(event => event.metadata.stage === 'start_clicked');
    assert.equal(starts.length, 1);
    assert.equal(Object.hasOwn(starts[0], 'offer_id'), false);
    assert.equal(p.sent.some(event => event.metadata.stage === 'service_selected' || event.metadata.stage === 'service_link_clicked'), false);
  }
  const p = page();
  p.click('#checkout', 'generic');
  p.click(null, 'generic');
  const starts = p.sent.filter(event => event.metadata.stage === 'start_clicked');
  assert.equal(starts.length, 1);
  assert.equal(Object.hasOwn(starts[0], 'offer_id'), false);
});
test('attributes explicit menu links and menu-specific controls to the menu offer', () => {
  for (const href of ['https://menu-made.com/contact?service=menu#details', 'https://menu-made.com/contact.html?service=online_menu_qr#checkout']) {
    const p = page({ pathname: '/' });
    p.click(href);
    p.click(href);
    const starts = p.sent.filter(event => event.metadata.stage === 'start_clicked');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].offer_id, 'offer_online_menu_qr');
  }
  const p = page();
  p.click('#checkout', 'menu');
  p.click(null, 'menu');
  const starts = p.sent.filter(event => event.metadata.stage === 'start_clicked');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].offer_id, 'offer_online_menu_qr');
  const markedLink = page();
  markedLink.click('https://menu-made.com/contact.html?service=menu', 'generic');
  assert.equal(markedLink.sent.filter(event => event.metadata.stage === 'start_clicked').length, 1);
  assert.equal(markedLink.sent.find(event => event.metadata.stage === 'start_clicked').offer_id, 'offer_online_menu_qr');
});
test('inquiries, other services, and unrelated or external links are not menu starts', () => {
  const p = page();
  for (const href of ['https://menu-made.com/contact.html#inquiry', 'https://menu-made.com/contact.html?service=menu#inquiry', 'https://menu-made.com/contact?service=conversion', 'https://menu-made.com/contact?service=app', 'https://example.com/contact?service=menu', 'https://menu-made.com/sample-menu.html']) p.click(href);
  assert.equal(p.sent.some(event => event.metadata.stage === 'start_clicked'), false);
  assert.equal(p.sent.some(event => event.metadata.stage === 'service_link_clicked' && event.offer_id === 'offer_conversion_fix'), true);
});
