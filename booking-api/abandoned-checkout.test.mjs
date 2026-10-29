// Stage 9 part 2: abandoned-checkout follow-up. One email 24-72 hours after an unpaid checkout, with a signed
// link that reopens the same order in a new Stripe session (old session expired first).
// Run: node --no-warnings --test booking-api/abandoned-checkout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { followUpAbandonedCheckouts, maybeFollowUpAbandonedCheckouts, cartInputFromItems } = await import('./src/checkout/abandoned.js');

const catalog = JSON.parse(readFileSync(new URL('./subscription-catalog.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('./migrations/0001_subscription_catalog.sql', import.meta.url), 'utf8');
const HOUR = 3600000;

function setup() {
  const DB = createD1();
  const t = '2026-09-04T00:00:00.000Z';
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  for (const [code, slug, price, wf] of [['ONLINE_MENU_QR', 'online-menu-qr', 12900, 'MENU_QR_V1'], ['GOOGLE_VISIBILITY', 'google-visibility', 14900, 'GOOGLE_VISIBILITY_V1'], ['CONVERSION_FIX', 'conversion-fix', 29900, 'CONVERSION_FIX_V1']]) {
    sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, sort_order, is_public, is_featured, cta_text)
         VALUES (?, ?, ?, ?, ?, 'OTHER', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 0, 0, ?, ?, 1, 1, 0, 'Get Started')`, `offer_${code.toLowerCase()}`, t, t, code, code === 'ONLINE_MENU_QR' ? 'Online Menu + QR' : code, wf, slug);
    sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, scope_json, stripe_price_id)
         VALUES (?, ?, 1, ?, ?, 'ACTIVE', ?, 'USD', '{}', ?)`, `offerv1_${code.toLowerCase()}`, `offer_${code.toLowerCase()}`, t, t, price, catalog.one_time[code].price);
  }
  DB.raw.exec(migration);
  sql(`UPDATE offers SET is_public = 1`);

  const stripe = { sessions: new Map(), created: [], expired: [], gets: [] };
  const emails = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    if (u.hostname === 'api.resend.com') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    assert.equal(u.hostname, 'api.stripe.com');
    let m;
    if (method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      const id = `cs_${stripe.created.length + 1}`;
      const params = new URLSearchParams(init.body || '');
      stripe.sessions.set(id, { id, status: 'open', payment_status: 'unpaid', params });
      stripe.created.push(id);
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    if (method === 'POST' && (m = /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/.exec(u.pathname))) {
      stripe.sessions.get(m[1]).status = 'expired'; stripe.expired.push(m[1]);
      return Response.json(stripe.sessions.get(m[1]));
    }
    if (method === 'GET' && (m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(u.pathname))) {
      stripe.gets.push(m[1]);
      const s = stripe.sessions.get(m[1]);
      return s ? Response.json({ id: s.id, status: s.status, payment_status: s.payment_status }) : Response.json({ error: { message: 'No such session' } }, { status: 404 });
    }
    throw new Error(`Unexpected Stripe call ${method} ${u.pathname}`);
  };
  const env = { DB, ASSETS: createR2(), PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_SECRET_KEY_TEST: 'sk_test_x' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (path, init) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, ctx);
  const checkout = async (data, live = true) => (await call(live ? '/api/create-checkout' : '/api/create-checkout-test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  })).json();
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const age = (orderId, hours) => sql(`UPDATE orders SET created_at = ? WHERE id = ?`, new Date(Date.now() - hours * HOUR).toISOString(), orderId);
  const linkIn = (email) => /https:\/\/menu-made\.com(\/api\/checkout\/resume\/[^\s"]+)/.exec(email.text)[1];
  return { env, call, checkout, row, sql, age, stripe, emails, linkIn, restore: () => { globalThis.fetch = realFetch; } };
}

const buyer = { name: 'Joe Rossi', business: "Joe's Pizza", email: 'joe@joespizza.example', phone: '' };

test('one reminder 24 hours after an unpaid checkout, with the cart and a Finish checkout link', async () => {
  const h = setup();
  try {
    const started = await h.checkout({ items: [{ key: 'BUNDLE_GROWTH', interval: 'month' }, { key: 'GOOGLE_VISIBILITY' }], customer: buyer });
    assert.equal(started.ok, true, JSON.stringify(started));
    h.age(started.order_id, 23);
    assert.equal((await followUpAbandonedCheckouts(h.env)).sent, 0, 'not before 24 hours');
    h.age(started.order_id, 25);
    const first = await followUpAbandonedCheckouts(h.env);
    assert.equal(first.sent, 1, JSON.stringify(first));
    assert.equal(h.emails.length, 1);
    const email = h.emails[0];
    assert.deepEqual([email.to].flat(), ['joe@joespizza.example']);
    assert.match(email.subject, /saved/);
    assert.match(email.text, /Growth/);
    assert.match(email.text, /\$179\/month/);
    assert.match(email.text, /Nothing was charged/);
    assert.match(email.html, /Finish checkout/);
    assert.match(email.html, /https:\/\/menu-made\.com\/account/, 'customer emails carry the account button');
    assert.equal(h.row(`SELECT status FROM communications WHERE order_id = ? AND purpose = 'ABANDONED_CHECKOUT'`, started.order_id).status, 'SENT');
    assert.equal((await followUpAbandonedCheckouts(h.env)).sent, 0, 'only one reminder ever');
    h.age(started.order_id, 80);
    h.sql(`DELETE FROM communications`);
    assert.equal((await followUpAbandonedCheckouts(h.env)).sent, 0, 'not after 72 hours');
  } finally { h.restore(); }
});

test('no reminder when the buyer paid, came back since, used a sandbox checkout, or Stripe says it was paid', async () => {
  const h = setup();
  try {
    const paid = await h.checkout({ items: [{ key: 'GOOGLE_VISIBILITY' }], customer: buyer });
    h.age(paid.order_id, 30);
    h.sql(`UPDATE orders SET status = 'PAID', payment_status = 'PAID' WHERE id = ?`, paid.order_id);

    const retried = await h.checkout({ items: [{ key: 'CONVERSION_FIX' }], customer: { ...buyer, email: 'amy@cafe.example' } });
    h.age(retried.order_id, 30);
    const later = await h.checkout({ items: [{ key: 'CONVERSION_FIX' }], customer: { ...buyer, email: 'amy@cafe.example' } });
    h.age(later.order_id, 2);

    const sandbox = await h.checkout({ items: [{ key: 'CONVERSION_FIX' }], customer: { ...buyer, email: 'sam@cafe.example' } }, false);
    h.age(sandbox.order_id, 30);

    const lateWebhook = await h.checkout({ items: [{ key: 'CONVERSION_FIX' }], customer: { ...buyer, email: 'lee@cafe.example' } });
    h.age(lateWebhook.order_id, 30);
    const session = h.row(`SELECT stripe_checkout_session_id AS id FROM orders WHERE id = ?`, lateWebhook.order_id).id;
    Object.assign(h.stripe.sessions.get(session), { status: 'complete', payment_status: 'paid' });

    const owner = await h.checkout({ items: [{ key: 'CONVERSION_FIX' }], customer: { ...buyer, email: 'info@menu-made.com' } });
    h.age(owner.order_id, 30);

    const result = await followUpAbandonedCheckouts(h.env);
    assert.equal(result.sent, 0, JSON.stringify(result));
    assert.equal(h.emails.length, 0);
    const reasons = Object.fromEntries(result.skipped.map((s) => [s.id, s.reason]));
    assert.equal(reasons[retried.order_id], 'buyer came back since');
    assert.equal(reasons[sandbox.order_id], 'sandbox order');
    assert.equal(reasons[lateWebhook.order_id], 'paid at Stripe');
    assert.equal(reasons[owner.order_id], 'owner address');
    assert.equal(reasons[paid.order_id], undefined, 'paid orders are not even candidates');
  } finally { h.restore(); }
});

test('the link: GET shows the order without opening Stripe, POST expires the old session and opens a new one for the same order', async () => {
  const h = setup();
  try {
    const started = await h.checkout({ items: [{ key: 'ONLINE_MENU_QR' }], menu_pages: 5, customer: { ...buyer, notes: 'Document ref: 6f1d3c2a-1111-4111-8111-111111111111' } });
    assert.equal(started.ok, true, JSON.stringify(started));
    h.age(started.order_id, 26);
    await followUpAbandonedCheckouts(h.env);
    assert.match(h.emails[0].text, /uploaded menu is saved/);
    assert.match(h.emails[0].text, /5 menu pages/);
    const path = h.linkIn(h.emails[0]);
    const before = h.stripe.created.length;
    const page = await h.call(path);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Continue to secure checkout/);
    assert.match(html, /method="post"/);
    assert.equal(h.stripe.created.length, before, 'GET opens no Stripe session');

    const token = new URL('https://menu-made.com' + path).searchParams.get('t');
    const post = await h.call(path.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token }) });
    assert.equal(post.status, 303);
    const newId = h.stripe.created.at(-1);
    assert.equal(post.headers.get('Location'), `https://checkout.stripe.com/c/pay/${newId}`);
    assert.deepEqual(h.stripe.expired, ['cs_1'], 'the old session is expired first');
    const order = h.row(`SELECT * FROM orders WHERE id = ?`, started.order_id);
    assert.equal(order.stripe_checkout_session_id, newId);
    assert.equal(order.status, 'PAYMENT_PENDING');
    assert.match(order.notes, /Document ref:/, 'the uploaded menu stays with the order');
    const params = h.stripe.sessions.get(newId).params;
    assert.equal(params.get('metadata[order_id]'), started.order_id);
    assert.equal(params.get('metadata[resumed]'), '1');
    assert.equal(params.get('mode'), 'payment');
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), '18400', '5 pages: $129 + 2 x $20 + $15 hosting');
    assert.equal(h.row(`SELECT COUNT(*) AS n FROM orders`).n, 1, 'no second order');

    const forged = await h.call(path.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token.slice(0, -2) + 'xx' }) });
    assert.equal(forged.status, 404);
    h.sql(`UPDATE orders SET status = 'PAID', payment_status = 'PAID' WHERE id = ?`, started.order_id);
    const afterPaid = await h.call(path);
    assert.match(await afterPaid.text(), /already paid/);
  } finally { h.restore(); }
});

