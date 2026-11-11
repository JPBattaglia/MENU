// Hybrid Mobile Apps (src/store-app/hybrid.js, owner decision Nov 8, 2026): the live content the owner's two apps'
// native screens draw from, the route, the build config's hybrid_url, and the app shell's configure step.
// Run: node --no-warnings --test booking-api/hybrid-app.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hybrid = await import('./src/store-app/hybrid.js');

const NINO_CATALOG = {
  shop: { collections: [{ id: 'retro', name: 'Retro' }, { id: 'bad id!', name: 'x' }] },
  products: [
    { id: '455597876', slug: 'skull-wave', title: 'Skull Wave', image: 'assets/products/455597876.webp', category: 'Originals', collections: ['ninos-picks'], description: 'A wave.', featured: true, price: { amount: 2500 }, accent: '#1188ff',
      options: { colors: [{ name: 'Black', hex: '#141313' }, { name: 'Bad', hex: 'red' }], sizes: ['S', 'M'] } },
    { id: '1', slug: 'Bad Slug', title: 'Nope', image: 'x.webp' },
    { id: '2', slug: 'no-image', title: 'No image', image: 'javascript:alert(1)' },
    { id: '3', slug: 'retro-tv', title: 'Retro TV', image: 'https://ninobattaglia.com/assets/products/3.webp', collections: ['retro'], price: { amount: 2700 } }
  ]
};

test('nino: designs with absolute https photos, prices, colours, sizes and in-app buy links', () => {
  const c = hybrid.ninoContent(NINO_CATALOG);
  assert.deepEqual(c.tabs, ['shop', 'ideas', 'rewards', 'cart', 'work']);
  assert.equal(c.fans_api, 'https://nino-printful-commerce-api.ijpbattaglia.workers.dev');
  assert.deepEqual(c.collections, [{ id: 'retro', name: 'Retro' }]);
  assert.deepEqual(c.products.map((p) => p.slug), ['skull-wave', 'retro-tv'], 'bad slugs and non-https images dropped; featured first');
  const p = c.products[0];
  assert.equal(p.image, 'https://ninobattaglia.com/assets/products/455597876.webp');
  assert.equal(p.price_cents, 2500);
  assert.deepEqual(p.colors, [{ name: 'Black', hex: '#141313' }]);
  assert.deepEqual(p.sizes, ['S', 'M']);
  assert.equal(p.buy_url, 'https://ninobattaglia.com/shop.html?product=455597876');
  assert.equal(p.url, 'https://ninobattaglia.com/shirts/skull-wave.html');
  assert.equal(c.links.cart, 'https://ninobattaglia.com/cart.html');
  assert.deepEqual(c.rewards.steps.map((x) => [x.at, x.tier]), [[3, 'canvas'], [6, 'hoodie']]);
});

