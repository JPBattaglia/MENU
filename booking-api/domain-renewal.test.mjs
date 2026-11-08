// Domain renewal reminders (handbook NEXT, Nov 7, 2026): pay-link emails from 45 days before expiry, owner told a week
// before if unpaid, auto-renew on only once paid and off again after Cloudflare renews, nothing ever renews unpaid.
// Run: node --no-warnings --test booking-api/domain-renewal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { runDomainRenewals, handleDomainRenewPay, handleDomainRenewalPaid, renewalCents } = await import('./src/producers/website/domain-renewal.js');
const { RUNBOOK_BY_TEMPLATE } = await import('./src/lib/runbook.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
const T = '2026-11-07T00:00:00.000Z';
const EXPIRES = '2027-11-07T00:00:00Z';
const DAY = 86400000;
const daysBefore = (d) => Date.parse(EXPIRES) - d * DAY + 3600000; // a little after the boundary

function setup({ renewed = false, status = 'ACTIVE', environment = 'live' } = {}) {
  const DB = createD1();
  DB.raw.exec(read('0009_website_package.sql')); DB.raw.exec(read('0043_domain_registrations.sql')); DB.raw.exec(read('0044_domain_renewals.sql'));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'ana@oliva.example', 'Ana', 'Rossi')`, T, T);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Oliva Kitchen')`, T, T);
  sql(`INSERT INTO domain_registrations (domain, order_id, project_id, business_id, customer_id, slug, environment, status, price_cents, cost_cents, renewal_cents, expires_at, created_at, updated_at)
       VALUES ('olivakitchen.com', 'o1', 'p1', 'biz', 'cust', 'oliva', ?, ?, 1511, 1011, 1511, ?, ?, ?)`, environment, status, EXPIRES, T, T);
  const calls = [];
  const emails = [];
  const state = { renewed };
  const fake = async (url, init = {}) => {
    url = String(url);
    const method = init.method || 'GET';
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = String(init.body); }
    calls.push({ url, method, body });
    if (url === 'https://api.resend.com/emails') { emails.push(body); return Response.json({ id: 'e' + emails.length }); }
    if (url === 'https://api.stripe.com/v1/checkout/sessions' && method === 'POST') return Response.json({ id: 'cs_live_r1', url: 'https://checkout.stripe.com/c/pay/cs_live_r1', expires_at: Math.floor(Date.now() / 1000) + 86400 });
    if (url.endsWith('/registrar/registrations/olivakitchen.com') && method === 'PATCH') return Response.json({ success: true, result: { state: 'succeeded', completed: true } });
    if (url.endsWith('/registrar/registrations/olivakitchen.com')) return Response.json({ success: true, result: { domain_name: 'olivakitchen.com', expires_at: state.renewed ? '2028-11-07T00:00:00Z' : EXPIRES, auto_renew: !state.renewed ? false : true } });
    throw new Error('Unexpected fetch ' + method + ' ' + url);
  };
  globalThis.fetch = fake;
  const env = { DB, CF_REGISTRAR_TOKEN: 'cfat_x', CF_ACCOUNT_ID: 'acct', STRIPE_SECRET_KEY: 'sk_live_x', RESEND_API_KEY: 're_test', OWNER_EMAIL: 'info@menu-made.com',
    PRODUCTION_RUNNER_SECRET: 'secret', PUBLIC_BASE_URL: 'https://menu-made.com' };
  const row = () => DB.raw.prepare(`SELECT * FROM domain_registrations WHERE domain = 'olivakitchen.com'`).get();
  const run = (days) => runDomainRenewals(env, { now: daysBefore(days), fetchImpl: fake, force: true });
  const patches = () => calls.filter((c) => c.method === 'PATCH').map((c) => c.body.auto_renew);
  return { DB, env, row, run, calls, emails, fake, state, patches };
}