test('a plan cart is rebuilt as the same subscription; a Website Package keeps its free Website Care trial', async () => {
  const h = setup();
  try {
    const plan = await h.checkout({ items: [{ key: 'MENU_CARE', interval: 'year' }, { key: 'CONVERSION_FIX' }], customer: buyer });
    assert.equal(plan.ok, true, JSON.stringify(plan));
    const items = h.env.DB.raw.prepare(`SELECT i.*, f.code AS offer_code FROM order_items i JOIN offers f ON f.id = i.offer_id WHERE order_id = ?`).all(plan.order_id).map((r) => ({ ...r }));
    const input = cartInputFromItems(items);
    assert.equal(input.interval, 'year');
    assert.deepEqual(input.items.map((i) => i.key).sort(), ['CONVERSION_FIX', 'MENU_CARE']);

    const pkg = await h.checkout({ items: [{ key: 'WEBSITE_PACKAGE' }], interval: 'month', customer: { ...buyer, email: 'web@cafe.example' } });
    assert.equal(pkg.ok, true, JSON.stringify(pkg));
    h.age(pkg.order_id, 25);
    await followUpAbandonedCheckouts(h.env);
    const email = h.emails.find((e) => [e.to].flat()[0] === 'web@cafe.example');
    assert.match(email.text, /Website Package/);
    assert.doesNotMatch(email.text, /Website Care: \$0/, 'the trial line is not listed as a $0 item');
    assert.match(email.text, /free for the first 3 months/);
    const path = h.linkIn(email);
    const token = new URL('https://menu-made.com' + path).searchParams.get('t');
    const post = await h.call(path.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token }) });
    assert.equal(post.status, 303);
    const params = h.stripe.sessions.get(h.stripe.created.at(-1)).params;
    assert.equal(params.get('mode'), 'subscription');
    assert.equal(params.get('subscription_data[trial_period_days]'), '90');
    assert.equal(params.get('subscription_data[metadata][order_id]'), pkg.order_id);
  } finally { h.restore(); }
});

test('a changed price or an offer taken off sale sends the buyer to start again instead of charging a new amount', async () => {
  const h = setup();
  try {
    const started = await h.checkout({ items: [{ key: 'CONVERSION_FIX' }], customer: buyer });
    h.age(started.order_id, 25);
    await followUpAbandonedCheckouts(h.env);
    h.sql(`UPDATE offer_versions SET price_cents = 34900 WHERE offer_id = 'offer_conversion_fix'`);
    const path = h.linkIn(h.emails[0]);
    const token = new URL('https://menu-made.com' + path).searchParams.get('t');
    const before = h.stripe.created.length;
    const post = await h.call(path.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token }) });
    assert.equal(post.status, 200);
    assert.match(await post.text(), /Prices have changed/);
    assert.equal(h.stripe.created.length, before);
  } finally { h.restore(); }
});

test('the hourly tick only runs in the first five minutes of the hour', async () => {
  const h = setup();
  try {
    assert.equal(await maybeFollowUpAbandonedCheckouts(h.env, new Date('2026-10-29T15:07:00Z')), null);
    assert.notEqual(await maybeFollowUpAbandonedCheckouts(h.env, new Date('2026-10-29T15:02:00Z')), null);
  } finally { h.restore(); }
});
