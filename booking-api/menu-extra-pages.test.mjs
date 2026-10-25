// Extra menu pages: every page in the uploaded file counts; more pages than paid for pauses production
// until the buyer pays $20 per extra page, then production resumes on its own.
// Run: node --no-warnings --test menu-extra-pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createHmac } from 'node:crypto';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = {
  ...(await import('./src/worker.js')),
  ...(await import('./src/workflows/definitions.js')),
  ...(await import('./src/workflows/runner.js')),
  ...(await import('./src/lib/links.js')),
  ...(await import('./src/producers/menu-qr/page-billing.js')),
};

// ---------- PDF fixtures ----------

function classicPdf(pages, { outlineCount = null, nested = false } = {}) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R' + (outlineCount ? ' /Outlines 9 0 R' : '') + ' >>'];
  const kids = Array.from({ length: pages }, (_, i) => `${10 + i} 0 R`);
  if (nested) {
    const half = Math.ceil(pages / 2);
    objs.push(`<< /Type /Pages /Kids [3 0 R 4 0 R] /Count ${pages} >>`);
    objs.push(`<< /Type /Pages /Parent 2 0 R /Kids [${kids.slice(0, half).join(' ')}] /Count ${half} >>`);
    objs.push(`<< /Type /Pages /Parent 2 0 R /Kids [${kids.slice(half).join(' ')}] /Count ${pages - half} >>`);
  } else {
    objs.push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> >>`);
  }
  let body = '%PDF-1.7\n';
  objs.forEach((o, i) => { body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  if (outlineCount) body += `9 0 obj\n<< /Type /Outlines /Count ${outlineCount} >>\nendobj\n`;
  kids.forEach((_, i) => { body += `${10 + i} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`; });
  return Buffer.from(body + 'trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
}

// Page tree hidden inside a compressed object stream, as most modern exporters write it.
function objectStreamPdf(pages) {
  const inner = `2 0 3 60 << /Type /Pages /Kids [3 0 R] /Count ${pages} >> << /Type /Page /Parent 2 0 R >>`;
  const data = deflateSync(Buffer.from(inner, 'latin1'));
  const head = Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n5 0 obj\n<< /Type /ObjStm /N 2 /First 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, 'latin1');
  return Buffer.concat([head, data, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')]);
}

test('counts PDF pages: plain, nested page tree, object streams; ignores outline counts', async () => {
  assert.equal(await api.countPdfPages(classicPdf(5)), 5);
  assert.equal(await api.countPdfPages(classicPdf(1)), 1);
  assert.equal(await api.countPdfPages(classicPdf(12, { nested: true })), 12);
  assert.equal(await api.countPdfPages(classicPdf(4, { outlineCount: 30 })), 4);
  assert.equal(await api.countPdfPages(objectStreamPdf(7)), 7);
  assert.equal(await api.countPdfPages(Buffer.from('not a pdf at all')), null);
  assert.equal(await api.countPdfPages(Buffer.from('%PDF-1.4\nencrypted garbage')), null);
});

// ---------- Order fixture ----------

const MENU_STEPS = JSON.stringify([
  { key: 'PREPARE_INPUTS', order: 10 }, { key: 'GENERATE_MENU_DRAFT', order: 20 },
  { key: 'GENERATE_QR', order: 30 }, { key: 'QUALITY_CHECK', order: 40 }, { key: 'PACKAGE_DELIVERABLES', order: 50 },
]);
const WEBHOOK_SECRET = 'whsec_test_placeholder';

function setup({ paidPages = 3, file = classicPdf(5), mime = 'application/pdf', link = false } = {}) {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = new Date().toISOString();
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'buyer@example.com', 'Pat', 'Lee')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Proof Cafe')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer', ?, ?, 'ONLINE_MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov', 'offer', 1, ?, ?, 'ACTIVE', 12900, '{}')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES ('order', ?, ?, 'cust', 'biz', 'READY_FOR_PRODUCTION', 14400, 14400, 'PAID', 'cs_test_proof')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json) VALUES ('item', 'order', 'offer', 'ov', 14400, 14400, ?)`,
    JSON.stringify({ offer_code: 'ONLINE_MENU_QR', environment: 'sandbox', menu_package: { menu_pages: paidPages } }));
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES ('proj', 'order', 'item', 'biz', 'cust', 'MENU_QR', 'READY', 'MENU_QR_V1', ?, ?)`, t, t);
  const input = (key, type, value, assetId = null, status = 'VALID', required = 1) => sql(
    `INSERT INTO project_inputs (id, project_id, input_key, input_type, value_text, asset_id, required, status, created_at, updated_at) VALUES (?, 'proj', ?, ?, ?, ?, ?, ?, ?, ?)`,
    `in-${key}`, key, type, value, assetId, required, status, t, t);
  input('business_name', 'TEXT', 'Proof Cafe');
  if (link) {
    input('menu_source', 'URL', 'https://proofcafe.example/menu');
  } else {
    sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES ('menufile', 'biz', 'cust', 'proj', 'MENU_SOURCE', 'uploads/menu', 'menu', ?, ?, 'VALID', ?)`, mime, file.length, t);
    ASSETS.put('uploads/menu', file);
    input('menu_file', 'FILE', null, 'menufile', 'VALID', 0);
    input('menu_source', 'URL', null, null, 'MISSING', 0);
  }
  input('qr_destination', 'URL', 'https://proofcafe.example/table-menu');
  input('contact_email', 'TEXT', 'buyer@example.com');
  sql(`INSERT INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES ('wd', 'MENU_QR_V1', 1, 'ACTIVE', ?, ?, ?)`, MENU_STEPS, t, t);

  const emails = [];
  const stripeCalls = [];
  const fetch = async (url, init = {}) => {
    const target = String(url);
    if (target === 'https://api.resend.com/emails') {
      emails.push({ ...JSON.parse(init.body), idempotencyKey: init.headers['Idempotency-Key'] });
      return Response.json({ id: `email-${emails.length}` });
    }
    if (target === 'https://api.stripe.com/v1/checkout/sessions') {
      stripeCalls.push({ auth: init.headers.Authorization, params: new URLSearchParams(init.body) });
      return Response.json({ id: `cs_test_extra_${stripeCalls.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_extra_${stripeCalls.length}`, expires_at: Math.floor(Date.now() / 1000) + 86400 });
    }
    if (target === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      return Response.json({ model: body.model, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', name: 'record_menu', input: {
        sections: [{ name: 'Mains', items: [{ name: 'Pasta', description: '', price: '$14' }] }], notes: '', unreadable: '' } }] });
    }
    if (target === 'https://proofcafe.example/menu') return new Response('Pasta $14', { headers: { 'content-type': 'text/plain' } });
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
  const ctx = { waitUntil: () => {} };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map(r => ({ ...r }));
  return { env, DB, ASSETS, emails, stripeCalls, fetch, ctx, row, rows, sql };
}

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const queueRun = (f) => api.ensureProductionWorkflow('proj', 'MENU_QR_V1', 1, 'cust', 'order', f.env);
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);
const billing = (f) => JSON.parse(f.row(`SELECT metadata_json FROM projects WHERE id = 'proj'`).metadata_json || '{}').page_billing;
const steps = (f, runId) => Object.fromEntries(f.rows(`SELECT step_key, status FROM workflow_steps WHERE workflow_run_id = ?`, runId).map(s => [s.step_key, s.status]));
const payLink = (text) => (text.match(/https:\/\/menu-made\.com\/api\/extra-pages\/[^\s"<]+/) || [])[0]?.replaceAll('&amp;', '&');

function signedWebhook(f, session, id = 'evt_extra_1') {
  const payload = JSON.stringify({ id, type: 'checkout.session.completed', data: { object: session } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return call(f, 'https://menu-made.com/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${v1}`, 'Content-Type': 'application/json' }, body: payload });
}

// ---------- Flows ----------

test('a 5-page menu on a 3-page order waits for $40, then production resumes after payment', async () => {
  const f = setup({ paidPages: 3, file: classicPdf(5) });
  await withFetch(f.fetch, async () => {
    const run = await queueRun(f);
    await api.runScheduledProduction(f.env);

    // Production paused before any work, with the reason recorded.
    assert.deepEqual(steps(f, run.id), { PREPARE_INPUTS: 'WAITING', GENERATE_MENU_DRAFT: 'QUEUED', GENERATE_QR: 'QUEUED', QUALITY_CHECK: 'QUEUED', PACKAGE_DELIVERABLES: 'QUEUED' });
    const runRow = f.row(`SELECT status, error_code FROM workflow_runs WHERE id = ?`, run.id);
    assert.deepEqual(runRow, { status: 'WAITING', error_code: 'EXTRA_PAGES_PAYMENT_REQUIRED' });
    const project = f.row(`SELECT status, blocked_reason FROM projects WHERE id = 'proj'`);
    assert.equal(project.status, 'BLOCKED');
    assert.match(project.blocked_reason, /2 extra menu pages/);
    const state = billing(f);
    assert.equal(state.status, 'PAYMENT_REQUIRED');
    assert.equal(state.counted_pages, 5);
    assert.equal(state.extra_pages, 2);
    assert.equal(state.amount_cents, 4000);

    // Buyer gets one email with the balance and a signed pay link; nothing else is sent.
    assert.equal(f.emails.length, 1);
    const request = f.emails[0];
    assert.deepEqual(request.to, ['buyer@example.com']);
    assert.match(request.subject, /^\[TEST\] Your menu has 5 pages — \$40 to start production$/);
    assert.match(request.text, /covered 3 pages/);
    const link = payLink(request.text);
    assert.ok(link);

    // Further ticks don't re-send or advance.
    await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 1);
    assert.equal(steps(f, run.id).PREPARE_INPUTS, 'WAITING');

    // Pay link opens a Stripe test-mode Checkout for 2 pages at $20; a second click reuses it.
    const first = await call(f, link);
    assert.equal(first.status, 303);
    assert.equal(first.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_extra_1');
    assert.equal(f.stripeCalls.length, 1);
    const { auth, params } = f.stripeCalls[0];
    assert.equal(auth, 'Bearer sk_test_placeholder');
    assert.equal(params.get('mode'), 'payment');
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), '2000');
    assert.equal(params.get('line_items[0][quantity]'), '2');
    assert.equal(params.get('metadata[purpose]'), 'extra_menu_pages');
    assert.equal(params.get('metadata[project_id]'), 'proj');
    assert.equal(params.get('metadata[order_id]'), null, 'must not look like a new order');
    assert.equal((await call(f, link)).status, 303);
    assert.equal(f.stripeCalls.length, 1);

    // Stripe confirms payment: the run is released.
    const paid = { id: 'cs_test_extra_1', object: 'checkout.session', payment_status: 'paid', amount_total: 4000,
      metadata: { purpose: 'extra_menu_pages', project_id: 'proj', extra_pages: '2', environment: 'sandbox' } };
    const hook = await signedWebhook(f, paid);
    assert.equal(hook.status, 200, await hook.clone().text());
    assert.equal(billing(f).status, 'PAID');
    assert.equal(billing(f).paid_extra_pages, 2);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, run.id).status, 'QUEUED');
    assert.equal(f.row(`SELECT payment_status FROM orders WHERE id = 'order'`).payment_status, 'PAID');

    // A repeated webhook changes nothing.
    assert.equal((await signedWebhook(f, paid, 'evt_extra_2')).status, 200);
    assert.equal(billing(f).paid_extra_pages, 2);
    assert.equal(billing(f).payments.length, 1);

    // Next tick produces the menu and asks the owner, noting the pages.
    await api.runScheduledProduction(f.env);
    assert.equal(steps(f, run.id).PACKAGE_DELIVERABLES, 'WAITING');
    const ownerEmail = f.emails.find(e => /Approve Proof Cafe/.test(e.subject));
    assert.ok(ownerEmail);
    assert.match(ownerEmail.text, /Menu pages: Paid for 3 pages \+ 2 extra · menu has 5 pages\./);

    // The pay link now says there's nothing to pay.
    const after = await call(f, link);
    assert.equal(after.status, 200);
    assert.match(await after.text(), /extra pages are paid/);
  });
});

test('pages within the paid amount go straight through; fewer pages are flagged to the owner', async () => {
  const exact = setup({ paidPages: 3, file: classicPdf(3) });
  await withFetch(exact.fetch, async () => {
    const run = await queueRun(exact);
    await api.runScheduledProduction(exact.env);
    assert.equal(steps(exact, run.id).PACKAGE_DELIVERABLES, 'WAITING');
    assert.equal(billing(exact).status, 'NOT_NEEDED');
    assert.match(exact.emails[0].text, /Menu pages: Paid for 3 pages · menu has 3 pages\./);
  });
  const over = setup({ paidPages: 5, file: objectStreamPdf(3) });
  await withFetch(over.fetch, async () => {
    await queueRun(over);
    await api.runScheduledProduction(over.env);
    assert.equal(over.emails.length, 1);
    assert.match(over.emails[0].text, /Menu pages: Paid for 5 pages · menu has 3 pages \(2 unused, \$40\)\. Refund from Stripe if you choose\./);
  });
});

test('a photo counts as one page; a menu link is flagged as uncounted', async () => {
  const photo = setup({ paidPages: 3, file: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mime: 'image/jpeg' });
  await withFetch(photo.fetch, async () => {
    const run = await queueRun(photo);
    await api.runScheduledProduction(photo.env);
    assert.equal(steps(photo, run.id).PACKAGE_DELIVERABLES, 'WAITING');
    assert.equal(billing(photo).counted_pages, 1);
  });
  const link = setup({ paidPages: 3, link: true });
  await withFetch(link.fetch, async () => {
    const run = await queueRun(link);
    await api.runScheduledProduction(link.env);
    assert.equal(steps(link, run.id).PACKAGE_DELIVERABLES, 'WAITING');
    assert.equal(billing(link).status, 'UNKNOWN');
    assert.match(link.emails[0].text, /page count unavailable \(menu sent as a link\)/);
  });
});

test('reminders on day 2 and 5, owner alert on day 7, each sent once', async () => {
  const f = setup({ paidPages: 3, file: classicPdf(6) });
  await withFetch(f.fetch, async () => {
    await queueRun(f);
    await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 1);
    const age = (days) => f.sql(`UPDATE projects SET metadata_json = json_set(metadata_json, '$.page_billing.requested_at', ?) WHERE id = 'proj'`,
      new Date(Date.now() - days * 86400000).toISOString());

    age(1); await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 1);
    age(2.1); await api.runScheduledProduction(f.env); await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 2);
    assert.match(f.emails[1].subject, /^\[TEST\] Reminder: Your menu has 6 pages — \$60/);
    assert.ok(payLink(f.emails[1].text));
    age(5.1); await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 3);
    age(7.1); await api.runScheduledProduction(f.env); await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 4);
    assert.deepEqual(f.emails[3].to, ['info@menu-made.com']);
    assert.match(f.emails[3].subject, /Unpaid extra menu pages: Proof Cafe/);
  });
});

