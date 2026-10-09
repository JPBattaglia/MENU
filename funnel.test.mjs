import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
const script = await readFile(new URL('./funnel.js', import.meta.url), 'utf8');
function page({ storage = new Map(), search = '', pathname = '/contact', privacy = false, fail = false, referrer = '' } = {}) {
  const sent = [], listeners = {}, window = {};
  const context = { window, location: { hostname: 'menu-made.com', origin: 'https://menu-made.com', pathname, search, href: 'https://menu-made.com' + pathname + search },
    navigator: { globalPrivacyControl: privacy }, URL, URLSearchParams, Date, crypto: webcrypto,
    sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    document: { referrer, addEventListener: (k, fn) => listeners[k] = fn, querySelectorAll: () => [] },
    fetch: (_url, options) => { if (fail) throw new Error('offline'); sent.push(JSON.parse(options.body)); return Promise.resolve({ ok: true }); } };
  vm.runInNewContext(script, context);
  return { api: window.MenuMadeFunnel, sent, listeners, storage };
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
  assert.equal(page({ search: '?mm_measurement=off' }).sent.length, 0);
  assert.doesNotThrow(() => page({ fail: true }).api.track('checkout_attempt'));
});
test('test attribution survives navigation, while booking clicks are only outbound-link signals', () => {
  const p = page({ search: '?mm_measurement=test' });
  const next = page({ storage: p.storage });
  assert.equal(next.sent[0].metadata.is_test, true);
  assert.equal(next.api.tracking().source, 'internal-test');
  next.listeners.click({ target: { closest: () => ({ href: 'https://www.everyexpert.com/jpbattaglia' }) } });
  assert.equal(next.sent[1].metadata.stage, 'booking_link_clicked');
  assert.equal(next.sent[1].metadata.is_test, true);
});
