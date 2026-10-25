// Stage 2 end-to-end tests: a paid Online Menu + QR order is produced on the scheduled tick, waits for
// owner approval, and is delivered to the buyer — against a real SQLite copy of the production schema.
// Run: node --no-warnings --test menu-qr-delivery.test.mjs
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const source = await readFile(new URL('./menu-checkout-with-booking.mjs', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(
  source + '\nexport {ensureProductionWorkflow, runScheduledProduction, signLinkToken, attachCheckoutMenuDocument, hostedMenuUrl};'
).toString('base64'));

const MENU_URL = 'https://proofcafe.example/menu';
const QR_URL = 'https://proofcafe.example/table-menu';
const MENU_STEPS = JSON.stringify([
  { key: 'PREPARE_INPUTS', order: 10 }, { key: 'GENERATE_MENU_DRAFT', order: 20 },
  { key: 'GENERATE_QR', order: 30 }, { key: 'QUALITY_CHECK', order: 40 }, { key: 'PACKAGE_DELIVERABLES', order: 50 },
]);

function setup({ automationStart = '2000-01-01T00:00:00.000Z', menuStatus = 200, menuFile = false } = {}) {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = new Date().toISOString();
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'buyer@example.com', 'Pat', 'Lee')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Proof Cafe')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer', ?, ?, 'ONLINE_MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov', 'offer', 1, ?, ?, 'ACTIVE', 12900, '{}')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES ('order', ?, ?, 'cust', 'biz', 'READY_FOR_PRODUCTION', 14400, 14400, 'PAID', 'cs_test_proof')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('item', 'order', 'offer', 'ov', 14400, 14400)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES ('proj', 'order', 'item', 'biz', 'cust', 'MENU_QR', 'READY', 'MENU_QR_V1', ?, ?)`, t, t);
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES ('logo', 'biz', 'cust', 'proj', 'LOGO', 'uploads/logo.png', 'logo.png', 'image/png', 10, 'VALID', ?)`, t);
  const input = (key, type, value, assetId = null) => sql(
    `INSERT INTO project_inputs (id, project_id, input_key, input_type, value_text, asset_id, required, status, created_at, updated_at) VALUES (?, 'proj', ?, ?, ?, ?, 1, 'VALID', ?, ?)`,
    `in-${key}`, key, type, value, assetId, t, t);
  input('business_name', 'TEXT', 'Proof Cafe');
  if (menuFile) {
    sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES ('menupdf', 'biz', 'cust', 'proj', 'MENU_SOURCE', 'uploads/menu.pdf', 'menu.pdf', 'application/pdf', 9, 'VALID', ?)`, t);
    input('menu_file', 'FILE', null, 'menupdf');
    sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, required, status, created_at, updated_at) VALUES ('in-menu_source', 'proj', 'menu_source', 'URL', 0, 'MISSING', ?, ?)`, t, t);
    ASSETS.put('uploads/menu.pdf', '%PDF-1.4 fake');
  } else {
    input('menu_source', 'URL', MENU_URL);
  }
  input('logo', 'FILE', null, 'logo');
  input('brand_colors', 'TEXT', '#071f2c, #00d6e6');
  input('qr_destination', 'URL', QR_URL);
  input('contact_email', 'TEXT', 'owner@proofcafe.example');
  sql(`INSERT INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES ('wd', 'MENU_QR_V1', 1, 'ACTIVE', ?, ?, ?)`, MENU_STEPS, t, t);

  const emails = [];
  const state = { failResend: 0, menuStatus };
  const fetch = async (url, init = {}) => {
    const target = String(url);
    if (target === 'https://api.resend.com/emails') {
      if (state.failResend > 0) { state.failResend--; return new Response(JSON.stringify({ message: 'Resend unavailable' }), { status: 503 }); }
      emails.push({ ...JSON.parse(init.body), idempotencyKey: init.headers['Idempotency-Key'] });
      return Response.json({ id: `email-${emails.length}` });
    }
    if (target === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      state.claudeRequest = { body, headers: init.headers };
      return Response.json({ model: body.model, usage: { input_tokens: 1500, output_tokens: 300 }, content: [{ type: 'tool_use', name: 'record_menu', input: {
        sections: [{ name: 'Starters', items: [{ name: 'Tomato Soup', description: 'Basil, cream', price: '$9' }, { name: 'Caesar Salad', description: '', price: '$11' }] },
          { name: 'Drinks', items: [{ name: 'Espresso', description: '', price: '$4' }] }],
        notes: 'Ask about allergens.', unreadable: 'The dessert prices were smudged.' } }] });
    }
    if (target === MENU_URL) {
      return new Response('Soup $12\nSalad $9\nCoffee $4', { status: state.menuStatus, headers: { 'content-type': 'text/plain' } });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };
  const env = {
    DB, ASSETS,
    PRODUCTION_RUNNER_SECRET: 'test-runner-secret',
    RESEND_API_KEY: 're_test_placeholder',
    ANTHROPIC_API_KEY: 'sk-ant-test-placeholder',
    AUTOMATION_START_AT: automationStart,
  };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map(r => ({ ...r }));
  return { env, DB, ASSETS, emails, state, fetch, ctx, pending, row, rows, sql };
}

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const queueRun = (f) => api.ensureProductionWorkflow('proj', 'MENU_QR_V1', 1, 'cust', 'order', f.env);
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map(m => m[0].replaceAll('&amp;', '&'));
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);

