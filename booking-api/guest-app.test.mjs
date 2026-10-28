// Stage 8, Guest App: build and checks, intake, icon render job, owner approval, serving (live, preview, app-only root),
// the update form and the monthly email. Mocked Resend and GitHub OIDC; real SQLite schema and migrations.
// Run: node --no-warnings --test booking-api/guest-app.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';
import { createZip } from './src/producers/social-posts/zip.js';

const api = { ...(await import('./src/worker.js')), ...(await import('./src/workflows/runner.js')) };
const { buildApp, iconSpecs, shortNameOf, ICONS } = await import('./src/producers/guest-app/build.js');
const { checkApp } = await import('./src/producers/guest-app/check.js');
const { startGuestAppIntake, intakeLink } = await import('./src/producers/guest-app/intake.js');
const renderJobs = await import('./src/producers/social-posts/render-jobs.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const APP = {
  app_name: "Joe's Pizza Kitchen", short_name: '', menu: '# Pizza\nMargherita | Mozzarella and basil | $15\nPepperoni | Spicy | 17', specials: 'Tuesday: two slices for $6',
  phone: '(512) 555-0100', address: '123 Main Street, Austin, TX', hours: 'Mon-Fri: 11am-9pm\nSat: 12pm-10pm', order_url: 'https://order.joespizza.test/', reserve_url: '', brand_color: '#b3261e'
};
const ICON_SIZES = Object.fromEntries(ICONS.map((i) => [i.path, 5000]));

