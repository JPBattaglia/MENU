// MΞNU free plan (stage 15 task 2, owner Nov 14, 2026): a free live menu from a preview, Classic design, badge, no end.
// Run: node --no-warnings --test booking-api/menu-free-plan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { menuHostingState, remindMenuHostingRenewals } = await import('./src/producers/menu-qr/hosting-renewal.js');
const { createMenuQrInputs } = await import('./src/onboarding/menu-inputs.js');
const { FREE_PER_EMAIL } = await import('./src/marketing/free-menu.js');

const MENU = { sections: [{ name: 'Starters', items: [{ name: 'Garlic Bread', description: 'House focaccia', price: '$9' }, { name: 'Soup', description: '', price: '$7' }] }], notes: '', unreadable: '', colors: [] };
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';

function setup(t) {
  const env = { DB: createD1(), ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-test', RESEND_API_KEY: 're_test', PRODUCTION_RUNNER_SECRET: 'test-runner-secret' };
  for (const m of ['0007_plan_settings.sql', '0009_website_package.sql', '0017_customer_accounts.sql', '0018_menu_hosting_index.sql']) env.DB.raw.exec(readFileSync(new URL(`./migrations/${m}`, import.meta.url), 'utf8'));
  const call = (path, init = {}) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, { waitUntil() {} });
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url === 'https://api.anthropic.com/v1/messages') return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: { input_tokens: 1, output_tokens: 1 } });
    if (url === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return Response.json({ id: `em_${sent.length}` }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  const preview = async ({ email = 'owner@cafe.example', business = 'Sample Cafe', occasion } = {}) => {
    const id = crypto.randomUUID();
    const storageKey = `private/inquiries/${id}/abc`;
    await env.ASSETS.put(storageKey, new Uint8Array([37, 80, 68, 70]));
    env.DB.raw.prepare(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at) VALUES (?, ?, ?, ?)`).run(id,
      JSON.stringify({ type: 'inquiry', purpose: 'checkout', email, name: 'Cafe', document: { storageKey, contentType: 'application/pdf', name: `menu-${id}.pdf`, size: 4 } }), `net-${id}`, Math.floor(Date.now() / 1000));
    const res = await call('/api/menu-preview/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: id, email, business, ...(occasion ? { occasion } : {}) }) });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    return out.token;
  };
  const confirmLink = () => {
    const mail = [...sent].reverse().find((m) => /free menu live/i.test(m.subject));
    return new URL(/https:\/\/menu-made\.com(\/api\/menu-free\/confirm\/[a-f0-9]{36}\?t=[^\s"]+)/.exec(mail.text)[1], 'https://menu-made.com');
  };
  const confirm = async () => {
    const link = confirmLink();
    const page = await call(link.pathname + link.search, { headers: { 'User-Agent': PHONE } });
    assert.match(await page.text(), /<form method="post">/, 'a button first, so email scanners do nothing');
    return call(link.pathname, { method: 'POST', body: new URLSearchParams({ t: link.searchParams.get('t') }) });
  };
  return { env, call, sent, preview, confirm, sql: (q, ...a) => env.DB.raw.prepare(q).all(...a) };
}

test('Start free: the preview offers it, the email confirms it, and a Classic menu with a badge and QR goes live at once', async (t) => {
  const f = setup(t);
  const token = await f.preview();
  const page = await (await f.call(`/api/menu-preview/view/${token}`, { headers: { 'User-Agent': PHONE } })).text();
  assert.match(page, /<form class="mm-gen-free" method="post" action="https:\/\/menu-made\.com\/api\/menu-preview\/free\/[a-f0-9]{36}"><button type="submit"[^>]*>Start free: Classic design<\/button><\/form>/);
  const state = await (await f.call(`/api/menu-preview/state/${token}`)).json();
  assert.equal(state.free.label, 'Start free: Classic design');
  assert.equal(state.free.live, false);

  const start = await f.call(`/api/menu-preview/free/${token}`, { method: 'POST', headers: { Accept: 'application/json' } });
  const started = await start.json();
  assert.equal(start.status, 200, JSON.stringify(started));
  assert.equal(started.sent_to, 'o•••@cafe.example');
  assert.deepEqual([f.sent.at(-1).to].flat(), ['owner@cafe.example']);
  assert.equal(f.sql(`SELECT COUNT(*) AS n FROM projects`)[0].n, 0, 'nothing goes live before the email is confirmed');

  const done = await f.confirm();
  assert.equal(done.status, 303);
  assert.match(done.headers.get('Location'), /\/menu-editor\.html\?business=[0-9a-f-]{36}&welcome=free$/);
  assert.match(done.headers.get('Set-Cookie'), /HttpOnly/i, 'signed in on that browser');
  const [project] = f.sql(`SELECT id, business_id, status, workflow_key, metadata_json FROM projects`);
  assert.equal(project.workflow_key, 'MENU_QR_V1');
  assert.equal(project.status, 'DELIVERED');
  assert.equal(JSON.parse(project.metadata_json).free_plan.design, 'classic');
  const types = f.sql(`SELECT deliverable_type AS t, status, customer_visible AS v FROM deliverables WHERE project_id = ? ORDER BY t`, project.id);
  assert.deepEqual(types.map((d) => [d.t, d.status, d.v]), [['MENU_DRAFT', 'FINAL', 1], ['QR_CODE', 'FINAL', 1]], 'menu and QR, no print set');
  const live = f.sent.at(-1);
  assert.match(live.subject, /Sample Cafe's menu is live/);
  assert.match(live.text, /QR code: https:\/\/menu-made\.com\/api\/delivery\//);

  const url = f.sql(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = 'qr_destination'`, project.id)[0].value_text;
  const menu = await (await f.call(new URL(url).pathname)).text();
  assert.match(menu, /Garlic Bread/);
  assert.match(menu, /class="mm-made-with" href="https:\/\/menu-made\.com\/online-menu\?ref=badge">Made with <b>MΞNU<\/b>/);
  assert.doesNotMatch(menu, /PREVIEW · NOT LIVE/);

  // Free forever: still live two years on, and no "goes offline" emails.
  const later = new Date(Date.now() + 730 * 864e5);
  assert.deepEqual(await menuHostingState(f.env, project.business_id, later), { live: true, reason: 'free_plan' });
  const reminders = await remindMenuHostingRenewals(f.env, { now: new Date(Date.now() + 340 * 864e5), projectIds: [project.id] });
  assert.equal(reminders.sent, 0);

  // A second confirm opens the same menu; the preview stays open past its 3 days for upgrading.
  assert.equal((await f.confirm()).status, 303);
  assert.equal(f.sql(`SELECT COUNT(*) AS n FROM projects`)[0].n, 1);
  f.sql(`UPDATE menu_previews SET expires_at = ?, created_at = ?`, new Date(Date.now() - 864e5).toISOString(), new Date(Date.now() - 60 * 864e5).toISOString());
  assert.equal((await f.call(`/api/menu-preview/view/${token}`, { headers: { 'User-Agent': PHONE } })).status, 200);
  const choose = await f.call(`/api/menu-preview/choose/${token}/modern`);
  assert.equal(choose.status, 303);
  assert.match(choose.headers.get('Location'), /contact\.html\?service=menu&plan=MENU_PLUS&preview=/);
  assert.equal((await (await f.call(`/api/menu-preview/handoff/${token}`)).json()).ok, true);
  assert.equal((await (await f.call(`/api/menu-preview/state/${token}`)).json()).free.live, true);

  // The editor knows it's free, and an owner edit keeps the badge (it is added when the page is served).
  const cookie = done.headers.get('Set-Cookie').split(';')[0];
  const editor = await (await f.call(`/api/account/menu?business=${project.business_id}`, { headers: { Cookie: cookie } })).json();
  assert.equal(editor.plan.free, true);
  assert.equal(editor.plan.upgrade_url, `https://menu-made.com/api/menu-preview/view/${token}`);
  editor.menu.sections[0].items[1].price = '$8';
  const saved = await f.call('/api/account/menu', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ business: project.business_id, sections: editor.menu.sections, notes: '' }) });
  assert.equal(saved.status, 200, await saved.clone().text());
  const edited = await (await f.call(new URL(url).pathname)).text();
  assert.match(edited, /\$8/);
  assert.match(edited, /mm-made-with/);
  const me = await (await f.call('/api/account/me', { headers: { Cookie: cookie } })).json();
  assert.equal(me.businesses[0].free_plan.upgrade_url, `https://menu-made.com/api/menu-preview/view/${token}`);
  assert.equal(me.businesses[0].menu_hosting, null, 'no Menu Care nag on a free menu');

  // Upgrading: the paid order's menu takes over the same address, so the printed QR keeps working.
  const t0 = new Date().toISOString();
  f.sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, notes) SELECT 'paid1', ?, ?, customer_id, business_id, 'PAID', 14400, 14400, 'PAID', 'Preview ref: ${token}' FROM projects LIMIT 1`, t0, t0);
  const order = f.sql(`SELECT id, customer_id, business_id FROM orders WHERE id = 'paid1'`)[0];
  f.sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) SELECT 'paidp', 'paid1', order_item_id, business_id, customer_id, 'MENU', 'IN_PROGRESS', 'MENU_QR_V1', 1, ?, ? FROM projects WHERE id = ?`, t0, t0, project.id);
  await createMenuQrInputs('paidp', order, t0, f.env);
  assert.equal(f.sql(`SELECT value_text FROM project_inputs WHERE project_id = 'paidp' AND input_key = 'qr_destination'`)[0].value_text, url);
  assert.match(await (await f.call(new URL(url).pathname)).text(), /Garlic Bread/, 'the free menu stays up until the paid one is approved');
});

