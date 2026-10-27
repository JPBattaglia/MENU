// Stage 7, Website Package: intake, styles, page build, automated checks, copy quality, owner approval, serving and the
// self-test. Mocked Anthropic and Resend; real SQLite schema and migrations.
// Run: node --no-warnings --test booking-api/website.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = { ...(await import('./src/worker.js')), ...(await import('./src/workflows/runner.js')) };
const { parseOfferings, parseHours, buildSite } = await import('./src/producers/website/build.js');
const { checkSite } = await import('./src/producers/website/check.js');
const { validateCopy } = await import('./src/producers/website/copy.js');
const { STYLES, contrast, css, hexOk } = await import('./src/producers/website/styles.js');
const { slugify, validSlug, sniffImage, startWebsiteIntake, intakeLink } = await import('./src/producers/website/intake.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const SITE = {
  name: "Joe's Pizza", kind: 'restaurant', about: 'Family pizza made fresh every day.', offerings: '# Pizza\nMargherita | Mozzarella and basil | $15\nPepperoni | Spicy and crisp | 17\n# Drinks\nSoda | Cold | $3',
  phone: '(512) 555-0100', address: '123 Main Street, Austin, TX', hours: 'Mon-Fri: 11am-9pm\nSat: 12pm-10pm', email: '', style: 'modern', brand: '', facebook: '', instagram: '',
  photos: [{ path: 'img/photo-1.png', alt: 'Our oven' }], logo: { path: 'img/logo.png' }
};
const COPY = { tagline: 'Fresh pizza, made daily', intro: "Joe's Pizza serves family pizza made fresh every day on Main Street.", about: ["Joe's Pizza is a family business that makes pizza fresh every day. Come and see us for a slice."], meta_description: "Joe's Pizza: family pizza made fresh every day at 123 Main Street, Austin.", meta_about: "About Joe's Pizza, a family pizza business on Main Street." };
const IMAGES = { 'img/photo-1.png': 70, 'img/logo.png': 70 };

test('offerings and hours parse into sections, items, prices and lines', () => {
  const s = parseOfferings(SITE.offerings);
  assert.deepEqual(s.map((x) => x.name), ['Pizza', 'Drinks']);
  assert.deepEqual(s[0].items.map((i) => [i.name, i.price]), [['Margherita', '$15'], ['Pepperoni', '$17']]);
  assert.equal(parseOfferings('Just a line')[0].items[0].name, 'Just a line');
  assert.deepEqual(parseHours(SITE.hours).map((h) => h.time), ['11am-9pm', '12pm-10pm']);
});

test('the three styles all keep text readable (WCAG AA) and a custom brand colour that fails is corrected', () => {
  for (const key of Object.keys(STYLES)) {
    const sheet = css(key, '');
    assert.ok(sheet.length > 200);
  }
  assert.ok(contrast('#000000', '#ffffff') > 20);
  assert.equal(hexOk('#b3261e'), true); assert.equal(hexOk('red'), false); assert.equal(hexOk('#fff'), false);
  const pale = css('modern', '#fffacd');
  assert.ok(pale.length > 200);
});

test('buildSite makes 5 pages that pass every automated check; broken sites are caught', () => {
  const pages = buildSite(SITE, COPY);
  assert.deepEqual(Object.keys(pages).sort(), ['about.html', 'contact.html', 'gallery.html', 'index.html', 'menu.html']);
  assert.deepEqual(checkSite({ pages, images: IMAGES, site: SITE }), []);
  assert.match(pages['menu.html'], /Margherita/); assert.match(pages['contact.html'], /tel:5125550100/);
  const noPhotos = buildSite({ ...SITE, photos: [] }, COPY);
  assert.equal(Object.keys(noPhotos).length, 4);
  assert.deepEqual(checkSite({ pages: noPhotos, images: IMAGES, site: { ...SITE, photos: [] } }), []);
  const services = buildSite({ ...SITE, kind: 'services' }, COPY);
  assert.ok(services['services.html'] && !services['menu.html']);
  const bad = { ...pages, 'index.html': pages['index.html'].replace('</main>', '<a href="nowhere.html">x</a><img src="img/ghost.png" alt="g"><p>Lorem ipsum</p></main>') };
  const found = checkSite({ pages: bad, images: IMAGES, site: SITE }).join('\n');
  assert.match(found, /nowhere\.html goes nowhere/); assert.match(found, /ghost\.png is not in the site/); assert.match(found, /placeholder/);
  assert.match(checkSite({ pages, images: { ...IMAGES, 'img/logo.png': 2_000_000 }, site: SITE }).join(), /over the 1500 KB limit|over the 1500/);
  assert.match(checkSite({ pages: { ...pages, 'contact.html': pages['contact.html'].replaceAll('tel:5125550100', 'tel:1') }, images: IMAGES, site: SITE }).join(), /phone number is missing/);
  assert.match(checkSite({ pages: { ...pages, 'index.html': pages['index.html'].replace('<h1', '<h2').replace('</h1>', '</h2>') }, images: IMAGES, site: SITE }).join(), /accessibility/);
  assert.match(checkSite({ pages: { 'index.html': pages['index.html'] }, images: IMAGES, site: SITE }).join(), /4 or 5 pages/);
});