test('the built app passes every check, installs with a complete manifest, and escapes what the owner typed', () => {
  const built = buildApp(APP, { version: 'v1', hasLogo: true });
  assert.deepEqual(checkApp({ files: built.files, icons: ICON_SIZES, app: APP }), []);
  const manifest = JSON.parse(built.files['manifest.webmanifest']);
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './');
  assert.equal(manifest.short_name, "Joe's Pizza"); assert.equal(manifest.theme_color, '#b3261e');
  assert.deepEqual(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`), ['192x192 any', '512x512 any', '512x512 maskable']);
  assert.match(built.files['index.html'], /tel:5125550100/); assert.match(built.files['index.html'], /Order online/); assert.ok(!/Book a table/.test(built.files['index.html']));
  assert.match(built.files['sw.js'], /guest-app-v1/);
  assert.equal(shortNameOf({ app_name: 'Supercalifragilistic Diner' }), 'Supercalifra');
  const hostile = buildApp({ ...APP, app_name: 'Joe <script>alert(1)</script>', specials: '<img src=x onerror=alert(1)>' }, { version: 'v1', hasLogo: false });
  assert.ok(!/<script>alert/.test(hostile.files['index.html'])); assert.ok(!/<img src=x/.test(hostile.files['index.html']));
  const specs = iconSpecs(APP, { hasLogo: false });
  assert.deepEqual(specs.map((s) => [s.name, s.width]), [['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512], ['apple-touch-icon.png', 180]]);
  assert.match(specs[0].svg, />JP</); assert.match(iconSpecs(APP, { hasLogo: true })[2].svg, /__LOGO_DATA_URI__/);
});

test('the checks catch an app that would not install or work offline', () => {
  const built = buildApp(APP, { version: 'v1', hasLogo: false });
  const manifest = JSON.parse(built.files['manifest.webmanifest']);
  const bad = (m) => checkApp({ files: { ...built.files, 'manifest.webmanifest': JSON.stringify({ ...manifest, ...m }) }, icons: ICON_SIZES, app: APP }).join('\n');
  assert.match(bad({ display: 'browser' }), /standalone/);
  assert.match(bad({ icons: manifest.icons.filter((i) => i.purpose !== 'maskable') }), /maskable/);
  assert.match(bad({ short_name: 'A very long name here' }), /short_name/);
  assert.match(checkApp({ files: built.files, icons: {}, app: APP }).join(), /icons\/icon-192\.png is not in the app/);
  assert.match(checkApp({ files: { ...built.files, 'sw.js': '// nothing' }, icons: ICON_SIZES, app: APP }).join(), /offline/);
  assert.match(checkApp({ files: { ...built.files, 'index.html': built.files['index.html'].replace('<h1', '<h2').replace('</h1>', '</h2>') }, icons: ICON_SIZES, app: APP }).join(), /accessibility/);
  assert.match(checkApp({ files: built.files, icons: ICON_SIZES, app: { ...APP, phone: '999 999 9999' } }).join(), /phone number is missing/);
});

const PID = '22222222-3333-4444-8555-666666666666';
function setup({ website = false } = {}) {
  const DB = createD1(); const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe', 'Rossi')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Joe''s Pizza')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_s', ?, ?, 'GUEST_APP_SETUP', 'Guest App Setup', 'APP', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'GUEST_APP_SETUP_V1'), ('offer_g', ?, ?, 'GUEST_APP', 'Guest App', 'APP', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 'GUEST_APP_V1')`, t, t, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_s', 'offer_s', 1, ?, ?, 'ACTIVE', 29900, '{}'), ('ov_g', 'offer_g', 1, ?, ?, 'ACTIVE', 2900, '{}')`, t, t, t, t);
  sql(`INSERT INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES ('wd_s', 'GUEST_APP_SETUP_V1', 1, 'ACTIVE', '[]', ?, ?), ('wd_g', 'GUEST_APP_V1', 1, 'ACTIVE', '[]', ?, ?)`, t, t, t, t);
  DB.raw.exec(read('0009_website_package.sql')); DB.raw.exec(read('0012_guest_app.sql'));
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o1', ?, ?, 'cust', 'biz', 'ONBOARDING_REQUIRED', 29900, 29900, 'PAID')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'offer_s', 'ov_s', 29900, 29900)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES (?, 'o1', 'i1', 'biz', 'cust', 'APP', 'AWAITING_INPUTS', 'GUEST_APP_SETUP_V1', 1, ?, ?)`, PID, t, t);
  if (website) sql(`INSERT INTO website_sites (id, slug, project_id, business_id, created_at, updated_at) VALUES ('s0', 'joes-site', 'wp', 'biz', ?, ?)`, t, t);
  const emails = [];
  const fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map((r) => ({ ...r }));
  return { env, DB, ASSETS, emails, fetch, ctx, pending, row, rows, sql };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map((m) => m[0].replaceAll('&amp;', '&'));
const ANSWERS = { app_name: APP.app_name, menu: APP.menu, specials: APP.specials, phone: APP.phone, address: APP.address, hours: APP.hours, order_url: APP.order_url, brand_color: APP.brand_color, subdomain: 'joes-pizza' };
async function submit(f, over = {}, logo = PNG) {
  const token = new URL(await intakeLink(f.env, PID)).searchParams.get('t');
  const form = new FormData(); form.append('t', token);
  for (const [k, v] of Object.entries({ ...ANSWERS, ...over })) form.append(k, v);
  if (logo) form.append('logo', new File([logo], 'logo.png', { type: 'image/png' }));
  return call(f, `https://menu-made.com/api/app-intake/${PID}`, { method: 'POST', body: form });
}
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
async function renderAuth(f) {
  f.kid = `kid-${crypto.randomUUID()}`;
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: f.kid, alg: 'RS256', use: 'sig' };
  f.env.RENDER_OIDC_FETCH = async () => Response.json({ keys: [jwk] });
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-render', exp: now + 300, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master', job_workflow_ref: renderJobs.RENDER_WORKFLOW };
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: f.kid })); const body = b64u(JSON.stringify(claims));
  return { Authorization: `Bearer ${head}.${body}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`))))}` };
}
const pngOf = (w, h, n = 3000) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
async function produceAndRender(f) {
  await api.runScheduledProduction(f.env); await Promise.all(f.pending);
  const auth = await renderAuth(f);
  const { job } = await (await call(f, 'https://menu-made.com/api/render-jobs/next', { headers: auth })).json();
  const spec = await (await renderJobs.handleRenderJobs(new Request(`https://menu-made.com/api/render-jobs/${job}`, { headers: auth }), f.env, job)).json();
  const zip = createZip(spec.files.map((s) => ({ name: s.name, data: pngOf(s.width, s.height) })));
  const res = await renderJobs.handleRenderJobs(new Request(`https://menu-made.com/api/render-jobs/${job}`, { method: 'POST', headers: auth, body: zip }), f.env, job);
  await api.runScheduledProduction(f.env); await Promise.all(f.pending);
  return { job, spec, res };
}