test('holiday previews have no free option, and the free plan has its limits', async (t) => {
  const f = setup(t);
  const holiday = await f.preview({ occasion: 'christmas', business: 'Holly Cafe', email: 'holly@cafe.example' }).catch(() => null);
  if (holiday) {
    const page = await (await f.call(`/api/menu-preview/view/${holiday}`, { headers: { 'User-Agent': PHONE } })).text();
    assert.doesNotMatch(page, /mm-gen-free/);
    assert.equal((await f.call(`/api/menu-preview/free/${holiday}`, { method: 'POST' })).status, 410);
  }
  for (let i = 0; i < FREE_PER_EMAIL; i++) {
    const token = await f.preview({ business: `Cafe ${i}` });
    await f.call(`/api/menu-preview/free/${token}`, { method: 'POST' });
    assert.equal((await f.confirm()).status, 303);
  }
  // A 4th preview for the same email (the preview limit is 3 a month, so it is copied from the last one).
  const last = f.sql(`SELECT * FROM menu_previews WHERE free_project_id IS NOT NULL ORDER BY free_claimed_at DESC LIMIT 1`)[0];
  const extra = 'e'.repeat(36);
  f.sql(`INSERT INTO menu_previews (token, request_id, email, business, status, created_at, expires_at) VALUES (?, ?, ?, 'One Too Many', 'READY', ?, ?)`, extra, last.request_id, last.email, last.created_at, last.expires_at);
  await f.env.ASSETS.put(`menu-previews/${extra}/data.json`, await (await f.env.ASSETS.get(`menu-previews/${last.token}/data.json`)).text());
  await f.call(`/api/menu-preview/free/${extra}`, { method: 'POST' });
  const refused = await f.confirm();
  assert.equal(refused.status, 429);
  assert.match(await refused.text(), /3 businesses per email address/);
});