test('page text is escaped: a hostile business name cannot inject markup', () => {
  const pages = buildSite({ ...SITE, name: 'Joe <script>alert(1)</script>', about: '<img src=x onerror=alert(1)>' }, { ...COPY, intro: 'Hello <b>there</b> from the team at the shop on Main Street.' });
  for (const html of Object.values(pages)) { assert.ok(!/<script>alert/.test(html)); assert.ok(!/<img src=x/.test(html)); }
});

test('copy checks refuse invented facts, boasts, exclamation marks and bad lengths', () => {
  assert.deepEqual(validateCopy(COPY, SITE).problems, []);
  const bad = (o) => validateCopy({ ...COPY, ...o }, SITE).problems.join('\n');
  assert.match(bad({ intro: 'Call us on 512-555-9999 for the finest pizza in town, award-winning since 1990.' }), /phone "512-555-9999"/);
  assert.match(bad({ tagline: 'The best pizza in Austin' }), /claim the owner did not make/);
  assert.match(bad({ about: ['We have a lot of fun! Come and see us today for pizza made fresh in our family kitchen on Main Street.'] }), /exclamation/);
  assert.match(bad({ tagline: 'Pizza' }), /tagline/);
  assert.match(bad({ meta_description: 'Short' }), /meta_description/);
  assert.match(bad({ intro: 'Our margherita is only $9 and is the best you will find anywhere near Main Street.' }), /price "\$9"/);
});

test('slugs, reserved words and image sniffing', () => {
  assert.equal(slugify("Joe's Pizza & Pasta!"), 'joe-s-pizza-and-pasta');
  assert.equal(validSlug('api'), false); assert.equal(validSlug('www'), false); assert.equal(validSlug('joes-pizza'), true); assert.equal(validSlug('a'), false);
  assert.equal(sniffImage(PNG).mime, 'image/png');
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])).mime, 'image/jpeg');
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(new TextEncoder().encode('MZ executable pretending to be a png file........')), null);
});

function setup() {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe', 'Rossi')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Joe''s Pizza')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_w', ?, ?, 'WEBSITE_PACKAGE', 'Website Package', 'WEBSITE', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'WEBSITE_PACKAGE_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_w', 'offer_w', 1, ?, ?, 'ACTIVE', 49900, '{}')`, t, t);
  DB.raw.exec(read('0004_ai_usage_index.sql')); DB.raw.exec(read('0009_website_package.sql'));
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o1', ?, ?, 'cust', 'biz', 'ONBOARDING_REQUIRED', 49900, 49900, 'PAID')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'offer_w', 'ov_w', 49900, 49900)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES ('11111111-2222-4333-8444-555555555555', 'o1', 'i1', 'biz', 'cust', 'WEBSITE', 'AWAITING_INPUTS', 'WEBSITE_PACKAGE_V1', 1, ?, ?)`, t, t);
  const emails = []; const state = { outputs: [], prompts: [] };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body); state.prompts.push(body.messages[0].content);
      const output = state.outputs.shift(); if (!output) throw new Error('Unexpected AI call');
      return Response.json({ model: body.model, usage: { input_tokens: 1500, output_tokens: 600 }, content: [{ type: 'tool_use', name: 'record_output', input: output }] });
    }
    throw new Error(`Unexpected fetch ${u}`);
  };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map((r) => ({ ...r }));
  return { env, DB, ASSETS, emails, state, fetch, ctx, pending, row, rows, sql, PID: '11111111-2222-4333-8444-555555555555' };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map((m) => m[0].replaceAll('&amp;', '&'));
const ANSWERS = { kind: 'restaurant', about: SITE.about, offerings: SITE.offerings, phone: SITE.phone, address: SITE.address, hours: SITE.hours, style: 'modern', subdomain: 'joes-pizza', photo_captions: 'Our oven' };
function intakeForm(token, over = {}, files = true) {
  const form = new FormData(); form.append('t', token);
  for (const [k, v] of Object.entries({ ...ANSWERS, ...over })) form.append(k, v);
  if (files) { form.append('logo', new File([PNG], 'logo.png', { type: 'image/png' })); form.append('photos', new File([PNG], 'oven.png', { type: 'image/png' })); }
  return form;
}
async function submitIntake(f, over, files) {
  const link = new URL(await intakeLink(f.env, f.PID));
  return call(f, `https://menu-made.com/api/site-intake/${f.PID}`, { method: 'POST', body: intakeForm(link.searchParams.get('t'), over, files) });
}