test('intake: signed link, full validation, PNG/JPG logo only, and the address is reserved against websites and other apps', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    assert.equal((await startGuestAppIntake(f.env, { projectId: PID })).started, true);
    const [link] = linksIn(f.emails[0].text, '/api/app-intake/');
    const form = await (await call(f, link)).text();
    assert.ok(!/value="[^"]+"/.test(form.replace(/name="t" value="[^"]+"/, '')), 'the form always starts empty');
    assert.equal((await call(f, link.replace(/t=.*/, 't=forged.token'))).status, 403);
    for (const [over, pattern] of [[{ phone: '12' }, /Phone number/], [{ order_url: 'http://x.test/' }, /https/], [{ menu: '' }, /required/], [{ subdomain: 'api' }, /reserved/]]) {
      const bad = await submit(f, over); assert.equal(bad.status, 400); assert.match(await bad.text(), pattern);
    }
    const webp = Uint8Array.from([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')]);
    assert.match(await (await submit(f, {}, webp)).text(), /PNG or JPG/);
    f.sql(`INSERT INTO website_sites (id, slug, project_id, business_id, created_at, updated_at) VALUES ('sx', 'joes-pizza', 'px', 'other-biz', 'x', 'x')`);
    assert.match(await (await submit(f)).text(), /already taken/);
    const ok = await submit(f, { subdomain: 'joes-app' });
    assert.equal(ok.status, 200); assert.match(await ok.text(), /joes-app\.menu-made\.com\/app/);
    assert.equal(f.row(`SELECT slug FROM guest_apps WHERE project_id = ?`, PID).slug, 'joes-app');
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, PID).status, 'READY');
    assert.match(await (await call(f, link)).text(), /being built/);
  });
});

test('a business with a Menu-made website keeps its address: the app goes on the same slug at /app/', async () => {
  const f = setup({ website: true });
  await withFetch(f.fetch, async () => {
    await startGuestAppIntake(f.env, { projectId: PID });
    assert.match(await (await submit(f)).text(), /joes-site\.menu-made\.com\/app/);
  });
});

