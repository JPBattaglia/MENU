import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { findMenuAtLink, handleMenuLink, scanPage, priceCount, photoSize, checkUrl } from './src/marketing/menu-link.js';

// A real-sized JPEG header (SOF0 with the given size), padded so it passes the "big photo" check.
function jpeg(w, h, pad = 40000, seed = 0) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const bytes = new Uint8Array(head.length + pad + 2);
  bytes.set(head); bytes[head.length] = seed; bytes[bytes.length - 2] = 0xff; bytes[bytes.length - 1] = 0xd9;
  return bytes;
}
const PDF = new TextEncoder().encode('%PDF-1.4\n' + 'x'.repeat(2000) + '\n%%EOF');

function site(pages) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const page = pages[url];
    if (!page) return new Response('not found', { status: 404 });
    if (typeof page === 'string') return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response(page.bytes, { headers: { 'Content-Type': page.type } });
  };
  return { fetcher, calls };
}
const noBrowser = {};

test('addresses: bare domains get https, private and odd addresses are refused', () => {
  assert.equal(checkUrl('joescafe.com/menu').toString(), 'https://joescafe.com/menu');
  for (const bad of ['http://localhost/x', 'http://192.168.1.4/menu', 'http://10.0.0.1', 'ftp://x.com', 'http://printer.local/', 'nonsense']) {
    assert.throws(() => checkUrl(bad), /address|website|link/i, bad);
  }
});

test('photo sizes come from the file header, and prices are counted', () => {
  assert.deepEqual(photoSize(jpeg(1200, 1800), 'image/jpeg'), { w: 1200, h: 1800 });
  assert.equal(priceCount('Burger 12.50\nFries $4\nSalad 9.00\nSoup $6.50\nPie 7.25\nTea 3.00'), 6);
});

test('a direct PDF or photo link comes back as that file', async () => {
  const { fetcher } = site({ 'https://joes.com/menu.pdf': { bytes: PDF, type: 'application/pdf' }, 'https://joes.com/menu.jpg': { bytes: jpeg(1000, 1400), type: 'image/jpeg' } });
  const pdf = await findMenuAtLink('https://joes.com/menu.pdf', noBrowser, { fetcher });
  assert.equal(pdf.contentType, 'application/pdf'); assert.equal(pdf.name, 'joes-menu.pdf');
  const photo = await findMenuAtLink('joes.com/menu.jpg', noBrowser, { fetcher });
  assert.equal(photo.contentType, 'image/jpeg'); assert.equal(photo.from, 'photo');
});

test('a menu page that shows the menu as photos gets the full-size photos, put together as one PDF', async () => {
  const html = `<html><head><title>Menu | Joe's</title></head><body><img src="/logo.png" width="120">
    <img src="https://images.squarespace-cdn.com/a/dinner-menu.jpg?format=500w" alt="Dinner menu" data-src="https://images.squarespace-cdn.com/a/dinner-menu.jpg">
    <img srcset="https://cdn.joes.com/p2-600.jpg 600w, https://cdn.joes.com/p2-2000.jpg 2000w" alt="Menu page 2"></body></html>`;
  const { fetcher } = site({
    'https://joes.com/menu': html,
    'https://images.squarespace-cdn.com/a/dinner-menu.jpg': { bytes: jpeg(1600, 2200, 40000, 1), type: 'image/jpeg' },
    'https://cdn.joes.com/p2-2000.jpg': { bytes: jpeg(1600, 2200, 41000, 2), type: 'image/jpeg' }
  });
  const found = await findMenuAtLink('https://joes.com/menu', noBrowser, { fetcher });
  assert.equal(found.from, 'photos');
  assert.equal(found.contentType, 'application/pdf');
  const doc = await PDFDocument.load(found.bytes);
  assert.equal(doc.getPageCount(), 2, 'a page per menu photo');
});

test('a single menu photo in a page comes back as that photo', async () => {
  const { fetcher } = site({
    'https://joes.com/our-menu': '<html><body><h1>Our menu</h1><img src="/wp-content/uploads/menu-2026.jpg" alt=""></body></html>',
    'https://joes.com/wp-content/uploads/menu-2026.jpg': { bytes: jpeg(1100, 1500), type: 'image/jpeg' }
  });
  const found = await findMenuAtLink('https://joes.com/our-menu', noBrowser, { fetcher });
  assert.equal(found.contentType, 'image/jpeg');
});