test('the price is the saved renewal price (cost + $5); the new alerts have runbook entries', () => {
  assert.equal(renewalCents({ renewal_cents: 1511 }), 1511);
  assert.equal(renewalCents({ cost_cents: 1011 }), 1511);
  assert.equal(RUNBOOK_BY_TEMPLATE.domain_renewal_unpaid_owner_v1, 'R3');
  assert.equal(RUNBOOK_BY_TEMPLATE.domain_renewal_stuck_v1, 'R2');
});

test('nothing happens until 45 days before expiry, and only once a day', async () => {
  const s = setup();
  assert.deepEqual(await s.run(60), []);
  assert.deepEqual(await runDomainRenewals(s.env, { now: Date.parse('2027-09-23T13:00:00Z'), fetchImpl: s.fake }), [], 'outside the daily slot');
  assert.equal(s.emails.length, 0);
});

test('unpaid: request, reminders, owner a week before, lapsed after; never charged, never auto-renewed', async () => {
  const s = setup();
  assert.deepEqual(await s.run(45), [{ domain: 'olivakitchen.com', outcome: 'REQUESTED' }]);
  const first = s.emails[0];
  assert.equal(first.subject, 'Keep olivakitchen.com for another year');
  assert.ok(first.to.includes('ana@oliva.example'));
  assert.ok(first.html.includes('$15.11'));
  assert.ok(/https:\/\/menu-made\.com\/api\/domain-renew\/olivakitchen\.com\?t=/.test(first.html));
  assert.ok(/Nothing renews without your OK/.test(first.text));
  assert.equal(s.row().renewal_status, 'DUE');
  assert.equal(s.row().renewal_for, EXPIRES);

  await s.run(44);
  assert.equal(s.emails.length, 1, 'one email per step, not one a day');
  await s.run(31);
  assert.equal(s.emails.length, 2);
  assert.match(s.emails[1].subject, /^Reminder: olivakitchen\.com expires/);
  await s.run(14);
  await s.run(7);
  const owner = s.emails.filter((e) => e.to.includes('info@menu-made.com') && /Domain renewal unpaid/.test(e.subject));
  assert.equal(owner.length, 1);
  assert.ok(owner[0].html.includes('Runbook R3'));
  await s.run(6);
  assert.equal(s.emails.filter((e) => /Domain renewal unpaid/.test(e.subject)).length, 1, 'owner told once');

  assert.deepEqual(await s.run(-1), [{ domain: 'olivakitchen.com', outcome: 'LAPSED' }]);
  assert.equal(s.row().renewal_status, 'LAPSED');
  assert.deepEqual(s.patches(), [], 'auto-renew never switched on without payment');
  assert.deepEqual(await s.run(-40), [], 'long gone: no longer looked at');
});

test('paid: auto-renew on, then off once Cloudflare renews; buyer told; next year starts fresh', async () => {
  const s = setup();
  await s.run(45);
  const out = await handleDomainRenewalPaid({ id: 'cs_live_r1', payment_status: 'paid', amount_total: 1511, metadata: { purpose: 'domain_renewal', domain: 'olivakitchen.com' } }, s.env, { fetchImpl: s.fake, now: daysBefore(40) });
  assert.equal(out.status, 'AUTO_RENEW_ON');
  assert.deepEqual(s.patches(), [true]);
  assert.equal(s.row().renewal_paid_cents, 1511);
  const again = await handleDomainRenewalPaid({ id: 'cs_live_r1', payment_status: 'paid', metadata: { domain: 'olivakitchen.com' } }, s.env, { fetchImpl: s.fake });
  assert.ok(again.duplicate);

  assert.deepEqual(await s.run(31), [{ domain: 'olivakitchen.com', outcome: 'AUTO_RENEW_ON' }], 'paid: no more reminders');
  assert.equal(s.emails.filter((e) => /^Reminder/.test(e.subject)).length, 0);

  s.state.renewed = true;
  assert.deepEqual(await s.run(29), [{ domain: 'olivakitchen.com', outcome: 'RENEWED' }]);
  assert.deepEqual(s.patches(), [true, false], 'auto-renew off again for next year');
  assert.equal(s.row().expires_at, '2028-11-07T00:00:00Z');
  assert.ok(s.emails.some((e) => /olivakitchen\.com is renewed until November/.test(e.subject)));

  assert.deepEqual(await s.run(20), [], 'renewed domain left alone until next year');
});

