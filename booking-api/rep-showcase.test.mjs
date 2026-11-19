// Rep showcase (Nov 19, 2026): on a walk-in, a rep-mode preview shows every format on the spot, with no approval,
// and public previews get none of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';
const { default: worker } = await import('./src/worker.js');

const TOKEN = 'a'.repeat(36);
const PUBLIC = 'b'.repeat(36);
const menu = {
  sections: [
    { name: 'Dim sum', items: [{ name: 'Har gow', description: 'Shrimp dumplings, 4 pieces', price: '6.50' }, { name: 'Siu mai', description: 'Pork and shrimp', price: '6.00' }] },
    { name: 'Noodles', items: [{ name: 'Wonton noodle soup', description: 'House broth', price: '12.95' }, { name: 'Beef chow fun', description: '', price: '15.50' }] }
  ],
  notes: 'Cash and cards accepted.'
};

async function setup() {
  const env = { DB: createD1(), ASSETS: createR2() };
  const now = new Date().toISOString();
  const ends = new Date(Date.now() + 72 * 3600e3).toISOString();
  for (const [token, campaign] of [[TOKEN, 'rep'], [PUBLIC, null]]) {
    env.DB.raw.prepare(`INSERT INTO menu_previews (token, request_id, email, business, campaign, status, created_at, expires_at) VALUES (?, 'r', 'owner@cafe.example', 'Golden Dragon', ?, 'READY', ?, ?)`).run(token, campaign, now, ends);
    await env.ASSETS.put(`menu-previews/${token}/data.json`, JSON.stringify({ business: 'Golden Dragon', menu, custom: {} }));
  }
  const get = (path) => worker.fetch(new Request(`https://menu-made.com${path}`), env, { waitUntil() {} });
  return { env, get };
}

test('a rep preview shows every format, watermarked and not printable, with no approval step', async () => {
  const { get } = await setup();
  const hub = await get(`/api/menu-preview/showcase/${TOKEN}/classic`);
  assert.equal(hub.status, 200);
  const hubHtml = await hub.text();
  for (const f of ['qr', 'tent', 'trifold', 'print', 'tv']) assert.ok(hubHtml.includes(`/showcase/${TOKEN}/classic/${f}`), `hub links ${f}`);
  assert.match(hubHtml, /Golden Dragon/);

  for (const f of ['qr', 'tent', 'trifold', 'print', 'tv']) {
    const res = await get(`/api/menu-preview/showcase/${TOKEN}/classic/${f}`);
    assert.equal(res.status, 200, f);
    const html = await res.text();
    assert.match(html, /NOT%20LIVE/, `${f} is watermarked`);
    assert.match(html, /@media print/, `${f} can't be printed`);
    assert.match(html, /All formats/, `${f} has a way back`);
  }
  const qr = await (await get(`/api/menu-preview/showcase/${TOKEN}/classic/qr`)).text();
  assert.match(qr, /<svg/);
  const tent = await (await get(`/api/menu-preview/showcase/${TOKEN}/classic/tent`)).text();
  assert.match(tent, /Scan for/);
  const print = await (await get(`/api/menu-preview/showcase/${TOKEN}/bistro/print`)).text();
  assert.match(print, /Har gow/);
  const tv = await (await get(`/api/menu-preview/showcase/${TOKEN}/modern/tv`)).text();
  assert.match(tv, /srcdoc=/);
  assert.match(tv, /Wonton noodle soup/);
});

test('public previews, unknown designs and formats, and ended previews get no showcase', async () => {
  const { env, get } = await setup();
  assert.equal((await get(`/api/menu-preview/showcase/${PUBLIC}/classic`)).status, 410);
  assert.equal((await get(`/api/menu-preview/showcase/${PUBLIC}/classic/tent`)).status, 410);
  assert.equal((await get(`/api/menu-preview/showcase/${TOKEN}/nosuch/qr`)).status, 410);
  assert.equal((await get(`/api/menu-preview/showcase/${TOKEN}/classic/pdf`)).status, 410);
  env.DB.raw.prepare(`UPDATE menu_previews SET expires_at = ? WHERE token = ?`).run(new Date(Date.now() - 1000).toISOString(), TOKEN);
  assert.equal((await get(`/api/menu-preview/showcase/${TOKEN}/classic/qr`)).status, 410);
});

test('only a rep preview page has the All formats button', async () => {
  const { env, get } = await setup();
  const { storeMenuDesigns } = await import('./src/marketing/public-preview.js');
  for (const token of [TOKEN, PUBLIC]) await storeMenuDesigns(env, token, { business: 'Golden Dragon', menu, custom: {} });
  const rep = await (await get(`/api/menu-preview/view/${TOKEN}/bistro`)).text();
  assert.ok(rep.includes(`href="/api/menu-preview/showcase/${TOKEN}/bistro"`), 'rep preview links its showcase for the design on screen');
  const pub = await (await get(`/api/menu-preview/view/${PUBLIC}/bistro`)).text();
  assert.ok(!pub.includes('mm-gen-all'), 'public preview has no showcase button');
});