test('a paid Menu + QR order is produced, waits for owner approval, then reaches the buyer', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const run = await queueRun(f);

    // One scheduled tick runs every automated step and parks at owner approval.
    await api.runScheduledProduction(f.env);
    const steps = Object.fromEntries(f.rows(`SELECT step_key, status FROM workflow_steps WHERE workflow_run_id = ?`, run.id).map(s => [s.step_key, s.status]));
    assert.deepEqual(steps, { PREPARE_INPUTS: 'SUCCEEDED', GENERATE_MENU_DRAFT: 'SUCCEEDED', GENERATE_QR: 'SUCCEEDED', QUALITY_CHECK: 'SUCCEEDED', PACKAGE_DELIVERABLES: 'WAITING' });
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, run.id).status, 'WAITING');
    assert.equal(f.row(`SELECT status FROM projects WHERE id = 'proj'`).status, 'QC_REQUIRED');
    assert.equal(f.row(`SELECT status FROM orders WHERE id = 'order'`).status, 'QC_REQUIRED');
    assert.equal(f.row(`SELECT fulfillment_status FROM order_items WHERE id = 'item'`).fulfillment_status, 'AWAITING_APPROVAL');
    const approval = f.row(`SELECT * FROM approvals WHERE project_id = 'proj'`);
    assert.equal(approval.status, 'PENDING');
    assert.ok(JSON.parse(approval.metadata_json).owner_notified_at);
    for (const d of f.rows(`SELECT status, customer_visible FROM deliverables WHERE project_id = 'proj'`)) {
      assert.equal(d.status, 'DRAFT'); assert.equal(d.customer_visible, 0);
    }

    // Exactly one email so far: the owner's approval request, labelled as a test order.
    assert.equal(f.emails.length, 1);
    const ownerEmail = f.emails[0];
    assert.deepEqual(ownerEmail.to, ['info@menu-made.com']);
    assert.match(ownerEmail.subject, /^\[TEST\] Approve Proof Cafe's online menu \+ QR$/);
    const [approveUrl] = linksIn(ownerEmail.text, '/api/approvals/');
    const previewUrls = linksIn(ownerEmail.text, '/api/delivery/');
    assert.ok(approveUrl); assert.equal(previewUrls.length, 2);

    // A second tick does nothing: no duplicate approval, no extra email.
    const idle = await api.runScheduledProduction(f.env);
    assert.equal(idle.results[0].processed, false);
    assert.equal(f.emails.length, 1);
    assert.equal(f.rows(`SELECT id FROM approvals`).length, 1);

    // Owner previews work; drafts are not reachable with a buyer-style link.
    const preview = await call(f, previewUrls[0]);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /^sandbox;/);
    const draftId = previewUrls[0].match(/delivery\/([0-9a-f-]{36})/)[1];
    const buyerToken = await api.signLinkToken(f.env, { kind: 'deliver', id: draftId, ttlDays: 1 });
    assert.equal((await call(f, `https://menu-made.com/api/delivery/${draftId}?t=${buyerToken}`)).status, 404);

    // Opening the approval page (or a link scanner fetching it) does not approve.
    const page = await call(f, approveUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<form method="post"/);
    assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');

    // A forged token is refused; the real one approves and triggers delivery immediately.
    const approvalPath = approveUrl.split('?')[0];
    const forged = await call(f, approvalPath, { method: 'POST', body: new URLSearchParams({ t: 'forged.token' }) });
    assert.equal(forged.status, 403);
    const token = new URL(approveUrl).searchParams.get('t');
    const approved = await call(f, approvalPath, { method: 'POST', body: new URLSearchParams({ t: token }) });
    assert.equal(approved.status, 200);
    await Promise.all(f.pending);

    assert.equal(f.emails.length, 2);
    const buyerEmail = f.emails[1];
    assert.deepEqual(buyerEmail.to, ['owner@proofcafe.example']);
    assert.deepEqual(buyerEmail.bcc, ['menu.automate@gmail.com']);
    assert.match(buyerEmail.subject, /Your online menu and QR code are ready/);
    assert.match(buyerEmail.text, new RegExp(QR_URL.replaceAll('.', '\\.')));
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, run.id).status, 'SUCCEEDED');
    assert.equal(f.row(`SELECT status FROM projects WHERE id = 'proj'`).status, 'DELIVERED');
    assert.equal(f.row(`SELECT status FROM orders WHERE id = 'order'`).status, 'DELIVERED');
    assert.equal(f.row(`SELECT fulfillment_status FROM order_items WHERE id = 'item'`).fulfillment_status, 'FULFILLED');
    for (const d of f.rows(`SELECT status, customer_visible, delivered_at FROM deliverables WHERE project_id = 'proj'`)) {
      assert.equal(d.status, 'FINAL'); assert.equal(d.customer_visible, 1); assert.ok(d.delivered_at);
    }

    // Buyer links open the files; the QR link downloads.
    const [menuLink, qrLink] = linksIn(buyerEmail.text, '/api/delivery/');
    const menu = await call(f, menuLink);
    assert.equal(menu.status, 200);
    assert.match(menu.headers.get('content-type'), /^text\/html/);
    assert.match(await menu.text(), /Tomato Soup/);
    const qr = await call(f, qrLink);
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get('content-disposition'), /^attachment;/);

    // Approving twice changes nothing and sends nothing.
    const again = await call(f, approvalPath, { method: 'POST', body: new URLSearchParams({ t: token }) });
    assert.match(await again.text(), /Already approved/);
    assert.equal(f.emails.length, 2);

    // Every email is logged.
    const logged = f.rows(`SELECT purpose, status FROM communications ORDER BY created_at`);
    assert.deepEqual(logged.map(c => [c.purpose, c.status]), [['OWNER_APPROVAL_REQUEST', 'SENT'], ['ORDER_DELIVERY', 'SENT']]);
  });
});