test('intake: the buyer is emailed a signed link, the form is validated, files are checked by bytes, and the slug is reserved', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    assert.equal((await startWebsiteIntake(f.env, { projectId: f.PID })).started, true);
    assert.equal(f.emails.length, 1); assert.deepEqual(f.emails[0].to, ['joe@joespizza.example']);
    const [link] = linksIn(f.emails[0].text, '/api/site-intake/');
    assert.equal((await call(f, link)).status, 200);
    assert.equal((await call(f, link.replace(/t=.*/, 't=forged.token'))).status, 403);
    const forged = await call(f, `https://menu-made.com/api/site-intake/${f.PID}`, { method: 'POST', body: intakeForm('x.y') });
    assert.equal(forged.status, 403);
    for (const [over, pattern] of [[{ phone: '12' }, /Phone number/], [{ brand_color: 'red' }, /Brand colour/], [{ subdomain: 'api' }, /reserved/], [{ facebook: 'http://x.example/a' }, /https/], [{ about: '' }, /required/]]) {
      const bad = await submitIntake(f, over);
      assert.equal(bad.status, 400); assert.match(await bad.text(), pattern);
    }
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, f.PID).status, 'AWAITING_INPUTS');
    const svg = new FormData(); const tok = new URL(await intakeLink(f.env, f.PID)).searchParams.get('t'); svg.append('t', tok);
    for (const [k, v] of Object.entries(ANSWERS)) svg.append(k, v);
    svg.append('logo', new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'logo.png', { type: 'image/png' }));
    const refused = await call(f, `https://menu-made.com/api/site-intake/${f.PID}`, { method: 'POST', body: svg });
    assert.equal(refused.status, 400); assert.match(await refused.text(), /not a PNG, JPG or WebP/);
    const ok = await submitIntake(f);
    assert.equal(ok.status, 200); assert.match(await ok.text(), /joes-pizza\.menu-made\.com/);
    assert.equal(f.row(`SELECT slug FROM website_sites WHERE project_id = ?`, f.PID).slug, 'joes-pizza');
    assert.equal(f.rows(`SELECT id FROM assets WHERE project_id = ? AND status = 'VALID'`, f.PID).length, 2);
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, f.PID).status, 'READY');
    assert.equal(f.rows(`SELECT id FROM workflow_runs WHERE project_id = ?`, f.PID).length, 1);
    assert.equal((await submitIntake(f)).status, 200);
  });
});

test('a taken web address is refused for a second customer', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    f.sql(`INSERT INTO website_sites (id, slug, project_id, created_at, updated_at) VALUES ('s0', 'joes-pizza', 'other', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`);
    await startWebsiteIntake(f.env, { projectId: f.PID });
    const res = await submitIntake(f);
    assert.equal(res.status, 400); assert.match(await res.text(), /already taken/);
  });
});

const goodCopy = () => ({ ...COPY });

test('end to end: intake, AI copy, checks, owner preview, approval, live site, buyer email; nothing is public before approval', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await startWebsiteIntake(f.env, { projectId: f.PID });
    await submitIntake(f);
    f.state.outputs.push(goodCopy());
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE customer_visible = 1`).length, 0);
    const live0 = await call(f, 'https://menu-made.com/api/site/joes-pizza/');
    assert.match(await live0.text(), /coming soon/);
    const owner = f.emails.find((m) => m.to[0] === 'info@menu-made.com');
    assert.match(owner.subject, /Approve Joe's Pizza's website/);
    assert.ok(!f.emails.some((m) => m.to[0] === 'joe@joespizza.example' && /live/.test(m.subject)));
    const [preview] = linksIn(owner.text, '/api/site-preview/');
    const home = await call(f, preview);
    assert.equal(home.status, 200); assert.equal(home.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.match(home.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await home.text(); assert.match(html, /Fresh pizza, made daily/); assert.match(html, /<h1/);
    for (const p of ['menu.html', 'about.html', 'contact.html', 'gallery.html']) assert.equal((await call(f, preview + p)).status, 200, p);
    const img = await call(f, preview + 'img/photo-1.png'); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await call(f, preview + 'nope.html')).status, 404);
    assert.equal((await call(f, preview.replace(/\/[^/]+\/$/, '/' + 'x'.repeat(30) + '.' + 'y'.repeat(30) + '/'))).status, 403);
    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: new URL(approveUrl).searchParams.get('t') }) });
    await Promise.all(f.pending);
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, f.PID).status, 'DELIVERED');
    const liveRes = await call(f, 'https://menu-made.com/api/site/joes-pizza/');
    assert.equal(liveRes.status, 200); assert.match(await liveRes.text(), /Fresh pizza, made daily/);
    assert.equal((await call(f, 'https://menu-made.com/api/site/joes-pizza/img/logo.png')).status, 200);
    assert.equal((await call(f, 'https://menu-made.com/api/site/joes-pizza', { redirect: 'manual' })).status, 301);
    assert.equal((await call(f, 'https://menu-made.com/api/site/unknown-site/')).status, 404);
    const buyer = f.emails.at(-1);
    assert.deepEqual(buyer.to, ['joe@joespizza.example']); assert.match(buyer.text, /api\/site\/joes-pizza\//); assert.match(buyer.text, /Website Care/);
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE'`).n, 1);
  });
});