test('free menus keep the print set and other designs for paid plans; MΞNU Plus unlocks them on the same menu', async (t) => {
  const f = setup(t);
  const token = await f.preview();
  await f.call(`/api/menu-preview/free/${token}`, { method: 'POST' });
  const done = await f.confirm();
  const cookie = done.headers.get('Set-Cookie').split(';')[0];
  const [project] = f.sql(`SELECT id, business_id, customer_id FROM projects`);
  const url = f.sql(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = 'qr_destination'`, project.id)[0].value_text;
  const path = new URL(url).pathname;
  assert.match(await (await f.call(`${path}/print.pdf`)).text(), /Comes with MΞNU Plus/);
  assert.match(await (await f.call(`${path}/tv`)).text(), /Comes with MΞNU Plus/);
  const post = (p, body) => f.call(p, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const locked = await post('/api/account/menu/design', { business: project.business_id, design: 'modern' });
  assert.equal(locked.status, 402);

  // Get MΞNU Plus from the editor: a live Stripe checkout for this business.
  f.env.STRIPE_SECRET_KEY = 'sk_live_placeholder';
  f.env.DB.raw.exec(readFileSync(new URL('./migrations/0059_menu_plus.sql', import.meta.url), 'utf8'));
  const stripeCalls = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.stripe.com/v1/checkout/sessions')) { stripeCalls.push(new URLSearchParams(init.body)); return Response.json({ id: 'cs_live_1', url: 'https://checkout.stripe.com/c/pay/cs_live_1' }); }
    return before(input, init);
  };
  const plus = await post('/api/account/menu/plus', { business: project.business_id, interval: 'month' });
  const plusOut = await plus.json();
  assert.equal(plus.status, 200, JSON.stringify(plusOut));
  assert.equal(plusOut.url, 'https://checkout.stripe.com/c/pay/cs_live_1');
  assert.equal(stripeCalls[0].get('line_items[0][price]'), 'price_1Ubv1wHw7f6jhUv88ldXfPwZ');
  assert.equal(f.sql(`SELECT business_id FROM orders ORDER BY created_at DESC LIMIT 1`)[0].business_id, project.business_id, 'bound to this business');

  // Once Plus is active: no badge, the print set opens, any design.
  const t0 = new Date().toISOString();
  f.sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, started_at, created_at, updated_at) VALUES ('subp', ?, ?, 'offer_menu_plus', 'offerv1_menu_plus', 'sub_p', 'cus_p', 'ACTIVE', 'MONTH', 1200, ?, ?, ?)`, project.customer_id, project.business_id, t0, t0, t0);
  f.sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('entp', ?, ?, 'subp', 'MENU_PLUS', 'ACTIVE', ?, ?, ?)`, project.customer_id, project.business_id, t0, t0, t0);
  assert.equal((await menuHostingState(f.env, project.business_id)).reason, 'menu_care');
  const menu = await (await f.call(path)).text();
  assert.doesNotMatch(menu, /mm-made-with/);
  assert.doesNotMatch(await (await f.call(`${path}/tv`)).text(), /Comes with MΞNU Plus/);
  const editor = await (await f.call(`/api/account/menu?business=${project.business_id}`, { headers: { Cookie: cookie } })).json();
  assert.equal(editor.plan.free, false);
  assert.ok(editor.designs.some((d) => d.key === 'modern'));
  const switched = await post('/api/account/menu/design', { business: project.business_id, design: 'modern' });
  assert.equal(switched.status, 200, await switched.clone().text());
  const after = await (await f.call(path)).text();
  assert.notEqual(after, menu, 'the live page is now in Modern');
  assert.match(after, /Garlic Bread/);
  assert.equal((await post('/api/account/menu/plus', { business: project.business_id, interval: 'month' })).status, 409, 'already covered');
});