test('pay links must be signed for that project and unexpired; unsigned webhooks are rejected', async () => {
  const f = setup({ paidPages: 3, file: classicPdf(5) });
  await withFetch(f.fetch, async () => {
    await queueRun(f);
    await api.runScheduledProduction(f.env);
    const link = payLink(f.emails[0].text);
    const other = await api.signLinkToken(f.env, { kind: 'extra_pages', id: 'another-project', ttlDays: 30 });
    const expired = await api.signLinkToken(f.env, { kind: 'extra_pages', id: 'proj', ttlDays: -1 });
    const wrongKind = await api.signLinkToken(f.env, { kind: 'approve', id: 'proj', ttlDays: 30 });
    assert.equal((await call(f, `https://menu-made.com/api/extra-pages/proj?t=${other}`)).status, 403);
    assert.equal((await call(f, `https://menu-made.com/api/extra-pages/proj?t=${wrongKind}`)).status, 403);
    assert.equal((await call(f, `https://menu-made.com/api/extra-pages/proj?t=${expired}`)).status, 410);
    assert.equal((await call(f, link.replace(/.$/, c => (c === 'A' ? 'B' : 'A')))).status, 403);
    assert.equal(f.stripeCalls.length, 0);

    const forged = await call(f, 'https://menu-made.com/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': 't=1,v1=00' },
      body: JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', metadata: { purpose: 'extra_menu_pages', project_id: 'proj', extra_pages: '2' } } } }) });
    assert.equal(forged.status, 400);
    assert.equal(billing(f).status, 'PAYMENT_REQUIRED');
  });
});

test('Stripe return pages', async () => {
  const f = setup();
  assert.match(await (await call(f, 'https://menu-made.com/api/extra-pages/proj/done')).text(), /Payment received/);
  assert.match(await (await call(f, 'https://menu-made.com/api/extra-pages/proj/done?cancelled=1')).text(), /No payment was taken/);
});