test('tampered and expired download links are refused', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await queueRun(f);
    await api.runScheduledProduction(f.env);
    const [preview] = linksIn(f.emails[0].text, '/api/delivery/');
    const id = preview.match(/delivery\/([0-9a-f-]{36})/)[1];
    const token = new URL(preview).searchParams.get('t');
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    assert.equal((await call(f, `https://menu-made.com/api/delivery/${id}?t=${tampered}`)).status, 403);
    const expired = await api.signLinkToken(f.env, { kind: 'preview', id, ttlDays: -1 });
    assert.equal((await call(f, `https://menu-made.com/api/delivery/${id}?t=${expired}`)).status, 403);
    const otherFile = await api.signLinkToken(f.env, { kind: 'preview', id: '00000000-0000-4000-8000-000000000000', ttlDays: 1 });
    assert.equal((await call(f, `https://menu-made.com/api/delivery/${id}?t=${otherFile}`)).status, 403);
  });
});

test('a failed buyer email is retried on the next tick instead of failing the order', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const run = await queueRun(f);
    await api.runScheduledProduction(f.env);
    const [approveUrl] = linksIn(f.emails[0].text, '/api/approvals/');
    f.state.failResend = 1;
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: new URL(approveUrl).searchParams.get('t') }) });
    await Promise.all(f.pending);
    const step = f.row(`SELECT status, error_message FROM workflow_steps WHERE workflow_run_id = ? AND step_key = 'PACKAGE_DELIVERABLES'`, run.id);
    assert.equal(step.status, 'QUEUED');
    assert.match(step.error_message, /Delivery email failed/);
    assert.equal(f.row(`SELECT status FROM projects WHERE id = 'proj'`).status !== 'FAILED', true);
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, run.id).status, 'SUCCEEDED');
    assert.equal(f.emails.filter(e => e.subject.includes('ready')).length, 1);
  });
});

