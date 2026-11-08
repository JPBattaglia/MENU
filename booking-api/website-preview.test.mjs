// Free Website Package preview (owner, Nov 5, 2026): a business sees its own site before paying, and prospect emails
// carry one. Run: node --no-warnings --test booking-api/website-preview.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { offeringsFromMenu, prefillFromPreview, PER_NETWORK_DAY } = await import('./src/marketing/website-preview.js');

const MENU = { sections: [{ name: 'Pizza', items: [{ name: 'Margherita', description: 'Mozzarella and basil', price: '$15' }, { name: 'Marinara', description: '', price: '$12' }] }], notes: '', unreadable: '' };
const COPY = { tagline: 'Pizza with mozzarella and basil', intro: 'Sample Pizza serves Margherita and Marinara pizza. Call ahead or stop by.', about: ['Sample Pizza makes Margherita pizza with mozzarella and basil, and a simple Marinara, for guests who stop by or call ahead.'], meta_description: 'Sample Pizza: Margherita and Marinara pizza, hours, address and phone number.', meta_about: 'About Sample Pizza and the pizza we make every day.' };
const PAGE_FACTS = { about: 'Family pizzeria serving Margherita and Marinara.', phone: '(415) 555-0100', address: '1 Main St, San Francisco', hours: 'Mon-Sun: 11am-9pm', offerings: '# Pizza\nMargherita | Mozzarella and basil | $15' };
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';

