// Rep showcase (Nov 19, 2026): on a walk-in, a rep-mode preview shows every format on the spot, with no approval,
// and public previews get none of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWaiverOn } from './src/checkout/quote.js';
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

function stubAi(t) {
  const asked = [];
  const emails = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (String(url) === 'https://api.anthropic.com/v1/messages') {
      const prompt = JSON.parse(init.body).messages[0].content;
      const texts = JSON.parse(/\n(\[[\s\S]*\])\n/.exec(prompt)[1]);
      asked.push(texts);
      return Response.json({ model: 'test', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: 'tool_use', name: 'record_output', input: { translations: texts.map((x) => `ZH ${x}`) } }] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = real; });
  return { asked, emails };
}

test('Languages: a tap translates the menu once, then it is saved; English shows every language to pick', async (t) => {
  const { env, get } = await setup();
  env.ANTHROPIC_API_KEY = 'sk-test';
  const ai = stubAi(t);
  const english = await (await get(`/api/menu-preview/showcase/${TOKEN}/classic/lang`)).text();
  assert.match(english, /中文（繁體）/);
  assert.match(english, /Har gow/);
  assert.equal(ai.asked.length, 0, 'English costs nothing');
  const zh = await (await get(`/api/menu-preview/showcase/${TOKEN}/classic/lang?lang=zh-Hant`)).text();
  assert.match(zh, /ZH Har gow/);
  assert.match(zh, /ZH Dim sum/);
  assert.match(zh, /6\.50/, 'prices unchanged');
  assert.equal(ai.asked.length, 1);
  await get(`/api/menu-preview/showcase/${TOKEN}/classic/lang?lang=zh-Hant`);
  assert.equal(ai.asked.length, 1, 'a second tap is free');
});

test('buying: the list of formats ends with a phone checkout QR and a tablet checkout at the new prices; no free plan; the inbox is never prefilled', async (t) => {
  const { env, get } = await setup();
  env.OWNER_EMAIL = 'rep-inbox@menu-made.example';
  env.DB.raw.prepare(`UPDATE menu_previews SET email = ? WHERE token = ?`).run('rep-inbox@menu-made.example', TOKEN);
  const hub = await (await get(`/api/menu-preview/showcase/${TOKEN}/garden`)).text();
  assert.ok(hub.includes(`/api/menu-preview/choose/${TOKEN}/garden`), 'checkout keeps the design on screen');
  assert.match(hub, /Scan with your phone to sign up/);
  assert.match(hub, setupWaiverOn() ? /no \$149 setup through Dec 31, just from \$19\.99\/mo with MΞNU Plus/ : /\$149 setup, then from \$19\.99\/mo with MΞNU Plus/);
  assert.match(hub, /Pro &amp; Max/, 'the tri-fold, table tent and languages are marked Pro');
  assert.ok(!/Start free|name="email"/.test(hub), 'no free plan');
  assert.ok(!hub.includes('rep-inbox@'), 'your inbox is not shown as their email');
  const handoff = await (await get(`/api/menu-preview/handoff/${TOKEN}`)).json();
  assert.equal(handoff.email, '', 'checkout does not prefill your inbox');
  const free = await worker.fetch(new Request(`https://menu-made.com/api/menu-preview/free/${TOKEN}`, { method: 'POST' }), env, { waitUntil() {} });
  assert.equal(free.status, 410, 'the free plan is off');
});
