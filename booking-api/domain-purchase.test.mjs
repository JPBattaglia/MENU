// Domains bought at checkout (owner, Nov 7, 2026): checked and priced at checkout, registered once after payment in
// the buyer's name, pointed at the hosted site, buyer told when it answers.
// Run: node --no-warnings --test booking-api/domain-purchase.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { domainForCheckout, hostsSite, queueDomain, registryPhone, runDomainPurchases } = await import('./src/producers/website/domain-purchase.js');
const { customHostSlug } = await import('./src/producers/website/domains.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
const T = '2026-11-07T00:00:00.000Z';

function setup({ cost = '10.11', registerState = 'succeeded', registerStatus = 201, stripeAddress = true } = {}) {
  const DB = createD1();
  DB.raw.exec(read('0009_website_package.sql')); DB.raw.exec(read('0043_domain_registrations.sql'));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name, phone) VALUES ('cust', ?, ?, 'ana@oliva.example', 'Ana', 'Rossi', '(415) 555-0142')`, T, T);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Oliva Kitchen')`, T, T);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES ('o1', ?, ?, 'cust', 'biz', 'PAID', 0, 0, 'PAID', 'cs_live_x')`, T, T);
  sql(`INSERT INTO website_sites (id, slug, project_id, business_id, customer_id, style, created_at, updated_at) VALUES ('s1', 'oliva', 'p1', 'biz', 'cust', 'generator', ?, ?)`, T, T);
  const calls = [];
  const emails = [];
  const fake = async (url, init = {}) => {
    url = String(url);
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (url === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'e' + emails.length }); }
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/')) return Response.json({ customer_details: { name: 'Ana Rossi', email: 'ana@oliva.example', phone: '+14155550142', address: stripeAddress ? { line1: '512 Columbus Ave', city: 'San Francisco', state: 'CA', postal_code: '94133', country: 'US' } : null } });
    if (url.endsWith('/registrar/domain-check')) return Response.json({ success: true, result: { domains: [{ name: 'olivakitchen.com', registrable: true, tier: 'standard', pricing: { currency: 'USD', registration_cost: cost, renewal_cost: cost } }] } });
    if (url.endsWith('/registrar/registrations') && method === 'POST') return Response.json({ success: true, result: { domain_name: 'olivakitchen.com', state: registerState, completed: registerState === 'succeeded', context: { registration: { expires_at: '2027-11-07T00:00:00Z' } } } }, { status: registerStatus });
    if (url.includes('/registration-status')) return Response.json({ success: true, result: { state: 'succeeded', completed: true, context: { registration: { expires_at: '2027-11-07T00:00:00Z' } } } });
    if (url.endsWith('/registrar/registrations/olivakitchen.com')) return Response.json({ success: true, result: { domain_name: 'olivakitchen.com', status: 'active', expires_at: '2027-11-07T00:00:00Z' } });
    if (url.includes('/zones?name=olivakitchen.com')) return Response.json({ success: true, result: [{ id: 'zone1' }] });
    if (url.endsWith('/zones/zone1/dns_records') || url.endsWith('/zones/zone1/workers/routes')) return Response.json({ success: true, result: {} });
    if (url === 'https://olivakitchen.com/') return new Response(null, { status: 200 });
    throw new Error('Unexpected fetch ' + url);
  };
  globalThis.fetch = fake;
  const env = { DB, CF_REGISTRAR_TOKEN: 'cfat_x', CF_ACCOUNT_ID: 'acct', STRIPE_SECRET_KEY: 'sk_live_x', RESEND_API_KEY: 're_test', OWNER_EMAIL: 'info@menu-made.com' };
  const context = { id: 'p1', order_id: 'o1', business_id: 'biz', customer_id: 'cust' };
  const domain = { name: 'olivakitchen.com', price_cents: 1511, cost_cents: 1011, renewal_cents: 1511 };
  const row = () => DB.raw.prepare(`SELECT * FROM domain_registrations WHERE domain = 'olivakitchen.com'`).get();
  const ripe = () => sql(`UPDATE domain_registrations SET next_check_at = NULL`);
  return { DB, env, context, domain, calls, emails, fake, row, ripe };
}

test('only a hosted site can have a domain, and phone numbers are put in registry form', () => {
  assert.ok(hostsSite({ offerCode: 'WEBSITE_CARE' }));
  assert.ok(hostsSite({ offerCode: 'BUNDLE_PRO', includes: ['MENU_CARE', 'WEBSITE_CARE'] }));
  assert.ok(!hostsSite({ offerCode: 'MENU_CARE', includes: [] }));
  assert.ok(!hostsSite(null));
  assert.equal(registryPhone('(415) 555-0142'), '+1.4155550142');
  assert.equal(registryPhone('+1 415 555 0142'), '+1.4155550142');
  assert.equal(registryPhone('+44 20 7946 0958'), null);
});

test('checkout prices the domain at cost + $5 and refuses it without hosting', async () => {
  const s = setup();
  const priced = await domainForCheckout(s.env, 'www.OlivaKitchen.com', { plan: { offerCode: 'WEBSITE_CARE' }, fetchImpl: s.fake });
  assert.deepEqual(priced, { name: 'olivakitchen.com', price_cents: 1511, cost_cents: 1011, renewal_cents: 1511 });
  await assert.rejects(domainForCheckout(s.env, 'olivakitchen.com', { plan: null, fetchImpl: s.fake }), /hosted website/);
  await assert.rejects(domainForCheckout({ ...s.env, CF_REGISTRAR_TOKEN: '' }, 'olivakitchen.com', { plan: { offerCode: 'WEBSITE_CARE' }, fetchImpl: s.fake }), /isn't available/);
});

test('after payment: registered once in the buyer\'s name, pointed, served on apex and www, buyer emailed', async () => {
  const s = setup();
  await queueDomain(s.env, s.context, s.domain, 'oliva');
  await queueDomain(s.env, s.context, s.domain, 'oliva'); // the step re-running never queues twice
  assert.equal(s.row().status, 'QUEUED');

  assert.deepEqual(await runDomainPurchases(s.env, { fetchImpl: s.fake }), [{ domain: 'olivakitchen.com', outcome: 'REGISTERED' }]);
  const posts = s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/registrar/registrations'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.domain_name, 'olivakitchen.com');
  assert.equal(posts[0].body.contacts.registrant.postal_info.name, 'Ana Rossi');
  assert.equal(posts[0].body.contacts.registrant.postal_info.organization, 'Oliva Kitchen');
  assert.equal(posts[0].body.contacts.registrant.phone, '+1.4155550142');
  assert.equal(posts[0].body.contacts.registrant.postal_info.address.country_code, 'US');
  assert.equal(posts[0].body.auto_renew, undefined, 'nothing renews unpaid');
  assert.equal(s.row().registrant, 'CUSTOMER');
  assert.equal(s.row().expires_at, '2027-11-07T00:00:00Z');

  assert.deepEqual(await runDomainPurchases(s.env, { fetchImpl: s.fake }), [{ domain: 'olivakitchen.com', outcome: 'POINTED' }]);
  const dns = s.calls.filter((c) => c.url.endsWith('/dns_records')).map((c) => c.body.name);
  const routes = s.calls.filter((c) => c.url.endsWith('/workers/routes')).map((c) => c.body);
  assert.deepEqual(dns, ['olivakitchen.com', 'www.olivakitchen.com']);
  assert.deepEqual(routes, [{ pattern: 'olivakitchen.com/*', script: 'menu-checkout' }, { pattern: 'www.olivakitchen.com/*', script: 'menu-checkout' }]);
  assert.equal(await customHostSlug(s.env, 'olivakitchen.com'), 'oliva');
  assert.equal(await customHostSlug(s.env, 'www.olivakitchen.com'), 'oliva');

  s.ripe();
  assert.deepEqual(await runDomainPurchases(s.env, { fetchImpl: s.fake }), [{ domain: 'olivakitchen.com', outcome: 'ACTIVE' }]);
  const live = s.emails.find((e) => e.subject === 'olivakitchen.com is live');
  assert.ok(live && live.to.includes('ana@oliva.example'));
  assert.ok(/nothing renews without your OK/.test(live.html));

  s.ripe();
  assert.deepEqual(await runDomainPurchases(s.env, { fetchImpl: s.fake }), [], 'an active domain is left alone');
  assert.equal(s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/registrar/registrations')).length, 1);
});

test('no address from Stripe: registered with the default contact; a slow registration is polled, never re-sent', async () => {
  const s = setup({ stripeAddress: false, registerState: 'in_progress', registerStatus: 202 });
  await queueDomain(s.env, s.context, s.domain, 'oliva');
  assert.deepEqual(await runDomainPurchases(s.env, { fetchImpl: s.fake }), [{ domain: 'olivakitchen.com', outcome: 'IN_PROGRESS' }]);
  assert.equal(s.calls.find((c) => c.url.endsWith('/registrar/registrations')).body.contacts, undefined);
  assert.equal(s.row().registrant, 'DEFAULT');
  s.ripe();
  assert.deepEqual(await runDomainPurchases(s.env, { fetchImpl: s.fake }), [{ domain: 'olivakitchen.com', outcome: 'REGISTERED' }]);
  assert.equal(s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/registrar/registrations')).length, 1);
});

test('a price jump since checkout holds the domain and tells the owner; test orders buy nothing', async () => {
  const s = setup({ cost: '30.00' });
  await queueDomain(s.env, s.context, s.domain, 'oliva');
  assert.deepEqual(await runDomainPurchases(s.env, { fetchImpl: s.fake }), [{ domain: 'olivakitchen.com', outcome: 'HELD' }]);
  assert.equal(s.calls.filter((c) => c.url.endsWith('/registrar/registrations')).length, 0);
  assert.ok(s.emails.some((e) => /\[Domain\] olivakitchen.com: price rose/.test(e.subject)));

  const t = setup();
  await queueDomain(t.env, t.context, t.domain, 'oliva', { test: true });
  assert.equal(t.row().status, 'TEST');
  assert.deepEqual(await runDomainPurchases(t.env, { fetchImpl: t.fake }), []);
  assert.equal(t.calls.length, 0);
});
