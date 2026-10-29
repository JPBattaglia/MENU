// Stage 3: subscription engine. Catalog rows, subscription checkout, webhooks -> subscriptions,
// entitlements and period jobs, renewals, cancel, failed payments, annual plans, plan changes, billing portal.
// Runs against the real migration and a fake Stripe that keeps subscriptions in memory.
// Run: node --no-warnings --test booking-api/subscriptions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { runDailySubscriptionPass } = await import('./src/subscriptions/daily.js');
const { addMonths, serviceMonthsDue } = await import('./src/subscriptions/periods.js');
const { billingPortalLink } = await import('./src/subscriptions/portal.js');

const catalog = JSON.parse(readFileSync(new URL('./subscription-catalog.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('./migrations/0001_subscription_catalog.sql', import.meta.url), 'utf8');
const SECRET_TEST = 'whsec_test_placeholder';
const SECRET_LIVE = 'whsec_live_placeholder';
const DAY = 86400;
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function setup() {
  const DB = createD1();
  DB.raw.exec('PRAGMA foreign_keys = ON');
  const t = '2026-09-04T00:00:00.000Z';
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  // Existing live one-time offers (Oct 25, 2026) the migration builds on.
  for (const [code, slug, price, wf] of [['ONLINE_MENU_QR', 'online-menu-qr', 12900, 'MENU_QR_V1'], ['GOOGLE_VISIBILITY', 'google-visibility', 14900, 'GOOGLE_VISIBILITY_V1'], ['CONVERSION_FIX', 'conversion-fix', 29900, 'CONVERSION_FIX_V1']]) {
    sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, sort_order, is_public, is_featured, cta_text)
         VALUES (?, ?, ?, ?, ?, 'OTHER', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 0, 0, ?, ?, 1, 1, 0, 'Get Started')`, `offer_${code.toLowerCase()}`, t, t, code, code, wf, slug);
    sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, scope_json, stripe_price_id)
         VALUES (?, ?, 1, ?, ?, 'ACTIVE', ?, 'USD', '{}', ?)`, `offerv1_${code.toLowerCase()}`, `offer_${code.toLowerCase()}`, t, t, price, catalog.one_time[code].price);
  }
  DB.raw.exec(migration);
  DB.raw.exec(readFileSync(new URL('./migrations/0007_plan_settings.sql', import.meta.url), 'utf8'));
  DB.raw.exec(readFileSync(new URL('./migrations/0013_google_connections.sql', import.meta.url), 'utf8'));
  DB.raw.exec(readFileSync(new URL('./migrations/0014_review_replies.sql', import.meta.url), 'utf8'));
  DB.raw.exec(readFileSync(new URL('./migrations/0015_google_profile_care.sql', import.meta.url), 'utf8'));

  const stripe = { sessions: [], subscriptions: new Map(), customers: new Map(), portal: [], deleted: [], keys: [] };
  const emails = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    if (u.hostname === 'api.resend.com') {
      emails.push(JSON.parse(init.body));
      return Response.json({ id: `email_${emails.length}` });
    }
    assert.equal(u.hostname, 'api.stripe.com');
    stripe.keys.push(init.headers.Authorization);
    const params = new URLSearchParams(init.body || '');
    let m;
    if (method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      const id = `cs_test_${stripe.sessions.length + 1}`;
      stripe.sessions.push({ id, params });
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    if (method === 'GET' && (m = /^\/v1\/subscriptions\/(.+)$/.exec(u.pathname))) {
      assert.equal(u.searchParams.get('expand[]'), 'items.data.price.product');
      const sub = stripe.subscriptions.get(decodeURIComponent(m[1]));
      return sub ? Response.json(sub) : Response.json({ error: { message: 'No such subscription' } }, { status: 404 });
    }
    if (method === 'GET' && (m = /^\/v1\/customers\/(.+)$/.exec(u.pathname))) {
      return Response.json(stripe.customers.get(m[1]) || { id: m[1], test_clock: null, metadata: {} });
    }
    if (method === 'POST' && u.pathname === '/v1/billing_portal/sessions') {
      stripe.portal.push(Object.fromEntries(params));
      return Response.json({ id: 'bps_1', url: 'https://billing.stripe.com/p/session/test_1' });
    }
    throw new Error(`Unexpected Stripe call ${method} ${u.pathname}`);
  };
  const env = {
    DB, ASSETS: createR2(),
    STRIPE_SECRET_KEY: 'sk_live_placeholder', STRIPE_SECRET_KEY_TEST: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: SECRET_LIVE, STRIPE_WEBHOOK_SECRET_TEST: SECRET_TEST,
    RESEND_API_KEY: 're_test', PRODUCTION_RUNNER_SECRET: 'runner-secret-placeholder', OWNER_EMAIL: 'owner@example.com'
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (path, init) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, ctx);
  const checkout = async (body, live = false) => {
    const res = await call(live ? '/api/create-checkout' : '/api/create-checkout-test', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://menu-made.com' }, body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };
  let eventCounter = 0;
  const webhook = async (type, object, { id = `evt_${++eventCounter}`, secret = SECRET_TEST } = {}) => {
    const payload = JSON.stringify({ id, type, data: { object } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    const res = await call('/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${ts},v1=${sig}` }, body: payload });
    return { status: res.status, body: await res.json() };
  };
  // A Stripe subscription as the 2025+ API returns it (periods on the item), for a sandbox checkout's inline price.
  const makeSub = ({ id, orderId, plan, interval = 'month', amount, start, status = 'active', trialEnd = null, customer = 'cus_test_1' }) => {
    const end = interval === 'year' ? addMonths(start, 12) : addMonths(start, 1);
    const sub = {
      id, object: 'subscription', status, customer, currency: 'usd', cancel_at_period_end: false,
      start_date: unix(start), canceled_at: null, ended_at: null, trial_end: trialEnd,
      metadata: { order_id: orderId, plan_code: plan, environment: 'sandbox' },
      items: { data: [{ id: `si_${id}`, quantity: 1, current_period_start: unix(start), current_period_end: unix(end),
        price: { id: `price_inline_${id}`, unit_amount: amount, recurring: { interval }, product: { id: `prod_inline_${id}`, metadata: { plan_code: plan } } } }] }
    };
    stripe.subscriptions.set(id, sub);
    return sub;
  };
  const invoice = (sub, { id, start, end, amount, extraLines = [] }) => ({
    id, object: 'invoice', amount_paid: amount, billing_reason: 'subscription_cycle',
    parent: { type: 'subscription_details', subscription_details: { subscription: sub.id } },
    lines: { data: [...extraLines, { id: `il_${id}`, parent: { type: 'subscription_item_details', subscription_item_details: { subscription: sub.id } },
      period: { start: unix(start), end: unix(end) } }] }
  });
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map((r) => ({ ...r }));
  const one = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const jobs = (subId) => rows(`SELECT json_extract(p.metadata_json, '$.plan_code') AS plan, json_extract(p.metadata_json, '$.period_start') AS period_start, p.status, r.status AS run_status, r.trigger_type
      FROM projects p JOIN workflow_runs r ON r.project_id = p.id WHERE json_extract(p.metadata_json, '$.subscription_id') = ? ORDER BY period_start, plan`, subId);
  return { env, call, checkout, webhook, makeSub, invoice, stripe, emails, rows, one, jobs, restore: () => { globalThis.fetch = realFetch; } };
}

const GROWTH = ['ACCESSIBILITY_MONITORING', 'GOOGLE_PROFILE_CARE', 'MENU_CARE', 'REVIEW_REPLIES'];
const buyer = { name: 'Ana Ruiz', business: 'Casa Ana', email: 'ana@example.com', phone: '' };

async function growthSubscriber(h, { interval = 'month', start = '2026-10-25T18:00:00.000Z' } = {}) {
  const res = await h.checkout({ items: [{ key: 'BUNDLE_GROWTH' }], interval, customer: buyer });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const amount = interval === 'year' ? 179000 : 17900;
  const sub = h.makeSub({ id: 'sub_growth', orderId: res.body.order_id, plan: 'BUNDLE_GROWTH', interval, amount, start });
  const done = await h.webhook('checkout.session.completed', { id: h.stripe.sessions.at(-1).id, object: 'checkout.session', mode: 'subscription',
    subscription: 'sub_growth', customer: 'cus_test_1', amount_total: amount, currency: 'usd', payment_status: 'paid', metadata: { order_id: res.body.order_id } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const row = h.one(`SELECT * FROM subscriptions WHERE provider_subscription_id = 'sub_growth'`);
  return { res, sub, row };
}

test('catalog migration matches subscription-catalog.json and keeps everything off sale', () => {
  const h = setup();
  try {
    for (const [code, plan] of Object.entries({ ...catalog.subscriptions, ...catalog.bundles })) {
      const versions = h.rows(`SELECT v.billing_interval, v.price_cents, v.stripe_price_id, v.scope_json, o.is_public, o.billing_type
        FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = ? ORDER BY v.version_number`, code);
      assert.deepEqual(versions.map((v) => [v.billing_interval, v.price_cents, v.stripe_price_id]),
        [['MONTH', plan.monthly.amount, plan.monthly.price], ['YEAR', plan.annual.amount, plan.annual.price]], code);
      assert.ok(versions.every((v) => v.is_public === 0 && v.billing_type === 'RECURRING'));
      assert.deepEqual(JSON.parse(versions[0].scope_json).includes, plan.includes || [code]);
    }
    for (const code of ['WEBSITE_PACKAGE', 'GUEST_APP_SETUP']) {
      assert.equal(h.one(`SELECT v.stripe_price_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = ?`, code).stripe_price_id, catalog.one_time[code].price);
    }
    assert.equal(h.one(`SELECT COUNT(*) AS n FROM workflow_definitions WHERE status = 'ACTIVE'`).n, 9);
  } finally { h.restore(); }
});

test('public offers list stays unchanged: no plan is on sale yet', async () => {
  const h = setup();
  try {
    const body = await (await h.call('/api/offers')).json();
    assert.deepEqual(body.offers.map((o) => o.code).sort(), ['CONVERSION_FIX', 'GOOGLE_VISIBILITY', 'ONLINE_MENU_QR']);
  } finally { h.restore(); }
});

test('site catalog lists every plan with monthly and annual prices, bundle contents and on-sale flags', async () => {
  const h = setup();
  try {
    const res = await h.call('/api/catalog');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Cache-Control'), /max-age=300/);
    const body = await res.json();
    const by = Object.fromEntries(body.offers.map((o) => [o.code, o]));
    for (const [code, entry] of Object.entries({ ...catalog.subscriptions, ...catalog.bundles })) {
      assert.deepEqual(by[code].prices, { month: entry.monthly.amount, year: entry.annual.amount }, code);
      assert.equal(by[code].on_sale, false, code);
    }
    assert.equal(by.BUNDLE_GROWTH.kind, 'BUNDLE');
    assert.deepEqual(by.BUNDLE_GROWTH.includes, catalog.bundles.BUNDLE_GROWTH.includes);
    assert.equal(by.GUEST_APP.requires_setup, 'GUEST_APP_SETUP');
    assert.equal(by.WEBSITE_PACKAGE.price_cents, catalog.one_time.WEBSITE_PACKAGE.amount);
    assert.equal(by.ONLINE_MENU_QR.on_sale, true);
    assert.equal(by.ONLINE_MENU_QR.kind, 'ONE_TIME');
    h.env.DB.raw.prepare(`UPDATE offers SET is_public = 1 WHERE code = 'BUNDLE_STARTER'`).run();
    const after = Object.fromEntries((await (await h.call('/api/catalog')).json()).offers.map((o) => [o.code, o]));
    assert.equal(after.BUNDLE_STARTER.on_sale, true);
  } finally { h.restore(); }
});

test('sandbox Growth checkout opens a subscription-mode session; annual uses the yearly price', async () => {
  const h = setup();
  try {
    const res = await h.checkout({ items: [{ key: 'BUNDLE_GROWTH' }], interval: 'month', customer: buyer });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.mode, 'subscription');
    const p = h.stripe.sessions[0].params;
    assert.equal(p.get('mode'), 'subscription');
    assert.equal(p.get('line_items[0][price_data][unit_amount]'), '17900');
    assert.equal(p.get('line_items[0][price_data][recurring][interval]'), 'month');
    assert.equal(p.get('line_items[0][price_data][product_data][metadata][plan_code]'), 'BUNDLE_GROWTH');
    assert.equal(p.get('subscription_data[metadata][order_id]'), res.body.order_id);
    assert.equal(p.get('subscription_data[metadata][environment]'), 'sandbox');
    assert.equal(p.get('customer_email'), 'ana@example.com');
    assert.equal(h.stripe.keys[0], 'Bearer sk_test_placeholder');
    const order = h.one(`SELECT total_cents FROM orders WHERE id = ?`, res.body.order_id);
    assert.equal(order.total_cents, 17900);

    const annual = await h.checkout({ items: [{ key: 'growth-plan' }], interval: 'annual', customer: buyer });
    assert.equal(annual.status, 200);
    const q = h.stripe.sessions[1].params;
    assert.equal(q.get('line_items[0][price_data][unit_amount]'), '179000');
    assert.equal(q.get('line_items[0][price_data][recurring][interval]'), 'year');
  } finally { h.restore(); }
});

test('a setup rides along as a one-time line in the same subscription checkout', async () => {
  const h = setup();
  try {
    const res = await h.checkout({ items: [{ key: 'GOOGLE_VISIBILITY' }, { key: 'GOOGLE_PROFILE_CARE' }], customer: buyer });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = h.stripe.sessions[0].params;
    assert.equal(p.get('mode'), 'subscription');
    assert.equal(p.get('line_items[0][price_data][unit_amount]'), '14900');
    assert.equal(p.get('line_items[0][price_data][recurring][interval]'), null);
    assert.equal(p.get('line_items[1][price_data][recurring][interval]'), 'month');
    assert.equal(h.one(`SELECT total_cents FROM orders WHERE id = ?`, res.body.order_id).total_cents, 14900 + 14900);
  } finally { h.restore(); }
});

test('live checkout cannot sell a plan before its producer passes (automation rule)', async () => {
  const h = setup();
  try {
    const res = await h.checkout({ items: [{ key: 'BUNDLE_GROWTH' }], customer: buyer }, true);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /isn't available yet/);
    assert.equal(h.stripe.sessions.length, 0);
  } finally { h.restore(); }
});

test('cart rules: one plan, business required, Website Package trial, Guest App needs its setup', async () => {
  const h = setup();
  try {
    let res = await h.checkout({ items: [{ key: 'MENU_CARE' }, { key: 'REVIEW_REPLIES' }], customer: buyer });
    assert.equal(res.status, 400); assert.match(res.body.error, /one plan or bundle/);
    res = await h.checkout({ items: [{ key: 'MENU_CARE' }], customer: { ...buyer, business: '' } });
    assert.equal(res.status, 400); assert.match(res.body.error, /Business name/);
    res = await h.checkout({ items: [{ key: 'MENU_CARE' }], interval: 'weekly', customer: buyer });
    assert.equal(res.status, 400); assert.match(res.body.error, /monthly or annual/);
    res = await h.checkout({ items: [{ key: 'GUEST_APP' }], customer: buyer });
    assert.equal(res.status, 400); assert.match(res.body.error, /setup/);
    res = await h.checkout({ items: [{ key: 'WEBSITE_PACKAGE' }, { key: 'BUNDLE_STARTER' }], customer: buyer });
    assert.equal(res.status, 400); assert.match(res.body.error, /Website Care/);
    assert.equal(h.stripe.sessions.length, 0);

    res = await h.checkout({ items: [{ key: 'WEBSITE_PACKAGE' }], customer: buyer });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.plan, 'WEBSITE_CARE');
    const p = h.stripe.sessions[0].params;
    assert.equal(p.get('subscription_data[trial_period_days]'), '90');
    assert.equal(p.get('line_items[0][price_data][unit_amount]'), '49900');
    assert.equal(p.get('line_items[1][price_data][unit_amount]'), '4900');
    assert.equal(h.one(`SELECT total_cents FROM orders WHERE id = ?`, res.body.order_id).total_cents, 49900, 'nothing charged for Care during the trial');

    res = await h.checkout({ items: [{ key: 'WEBSITE_PACKAGE' }, { key: 'BUNDLE_PRO' }], customer: buyer });
    assert.equal(res.status, 200);
    assert.equal(h.stripe.sessions[1].params.get('subscription_data[trial_period_days]'), null);
    res = await h.checkout({ items: [{ key: 'GUEST_APP_SETUP' }, { key: 'GUEST_APP' }], customer: buyer });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  } finally { h.restore(); }
});

test('only self-test customers on a test clock can be passed to the sandbox checkout', async () => {
  const h = setup();
  try {
    let res = await h.checkout({ items: [{ key: 'MENU_CARE' }], customer: buyer, stripe_test_customer: 'cus_random' });
    assert.equal(res.status, 400);
    res = await h.checkout({ items: [{ key: 'MENU_CARE' }], customer: buyer, stripe_test_customer: 'cus_random' }, true);
    assert.equal(res.status, 400);
    h.stripe.customers.set('cus_clock', { id: 'cus_clock', test_clock: 'clock_1', metadata: { self_test: '1' } });
    res = await h.checkout({ items: [{ key: 'MENU_CARE' }], customer: buyer, stripe_test_customer: 'cus_clock' });
    assert.equal(res.status, 200);
    assert.equal(h.stripe.sessions[0].params.get('customer'), 'cus_clock');
    assert.equal(h.stripe.sessions[0].params.get('customer_email'), null);
  } finally { h.restore(); }
});

test('Growth: checkout creates the subscription, 4 entitlements and a welcome email; invoices create 4 jobs a month, once', async () => {
  const h = setup();
  try {
    const { res, sub, row } = await growthSubscriber(h);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.billing_interval, 'MONTH');
    assert.equal(row.amount_cents, 17900);
    assert.equal(row.offer_id, 'offer_bundle_growth');
    assert.deepEqual(h.rows(`SELECT entitlement_type, status FROM entitlements WHERE subscription_id = ? ORDER BY entitlement_type`, row.id)
      .map((e) => `${e.entitlement_type}:${e.status}`), GROWTH.map((p) => `${p}:ACTIVE`));
    // The checkout order is a record of the purchase; no one-time work, so no project from it.
    assert.equal(h.one(`SELECT status FROM orders WHERE id = ?`, res.body.order_id).status, 'COMPLETED');
    assert.equal(h.one(`SELECT COUNT(*) AS n FROM projects WHERE order_id = ?`, res.body.order_id).n, 0);
    const welcome = h.emails.find((e) => e.subject === 'Your Growth Plan is active');
    assert.ok(welcome, 'welcome email sent');
    assert.match(welcome.text, new RegExp(`/api/billing-portal/${row.id}\\?t=`));

    const p1 = { start: '2026-10-25T18:00:00.000Z', end: '2026-11-25T18:00:00.000Z' };
    const inv1 = h.invoice(sub, { id: 'in_1', ...p1, amount: 17900 });
    assert.equal((await h.webhook('invoice.paid', inv1)).status, 200);
    let jobs = h.jobs(row.id);
    assert.deepEqual(jobs.map((j) => j.plan), GROWTH);
    assert.ok(jobs.every((j) => j.status === 'READY' && j.run_status === 'QUEUED' && j.trigger_type === 'SUBSCRIPTION_PERIOD'));
    const periodOrder = h.one(`SELECT * FROM orders WHERE id = (SELECT order_id FROM projects WHERE json_extract(metadata_json, '$.subscription_id') = ? LIMIT 1)`, row.id);
    assert.equal(periodOrder.payment_status, 'PAID');
    assert.equal(periodOrder.total_cents, 17900);

    // Stripe redelivers the event, and sends a second event for the same invoice: nothing new.
    assert.equal((await h.webhook('invoice.paid', inv1, { id: 'evt_dup' })).status, 200);
    assert.equal((await h.webhook('invoice.paid', inv1, { id: 'evt_dup' })).body.duplicate, true);
    assert.equal(h.jobs(row.id).length, 4);

    // Next month renews.
    const p2 = { start: p1.end, end: addMonths(p1.end, 1) };
    sub.items.data[0].current_period_start = unix(p2.start);
    sub.items.data[0].current_period_end = unix(p2.end);
    await h.webhook('invoice.paid', h.invoice(sub, { id: 'in_2', ...p2, amount: 17900 }));
    jobs = h.jobs(row.id);
    assert.equal(jobs.length, 8);
    assert.deepEqual(jobs.filter((j) => j.period_start === p2.start).map((j) => j.plan), GROWTH);
    assert.equal(h.one(`SELECT current_period_start FROM subscriptions WHERE id = ?`, row.id).current_period_start, p2.start);
  } finally { h.restore(); }
});

test('invoice.paid arriving before checkout.session.completed still creates the subscription and its jobs', async () => {
  const h = setup();
  try {
    const res = await h.checkout({ items: [{ key: 'BUNDLE_STARTER' }], customer: buyer });
    const start = '2026-10-25T18:00:00.000Z';
    const sub = h.makeSub({ id: 'sub_early', orderId: res.body.order_id, plan: 'BUNDLE_STARTER', amount: 7900, start });
    const r = await h.webhook('invoice.paid', h.invoice(sub, { id: 'in_e', start, end: addMonths(start, 1), amount: 7900 }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = h.one(`SELECT id, status FROM subscriptions WHERE provider_subscription_id = 'sub_early'`);
    assert.equal(row.status, 'ACTIVE');
    assert.deepEqual(h.jobs(row.id).map((j) => j.plan), ['ACCESSIBILITY_MONITORING', 'MENU_CARE', 'REVIEW_REPLIES']);
  } finally { h.restore(); }
});

test('cancel ends entitlements and no later period creates jobs', async () => {
  const h = setup();
  try {
    const { sub, row } = await growthSubscriber(h);
    const start = '2026-10-25T18:00:00.000Z';
    await h.webhook('invoice.paid', h.invoice(sub, { id: 'in_1', start, end: addMonths(start, 1), amount: 17900 }));
    sub.status = 'canceled'; sub.canceled_at = unix('2026-11-01T00:00:00.000Z'); sub.ended_at = sub.canceled_at;
    assert.equal((await h.webhook('customer.subscription.deleted', sub)).status, 200);
    assert.equal(h.one(`SELECT status FROM subscriptions WHERE id = ?`, row.id).status, 'CANCELLED');
    assert.equal(h.one(`SELECT COUNT(*) AS n FROM entitlements WHERE subscription_id = ? AND status != 'EXPIRED'`, row.id).n, 0);
    // Even a stray invoice event later creates nothing.
    const later = addMonths(start, 1);
    await h.webhook('invoice.paid', h.invoice(sub, { id: 'in_late', start: later, end: addMonths(later, 1), amount: 17900 }));
    await runDailySubscriptionPass(h.env, { force: true, now: new Date('2027-01-10T00:00:00Z') });
    assert.equal(h.jobs(row.id).length, 4);
  } finally { h.restore(); }
});

test('a failed payment pauses new jobs until an invoice is paid again', async () => {
  const h = setup();
  try {
    const { sub, row } = await growthSubscriber(h);
    const start = addMonths('2026-10-25T18:00:00.000Z', 1);
    const failed = { ...h.invoice(sub, { id: 'in_f', start, end: addMonths(start, 1), amount: 17900 }), billing_reason: 'subscription_cycle' };
    assert.equal((await h.webhook('invoice.payment_failed', failed)).status, 200);
    assert.equal(h.one(`SELECT status FROM subscriptions WHERE id = ?`, row.id).status, 'PAST_DUE');
    assert.equal(h.one(`SELECT COUNT(*) AS n FROM entitlements WHERE subscription_id = ? AND status = 'SUSPENDED'`, row.id).n, 4);
    assert.equal(h.jobs(row.id).length, 0);
    // The retry succeeds.
    await h.webhook('invoice.paid', h.invoice(sub, { id: 'in_f', start, end: addMonths(start, 1), amount: 17900 }));
    assert.equal(h.one(`SELECT status FROM subscriptions WHERE id = ?`, row.id).status, 'ACTIVE');
    assert.equal(h.jobs(row.id).length, 4);
  } finally { h.restore(); }
});

test('annual plans are charged once a year but still get a job every month', async () => {
  const h = setup();
  try {
    const start = '2026-01-31T12:00:00.000Z';
    const { sub, row } = await growthSubscriber(h, { interval: 'year', start });
    assert.equal(row.billing_interval, 'YEAR');
    await h.webhook('invoice.paid', h.invoice(sub, { id: 'in_y', start, end: addMonths(start, 12), amount: 179000 }));
    assert.equal(h.jobs(row.id).length, 4, 'the annual invoice creates the first month only');
    await runDailySubscriptionPass(h.env, { force: true, now: new Date('2026-04-15T00:00:00Z') });
    const months = [...new Set(h.jobs(row.id).map((j) => j.period_start))];
    assert.deepEqual(months, ['2026-01-31T12:00:00.000Z', '2026-02-28T12:00:00.000Z', '2026-03-31T12:00:00.000Z']);
    assert.equal(h.jobs(row.id).length, 12);
    // Running the pass again (or a day later) adds nothing new until the next month starts.
    await runDailySubscriptionPass(h.env, { force: true, now: new Date('2026-04-16T00:00:00Z') });
    assert.equal(h.jobs(row.id).length, 12);
    assert.equal(serviceMonthsDue(start, addMonths(start, 12), new Date('2027-06-01')).length, 12);
  } finally { h.restore(); }
});

test('the daily pass reconciles drift from a missed webhook', async () => {
  const h = setup();
  try {
    const { sub, row } = await growthSubscriber(h);
    sub.status = 'past_due';
    const summary = await runDailySubscriptionPass(h.env, { force: true });
    assert.deepEqual(summary.drift, [{ id: row.id, from: 'ACTIVE', to: 'PAST_DUE' }]);
    assert.equal(h.one(`SELECT status FROM subscriptions WHERE id = ?`, row.id).status, 'PAST_DUE');
    assert.equal((await runDailySubscriptionPass(h.env)).skipped, 'ran recently');
  } finally { h.restore(); }
});

test('an upgrade from Starter to Growth adds the new plan; a downgrade expires it', async () => {
  const h = setup();
  try {
    const res = await h.checkout({ items: [{ key: 'BUNDLE_STARTER' }], customer: buyer });
    const sub = h.makeSub({ id: 'sub_up', orderId: res.body.order_id, plan: 'BUNDLE_STARTER', amount: 7900, start: '2026-10-25T18:00:00.000Z' });
    await h.webhook('customer.subscription.created', sub);
    const row = h.one(`SELECT id FROM subscriptions WHERE provider_subscription_id = 'sub_up'`);
    // The portal swaps the price; live prices are matched by ID.
    sub.items.data[0].price = { id: catalog.bundles.BUNDLE_GROWTH.monthly.price, unit_amount: 17900, recurring: { interval: 'month' }, product: { id: 'prod_x', metadata: {} } };
    await h.webhook('customer.subscription.updated', sub);
    assert.equal(h.one(`SELECT offer_id FROM subscriptions WHERE id = ?`, row.id).offer_id, 'offer_bundle_growth');
    assert.equal(h.one(`SELECT status FROM entitlements WHERE subscription_id = ? AND entitlement_type = 'GOOGLE_PROFILE_CARE'`, row.id).status, 'ACTIVE');
    sub.items.data[0].price = { id: catalog.bundles.BUNDLE_STARTER.monthly.price, unit_amount: 7900, recurring: { interval: 'month' }, product: { id: 'prod_y', metadata: {} } };
    await h.webhook('customer.subscription.updated', sub);
    assert.equal(h.one(`SELECT status FROM entitlements WHERE subscription_id = ? AND entitlement_type = 'GOOGLE_PROFILE_CARE'`, row.id).status, 'EXPIRED');
    assert.equal(h.one(`SELECT COUNT(*) AS n FROM entitlements WHERE subscription_id = ? AND status = 'ACTIVE'`, row.id).n, 3);
    assert.equal(h.emails.filter((e) => e.subject.startsWith('Your Starter Plan')).length, 1, 'welcome sent once');
  } finally { h.restore(); }
});

test('Website Care trial: trialing subscription still gets its first month of jobs', async () => {
  const h = setup();
  try {
    const res = await h.checkout({ items: [{ key: 'WEBSITE_PACKAGE' }], customer: buyer });
    const start = '2026-10-25T18:00:00.000Z';
    const sub = h.makeSub({ id: 'sub_trial', orderId: res.body.order_id, plan: 'WEBSITE_CARE', amount: 4900, start, status: 'trialing', trialEnd: unix(start) + 90 * DAY });
    await h.webhook('checkout.session.completed', { id: h.stripe.sessions[0].id, object: 'checkout.session', mode: 'subscription', subscription: 'sub_trial',
      amount_total: 49900, currency: 'usd', metadata: { order_id: res.body.order_id } });
    const row = h.one(`SELECT id, status FROM subscriptions WHERE provider_subscription_id = 'sub_trial'`);
    assert.equal(row.status, 'TRIALING');
    // The one-time Website Package gets its own project from the checkout order.
    assert.equal(h.one(`SELECT workflow_key FROM projects WHERE order_id = ?`, res.body.order_id).workflow_key, 'WEBSITE_PACKAGE_V1');
    assert.equal(h.one(`SELECT status FROM orders WHERE id = ?`, res.body.order_id).status, 'ONBOARDING_REQUIRED');
    await h.webhook('invoice.paid', h.invoice(sub, { id: 'in_t', start, end: addMonths(start, 1), amount: 0 }));
    assert.deepEqual(h.jobs(row.id).map((j) => j.plan), ['WEBSITE_CARE']);
    assert.match(h.emails.at(-1).text, /free until 2027-01-23/);
  } finally { h.restore(); }
});

test('period jobs wait for their producer: the runner only picks up PRODUCE steps of workflows that have one (Menu Care)', async () => {
  const h = setup();
  try {
    const { sub, row } = await growthSubscriber(h);
    const start = '2026-10-25T18:00:00.000Z';
    await h.webhook('invoice.paid', h.invoice(sub, { id: 'in_1', start, end: addMonths(start, 1), amount: 17900 }));
    for (let i = 0; i < 4; i++) await h.call('/api/production/run-next', { method: 'POST', headers: { Authorization: 'Bearer runner-secret-placeholder', 'Content-Type': 'application/json' }, body: '{}' });
    // Every Growth plan has a producer now: Menu Care runs; Accessibility Monitoring parks until the buyer gives their
    // website; Review Replies and Google Profile Care park until the buyer connects Google.
    const by = Object.fromEntries(h.jobs(row.id).map((j) => [j.plan, j.run_status]));
    assert.notEqual(by.MENU_CARE, 'QUEUED', JSON.stringify(by));
    assert.equal(by.ACCESSIBILITY_MONITORING, 'WAITING', JSON.stringify(by));
    assert.equal(by.REVIEW_REPLIES, 'WAITING', JSON.stringify(by));
    assert.equal(by.GOOGLE_PROFILE_CARE, 'WAITING', JSON.stringify(by));
  } finally { h.restore(); }
});

test('subscriptions not made by our checkout are ignored, not retried forever', async () => {
  const h = setup();
  try {
    const sub = h.makeSub({ id: 'sub_foreign', orderId: undefined, plan: 'MENU_CARE', amount: 2900, start: '2026-10-25T18:00:00.000Z' });
    delete sub.metadata.order_id;
    const r = await h.webhook('invoice.paid', h.invoice(sub, { id: 'in_x', start: '2026-10-25T18:00:00.000Z', end: '2026-11-25T18:00:00.000Z', amount: 2900 }));
    assert.equal(r.status, 200);
    assert.equal(h.one(`SELECT COUNT(*) AS n FROM subscriptions`).n, 0);
  } finally { h.restore(); }
});

test('billing portal link opens a Stripe portal session for that subscriber only', async () => {
  const h = setup();
  try {
    const { row } = await growthSubscriber(h);
    const link = new URL(await billingPortalLink(h.env, row.id));
    const res = await h.call(link.pathname + link.search);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('Location'), 'https://billing.stripe.com/p/session/test_1');
    assert.deepEqual(h.stripe.portal, [{ customer: 'cus_test_1', return_url: 'https://menu-made.com/' }]);
    assert.equal(h.stripe.keys.at(-1), 'Bearer sk_test_placeholder', 'sandbox subscription uses the test key');
    const tampered = await h.call(`${link.pathname}?t=${link.searchParams.get('t').slice(0, -2)}xx`);
    assert.equal(tampered.status, 403);
    const other = await h.call(`/api/billing-portal/00000000-0000-4000-8000-000000000000${link.search}`);
    assert.equal(other.status, 403);
  } finally { h.restore(); }
});