test('the scheduled runner leaves runs created before automation went live alone', async () => {
  const f = setup({ automationStart: '2999-01-01T00:00:00.000Z' });
  await withFetch(f.fetch, async () => {
    const run = await queueRun(f);
    const tick = await api.runScheduledProduction(f.env);
    assert.equal(tick.results[0].processed, false);
    assert.equal(f.rows(`SELECT id FROM workflow_steps WHERE workflow_run_id = ? AND status != 'QUEUED'`, run.id).length, 0);
    assert.equal(f.emails.length, 0);
  });
});

test('a run parked for missing inputs resumes once the buyer completes intake', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const run = await queueRun(f);
    f.sql(`UPDATE project_inputs SET status = 'MISSING' WHERE input_key = 'qr_destination'`);
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, run.id).status, 'WAITING');
    f.sql(`UPDATE project_inputs SET status = 'VALID' WHERE input_key = 'qr_destination'`);
    await queueRun(f);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, run.id).status, 'QUEUED');
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE workflow_run_id = ? AND step_key = 'PACKAGE_DELIVERABLES'`, run.id).status, 'WAITING');
    assert.equal(f.rows(`SELECT id FROM approvals`).length, 1);
  });
});

test('a failed production step alerts the owner once and is recorded', async () => {
  const f = setup({ menuStatus: 500 });
  await withFetch(f.fetch, async () => {
    const run = await queueRun(f);
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, run.id).status, 'FAILED');
    const error = f.row(`SELECT error_type, workflow_run_id FROM system_errors`);
    assert.deepEqual(error, { error_type: 'PRODUCTION_STEP_FAILED', workflow_run_id: run.id });
    assert.equal(f.emails.length, 1);
    assert.match(f.emails[0].subject, /Automation stopped/);
    await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 1);
  });
});

test('an expired approval link queues a fresh approval request', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await queueRun(f);
    await api.runScheduledProduction(f.env);
    const approval = f.row(`SELECT id FROM approvals`);
    const expired = await api.signLinkToken(f.env, { kind: 'approve', id: approval.id, ttlDays: -1 });
    const response = await call(f, `https://menu-made.com/api/approvals/${approval.id}?t=${expired}`);
    assert.equal(response.status, 410);
    assert.equal(f.row(`SELECT status FROM approvals WHERE id = ?`, approval.id).status, 'EXPIRED');
    await api.runScheduledProduction(f.env);
    assert.equal(f.rows(`SELECT id FROM approvals WHERE status = 'PENDING'`).length, 1);
    assert.equal(f.emails.filter(e => e.subject.includes('Approve')).length, 2);
  });
});