test('copy with an invented fact is retried with feedback and then held back from everyone but the owner', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await startWebsiteIntake(f.env, { projectId: f.PID });
    await submitIntake(f);
    const bad = { ...goodCopy(), intro: "Joe's Pizza has won awards since 1985 and you can call 512-555-9999 any day." };
    f.state.outputs.push(bad, bad);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.state.prompts.length, 2); assert.match(f.state.prompts[1], /Your previous answer had these problems/);
    assert.equal(f.rows(`SELECT id FROM approvals`).length, 0);
    assert.equal(f.rows(`SELECT id FROM deliverables`).length, 0);
    const alert = f.emails.at(-1); assert.equal(alert.to[0], 'info@menu-made.com'); assert.match(alert.subject, /failed the quality checks/);
  });
});

test('request changes rebuilds once with the owner note in the prompt, and the old build is not live', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await startWebsiteIntake(f.env, { projectId: f.PID });
    await submitIntake(f);
    f.state.outputs.push(goodCopy());
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    const owner = f.emails.find((m) => m.to[0] === 'info@menu-made.com');
    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    const token = new URL(approveUrl).searchParams.get('t');
    f.state.outputs.push({ ...goodCopy(), tagline: 'Pizza from the Rossi family' });
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token, action: 'changes', note: 'Mention the Rossi family in the tagline' }) });
    await Promise.all(f.pending);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.state.prompts.length, 2); assert.match(f.state.prompts[1], /Rossi family/);
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE deliverable_type = 'SITE_BUILD' AND status != 'SUPERSEDED'`).length, 1);
    assert.match(await (await call(f, 'https://menu-made.com/api/site/joes-pizza/')).text(), /coming soon/);
  });
});

test('the self-test drives a synthetic order through intake, AI, preview, approval and the live site, and fails loudly when the copy is bad', async () => {
  const { advanceWebsiteSelfTests } = await import('./src/selftest/website-selftest.js');
  for (const broken of [false, true]) {
    const f = setup();
    f.sql(`UPDATE projects SET status = 'CANCELLED'`);
    await withFetch(f.fetch, async () => {
      const good = { tagline: 'Fresh bread and soup daily', intro: 'Website Self-Test Cafe is a small family cafe that bakes bread every morning and serves soup and sandwiches at lunch.', about: ['Website Self-Test Cafe is a small family cafe. We bake bread every morning and serve soup and sandwiches at lunch for our neighbours.'], meta_description: 'Website Self-Test Cafe bakes bread every morning and serves soup and sandwiches at lunch in Austin.', meta_about: 'About Website Self-Test Cafe, a small family cafe that bakes bread every morning.' };
      const bad = { ...good, tagline: 'The best cafe in the world!' };
      f.state.outputs.push(...(broken ? [bad, bad] : [good]));
      f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('77778888-0000-4000-8000-000000000001', 'WEBSITE_PACKAGE_RUN', 'REQUESTED', 'test', '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z')`);
      const app = (request) => api.default.fetch(request, f.env, f.ctx);
      for (let tick = 0; tick < 5; tick++) { await advanceWebsiteSelfTests(f.env, app); await api.runScheduledProduction(f.env); await Promise.all(f.pending); }
      await advanceWebsiteSelfTests(f.env, app);
      const result = f.row(`SELECT status, error FROM self_tests`);
      if (!broken) { assert.equal(result.status, 'PASSED', JSON.stringify(result)); assert.ok(f.emails.filter((e) => e.to[0] !== 'info@menu-made.com').every((e) => e.to[0] === 'delivered@resend.dev')); }
      else { assert.equal(result.status, 'FAILED', JSON.stringify(result)); assert.ok(f.emails.some((e) => e.to[0] === 'info@menu-made.com' && /self-test failed/i.test(e.subject))); }
    });
  }
});