test('end to end: icons drawn by the renderer, owner preview and approval, live app with offline worker, QR, update form and monthly email', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await startGuestAppIntake(f.env, { projectId: PID });
    await submit(f);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE step_key = 'PRODUCE'`).status, 'WAITING');
    assert.equal(f.rows(`SELECT id FROM approvals`).length, 0, 'nothing is shown before the icons exist');
    const { spec, res } = await produceAndRender(f);
    assert.equal(spec.kind, 'GUEST_APP'); assert.equal(spec.files.length, 4);
    assert.match(spec.assets.logo, /^data:image\/png;base64,/); assert.ok(spec.files.every((s) => s.svg.includes('__LOGO_DATA_URI__')));
    assert.equal(res.status, 200);
    assert.equal((await call(f, 'https://menu-made.com/api/site/joes-pizza/app/')).status, 200);
    assert.match(await (await call(f, 'https://menu-made.com/api/site/joes-pizza/app/')).text(), /coming soon/);
    const owner = f.emails.find((m) => m.to[0] === 'info@menu-made.com');
    assert.match(owner.subject, /Approve Joe's Pizza's Guest App/);
    const [preview] = linksIn(owner.text, '/api/app-preview/');
    const page = await call(f, preview);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/); assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(await (await call(f, preview + 'app.js')).text(), /Preview/);
    assert.equal((await call(f, preview + 'icons/maskable-512.png')).headers.get('content-type'), 'image/png');
    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: new URL(approveUrl).searchParams.get('t') }) });
    await Promise.all(f.pending);
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, PID).status, 'DELIVERED');

    const base = 'https://menu-made.com/api/site/joes-pizza/';
    const root = await call(f, base, { redirect: 'manual' });
    assert.equal(root.status, 302); assert.match(root.headers.get('location'), /\/api\/site\/joes-pizza\/app\/$/);
    const live = await call(f, `${base}app/`);
    assert.equal(live.status, 200); assert.match(await live.text(), /Tuesday: two slices/);
    const manifest = await call(f, `${base}app/manifest.webmanifest`);
    assert.equal(manifest.headers.get('content-type'), 'application/manifest+json'); assert.equal((await manifest.json()).display, 'standalone');
    const sw = await call(f, `${base}app/sw.js`);
    assert.equal(sw.headers.get('content-type'), 'text/javascript; charset=utf-8'); assert.equal(sw.headers.get('cache-control'), 'no-cache');
    assert.match(await (await call(f, `${base}app/app.js`)).text(), /serviceWorker\.register/);
    assert.match(await (await call(f, `${base}app/qr.svg`)).text(), /<svg/);
    assert.equal((await call(f, `${base}app/icons/icon-512.png`)).status, 200);
    assert.equal((await call(f, `${base}app`, { redirect: 'manual' })).status, 301);

    const buyer = f.emails.at(-1);
    assert.deepEqual(buyer.to, ['joe@joespizza.example']); assert.match(buyer.subject, /Guest App is live/); assert.match(buyer.text, /Add to Home Screen/); assert.match(buyer.text, /qr\.svg/);
    const [update] = linksIn(buyer.text, '/api/app-update/');
    assert.equal((await call(f, update)).status, 403, 'updates need an active Guest App plan');
    f.sql(`INSERT INTO entitlements (id, customer_id, business_id, order_item_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('ent', 'cust', 'biz', 'i1', 'GUEST_APP', 'ACTIVE', 'x', 'x', 'x')`);
    const form = await (await call(f, update)).text();
    assert.match(form, /Tuesday: two slices/, 'the update form shows the current answers'); assert.ok(!/name="brand_color"/.test(form)); assert.ok(!/name="logo"/.test(form));
    const body = new FormData(); body.append('t', new URL(update).searchParams.get('t'));
    for (const [k, v] of Object.entries({ ...ANSWERS, specials: 'Friday: free garlic knots' })) body.append(k, v);
    const saved = await call(f, update.split('?')[0], { method: 'POST', body });
    assert.equal(saved.status, 200);
    assert.match(await (await call(f, `${base}app/`)).text(), /Friday: free garlic knots/);
    assert.equal((await call(f, `${base}app/icons/icon-192.png`)).status, 200, 'the approved icons carry over');
    const bad = new FormData(); bad.append('t', new URL(update).searchParams.get('t'));
    for (const [k, v] of Object.entries({ ...ANSWERS, phone: '1' })) bad.append(k, v);
    assert.equal((await call(f, update.split('?')[0], { method: 'POST', body: bad })).status, 400);

    // Monthly run of the plan: an email with the update link.
    const { runGuestAppMonthStep } = await import('./src/producers/guest-app/app-step.js');
    f.sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o2', 'x', 'x', 'cust', 'biz', 'READY_FOR_PRODUCTION', 0, 0, 'PAID')`);
    f.sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i2', 'o2', 'offer_g', 'ov_g', 0, 0)`);
    f.sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at, metadata_json) VALUES ('pm', 'o2', 'i2', 'biz', 'cust', 'APP', 'READY', 'GUEST_APP_V1', 1, 'x', 'x', '{"subscription_id":"sub","period_start":"2026-11-01"}')`);
    f.sql(`INSERT INTO workflow_runs (id, project_id, workflow_key, workflow_version, status, trigger_type, attempt_number, created_at) VALUES ('rm', 'pm', 'GUEST_APP_V1', 1, 'RUNNING', 'SUBSCRIPTION_PERIOD', 1, 'x')`);
    f.sql(`INSERT INTO workflow_steps (id, workflow_run_id, step_key, step_order, status, attempt_count) VALUES ('sm', 'rm', 'PRODUCE', 10, 'RUNNING', 1), ('sd', 'rm', 'DELIVER', 20, 'QUEUED', 0)`);
    const out = await runGuestAppMonthStep({ workflow_step_id: 'sm', workflow_run_id: 'rm', project_id: 'pm', step_key: 'PRODUCE', step_order: 10, workflow_key: 'GUEST_APP_V1', workflow_version: 1 }, f.env);
    assert.equal(out.outcome, 'MONTH_OPENED');
    assert.match(f.emails.at(-1).subject, /update Joe's Pizza's app/); assert.equal(linksIn(f.emails.at(-1).text, '/api/app-update/').length, 1);
  });
});

test('icons that come back wrong are refused and the step keeps waiting', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await startGuestAppIntake(f.env, { projectId: PID });
    await submit(f, {}, null);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    const auth = await renderAuth(f);
    const { job } = await (await call(f, 'https://menu-made.com/api/render-jobs/next', { headers: auth })).json();
    const spec = await (await renderJobs.handleRenderJobs(new Request(`https://menu-made.com/api/render-jobs/${job}`, { headers: auth }), f.env, job)).json();
    assert.deepEqual(spec.assets, {}); assert.match(spec.files[0].svg, />JP</);
    const wrong = createZip(spec.files.map((s) => ({ name: s.name, data: pngOf(s.width, s.width === 180 ? 100 : s.height) })));
    const refused = await renderJobs.handleRenderJobs(new Request(`https://menu-made.com/api/render-jobs/${job}`, { method: 'POST', headers: auth, body: wrong }), f.env, job);
    assert.equal(refused.status, 422);
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE id = ?`, job).status, 'WAITING');
  });
});

test('the GUEST_APP_RUN self-test drives a synthetic order through intake, the renderer, preview, approval and the live app', async () => {
  const f = setup();
  const { advanceGuestAppSelfTests } = await import('./src/selftest/guest-app-selftest.js');
  const app = (request) => api.default.fetch(request, f.env, f.ctx);
  f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('gst1', 'GUEST_APP_RUN', 'REQUESTED', 'test', ?, ?)`, new Date().toISOString(), new Date().toISOString());
  await withFetch(f.fetch, async () => {
    await advanceGuestAppSelfTests(f.env, app);
    const started = f.row(`SELECT status, stage, error FROM self_tests WHERE id = 'gst1'`);
    assert.equal(started.stage, 'AWAIT_OWNER_REQUEST', started.error || '');
    await produceAndRender(f);
    await advanceGuestAppSelfTests(f.env, app); await Promise.all(f.pending);
    const approved = f.row(`SELECT stage, error FROM self_tests WHERE id = 'gst1'`);
    assert.equal(approved.stage, 'AWAIT_DELIVERED', approved.error || '');
    await advanceGuestAppSelfTests(f.env, app);
    const done = f.row(`SELECT status, error, log_json FROM self_tests WHERE id = 'gst1'`);
    assert.equal(done.status, 'PASSED', done.error || '');
    assert.match(done.log_json, /Install it on a phone from .*appselftest-gst1\/app\//);
    assert.ok(!f.emails.some((m) => /self-test failed/.test(m.subject)));
  });
});
