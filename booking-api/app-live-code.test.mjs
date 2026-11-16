// Live screen updates for the store apps (app-shell/www/live.js, owner Nov 14, 2026): the app runs the newest
// hybrid.js / app.js / app.css from menu-made.com, falls back to the bundled copy, and skips a copy that crashed.
// Run: node --no-warnings --test booking-api/app-live-code.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const LIVE = readFileSync(new URL('../app-shell/www/live.js', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../app-shell/www/index.html', import.meta.url), 'utf8');
const GOOD = { 'hybrid.js': 'window.MMHybrid={};', 'app.js': '/* hybrid_url */ 1;', 'app.css': 'body{}' };

function run({ storage = {}, remote = GOOD, ok = true } = {}) {
  const store = new Map(Object.entries(storage));
  const scripts = [], styles = [], timers = [], listeners = {};
  const link = { disabled: false };
  const node = (tag) => ({ tag, set src(v) { this._src = v; }, get src() { return this._src; } });
  const document = {
    hidden: false,
    head: { appendChild: (n) => styles.push(n) },
    body: { appendChild: (n) => scripts.push(n) },
    createElement: node,
    querySelector: () => link,
    addEventListener: (ev, fn) => { listeners[ev] = fn; }
  };
  const fetched = [];
  const ctx = {
    document, window: { addEventListener() {} }, location: { reload() { ctx.reloaded = true; } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    setTimeout: (fn, ms) => timers.push([ms, fn]),
    URL: { createObjectURL: (b) => 'blob:' + b.text },
    Blob: class { constructor(parts) { this.text = parts.join(''); } },
    fetch: (url) => { fetched.push(url); const f = url.split('/').pop().split('?')[0]; return Promise.resolve({ ok, text: () => Promise.resolve(remote[f]) }); },
    Promise, Date, Math, JSON, Number, String
  };
  ctx.window = Object.assign(ctx.window, ctx);
  vm.runInNewContext(LIVE, ctx);
  return { ctx, store, scripts, styles, timers, link, fetched, listeners };
}
const flush = () => new Promise((r) => setImmediate(r));

test('index.html loads only live.js and allows blob scripts, nothing else remote', () => {
  assert.match(INDEX, /<script src="live\.js"><\/script>/);
  assert.doesNotMatch(INDEX, /<script src="(hybrid|app)\.js">/);
  assert.match(INDEX, /script-src 'self' blob:;/);
  assert.match(INDEX, /connect-src 'self'/);
});

test('first launch runs the bundled files, then saves the website copy', async () => {
  const r = run();
  assert.deepEqual(r.scripts.map((s) => s.src), ['hybrid.js', 'app.js']);
  assert.equal(r.styles.length, 0);
  r.timers.find(([ms]) => ms === 2500)[1]();
  await flush(); await flush();
  assert.ok(r.fetched.every((u) => u.startsWith('https://menu-made.com/app-shell/www/')));
  const saved = JSON.parse(r.store.get('mm-live-code'));
  assert.equal(saved.files['hybrid.js'], GOOD['hybrid.js']);
});

test('next launch runs the saved copy from blobs, and a clean start clears the trial mark', async () => {
  const first = run(); first.timers.find(([ms]) => ms === 2500)[1](); await flush(); await flush();
  const r = run({ storage: Object.fromEntries(first.store) });
  assert.deepEqual(r.scripts.map((s) => s.src), ['blob:' + GOOD['hybrid.js'], 'blob:' + GOOD['app.js']]);
  assert.equal(r.link.disabled, true);
  assert.equal(r.styles[0].textContent, GOOD['app.css']);
  assert.ok(r.store.has('mm-live-trying'));
  r.timers.find(([ms]) => ms === 6000)[1]();
  assert.ok(!r.store.has('mm-live-trying'));
});

test('a saved copy that never started cleanly is skipped on the next launch', async () => {
  const first = run(); first.timers.find(([ms]) => ms === 2500)[1](); await flush(); await flush();
  const crashed = run({ storage: Object.fromEntries(first.store) }); // never reaches the 6 s clean-start mark
  const r = run({ storage: Object.fromEntries(crashed.store) });
  assert.deepEqual(r.scripts.map((s) => s.src), ['hybrid.js', 'app.js']);
  assert.equal(r.store.get('mm-live-bad'), JSON.stringify(JSON.parse(first.store.get('mm-live-code')).id));
});

test('website code that needs a newer app build is ignored', async () => {
  const r = run({ remote: { ...GOOD, 'hybrid.js': '// live-shell-min: 9\nwindow.MMHybrid={};' } });
  r.timers.find(([ms]) => ms === 2500)[1](); await flush(); await flush();
  assert.ok(!r.store.has('mm-live-code'));
});

test('a failed or odd download saves nothing', async () => {
  const r = run({ ok: false }); r.timers.find(([ms]) => ms === 2500)[1](); await flush(); await flush();
  assert.ok(!r.store.has('mm-live-code'));
  const r2 = run({ remote: { ...GOOD, 'hybrid.js': '<html>not found</html>' } }); r2.timers.find(([ms]) => ms === 2500)[1](); await flush(); await flush();
  assert.ok(!r2.store.has('mm-live-code'));
});

// Owner, Nov 14, 2026: "The zoom capability is paramount." The Nino product photo must always open the full-screen
// viewer with pinch and double-tap zoom, on Android (whose web view obeys user-scalable=no) as well as iPhone.
test('Nino product photo keeps its full-screen pinch and double-tap zoom', () => {
  const js = readFileSync(new URL('../app-shell/www/hybrid.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app-shell/www/app.css', import.meta.url), 'utf8');
  assert.match(js, /function zoomViewer\(src, alt\)/);
  assert.match(js, /"hy-hero-img hy-zoomable"/);
  assert.match(js, /img\.addEventListener\("click", function \(\) \{ zoomViewer\(/);
  assert.match(js, /e\.touches/); assert.match(js, /lastTap < 300/);
  assert.match(css, /\.hy-zoom \{[^}]*touch-action: none/);
});

// Owner, Nov 15, 2026: "Need to be able to zoom all images in the Nino app and site." Every picture in the Nino app
// that isn't a button or link opens the same viewer, and the Work piece's big picture does too.
test('every picture in the Nino app zooms', () => {
  const js = readFileSync(new URL('../app-shell/www/hybrid.js', import.meta.url), 'utf8');
  assert.match(js, /document\.addEventListener\("click", function \(ev\) \{[\s\S]{0,200}data\.kind !== "shop"[\s\S]{0,400}zoomViewer\(t\.currentSrc \|\| t\.src, t\.alt\)/);
  assert.match(js, /"hy-hero-img hy-work-full hy-zoomable"/);
  assert.match(js, /big\.addEventListener\("click", function \(\) \{ zoomViewer\(/);
});

test('menu-made.com lets the apps read the live screen files (CORS), or no phone ever gets an update', () => {
  // Owner, Nov 16, 2026: the how-to videos never showed in the app. The apps run from capacitor://localhost and
  // https://localhost, so live.js's fetch of https://menu-made.com/app-shell/www/* is cross-origin; without
  // Access-Control-Allow-Origin the phone blocks it and keeps the bundled screens forever.
  const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  const block = /^\/app-shell\/www\/\*\s*\n((?:[ \t]+.+\n?)+)/m.exec(headers);
  assert.ok(block, '_headers has a rule for /app-shell/www/*');
  assert.match(block[1], /Access-Control-Allow-Origin:\s*\*/);
  assert.match(LIVE, /BASE = "https:\/\/menu-made\.com\/app-shell\/www\/"/, 'the rule covers the address live.js reads');
});