test('menumade: the three plans with live prices, described by their included services', () => {
  const c = hybrid.menumadeContent({ ok: true, offers: [
    { code: 'BUNDLE_PRO', name: 'Pro Plan', on_sale: true, prices: { month: 27900, year: 279000 }, includes: ['MENU_CARE'] },
    { code: 'BUNDLE_STARTER', name: 'Starter Plan', on_sale: true, prices: { month: 7900, year: 79000 }, includes: ['MENU_CARE', 'REVIEW_REPLIES', 'ACCESSIBILITY_MONITORING'] },
    { code: 'BUNDLE_GROWTH', name: 'Growth Plan', on_sale: false, prices: { month: 16900 } },
    { code: 'MENU_CARE', name: 'Menu Care', on_sale: true, prices: { month: 2900 } },
    { code: 'REVIEW_REPLIES', name: 'Review Replies', on_sale: true, prices: { month: 4900 } },
    { code: 'ACCESSIBILITY_MONITORING', name: 'Accessibility Monitoring', on_sale: true, prices: { month: 3900 } }
  ] });
  assert.deepEqual(c.tabs, ['home', 'preview', 'plans', 'account']);
  assert.deepEqual(c.plans.map((p) => [p.name, p.month_cents, p.year_cents]), [['Starter', 7900, 79000], ['Pro', 27900, 279000]], 'off-sale plans hidden, Starter first');
  assert.equal(c.plans[0].description, 'Includes Menu Care, Review Replies and Accessibility Monitoring');
  assert.equal(c.plans[0].checkout_year, 'https://menu-made.com/contact.html?plan=BUNDLE_STARTER&interval=year');
  assert.equal(c.preview.upload_url, 'https://menu-made.com/api/inquiry');
  // Nov 10, 2026: the generators run inside the app, and the chooser says what each one's three buttons do.
  assert.deepEqual(c.generators.map((g) => [g.key, g.buttons.map((b) => b.label)]), [['menu', ['Generate menu', 'Customize', 'Make it live']], ['site', ['Generate site', 'Customize', 'Choose this site']]]);
  assert.equal(c.generators[0].state_url, 'https://menu-made.com/api/menu-preview/state/');
  assert.equal(c.generators[1].create_url, 'https://menu-made.com/api/website-preview/create');
  assert.match(c.generators[0].buttons[2].text, /\$\d+ for the first year/);
  assert.deepEqual(c.services.map((v) => [v.name, v.price]), [['Menu Care', '$29/mo'], ['Review Replies', '$49/mo'], ['Accessibility Monitoring', '$39/mo']], 'services with prices; bundles are the plans');
  const off = hybrid.menumadeContent({ ok: true, offers: [{ code: 'STORE_APP_SETUP', name: 'Mobile App Setup', kind: 'ONE_TIME', on_sale: true, price_cents: 99900 }, { code: 'ONLINE_MENU_QR', name: 'Online Menu + QR', kind: 'ONE_TIME', on_sale: true, price_cents: 12900 }] }, { offCodes: ['STORE_APP_SETUP', 'STORE_APP_CARE'] });
  assert.deepEqual(off.services.map((v) => v.name), ['Online Menu + QR'], 'a service switched off for sale is not listed');
  assert.match(off.services[0].price, /^\$\d+ first year$/);
  assert.ok(c.work.length >= 4 && c.work.every((w) => /^https:\/\/menu-made\.com\/assets\/work\//.test(w.image)));
  assert.match(c.hero.image, /^https:\/\/menu-made\.com\//);
});

test('the route answers public JSON with CORS, refuses unknown apps, and says unavailable when the source fails', async () => {
  const req = (key, method = 'GET') => new Request(`https://menu-made.com/api/app-hybrid/${key}`, { method });
  const ok = await hybrid.handleHybridContent(req('nino'), {}, 'nino', { cacheStore: null, fetchImpl: async () => Response.json(NINO_CATALOG) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(ok.headers.get('Cache-Control'), /max-age=300/);
  assert.equal((await ok.json()).products.length, 2);
  assert.equal((await hybrid.handleHybridContent(req('other'), {}, 'other', { cacheStore: null })).status, 404);
  assert.equal((await hybrid.handleHybridContent(req('nino', 'POST'), {}, 'nino', { cacheStore: null })).status, 404);
  const down = await hybrid.handleHybridContent(req('nino'), {}, 'nino', { cacheStore: null, fetchImpl: async () => new Response('', { status: 500 }) });
  assert.equal(down.status, 503);
  assert.equal(down.headers.get('Cache-Control'), 'no-store');
});

test('only the owner\'s two apps are hybrid', () => {
  assert.equal(hybrid.hybridUrlForBundle('com.menumade.menumade'), 'https://menu-made.com/api/app-hybrid/menumade');
  assert.equal(hybrid.hybridUrlForBundle('com.menumade.ninobattaglia'), 'https://menu-made.com/api/app-hybrid/nino');
  assert.equal(hybrid.hybridUrlForBundle('com.menumade.samplecafe'), '');
});

test('the app shell: configure.mjs writes hybrid_url (and drops site_url), refuses other addresses; screens load hybrid.js', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hy-'));
  const shell = new URL('../app-shell/', import.meta.url).pathname;
  const run = (cfg) => { const f = join(dir, 'b.json'); writeFileSync(f, JSON.stringify(cfg)); return execFileSync('node', [join(shell, 'configure.mjs'), f], { encoding: 'utf8', stdio: 'pipe' }); };
  const base = { app_id: 'com.menumade.ninobattaglia', app_name: 'Nino Battaglia', brand_color: '#200705', api_base: 'https://ninos-ts.menu-made.com/app/api', site_url: 'https://ninobattaglia.com/shop.html' };
  const files = [join(shell, 'capacitor.config.json'), join(shell, 'www/config.json')];
  const before = files.map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : null));
  try {
    run({ ...base, hybrid_url: 'https://menu-made.com/api/app-hybrid/nino', intro_url: 'https://menu-made.com/assets/own-apps/nino-intro-neon.mp4', loader_url: 'https://menu-made.com/assets/own-apps/nino-loader.webp' });
    const www = JSON.parse(readFileSync(join(shell, 'www/config.json'), 'utf8'));
    assert.equal(www.hybrid_url, 'https://menu-made.com/api/app-hybrid/nino');
    assert.equal(www.site_url, undefined);
    assert.equal(www.intro_url, 'https://menu-made.com/assets/own-apps/nino-intro-neon.mp4');
    assert.equal(www.loader_url, 'https://menu-made.com/assets/own-apps/nino-loader.webp');
    run({ ...base, hybrid_url: 'https://menu-made.com/api/app-hybrid/nino', intro_url: 'https://evil.example/x.mp4', loader_url: 'https://menu-made.com/x.svg' });
    const dropped = JSON.parse(readFileSync(join(shell, 'www/config.json'), 'utf8'));
    assert.equal(dropped.intro_url, undefined, 'an intro from anywhere but menu-made.com is left out');
    assert.equal(dropped.loader_url, undefined, 'only webp, gif or png loaders');
    // The name under the icon (owner, Nov 10, 2026): "Nino" and "MΞNU", while the listing names stay as they are.
    run({ ...base, hybrid_url: 'https://menu-made.com/api/app-hybrid/nino', app_label: 'Nino' });
    assert.equal(JSON.parse(readFileSync(join(shell, 'capacitor.config.json'), 'utf8')).appName, 'Nino');
    assert.equal(JSON.parse(readFileSync(join(shell, 'www/config.json'), 'utf8')).app_name, 'Nino Battaglia');
    run({ ...base, app_name: 'MENU-MADE', hybrid_url: 'https://menu-made.com/api/app-hybrid/menumade', app_label: 'M\u039eNU' });
    assert.equal(JSON.parse(readFileSync(join(shell, 'capacitor.config.json'), 'utf8')).appName, 'MΞNU');
    run({ ...base, hybrid_url: 'https://menu-made.com/api/app-hybrid/nino' });
    assert.equal(JSON.parse(readFileSync(join(shell, 'capacitor.config.json'), 'utf8')).appName, 'Nino Battaglia', 'no label: the app name');
    assert.throws(() => run({ ...base, app_label: 'x'.repeat(31) }));
    assert.throws(() => run({ ...base, hybrid_url: 'https://evil.example/api/app-hybrid/nino' }));
  } finally {
    files.forEach((f, i) => (before[i] === null ? rmSync(f, { force: true }) : writeFileSync(f, before[i])));
  }
  const html = readFileSync(join(shell, 'www/index.html'), 'utf8');
  assert.ok(html.indexOf('hybrid.js') > 0 && html.indexOf('hybrid.js') < html.indexOf('app.js'), 'hybrid.js loads before app.js');
  const js = readFileSync(join(shell, 'www/hybrid.js'), 'utf8');
  assert.doesNotMatch(js, /innerHTML/, 'text only through textContent');
  // Nino's shop is bought inside the app (owner, Nov 10, 2026): no button that only sends the buyer to the website.
  assert.doesNotMatch(js, /See the design page|Open my cart/);
  // Menu-made's generators show their designs in a frame on the app's own screen (the page allows only menu-made.com).
  assert.match(html, /frame-src https:\/\/menu-made\.com/);
  assert.match(js, /Start the /); assert.doesNotMatch(js, /More about Online Menu/);
  assert.match(js, /Add to cart/); assert.match(js, /\/api\/shipping-quotes/); assert.match(js, /\/api\/checkout/);
});

test('each own app carries its home-screen label', () => {
  assert.equal(hybrid.hybridLookForBundle('com.menumade.ninobattaglia').label, 'Nino');
  assert.equal(hybrid.hybridLookForBundle('com.menumade.menumade').label, 'MΞNU');
});

test('nino: designs from the shop\'s new list join the catalog; the first 24 hours are early access and come first', () => {
  const now = 1_800_000_000;
  const c = hybrid.ninoContent(NINO_CATALOG, { designs: [
    { id: '777', title: 'Fresh Drop', image: 'https://ninobattaglia.com/x.webp', price_cents: 2500, released_at: now - 3600 },
    { id: '455597876', title: 'Skull Wave', image: 'https://x/y', released_at: now - 3 * 86400 },
    { id: '888', title: 'No picture', image: 'http://insecure/x.png', released_at: now - 10 }
  ] }, now);
  assert.deepEqual(c.products.map((p) => [p.slug, Boolean(p.early)]), [['new-777', true], ['skull-wave', false], ['retro-tv', false]]);
  assert.equal(c.products[0].buy_url, 'https://ninobattaglia.com/shop.html?product=777');
});

test('new-design pushes: one notification for the designs entering early access, never twice', async () => {
  const now = 1_800_000_000;
  const settings = new Map(); const pushes = [];
  const stmt = (sql, a) => ({
    first: async () => /FROM worker_settings/.test(sql) ? (settings.has(a[0]) ? { value: settings.get(a[0]) } : null)
      : /FROM guest_apps/.test(sql) ? { id: 'app-nino' }
      : /COUNT\(\*\) AS n FROM push_messages/.test(sql) ? { n: 0 } : null,
    run: async () => { if (/INSERT INTO worker_settings/.test(sql)) settings.set(a[0], a[1]); if (/INSERT INTO push_messages/.test(sql)) pushes.push(a); return { meta: { changes: 1 } }; },
    all: async () => ({ results: [] })
  });
  const db = { prepare: (sql) => ({ ...stmt(sql, []), bind: (...a) => stmt(sql, a) }) };
  const releases = { designs: [{ id: '1', title: 'Fresh Drop', released_at: now - 60 }, { id: '2', title: 'Old One', released_at: now - 3 * 86400 }] };
  const fetchImpl = async () => Response.json(releases);
  const env = { DB: db };
  const first = await hybrid.announceNinoDrops(env, { fetchImpl, nowSeconds: now });
  assert.deepEqual(first.announced, ['1']);
  assert.equal(pushes.length, 1);
  assert.match(pushes[0][2], /New design: Fresh Drop/);
  assert.deepEqual((await hybrid.announceNinoDrops(env, { fetchImpl, nowSeconds: now })).none, true, 'not announced twice');
});

test('the MΞNU icon has its own darker background; an app without one keeps its brand colour', async () => {
  const { storeIconSvg } = await import('./src/producers/guest-app/build.js');
  assert.equal(hybrid.hybridLookForBundle('com.menumade.menumade').icon_bg, '#012a30');
  const app = { app_name: 'MENU-MADE', brand_color: '#013f45' };
  assert.match(storeIconSvg(app, { hasLogo: true, background: '#00161b' }), /<rect width="512" height="512" fill="#00161b"\/>/);
  assert.match(storeIconSvg(app, { hasLogo: true }), /fill="#013f45"/);
  assert.match(storeIconSvg(app, { hasLogo: true, background: 'nope' }), /fill="#013f45"/);
});

test('menumade: the Holiday menu generator is sent in season, in a field older app builds ignore', () => {
  const offers = [{ code: 'HOLIDAY_MENU', name: 'Holiday Menu', kind: 'ONE_TIME', on_sale: true, price_cents: 5900 }];
  const nov = hybrid.menumadeContent({ ok: true, offers }, { now: Date.parse('2026-11-20T18:00:00Z') });
  assert.deepEqual(nov.generators.map((g) => g.key), ['menu', 'site'], 'the two regular generators are unchanged');
  assert.equal(nov.seasonal.length, 1);
  const g = nov.seasonal[0];
  assert.deepEqual([g.key, g.noun, g.count, g.badge], ['holiday', 'holiday menu', 6, '$59 per holiday']);
  assert.deepEqual(g.occasions, [{ key: 'christmas', label: 'Christmas' }, { key: 'newyear', label: "New Year's Eve" }]);
  assert.equal(g.create_url, 'https://menu-made.com/api/menu-preview/create');
  assert.equal(g.state_url, 'https://menu-made.com/api/menu-preview/state/');
  assert.match(g.buttons[2].text, /\$59 for one holiday.*second holiday menu this season is \$30/);
  assert.equal(g.strip.text, "your Christmas and New Year's Eve menus online with a QR code, $59 per holiday.");
  assert.deepEqual([g.popup.title, g.popup.price, g.popup.price_note, g.popup.action], ['Get your Christmas menu online', '$59', "per holiday, or $89 for Christmas and New Year's Eve", 'See my holiday menu free']);
  const dec = hybrid.menumadeContent({ ok: true, offers }, { now: Date.parse('2026-12-27T18:00:00Z') }).seasonal[0];
  assert.deepEqual(dec.occasions, [{ key: 'newyear', label: "New Year's Eve" }], 'after Christmas only New Year\'s Eve');
  assert.match(dec.card_text, /^Your New Year's Eve menu/);
  assert.deepEqual([dec.popup.title, dec.popup.price_note, dec.strip.text], ["Get your New Year's Eve menu online", 'nothing renews', "your New Year's Eve menu online with a QR code, $59 per holiday."]);
  assert.deepEqual(hybrid.menumadeContent({ ok: true, offers }, { now: Date.parse('2027-01-02T18:00:00Z') }).seasonal, [], 'gone after the season');
  assert.deepEqual(hybrid.menumadeContent({ ok: true, offers }, { now: Date.parse('2026-11-20T18:00:00Z'), offCodes: ['HOLIDAY_MENU'] }).seasonal, [], 'gone when its Selling switch is off');
  assert.deepEqual(hybrid.menumadeContent({ ok: true, offers: [] }, { now: Date.parse('2026-11-20T18:00:00Z') }).seasonal, [], 'gone when it is not on sale');
  const js = readFileSync(new URL('../app-shell/www/hybrid.js', import.meta.url), 'utf8');
  assert.match(js, /occasion: occasions\.length \? gen\.occasion : undefined/, 'the app sends the chosen holiday with the preview');
  assert.match(js, /function allGens\(\) \{ return seasonal\(\)\.concat\(data\.generators/);
});
