// The sandbox self-test drives a whole Menu + QR order (with extra pages) through the worker's own routes.
// Here it runs against a fake Stripe that behaves like the real one (sessions, browserless confirm,
// signed webhooks back to the worker) and the production catalog rows.
// Run: node --no-warnings --test selftest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = {
  ...(await import('./src/worker.js')),
  ...(await import('./src/selftest/menu-qr-selftest.js')),
  ...(await import('./src/producers/menu-qr/page-billing.js')),
};
const WEBHOOK_SECRET = 'whsec_test_placeholder';

function setup({ stripeConfirmFails = false } = {}) {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = new Date().toISOString();
  // Production catalog rows (Oct 25, 2026), with requires_approval=1 as set by migration 0002_menu_qr_routing.sql.
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, sort_order, is_public, is_featured, cta_text)
       VALUES ('offer_online_menu_qr', ?, ?, 'ONLINE_MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 1, 'MENU_QR_V1', 'online-menu-qr', 'Online menu and QR service', 1, 1, 0, 'Get Started')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, scope_json, stripe_price_id)
       VALUES ('offerv1_online_menu_qr', 'offer_online_menu_qr', 1, ?, ?, 'ACTIVE', 12900, 'USD', '{"service":"online_menu_qr"}', 'price_1T6OzbHw7f6jhUv8Epy5oYMf')`, t, t);
  sql(`INSERT INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES ('wd', 'MENU_QR_V1', 1, 'ACTIVE', ?, ?, ?)`,
    JSON.stringify([{ key: 'PREPARE_INPUTS', order: 10 }, { key: 'GENERATE_MENU_DRAFT', order: 20 }, { key: 'GENERATE_QR', order: 30 }, { key: 'QUALITY_CHECK', order: 40 }, { key: 'PACKAGE_DELIVERABLES', order: 50 }]), t, t);

  const emails = [];
  const sessions = new Map();
  const webhooks = [];
  const stripeLog = [];
  const stripe = async (url, init) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    stripeLog.push(`${method} ${u.pathname}`);
    assert.equal(init.headers.Authorization, 'Bearer sk_test_placeholder', 'only the test key is ever used');
    const params = new URLSearchParams(init.body || '');
    let m;
    if (method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      const id = `cs_test_${sessions.size + 1}`;
      let total = 0;
      for (let i = 0; params.has(`line_items[${i}][quantity]`); i++) {
        total += Number(params.get(`line_items[${i}][price_data][unit_amount]`)) * Number(params.get(`line_items[${i}][quantity]`));
      }
      const metadata = {};
      for (const [k, v] of params) { const mk = /^metadata\[(.+)\]$/.exec(k); if (mk) metadata[mk[1]] = v; }
      const session = { id, object: 'checkout.session', livemode: false, url: `https://checkout.stripe.com/c/pay/${id}`, amount_total: total,
        payment_status: 'unpaid', status: 'open', metadata, customer_email: params.get('customer_email'), payment_intent: null,
        expires_at: Math.floor(Date.now() / 1000) + 86400 };
      sessions.set(id, session);
      return Response.json(session);
    }
    if (method === 'GET' && (m = /^\/v1\/checkout\/sessions\/(.+)$/.exec(u.pathname))) return Response.json(sessions.get(m[1]));
    if (method === 'GET' && (m = /^\/v1\/payment_pages\/([^/]+)$/.exec(u.pathname))) return Response.json({ total_summary: { due: sessions.get(m[1]).amount_total } });
    if (method === 'POST' && u.pathname === '/v1/payment_methods') {
      assert.equal(params.get('card[token]'), 'tok_visa');
      return Response.json({ id: 'pm_test_visa' });
    }
    if (method === 'POST' && (m = /^\/v1\/payment_pages\/([^/]+)\/confirm$/.exec(u.pathname))) {
      const session = sessions.get(m[1]);
      if (stripeConfirmFails) return Response.json({ error: { message: 'Your card was declined.' } }, { status: 402 });
      assert.equal(Number(params.get('expected_amount')), session.amount_total);
      Object.assign(session, { payment_status: 'paid', status: 'complete', payment_intent: `pi_${session.id}` });
      webhooks.push({ id: `evt_${session.id}`, type: 'checkout.session.completed', data: { object: { ...session } } });
      return Response.json({ status: 'complete' });
    }
    throw new Error(`Unexpected Stripe call ${method} ${u.pathname}`);
  };
  const fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith('https://api.stripe.com/')) return stripe(target, init);
    if (target === 'https://api.resend.com/emails') {
      emails.push(JSON.parse(init.body));
      return Response.json({ id: `email-${emails.length}` });
    }
    if (target === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      assert.equal(body.messages[0].content[0].type, 'document');
      return Response.json({ model: body.model, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', name: 'record_menu', input: {
        sections: [{ name: 'Pizza', items: [{ name: 'Margherita Pizza', description: '', price: '$15' }, { name: 'Funghi Pizza', description: '', price: '$16' }] },
          { name: 'Desserts', items: [{ name: 'Tiramisu', description: '', price: '$9' }] }], notes: '', unreadable: '' } }] });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };
  const env = {
    DB, ASSETS,
    PRODUCTION_RUNNER_SECRET: 'test-runner-secret',
    RESEND_API_KEY: 're_test_placeholder',
    ANTHROPIC_API_KEY: 'sk-ant-test-placeholder',
    STRIPE_SECRET_KEY: 'sk_live_must_not_be_used',
    STRIPE_SECRET_KEY_TEST: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET_TEST: WEBHOOK_SECRET,
    AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z',
  };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map(r => ({ ...r }));

  // Stripe delivers queued webhooks to the worker, signed with the test-mode secret.
  async function deliverWebhooks() {
    while (webhooks.length) {
      const event = webhooks.shift();
      const payload = JSON.stringify(event);
      const ts = Math.floor(Date.now() / 1000);
      const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${payload}`).digest('hex');
      const res = await api.default.fetch(new Request('https://menu-made.com/api/stripe-webhook', {
        method: 'POST', headers: { 'Stripe-Signature': `t=${ts},v1=${v1}`, 'Content-Type': 'application/json' }, body: payload }), env, { waitUntil() {} });
      assert.equal(res.status, 200, await res.clone().text());
    }
  }
  // One cron tick of the worker, with every waitUntil awaited.
  async function tick() {
    const pending = [];
    const ctx = { waitUntil: (p) => pending.push(p) };
    await api.default.scheduled({ cron: '*/5 * * * *' }, env, ctx);
    while (pending.length) await pending.shift();
  }
  const request = () => sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('st1', 'MENU_QR_EXTRA_PAGES', 'REQUESTED', 'test', ?, ?)`, t, t);
  return { env, DB, ASSETS, emails, sessions, stripeLog, fetch, row, rows, sql, tick, deliverWebhooks, request };
}

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('the generated self-test menu is a real 5-page PDF', async () => {
  assert.equal(await api.countPdfPages(api.buildMenuPdf()), 5);
});

