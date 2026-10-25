// The subscription self-test (stage 3 exit) run end to end against a fake Stripe with test clocks:
// checkout in subscription mode, browserless payment, renewal on clock advance, cancel, no jobs after.
// Run: node --no-warnings --test booking-api/subscription-selftest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { addMonths } = await import('./src/subscriptions/periods.js');
const WEBHOOK_SECRET = 'whsec_test_placeholder';
const migration = readFileSync(new URL('./migrations/0001_subscription_catalog.sql', import.meta.url), 'utf8');
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function fakeStripe({ renewalCreatesInvoice = true } = {}) {
  const s = { endpointEvents: ['checkout.session.completed'], clocks: new Map(), customers: new Map(), sessions: new Map(), subs: new Map(), webhooks: [], deletedClocks: [], n: 0 };
  const id = (p) => `${p}_${++s.n}`;
  const emitInvoice = (sub, startIso) => {
    const endIso = addMonths(startIso, 1);
    sub.items.data[0].current_period_start = unix(startIso);
    sub.items.data[0].current_period_end = unix(endIso);
    s.webhooks.push({ id: id('evt'), type: 'invoice.paid', data: { object: { id: id('in'), amount_paid: sub.items.data[0].price.unit_amount,
      parent: { subscription_details: { subscription: sub.id } },
      lines: { data: [{ parent: { type: 'subscription_item_details', subscription_item_details: { subscription: sub.id } }, period: { start: unix(startIso), end: unix(endIso) } }] } } } });
  };
  s.handle = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    assert.equal(init.headers.Authorization, 'Bearer sk_test_placeholder', 'only the test key is used');
    const p = new URLSearchParams(init.body || '');
    let m;
    if (u.pathname === '/v1/webhook_endpoints') {
      return Response.json({ data: [{ id: 'we_test', url: 'https://menu-made.com/api/stripe-webhook', status: 'enabled', enabled_events: s.endpointEvents }] });
    }
    if (method === 'POST' && u.pathname === '/v1/webhook_endpoints/we_test') {
      s.endpointEvents = p.getAll('enabled_events[]');
      return Response.json({ id: 'we_test' });
    }
    if (method === 'POST' && u.pathname === '/v1/test_helpers/test_clocks') {
      const clock = { id: id('clock'), frozen_time: Number(p.get('frozen_time')), status: 'ready' };
      s.clocks.set(clock.id, clock);
      return Response.json(clock);
    }
    if ((m = /^\/v1\/test_helpers\/test_clocks\/([^/]+)(\/advance)?$/.exec(u.pathname))) {
      const clock = s.clocks.get(m[1]);
      if (method === 'DELETE') { s.deletedClocks.push(m[1]); return Response.json({ deleted: true }); }
      if (m[2]) {
        const to = Number(p.get('frozen_time'));
        clock.frozen_time = to;
        clock.status = 'advancing';
        // Renew every live subscription on this clock whose period ended.
        for (const sub of s.subs.values()) {
          if (s.customers.get(sub.customer)?.test_clock !== clock.id || sub.status !== 'active') continue;
          while (sub.items.data[0].current_period_end <= to && renewalCreatesInvoice) {
            emitInvoice(sub, new Date(sub.items.data[0].current_period_end * 1000).toISOString());
          }
        }
        return Response.json(clock);
      }
      if (clock.status === 'advancing') { clock.status = 'ready'; return Response.json({ ...clock, status: 'advancing' }); }
      return Response.json(clock);
    }
    if (method === 'POST' && u.pathname === '/v1/customers') {
      const c = { id: id('cus'), email: p.get('email'), test_clock: p.get('test_clock'), metadata: { self_test: p.get('metadata[self_test]') } };
      s.customers.set(c.id, c);
      return Response.json(c);
    }
    if (method === 'GET' && (m = /^\/v1\/customers\/(.+)$/.exec(u.pathname))) return Response.json(s.customers.get(m[1]));
    if (method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      assert.equal(p.get('mode'), 'subscription');
      const session = { id: `cs_test_${++s.n}`, object: 'checkout.session', livemode: false, mode: 'subscription', url: 'https://checkout.stripe.com/x',
        amount_total: Number(p.get('line_items[0][price_data][unit_amount]')), payment_status: 'unpaid', status: 'open',
        customer: p.get('customer'), metadata: { order_id: p.get('metadata[order_id]') }, params: p };
      s.sessions.set(session.id, session);
      return Response.json(session);
    }
    if (method === 'GET' && (m = /^\/v1\/checkout\/sessions\/(.+)$/.exec(u.pathname))) return Response.json(s.sessions.get(m[1]));
    if (method === 'GET' && (m = /^\/v1\/payment_pages\/([^/]+)$/.exec(u.pathname))) return Response.json({ total_summary: { due: s.sessions.get(m[1]).amount_total } });
    if (method === 'POST' && u.pathname === '/v1/payment_methods') return Response.json({ id: 'pm_visa' });
    if (method === 'POST' && (m = /^\/v1\/payment_pages\/([^/]+)\/confirm$/.exec(u.pathname))) {
      const session = s.sessions.get(m[1]);
      const clock = s.clocks.get(s.customers.get(session.customer).test_clock);
      const start = new Date(clock.frozen_time * 1000).toISOString();
      const sp = session.params;
      const sub = { id: id('sub'), object: 'subscription', status: 'active', customer: session.customer, currency: 'usd', cancel_at_period_end: false,
        start_date: clock.frozen_time, metadata: { order_id: sp.get('subscription_data[metadata][order_id]'), plan_code: sp.get('subscription_data[metadata][plan_code]') },
        items: { data: [{ quantity: 1, price: { id: id('price'), unit_amount: Number(sp.get('line_items[0][price_data][unit_amount]')),
          recurring: { interval: sp.get('line_items[0][price_data][recurring][interval]') },
          product: { id: id('prod'), metadata: { plan_code: sp.get('line_items[0][price_data][product_data][metadata][plan_code]') } } } }] } };
      s.subs.set(sub.id, sub);
      emitInvoice(sub, start);
      Object.assign(session, { payment_status: 'paid', status: 'complete', subscription: sub.id });
      s.webhooks.push({ id: id('evt'), type: 'checkout.session.completed', data: { object: { ...session, params: undefined } } });
      return Response.json({ status: 'complete' });
    }
    if ((m = /^\/v1\/subscriptions\/([^/?]+)$/.exec(u.pathname))) {
      const sub = s.subs.get(m[1]);
      if (method === 'DELETE') {
        Object.assign(sub, { status: 'canceled', canceled_at: s.clocks.values().next().value.frozen_time, ended_at: s.clocks.values().next().value.frozen_time });
        s.webhooks.push({ id: id('evt'), type: 'customer.subscription.deleted', data: { object: { ...sub } } });
      }
      return Response.json(sub);
    }
    throw new Error(`Unexpected Stripe call ${method} ${u.pathname}`);
  };
  return s;
}