test('a home page: food photos are not taken for a menu, its Menu link is followed', async () => {
  const { fetcher, calls } = site({
    'https://joes.com/': '<html><body><img src="/hero-burger.jpg"><nav><a href="/order">Order online</a><a href="/menus">Menu</a></nav></body></html>',
    'https://joes.com/hero-burger.jpg': { bytes: jpeg(1800, 1200), type: 'image/jpeg' },
    'https://joes.com/menus': '<html><body><a href="/files/joes-menu.pdf">Download our menu</a></body></html>',
    'https://joes.com/files/joes-menu.pdf': { bytes: PDF, type: 'application/pdf' }
  });
  const found = await findMenuAtLink('https://joes.com/', noBrowser, { fetcher });
  assert.equal(found.from, 'linked pdf');
  assert.ok(!calls.includes('https://joes.com/hero-burger.jpg'), 'a home page photo with no menu hint is not fetched');
});

test('a text menu page is printed by the browser, or written out as text when no browser is free', async () => {
  const items = Array.from({ length: 8 }, (_, i) => `<li>Dish ${i} <span>$1${i}.00</span></li>`).join('');
  const { fetcher } = site({ 'https://joes.com/menu': `<html><body><ul>${items}</ul></body></html>` });
  const printed = new Uint8Array([...PDF]);
  const browser = { BROWSER: { quickAction: async (action, opts) => { assert.equal(action, 'pdf'); assert.equal(opts.url, 'https://joes.com/menu'); return new Response(printed); } } };
  assert.equal((await findMenuAtLink('https://joes.com/menu', browser, { fetcher })).from, 'page');
  const plain = await findMenuAtLink('https://joes.com/menu', noBrowser, { fetcher });
  assert.equal(plain.from, 'text');
  assert.equal((await PDFDocument.load(plain.bytes)).getPageCount(), 1);
});

test('a page drawn by JavaScript is read again as the browser sees it', async () => {
  const { fetcher } = site({
    'https://order.toasttab.com/online/joes': '<html><body><div id="root"></div><script src="/app.js"></script></body></html>',
    'https://cdn.toasttab.com/joes/menu-board.jpg': { bytes: jpeg(1200, 1700), type: 'image/jpeg' }
  });
  const env = { BROWSER: { quickAction: async (action) => action === 'content'
    ? new Response(JSON.stringify({ success: true, result: '<html><body><div id="root"><h2>Menu</h2><img src="https://cdn.toasttab.com/joes/menu-board.jpg" alt="Menu board"></div>' + ' '.repeat(300) + '</body></html>' }))
    : new Response('no', { status: 500 }) } };
  const found = await findMenuAtLink('https://order.toasttab.com/online/joes', env, { fetcher });
  assert.equal(found.contentType, 'image/jpeg');
});

test('scanPage ranks menu links and skips ordering links', () => {
  const s = scanPage('<a href="/order">Order now</a><a href="/food-menu">Food Menu</a><a href="/about">About</a>', new URL('https://joes.com/'));
  assert.deepEqual(s.links.map((l) => l.url.pathname), ['/food-menu']);
});

test('nothing found gives a plain reason to upload instead', async () => {
  const { fetcher } = site({ 'https://joes.com/': '<html><body>' + '<p>Welcome to our family restaurant, open since 1982.</p>'.repeat(12) + '</body></html>' });
  await assert.rejects(findMenuAtLink('https://joes.com/', noBrowser, { fetcher }), /couldn't find a menu|upload a photo or PDF/i);
  const missing = site({});
  await assert.rejects(findMenuAtLink('https://joes.com/menu', noBrowser, { fetcher: missing.fetcher }), /404/);
});

test('the endpoint returns the file with its name, answers CORS for the app, and limits each network', async () => {
  const { fetcher } = site({ 'https://joes.com/menu.pdf': { bytes: PDF, type: 'application/pdf' } });
  let n = 0;
  const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({ meta: { changes: ++n <= 2 ? 1 : 0 } }) }) }) } };
  const req = () => new Request('https://menu-made.com/api/menu-preview/link', { method: 'POST', headers: { Origin: 'capacitor://localhost', 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' }, body: JSON.stringify({ url: 'https://joes.com/menu.pdf' }) });
  const ok = await handleMenuLink(req(), env, { fetcher });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'application/pdf');
  assert.equal(ok.headers.get('X-Menu-Name'), 'joes-menu.pdf');
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'capacitor://localhost');
  assert.match(ok.headers.get('Access-Control-Expose-Headers'), /X-Menu-Name/);
  assert.equal((await handleMenuLink(req(), env, { fetcher })).status, 200);
  assert.equal((await handleMenuLink(req(), env, { fetcher })).status, 429);
  const bad = await handleMenuLink(new Request('https://menu-made.com/api/menu-preview/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'http://localhost/x' }) }), {}, { fetcher });
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).error, /public website/);
});