test('self-test walks a 3-page order with a 5-page menu through payment, extra pages, approval and delivery', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    f.request();
    let result;
    for (let i = 0; i < 8; i++) {
      await f.tick();
      await f.deliverWebhooks();
      result = f.row(`SELECT * FROM self_tests WHERE id = 'st1'`);
      if (['PASSED', 'FAILED'].includes(result.status)) break;
    }
    assert.equal(result.status, 'PASSED', `${result.stage}: ${result.error}\n${result.log_json}`);
    const log = JSON.parse(result.log_json).map(l => l.note);
    assert.match(log[0], /placed for 3 pages \(\$144\) with a 5-page menu/);
    assert.ok(log.some(l => /Page check found 5 pages; buyer emailed for \$40/.test(l)));
    assert.ok(log.some(l => /2 extra pages paid/.test(l)));
    assert.ok(log.some(l => /hosted menu page is live/.test(l)));

    // Two real Stripe test payments: the $144 order and the $40 balance.
    assert.deepEqual([...f.sessions.values()].map(s => [s.amount_total, s.payment_status]), [[14400, 'paid'], [4000, 'paid']]);
    // Every email went to the self-test inbox; nothing to the owner, no internal BCC.
    assert.ok(f.emails.length >= 3);
    for (const email of f.emails) {
      assert.deepEqual(email.to, ['delivered@resend.dev'], email.subject);
      assert.equal(email.bcc, undefined);
    }
    const order = f.row(`SELECT status, payment_status FROM orders WHERE id = ?`, result.order_id);
    assert.equal(order.payment_status, 'PAID');
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, result.project_id).status, 'DELIVERED');

    // Finished tests stay finished.
    await f.tick();
    assert.equal(f.row(`SELECT status FROM self_tests WHERE id = 'st1'`).status, 'PASSED');
  });
});

test('a failing step marks the self-test FAILED and alerts the owner once', async () => {
  const f = setup({ stripeConfirmFails: true });
  await withFetch(f.fetch, async () => {
    f.request();
    await f.tick();
    await f.tick();
    const result = f.row(`SELECT * FROM self_tests WHERE id = 'st1'`);
    assert.equal(result.status, 'FAILED');
    assert.match(result.error, /declined/);
    const alerts = f.emails.filter(e => e.subject === 'Menu + QR self-test failed');
    assert.equal(alerts.length, 1);
    assert.deepEqual(alerts[0].to, ['info@menu-made.com']);
  });
});

test('a daily self-test is scheduled at 8am Pacific, at most once a day', async () => {
  const f = setup();
  const at = (h) => new Date(Date.UTC(2026, 9, 26, h, 2));
  await api.maybeScheduleDaily(f.env, at(14));
  assert.equal(f.rows(`SELECT id FROM self_tests`).length, 0);
  await api.maybeScheduleDaily(f.env, at(15));
  await api.maybeScheduleDaily(f.env, at(15));
  const created = f.rows(`SELECT requested_by, status FROM self_tests`);
  assert.deepEqual(created, [{ requested_by: 'daily', status: 'REQUESTED' }]);
});