function setup() {
  const env = { DB: createD1(), ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-test', RESEND_API_KEY: 're_test' };
  const call = (path, init = {}) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, { waitUntil() {} });
  const create = (body) => call('/api/website-preview/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const get = (path, agent = PHONE) => call(path, { headers: { 'User-Agent': agent } });
  const upload = async ({ email = 'owner@pizza.example', ip = 'net-1' } = {}) => {
    const id = crypto.randomUUID();
    const storageKey = `private/inquiries/${id}/abc`;
    await env.ASSETS.put(storageKey, new Uint8Array([37, 80, 68, 70]));
    env.DB.raw.prepare(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at) VALUES (?, ?, ?, ?)`).run(id,
      JSON.stringify({ type: 'inquiry', purpose: 'checkout', email, name: 'Pizza', document: { storageKey, contentType: 'application/pdf', name: 'menu.pdf', size: 4 } }), ip, Math.floor(Date.now() / 1000));
    return id;
  };
  return { env, call, create, get, upload };
}

// Claude: the menu read (record_menu), the copy and the page facts (generate's tool), by what each request asks for.
function stubApis(t, { site = '<html><body><h1>Sample Pizza</h1><p>Family pizzeria serving Margherita and Marinara. Call (415) 555-0100. 1 Main St, San Francisco. Open Mon-Sun 11am-9pm.</p></body></html>' } = {}) {
  const calls = { menu: 0, copy: 0, facts: 0, email: 0, site: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      const tool = body.tools?.[0]?.name;
      if (tool === 'record_menu') { calls.menu++; return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: { input_tokens: 1, output_tokens: 1 } }); }
      const facts = JSON.stringify(body.tools[0].input_schema).includes('phone number exactly');
      if (facts) calls.facts++; else calls.copy++;
      return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: tool, input: facts ? PAGE_FACTS : COPY }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (url === 'https://api.resend.com/emails') { calls.email++; return Response.json({ id: 'em_1' }); }
    if (url.startsWith('https://pizza.example')) { calls.site++; return new Response(site, { headers: { 'Content-Type': 'text/html' } }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('the menu becomes the builder\'s offerings text', () => {
  assert.equal(offeringsFromMenu(MENU), '# Pizza\nMargherita | Mozzarella and basil | $15\nMarinara | $12');
});

test('an upload becomes a watermarked, unindexed website preview with its own pages, emailed, and checkout can pick it up', async (t) => {
  const f = setup();
  const calls = stubApis(t);
  const res = await f.create({ request_id: await f.upload(), email: 'Owner@Pizza.example', business: 'Sample Pizza', phone: '(415) 555-0100', hours: 'Mon-Sun: 11am-9pm' });
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));
  // The site generator: the link opens design 1; Generate site walks the nine designs; Choose this site goes to checkout.
  assert.match(out.url, /^https:\/\/menu-made\.com\/api\/website-preview\/view\/[a-f0-9]{36}\/d\/trattoria\/index\.html$/);
  const first = await (await f.get(new URL(out.url).pathname)).text();
  for (const words of ['Design 1 of 9: Trattoria', 'Sample Pizza', 'href="menu.html"', 'PREVIEW%20%C2%B7%20NOT%20LIVE', '@media print', 'noindex', `d/bistro/index.html">Generate site`, `service=sitefiles&amp;wpreview=${out.token}&amp;design=trattoria`, 'Choose this site: $299']) assert.ok(first.includes(words), words);
  assert.doesNotMatch(first, /href="styles\.css"/, 'styles are inside the page');
  assert.doesNotMatch(first, /id="menu"/, 'the menu is not on the home page (owner, Nov 6)');
  const designMenu = await (await f.get(`/api/website-preview/view/${out.token}/d/trattoria/menu.html`)).text();
  assert.match(designMenu, /Margherita/); assert.match(designMenu, /Choose this site/);
  const last = await (await f.get(`/api/website-preview/view/${out.token}/d/taproom/index.html`)).text();
  assert.ok(last.includes('Design 9 of 9: Taproom') && last.includes('d/trattoria/index.html">Generate site'), 'the last design wraps to the first');
  assert.equal((await f.get(`/api/website-preview/view/${out.token}/d/nope/index.html`)).status, 410);
  const home = await f.get(new URL(out.url).pathname.replace('d/trattoria/index.html', 'index.html'));
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const html = await home.text();
  for (const words of ['Sample Pizza', 'PREVIEW%20%C2%B7%20NOT%20LIVE', '@media print', 'See it in 9 designs', '$299', 'href="menu.html"', 'tel:']) assert.ok(html.includes(words), words);
  const menu = await (await f.get(new URL(out.url).pathname.replace('d/trattoria/index.html', 'menu.html'))).text();
  assert.match(menu, /Margherita/); assert.match(menu, /\$15/);
  assert.equal((await f.get(new URL(out.url).pathname.replace('d/trattoria/index.html', 'secret.txt'))).status, 404, 'only page files are served');
  assert.equal(calls.menu, 1); assert.equal(calls.copy, 1); assert.equal(calls.email, 1);
  const handoff = await (await f.get(`/api/website-preview/handoff/${out.token}`)).json();
  assert.deepEqual(handoff, { ok: true, business: 'Sample Pizza', email: 'owner@pizza.example' });
  const prefill = await prefillFromPreview(f.env, 'owner@pizza.example');
  assert.equal(prefill.phone, '(415) 555-0100'); assert.match(prefill.offerings, /Margherita/);
});

// Real image bytes for uploads: PNG, JPEG and a fake "image" that is really text.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

test('Make it yours: a logo, photos and a brand colour rebuild all nine designs, and bad files are refused', async (t) => {
  const f = setup();
  stubApis(t);
  const out = await (await f.create({ request_id: await f.upload(), email: 'owner@pizza.example', business: 'Sample Pizza', phone: '(415) 555-0100' })).json();
  const first = await (await f.get(`/api/website-preview/view/${out.token}/d/bistro/index.html`)).text();
  for (const words of ['>Customize</button>', 'Customize your site', 'Updating all 9 designs', 'class="mm-spin"', `action="/api/website-preview/customize/${out.token}"`, 'name="photos"', 'name="logo"', 'type="color"', 'Update all 9 designs']) assert.ok(first.includes(words), words);
  const post = (form) => f.call(`/api/website-preview/customize/${out.token}`, { method: 'POST', body: form });
  const form = new FormData();
  form.set('design', 'bistro');
  form.set('logo', new File([PNG], 'logo.png', { type: 'image/png' }));
  form.append('photos', new File([JPG], 'a.jpg', { type: 'image/jpeg' }));
  form.append('photos', new File([PNG], 'b.png', { type: 'image/png' }));
  form.set('brand', '#B22222'); form.set('use_brand', '1');
  form.set('logo_info', 't=1;l=0.020;c=0.60;b=0'); form.set('logo_bg', 'auto');
  const res = await post(form);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `https://menu-made.com/api/website-preview/view/${out.token}/d/bistro/index.html`);
  for (const key of ['trattoria', 'bistro', 'night', 'farmhouse', 'fine', 'fresh', 'pop', 'coastal', 'taproom']) {
    const html = await (await f.get(`/api/website-preview/view/${out.token}/d/${key}/index.html`)).text();
    assert.ok(html.includes('img/logo.png'), `${key}: logo`);
    assert.ok(html.includes('Using your logo, 2 photos, your colour'), `${key}: panel shows what is in use`);
  }
  const all = (await Promise.all(['index', 'menu', 'about', 'contact'].map(async (p) => (await f.get(`/api/website-preview/view/${out.token}/d/farmhouse/${p}.html`)).text()))).join('');
  assert.ok(all.includes('img/photo-1.jpg'), 'photos appear in the design');
  assert.ok(all.toLowerCase().includes('#b22222'), 'the brand colour is used');
  const img = await f.get(`/api/website-preview/view/${out.token}/d/farmhouse/img/logo.png`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('Content-Type'), 'image/png');
  assert.equal((await f.get(`/api/website-preview/view/${out.token}/d/farmhouse/img/data.json`)).status, 404, 'only the images are served');
  const data = JSON.parse(await (await f.env.ASSETS.get(`website-previews/${out.token}/data.json`)).text());
  assert.equal(data.site.photos.length, 2); assert.equal(data.site.brand, '#b22222'); assert.equal(data.customized, 1);
  assert.deepEqual(data.site.logo.info, { t: 1, l: 0.02, c: 0.6, b: 0 }, 'the browser measurement is kept');
  assert.equal(data.site.logo_bg, 'auto');
  assert.ok(first.includes('name="logo_bg"') && first.includes('name="logo_info"'), 'Logo background and measurement fields');
  assert.match(await (await f.get(`/api/website-preview/view/${out.token}/d/night/index.html`)).text(), /<img class="logo logo-badge"/, 'a dark logo on Night Market gets a badge');
  const dark = new FormData(); dark.set('design', 'bistro'); dark.set('logo_bg', 'dark');
  assert.equal((await post(dark)).status, 303);
  assert.match(await (await f.get(`/api/website-preview/view/${out.token}/d/bistro/index.html`)).text(), /<img class="logo logo-badge" style="--plate:#/, 'the chosen Dark badge');
  // Only a new colour: the photos and logo stay; unticking the colour goes back to each design's own.
  const colourOnly = new FormData(); colourOnly.set('design', 'night'); colourOnly.set('brand', '#000000');
  assert.equal((await post(colourOnly)).status, 303);
  const after = JSON.parse(await (await f.env.ASSETS.get(`website-previews/${out.token}/data.json`)).text());
  assert.equal(after.site.brand, ''); assert.equal(after.site.photos.length, 2); assert.ok(after.site.logo);
  // Not an image, or too many photos: refused, nothing changes.
  const bad = new FormData(); bad.set('logo', new File([new TextEncoder().encode('<svg onload=alert(1)>')], 'x.png', { type: 'image/png' }));
  assert.equal((await post(bad)).status, 400);
  const many = new FormData(); for (let i = 0; i < 7; i++) many.append('photos', new File([PNG], `${i}.png`, { type: 'image/png' }));
  assert.equal((await post(many)).status, 400);
  assert.equal(JSON.parse(await (await f.env.ASSETS.get(`website-previews/${out.token}/data.json`)).text()).customized, 3, 'colour-only and Logo background updates counted; refused ones not');
  // An ended preview can't be changed.
  f.env.DB.raw.prepare(`UPDATE website_previews SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
  assert.equal((await post(form)).status, 410);
  assert.equal((await f.get(`/api/website-preview/view/${out.token}/d/farmhouse/img/logo.png`)).status, 404);
});

test('Customize details: motto, About, contact details, social and order links go into every design; bad links are refused', async (t) => {
  const f = setup();
  stubApis(t);
  const out = await (await f.create({ request_id: await f.upload(), email: 'owner@pizza.example', business: 'Sample Pizza', phone: '(415) 555-0100' })).json();
  const first = await (await f.get(`/api/website-preview/view/${out.token}/d/bistro/index.html`)).text();
  for (const name of ['motto', 'about', 'phone', 'email', 'address', 'hours', 'instagram', 'facebook', 'tiktok', 'yelp', 'order_url', 'order_label']) assert.match(first, new RegExp(`name="${name}"`), name);
  assert.match(first, /name="phone" value="\(415\) 555-0100"/, 'fields start with what we have');
  const post = (form) => f.call(`/api/website-preview/customize/${out.token}`, { method: 'POST', body: form });
  const form = new FormData();
  form.set('design', 'fresh');
  form.set('motto', 'Wood-fired since 1998');
  form.set('about', 'Family-run on Columbus Ave.\n\nDough rests 48 hours.');
  form.set('phone', '(415) 555-0199'); form.set('email', 'Hello@SamplePizza.example'); form.set('address', '1 Grant Ave, San Francisco, CA'); form.set('hours', 'Mon-Sun: 11am-10pm');
  form.set('instagram', '@samplepizza'); form.set('facebook', 'facebook.com/samplepizza'); form.set('tiktok', ''); form.set('yelp', 'https://www.yelp.com/biz/sample-pizza');
  form.set('order_url', 'https://order.toasttab.com/online/sample-pizza'); form.set('order_label', 'Order online');
  assert.equal((await post(form)).status, 303);
  const data = JSON.parse(await (await f.env.ASSETS.get(`website-previews/${out.token}/data.json`)).text());
  assert.equal(data.site.instagram, 'https://www.instagram.com/samplepizza');
  assert.equal(data.site.facebook, 'https://facebook.com/samplepizza');
  assert.equal(data.site.email, 'hello@samplepizza.example');
  for (const key of ['trattoria', 'bistro', 'night', 'farmhouse', 'fine', 'fresh', 'pop', 'coastal', 'taproom']) {
    const pages = (await Promise.all(['index', 'about', 'contact'].map(async (p) => (await f.get(`/api/website-preview/view/${out.token}/d/${key}/${p}.html`)).text()))).join('');
    for (const words of ['Wood-fired since 1998', 'Dough rests 48 hours.', 'tel:4155550199', '1 Grant Ave', 'mailto:hello@samplepizza.example', 'https://www.instagram.com/samplepizza', 'https://www.yelp.com/biz/sample-pizza', 'href="https://order.toasttab.com/online/sample-pizza"', 'class="foot-social"']) assert.ok(pages.includes(words), `${key}: ${words}`);
    assert.ok(!pages.includes('tiktok.com'), `${key}: an empty link is left out`);
  }
  // Booking label; then bad input is refused and nothing changes.
  const book = new FormData(); book.set('design', 'fine'); book.set('order_url', 'opentable.com/r/sample'); book.set('order_label', 'Book a table');
  assert.equal((await post(book)).status, 303);
  assert.match(await (await f.get(`/api/website-preview/view/${out.token}/d/bistro/index.html`)).text(), />Book a table</);
  for (const [field, value] of [['instagram', 'https://evil.example/x'], ['facebook', 'javascript:alert(1)'], ['order_url', 'not a link at all'], ['email', 'nope']]) {
    const bad = new FormData(); bad.set(field, value);
    assert.equal((await post(bad)).status, 400, `${field}: ${value}`);
  }
  const after = JSON.parse(await (await f.env.ASSETS.get(`website-previews/${out.token}/data.json`)).text());
  assert.equal(after.site.instagram, 'https://www.instagram.com/samplepizza'); assert.equal(after.site.email, 'hello@samplepizza.example');
});

test('a current website adds its about text, phone and address; the public limits hold', async (t) => {
  const f = setup();
  const calls = stubApis(t);
  const out = await (await f.create({ request_id: await f.upload({ email: 'a@pizza.example' }), email: 'a@pizza.example', business: 'Sample Pizza', website: 'pizza.example' })).json();
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(calls.site, 1); assert.equal(calls.facts, 1);
  const contact = await (await f.get(`/api/website-preview/view/${out.token}/contact.html`)).text();
  assert.match(contact, /1 Main St, San Francisco/);
  // Same email again: the same preview back, no new build.
  const again = await (await f.create({ request_id: await f.upload({ email: 'a@pizza.example' }), email: 'a@pizza.example', business: 'Sample Pizza' })).json();
  assert.equal(again.reused, true);
  for (let i = 1; i < PER_NETWORK_DAY; i++) await f.create({ request_id: await f.upload({ email: `n${i}@pizza.example` }), email: `n${i}@pizza.example`, business: 'X' });
  const blocked = await f.create({ request_id: await f.upload({ email: 'z@pizza.example' }), email: 'z@pizza.example', business: 'Y' });
  assert.equal(blocked.status, 429);
});

test('ended and unknown previews show a plain ended page', async (t) => {
  const f = setup();
  stubApis(t);
  const out = await (await f.create({ request_id: await f.upload({ email: 'b@pizza.example' }), email: 'b@pizza.example', business: 'Sample Pizza' })).json();
  f.env.DB.raw.prepare(`UPDATE website_previews SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
  const ended = await f.get(new URL(out.url).pathname);
  assert.equal(ended.status, 410);
  assert.equal((await f.get(`/api/website-preview/view/${'a'.repeat(36)}/index.html`)).status, 410);
});

test('clicking through every page of all nine designs counts nine opens; there is no open limit', async (t) => {
  const f = setup();
  stubApis(t);
  const out = await (await f.create({ request_id: await f.upload({ email: 'c@pizza.example' }), email: 'c@pizza.example', business: 'Sample Pizza' })).json();
  const { DESIGN_KEYS } = await import('./src/producers/website/templates/designs.js');
  for (const key of DESIGN_KEYS) for (const page of ['index', 'menu', 'about', 'contact']) {
    const res = await f.get(`/api/website-preview/view/${out.token}/d/${key}/${page}.html`);
    assert.ok([200, 404, 410].includes(res.status));
    assert.notEqual(res.status, 410, `${key}/${page} must not end the preview`);
  }
  const opens = () => f.env.DB.raw.prepare(`SELECT open_count AS n FROM website_previews WHERE token = ?`).get(out.token).n;
  assert.equal(opens(), DESIGN_KEYS.length);
  f.env.DB.raw.prepare(`UPDATE website_previews SET open_count = 5000`).run();
  assert.equal((await f.get(`/api/website-preview/view/${out.token}/d/bistro/index.html`)).status, 200, 'no open limit (owner, Nov 7, 2026): only the end date');
});

async function prospectSetup(rows) {
  const f = setup();
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const kid = `kid-site-${crypto.randomUUID()}`;
  f.env.RENDER_OIDC_FETCH = async () => Response.json({ keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' }] });
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-prospect-drafts', exp: now + 300, nbf: now - 5, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master',
    job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/prospect-drafts.yml@refs/heads/master', event_name: 'workflow_dispatch' };
  const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })); const b = b64u(JSON.stringify(claims));
  const jwt = `${h}.${b}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${b}`))))}`;
  f.post = (path, body) => f.call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) });
  const t = new Date().toISOString();
  for (const r of rows) f.env.DB.raw.prepare(`INSERT INTO prospects (id, name, city, address, phone, website, cuisine, status, gaps_json, offer_code, email, found_at, checked_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?)`)
    .run(r.id, r.name, r.city || null, r.address || null, r.phone || null, r.website || null, r.cuisine || null, r.gaps, r.offer, r.email, t, t, t);
  return f;
}

test('prospects: a bad-on-phone site is rebuilt from its own page; a no-website business from its listing; follow-ups know it is a website', async (t) => {
  const f = await prospectSetup([
    { id: 'node/10', name: 'Sample Pizza', website: 'https://pizza.example', gaps: '["no_phone_layout"]', offer: 'CONVERSION_FIX', email: 'hi@pizza.example' },
    { id: 'node/11', name: 'Corner Deli', city: 'Oakland', address: '9 Elm St, Oakland', phone: '510-555-0101', cuisine: 'sandwich', gaps: '["no_website"]', offer: 'WEBSITE_PACKAGE', email: 'hi@deli.example' },
    { id: 'node/12', name: 'Ghost Cafe', gaps: '["no_website"]', offer: 'WEBSITE_PACKAGE', email: 'hi@ghost.example' }
  ]);
  const calls = stubApis(t);
  const rebuilt = await (await f.post('/api/system/prospects/site-demo', { id: 'node/10' })).json();
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt)); assert.equal(rebuilt.from, 'their website');
  assert.equal(calls.site, 1);
  const html = await (await f.get(new URL(rebuilt.url).pathname)).text();
  assert.match(html, /A private preview made for you by Menu-made/);
  const listing = await (await f.post('/api/system/prospects/site-demo', { id: 'node/11' })).json();
  assert.equal(listing.ok, true, JSON.stringify(listing)); assert.equal(listing.from, 'their listing');
  const pages = f.env.DB.raw.prepare(`SELECT page_count FROM website_previews WHERE prospect_id = 'node/11'`).get().page_count;
  assert.equal(pages, 3, 'no menu: home, about, contact');
  const empty = await (await f.post('/api/system/prospects/site-demo', { id: 'node/12' })).json();
  assert.equal(empty.ok, false); assert.match(empty.skip, /not enough public details/);
  assert.equal((await (await f.post('/api/system/prospects/site-demo', { id: 'node/10' })).json()).reused, true);
  // Sent 4 days ago, preview made before the send and opened once: a website follow-up.
  const old = new Date(Date.now() - 5 * 86400000).toISOString();
  f.env.DB.raw.prepare(`UPDATE prospect_demos SET created_at = ? WHERE prospect_id = 'node/10'`).run(old);
  f.env.DB.raw.prepare(`UPDATE prospects SET status = 'SENT', sent_at = ? WHERE id = 'node/10'`).run(new Date(Date.now() - 4 * 86400000).toISOString());
  await f.get(new URL(rebuilt.url).pathname);
  const list = await (await f.post('/api/system/prospects/followups', {})).json();
  const item = list.prospects.find((p) => p.id === 'node/10');
  assert.equal(item.kind, 'opened'); assert.equal(item.demo_kind, 'website'); assert.equal(item.url, rebuilt.url);
});

test('Customize: "Logo background" and the logo measurement are kept and reach the designs', async () => {
  const { logoBgSelect } = await import('./src/marketing/logo-measure.js');
  assert.match(logoBgSelect('dark'), /<option value="dark" selected>Dark badge<\/option>/);
  assert.match(logoBgSelect(), /<option value="auto" selected>Automatic<\/option>/);
});