test('an uploaded menu PDF is read by Claude and the owner sees what to double-check', async () => {
  const f = setup({ menuFile: true });
  await withFetch(f.fetch, async () => {
    await queueRun(f);
    await api.runScheduledProduction(f.env);
    const sent = f.state.claudeRequest;
    assert.equal(sent.headers['x-api-key'], 'sk-ant-test-placeholder');
    assert.equal(sent.body.content ?? sent.body.messages[0].content[0].type, 'document');
    assert.equal(sent.body.tool_choice.type, 'auto'); assert.equal(sent.body.tools[0].name, 'record_menu');
    const draft = f.row(`SELECT a.storage_key FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.deliverable_type = 'MENU_DRAFT'`);
    const html = new TextDecoder().decode(f.ASSETS.objects.get(draft.storage_key).data);
    assert.match(html, /<h2 id="s1-h">Starters<\/h2>/); assert.match(html, /<span class="item">Tomato Soup<\/span>.*<span class="price">\$9<\/span>/s); assert.match(html, /href="#s2">Drinks</);
    assert.doesNotMatch(html, /Draft generated from/);
    assert.equal(f.emails.length, 1);
    assert.match(f.emails[0].text, /Read from the uploaded menu file: 3 items\. Check carefully: The dessert prices were smudged\./);
  });
});

test('the menu uploaded at checkout is attached, and the hosted menu page goes live after approval', async () => {
  const f = setup({ menuFile: true });
  await withFetch(f.fetch, async () => {
    // Simulate the Start page upload: an inquiry holding the PDF, referenced from the order notes.
    const ref = '11111111-2222-4333-8444-555555555555';
    f.sql(`UPDATE project_inputs SET status = 'MISSING', asset_id = NULL WHERE input_key = 'menu_file'`);
    f.sql(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at) VALUES (?, ?, 'x', 0)`, ref,
      JSON.stringify({ document: { name: 'menu.pdf', contentType: 'application/pdf', size: 9, checksum: 'abc', storageKey: `private/inquiries/${ref}/abc` } }));
    await f.ASSETS.put(`private/inquiries/${ref}/abc`, '%PDF-1.4 fake');
    f.sql(`UPDATE orders SET notes = ? WHERE id = 'order'`, `Menu + QR\nDocument ref: ${ref}\nThanks`);
    const hostedUrl = api.hostedMenuUrl('proj', 'Proof Cafe');
    f.sql(`UPDATE project_inputs SET value_text = ? WHERE input_key = 'qr_destination'`, hostedUrl);
    assert.equal(await api.attachCheckoutMenuDocument('proj', 'order', f.env), true);
    assert.equal(f.row(`SELECT status FROM project_inputs WHERE input_key = 'menu_file'`).status, 'VALID');

    await queueRun(f);
    await api.runScheduledProduction(f.env);
    assert.match(hostedUrl, /^https:\/\/menu-made\.com\/api\/menu\/proof-cafe-[0-9a-z]+$/);
    assert.match(await (await call(f, hostedUrl)).text(), /Menu coming soon/);
    const [approveUrl] = linksIn(f.emails[0].text, '/api/approvals/');
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: new URL(approveUrl).searchParams.get('t') }) });
    await Promise.all(f.pending);
    const live = await call(f, hostedUrl);
    assert.equal(live.status, 200);
    assert.match(await live.text(), /Tomato Soup/);
    assert.match(f.emails[1].text, /Your menu is live at https:\/\/menu-made\.com\/api\/menu\//);
  });
});
