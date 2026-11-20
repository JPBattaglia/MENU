import test from 'node:test';
import assert from 'node:assert/strict';
import { findSiteLook, logoCandidates, brandColor, findLinks } from './src/marketing/site-look.js';

function jpeg(w, h, pad = 40000, seed = 0) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const bytes = new Uint8Array(head.length + pad + 2);
  bytes.set(head); bytes[head.length] = seed; bytes[bytes.length - 2] = 0xff; bytes[bytes.length - 1] = 0xd9;
  return bytes;
}
function png(w, h) {
  const b = new Uint8Array(400); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b;
}
function site(pages) {
  return async (url) => {
    const page = pages[url];
    if (!page) return new Response('nope', { status: 404 });
    if (typeof page === 'string') return new Response(page, { headers: { 'Content-Type': 'text/html' } });
    return new Response(page.bytes, { headers: { 'Content-Type': page.type } });
  };
}

const HOME = `<html><head><meta name="theme-color" content="#8B1E2D"><link rel="apple-touch-icon" href="/touch.png"></head><body>
<header><a href="/" class="site-logo"><img src="/img/joes-wordmark.png" alt="Joe's"></a><nav><a href="/gallery">Gallery</a></nav></header>
<img src="/img/hero-pasta.jpg" alt="Pasta"><img src="/img/dining-room.jpg"><img src="/img/menu-scan.jpg" alt="menu">
<img src="https://cdn.example/opentable-badge.png">
<a href="https://www.instagram.com/joescafe/">IG</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a><a href="https://facebook.com/JoesCafeSF">FB</a>
<a href="https://www.yelp.com/biz/joes-cafe-sf">Yelp</a><a href="https://order.toasttab.com/online/joes">Order</a>
<p>${'Fresh pasta made every morning in our kitchen on Valencia Street. '.repeat(5)}</p></body></html>`;

test('the logo is found in the header by its class, before icons; partner logos are not theirs', () => {
  const list = logoCandidates(HOME, new URL('https://joes.example/'));
  assert.equal(list[0].url.pathname, '/img/joes-wordmark.png');
  assert.ok(!list.some((c) => /opentable/.test(c.url.toString())));
});

test('colour and links: theme colour unless grey; Instagram, Facebook, Yelp and an order link, not share buttons', () => {
  assert.equal(brandColor(HOME), '#8b1e2d');
  assert.equal(brandColor('<meta name="theme-color" content="#ffffff">'), '');
  const links = findLinks(HOME, new URL('https://joes.example/'));
  assert.equal(links.instagram, 'https://www.instagram.com/joescafe/');
  assert.equal(links.facebook, 'https://www.facebook.com/JoesCafeSF');
  assert.equal(links.yelp, 'https://www.yelp.com/biz/joes-cafe-sf');
  assert.equal(links.order_url, 'https://order.toasttab.com/online/joes');
  assert.equal(links.order_label, 'Order online');
});

test('their own photos: big pictures from the home and gallery pages, kept and ordered by one AI look', async (t) => {
  const fetcher = site({
    'https://joes.example/': HOME,
    'https://joes.example/gallery': '<html><body><img src="/img/storefront.jpg"><p>' + 'Our space. '.repeat(30) + '</p></body></html>',
    'https://joes.example/img/joes-wordmark.png': { bytes: png(600, 200), type: 'image/png' },
    'https://joes.example/img/hero-pasta.jpg': { bytes: jpeg(1600, 1000, 40000, 1), type: 'image/jpeg' },
    'https://joes.example/img/dining-room.jpg': { bytes: jpeg(1600, 1066, 41000, 2), type: 'image/jpeg' },
    'https://joes.example/img/menu-scan.jpg': { bytes: jpeg(1200, 1700, 42000, 3), type: 'image/jpeg' },
    'https://joes.example/img/storefront.jpg': { bytes: jpeg(1400, 1000, 43000, 4), type: 'image/jpeg' }
  });
  const real = globalThis.fetch; let shown = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'claude-haiku-5-5');
    shown = body.messages[0].content.filter((c) => c.type === 'image').length;
    return Response.json({ content: [{ type: 'text', text: '3, 1, 2' }] }); // storefront first, then pasta, dining room
  };
  t.after(() => { globalThis.fetch = real; });
  const look = await findSiteLook('joes.example', { ANTHROPIC_API_KEY: 'k' }, { fetcher });
  assert.equal(look.logo.type, 'image/png');
  assert.equal(shown, 3, 'one look at the three big photos; the menu scan is left out before it');
  assert.deepEqual(look.photos.map((p) => p.bytes.length), [43000 + 41, 40000 + 41, 41000 + 41], 'storefront, pasta, dining room');
  assert.equal(look.brand, '#8b1e2d');
  assert.equal(look.links.instagram, 'https://www.instagram.com/joescafe/');
});

test('nothing usable, or no key: an empty look, never an error', async () => {
  assert.deepEqual(await findSiteLook('http://localhost/', {}, { fetcher: site({}) }), { logo: null, photos: [], brand: '', links: {} });
  const look = await findSiteLook('https://joes.example/', {}, { fetcher: site({ 'https://joes.example/': HOME }) });
  assert.equal(look.logo, null, 'the logo file did not answer');
  assert.deepEqual(look.photos, [], 'without a key no photo is guessed at');
  assert.equal(look.links.yelp, 'https://www.yelp.com/biz/joes-cafe-sf');
});