test('paid but Cloudflare never renews: owner gets click-by-click steps once', async () => {
  const s = setup();
  await handleDomainRenewalPaid({ id: 'cs_live_r2', payment_status: 'paid', amount_total: 1511, metadata: { domain: 'olivakitchen.com' } }, s.env, { fetchImpl: s.fake, now: daysBefore(20) });
  assert.deepEqual(await s.run(2), [{ domain: 'olivakitchen.com', outcome: 'STUCK' }]);
  const stuck = s.emails.filter((e) => /renew it by hand/.test(e.subject));
  assert.equal(stuck.length, 1);
  assert.ok(stuck[0].html.includes('dash.cloudflare.com'));
  assert.ok(stuck[0].html.includes('Runbook R2'));
  await s.run(1);
  assert.equal(s.emails.filter((e) => /renew it by hand/.test(e.subject)).length, 1);
});

test('paid after expiry: no auto-renew (Cloudflare stops after expiry), owner renews by hand', async () => {
  const s = setup();
  await s.run(-1);
  const out = await handleDomainRenewalPaid({ id: 'cs_live_r3', payment_status: 'paid', amount_total: 1511, metadata: { domain: 'olivakitchen.com' } }, s.env, { fetchImpl: s.fake, now: daysBefore(-3) });
  assert.equal(out.status, 'PAID');
  assert.deepEqual(s.patches(), []);
  assert.equal(s.emails.filter((e) => /renew it by hand/.test(e.subject)).length, 1);
});

test('pay link: valid link opens Stripe for one year at cost + $5; bad links and paid domains do not', async () => {
  const s = setup();
  await s.run(45);
  const link = s.emails[0].html.match(/https:\/\/menu-made\.com\/api\/domain-renew\/olivakitchen\.com\?t=[A-Za-z0-9_.-]+/)[0];
  const res = await handleDomainRenewPay(new Request(link), s.env, 'olivakitchen.com');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_live_r1');
  const stripe = s.calls.find((c) => c.url === 'https://api.stripe.com/v1/checkout/sessions');
  const params = new URLSearchParams(stripe.body);
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '1511');
  assert.equal(params.get('metadata[purpose]'), 'domain_renewal');
  assert.equal(params.get('metadata[domain]'), 'olivakitchen.com');
  assert.equal(params.get('customer_email'), 'ana@oliva.example');

  const reuse = await handleDomainRenewPay(new Request(link), s.env, 'olivakitchen.com');
  assert.equal(reuse.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_live_r1');
  assert.equal(s.calls.filter((c) => c.url === 'https://api.stripe.com/v1/checkout/sessions').length, 1, 'repeat clicks reuse the open session');

  assert.equal((await handleDomainRenewPay(new Request(link.replace(/t=.*/, 't=bad.token')), s.env, 'olivakitchen.com')).status, 403);
  assert.equal((await handleDomainRenewPay(new Request(link), s.env, 'other.com')).status, 403, 'a link only works for its own domain');

  await handleDomainRenewalPaid({ id: 'cs_live_r1', payment_status: 'paid', amount_total: 1511, metadata: { domain: 'olivakitchen.com' } }, s.env, { fetchImpl: s.fake, now: daysBefore(44) });
  const paid = await handleDomainRenewPay(new Request(link), s.env, 'olivakitchen.com');
  assert.equal(paid.status, 200);
  assert.match(await paid.text(), /Already paid/);
});

test('test-order domains are never looked at', async () => {
  const s = setup({ status: 'TEST', environment: 'sandbox' });
  assert.deepEqual(await s.run(45), []);
  assert.equal(s.calls.length, 0);
});