function setup(options) {
  const DB = createD1();
  DB.raw.exec(migration);
  const stripe = fakeStripe(options);
  const emails = [];
  const env = {
    DB, ASSETS: createR2(), PRODUCTION_RUNNER_SECRET: 'runner', RESEND_API_KEY: 're_test',
    STRIPE_SECRET_KEY: 'sk_live_must_not_be_used', STRIPE_SECRET_KEY_TEST: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET_TEST: WEBHOOK_SECRET
  };
  const fetch = async (url, init = {}) => {
    if (String(url).startsWith('https://api.stripe.com/')) return stripe.handle(url, init);
    if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    throw new Error(`Unexpected fetch ${url}`);
  };
  async function deliver() {
    while (stripe.webhooks.length) {
      const payload = JSON.stringify(stripe.webhooks.shift());
      const ts = Math.floor(Date.now() / 1000);
      const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${payload}`).digest('hex');
      const res = await worker.fetch(new Request('https://menu-made.com/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${ts},v1=${v1}` }, body: payload }), env, { waitUntil() {} });
      assert.equal(res.status, 200, await res.clone().text());
    }
  }
  async function tick() {
    const pending = [];
    await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil: (p) => pending.push(p) });
    while (pending.length) await pending.shift();
  }
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const t = new Date().toISOString();
  DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('st', 'SUBSCRIPTION_GROWTH', 'REQUESTED', 'test', ?, ?)`).run(t, t);
  // The quiet wait after cancel is real time; push the stage start back instead of sleeping.
  const ageStage = () => DB.raw.prepare(`UPDATE self_tests SET stage_started_at = ? WHERE id = 'st'`).run(new Date(Date.now() - 10 * 60000).toISOString());
  return { env, stripe, emails, fetch, deliver, tick, row, ageStage };
}

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('subscription self-test: Growth renews on a test clock with 4 new jobs, and cancel stops them', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    let result;
    for (let i = 0; i < 12; i++) {
      await f.tick();
      await f.deliver();
      result = f.row(`SELECT * FROM self_tests WHERE id = 'st'`);
      if (result.stage === 'AWAIT_NO_NEW_JOBS') f.ageStage();
      if (['PASSED', 'FAILED'].includes(result.status)) break;
    }
    assert.equal(result.status, 'PASSED', `${result.stage}: ${result.error}\n${result.log_json}`);
    const log = JSON.parse(result.log_json).map((l) => l.note);
    assert.ok(log.some((l) => /4 entitlements and 4 first-month jobs/.test(l)), log.join('\n'));
    assert.ok(log.some((l) => /Renewal created exactly 4 jobs/.test(l)));
    assert.ok(log.some((l) => /No jobs after cancel/.test(l)));
    // Test jobs never reach a producer; the clock is deleted.
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM workflow_runs WHERE trigger_type = 'SUBSCRIPTION_PERIOD' AND status != 'CANCELLED'`).n, 0);
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM projects WHERE status = 'CANCELLED'`).n, 8);
    assert.equal(f.stripe.deletedClocks.length, 1);
    assert.deepEqual(f.stripe.endpointEvents, ['checkout.session.completed', 'invoice.paid', 'invoice.payment_failed',
      'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
    for (const email of f.emails) assert.deepEqual(email.to, ['delivered@resend.dev'], email.subject);
  });
});

test('subscription self-test fails, alerts the owner and cleans up when a renewal makes no jobs', async () => {
  const f = setup({ renewalCreatesInvoice: false });
  await withFetch(f.fetch, async () => {
    for (let i = 0; i < 4; i++) { await f.tick(); await f.deliver(); }
    // Simulate the stage timing out.
    f.env.DB.raw.prepare(`UPDATE self_tests SET stage_started_at = ? WHERE id = 'st'`).run(new Date(Date.now() - 30 * 60000).toISOString());
    await f.tick();
    const result = f.row(`SELECT * FROM self_tests WHERE id = 'st'`);
    assert.equal(result.status, 'FAILED');
    assert.match(result.error, /Timed out .* AWAIT_RENEWAL/);
    assert.equal(f.emails.filter((e) => e.subject === 'Subscription self-test failed').length, 1);
    assert.equal(f.stripe.deletedClocks.length, 1);
  });
});
