// Stage 6, Menu Care: a customer's menu change goes through the signed form, the shared AI step, owner approval
// and onto the same hosted menu address. Mocked Anthropic and Resend, real SQLite schema and migrations.
// Run: node --no-warnings --test booking-api/menu-care.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = {
  ...(await import('./src/worker.js')),
  ...(await import('./src/workflows/runner.js')),
  ...(await import('./src/lib/links.js')),
};
const { buildDesignedMenuHtml } = await import('./src/producers/menu-qr/design.js');
const { parseMenuHtml, diffMenus, checkChange } = await import('./src/producers/menu-care/menu-edit.js');
const { menuCareLink } = await import('./src/producers/menu-care/care-step.js');
const migration = readFileSync(new URL('./migrations/0005_menu_care.sql', import.meta.url), 'utf8');
const settingsMigration = readFileSync(new URL('./migrations/0007_plan_settings.sql', import.meta.url), 'utf8');
const usageIndex = readFileSync(new URL('./migrations/0004_ai_usage_index.sql', import.meta.url), 'utf8');

const HOSTED = 'https://menu-made.com/api/menu/proof-cafe';
const MENU = {
  sections: [
    { name: 'Starters', items: [{ name: 'Tomato Soup', description: 'Basil, cream', price: '$9' }, { name: 'Caesar Salad', description: '', price: '$11' }] },
    { name: 'Pizza', items: [{ name: 'Margherita', description: 'Mozzarella & basil', price: '$15' }, { name: 'Pepperoni', description: '', price: '$17.50' }] },
    { name: 'Drinks', items: [{ name: 'Espresso', description: '', price: '$4' }] },
  ],
  notes: 'Ask about allergens.',
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const withPrice = (menu, itemName, price) => { const m = clone(menu); for (const s of m.sections) for (const i of s.items) if (i.name === itemName) i.price = price; return m; };

function setup() {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'owner@proofcafe.example', 'Pat', 'Lee')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Proof Cafe')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_qr', ?, ?, 'ONLINE_MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_care', ?, ?, 'MENU_CARE', 'Menu Care', 'MENU', 'ACTIVE', 'RECURRING', 'DIGITAL', 1, 'MENU_CARE_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_qr', 'offer_qr', 1, ?, ?, 'ACTIVE', 12900, '{}')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, billing_interval, scope_json) VALUES ('ov_care', 'offer_care', 1, ?, ?, 'ACTIVE', 2900, 'MONTH', '{}')`, t, t);
  sql(`INSERT INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES ('wd_care', 'MENU_CARE_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20}]', ?, ?)`, t, t);
  DB.raw.exec(usageIndex); DB.raw.exec(settingsMigration);
  DB.raw.exec(migration);

  // The customer's existing, approved Menu + QR project and its live menu page.
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, stripe_checkout_session_id) VALUES ('order', ?, ?, 'cust', 'biz', 'DELIVERED', 14400, 14400, 'PAID', 'cs_live_proof')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('item', 'order', 'offer_qr', 'ov_qr', 14400, 14400)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES ('proj', 'order', 'item', 'biz', 'cust', 'MENU', 'DELIVERED', 'MENU_QR_V1', ?, ?)`, t, t);
  sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, value_text, required, status, created_at, updated_at) VALUES ('in-qr', 'proj', 'qr_destination', 'URL', ?, 1, 'VALID', ?, ?)`, HOSTED, t, t);
  const html = buildDesignedMenuHtml({ businessName: 'Proof Cafe', brandColors: '#071f2c, #00d6e6', menu: MENU, logoDataUri: null });
  ASSETS.put('customers/cust/projects/proj/menu.html', html);
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES ('a1', 'biz', 'cust', 'proj', 'DELIVERABLE', 'customers/cust/projects/proj/menu.html', 'menu.html', 'text/html', ?, 'VALID', ?)`, html.length, t);
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d1', 'proj', 'a1', 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`, t, t);

  // The Menu Care subscription.
  sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, current_period_start, current_period_end, started_at, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'cust', 'biz', 'offer_care', 'ov_care', 'sub_test', 'cus_test', 'ACTIVE', 'MONTH', 2900, '2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z', ?, ?, ?)`, t, t, t);
  sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, metadata_json, created_at, updated_at) VALUES ('ent', 'cust', 'biz', '11111111-1111-4111-8111-111111111111', 'MENU_CARE', 'ACTIVE', ?, ?, ?, ?)`, t,
    JSON.stringify({ offer_id: 'offer_care', offer_version_id: 'ov_care', workflow_key: 'MENU_CARE_V1' }), t, t);

  const emails = [];
  const state = { outputs: [], prompts: [] };
  const fetch = async (url, init = {}) => {
    const target = String(url);
    if (target === 'https://api.resend.com/emails') {
      emails.push({ ...JSON.parse(init.body), idempotencyKey: init.headers['Idempotency-Key'] });
      return Response.json({ id: `email-${emails.length}` });
    }
    if (target === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      state.prompts.push(body.messages[0].content);
      const output = state.outputs.shift();
      if (!output) throw new Error('Unexpected AI call');
      return Response.json({ model: body.model, usage: { input_tokens: 800, output_tokens: 400 }, content: [{ type: 'tool_use', name: 'record_output', input: output }] });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map(r => ({ ...r }));
  return { env, DB, ASSETS, emails, state, fetch, ctx, pending, row, rows, sql };
}

const SUB = '11111111-1111-4111-8111-111111111111';
async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map(m => m[0].replaceAll('&amp;', '&'));
const aiReply = (menu, extra = {}) => ({ sections: menu.sections, notes: menu.notes, understood: true, summary: 'Updated the menu.', ...extra });

async function submit(f, text) {
  const link = await menuCareLink(f.env, SUB);
  const token = new URL(link).searchParams.get('t');
  return call(f, `https://menu-made.com/api/menu-care/${SUB}`, { method: 'POST', body: new URLSearchParams({ t: token, change: text }) });
}
const hosted = async (f) => (await call(f, HOSTED)).text();

// ---------- pure logic ----------

test('the live menu page is read back into the same structure it was built from', () => {
  const html = buildDesignedMenuHtml({ businessName: 'Proof Cafe', brandColors: '#071f2c, #00d6e6', menu: MENU, logoDataUri: 'data:image/png;base64,AAAA' });
  const parsed = parseMenuHtml(html);
  assert.deepEqual(parsed.menu.sections, MENU.sections.map(s => ({ name: s.name, items: s.items.map(i => ({ name: i.name, description: i.description, price: i.price })) })));
  assert.equal(parsed.menu.notes, 'Ask about allergens.');
  assert.equal(parsed.businessName, 'Proof Cafe');
  assert.equal(parsed.logoDataUri, 'data:image/png;base64,AAAA');
  assert.match(parsed.primary, /^#[0-9a-f]{6}$/);
  assert.throws(() => parseMenuHtml('<html><body>plain draft</body></html>'), /not in the designed format/);
});

test('diff lists added, removed and changed items', () => {
  const after = withPrice(MENU, 'Margherita', '$16');
  after.sections[0].items.push({ name: 'Bruschetta', description: '', price: '$8' });
  after.sections[2].items = [];
  const kinds = diffMenus(MENU, after).map(d => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['added:Bruschetta', 'changed:Margherita', 'removed:Espresso']);
});

test('checks refuse invented prices, empty results and wiping most of the menu', () => {
  const ok = withPrice(MENU, 'Margherita', '$16');
  assert.deepEqual(checkChange({ before: MENU, after: ok, requestText: 'Margherita is now $16', diff: diffMenus(MENU, ok) }), []);
  assert.match(checkChange({ before: MENU, after: ok, requestText: 'make Margherita more expensive', diff: diffMenus(MENU, ok) })[0], /price "\$16"/);
  assert.match(checkChange({ before: MENU, after: MENU, requestText: 'nothing', diff: [] })[0], /did not change anything/);
  const wiped = { sections: [{ name: 'Drinks', items: [{ name: 'Espresso', description: '', price: '$4' }] }], notes: '' };
  assert.ok(checkChange({ before: MENU, after: wiped, requestText: 'x', diff: diffMenus(MENU, wiped) }).some(p => /removes most of the menu/.test(p)));
});

// ---------- end to end ----------

test('a change request is applied, approved by the owner, and goes live at the same menu address', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const updated = withPrice(MENU, 'Margherita', '$16');
    updated.sections[0].items.push({ name: 'Bruschetta', description: 'Tomato, garlic', price: '$8' });
    f.state.outputs.push(aiReply(updated, { summary: 'Raised Margherita to $16 and added Bruschetta.' }));

    const sent = await submit(f, 'Raise the Margherita to $16 and add Bruschetta, tomato and garlic, $8, under Starters');
    assert.equal(sent.status, 200);
    const request = f.row(`SELECT * FROM menu_change_requests`);
    assert.equal(request.status, 'RECEIVED');
    assert.equal(f.row(`SELECT status, trigger_type FROM workflow_runs WHERE project_id = ?`, request.project_id).trigger_type, 'MENU_CARE_REQUEST');

    // One tick produces the draft and parks at owner approval; the live menu is untouched.
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM menu_change_requests`).status, 'DRAFTED');
    assert.equal(f.emails.length, 1);
    const owner = f.emails[0];
    assert.deepEqual(owner.to, ['info@menu-made.com']);
    assert.match(owner.subject, /Approve Proof Cafe's menu change/);
    assert.match(owner.text, /Changed Margherita \(Pizza\): price \$15 → \$16/);
    assert.match(owner.text, /Added Bruschetta \(Starters\) \$8/);
    const live = await hosted(f);
    assert.match(live, /\$15/); assert.doesNotMatch(live, /Bruschetta/);
    assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');

    // The AI step logged its tokens against the subscription.
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id = ?`, SUB).n, 1);

    // Approve; the customer is told, and the same address now shows the new version.
    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    const token = new URL(approveUrl).searchParams.get('t');
    const approved = await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token }) });
    assert.equal(approved.status, 200);
    await Promise.all(f.pending);
    assert.equal(f.emails.length, 2);
    assert.deepEqual(f.emails[1].to, ['owner@proofcafe.example']);
    assert.match(f.emails[1].text, /Your online menu now shows/);
    assert.match(f.emails[1].text, new RegExp(HOSTED.replaceAll('.', '\\.')));
    const after = await hosted(f);
    assert.match(after, /Bruschetta/); assert.match(after, /\$16/); assert.doesNotMatch(after, />\$15</);
    assert.match(after, /Pepperoni/, 'items the request did not mention are still there');
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE project_id = ?`, request.project_id).status, 'SUCCEEDED');
  });
});

test('a request that needs a price nobody gave is not applied; the customer and owner are told and the menu stays', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    f.state.outputs.push(aiReply(withPrice(MENU, 'Margherita', '$99')));
    await submit(f, 'Make the Margherita more expensive');
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM menu_change_requests`).status, 'NOT_APPLIED');
    assert.equal(f.rows(`SELECT id FROM approvals`).length, 0);
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE project_id != 'proj'`).length, 0);
    assert.deepEqual(f.emails.map(e => e.to[0]).sort(), ['info@menu-made.com', 'owner@proofcafe.example']);
    assert.match(f.emails.find(e => e.to[0] === 'owner@proofcafe.example').text, /exact wording and prices/);
    assert.match(await hosted(f), /\$15/);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE trigger_type = 'MENU_CARE_REQUEST'`).status, 'SUCCEEDED');
  });
});

test('a message that is not a menu change is not applied', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    f.state.outputs.push(aiReply(MENU, { understood: false, summary: 'This is a question, not a menu change.' }));
    await submit(f, 'What time do you close?');
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM menu_change_requests`).status, 'NOT_APPLIED');
    assert.equal(f.rows(`SELECT id FROM approvals`).length, 0);
  });
});

test('owner asks for changes: the request is redone once with the owner\'s note, then goes back for approval', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    f.state.outputs.push(aiReply(withPrice(MENU, 'Margherita', '$16')));
    await submit(f, 'Margherita is now $16 and Pepperoni is now $18');
    await api.runScheduledProduction(f.env);
    const [approveUrl] = linksIn(f.emails[0].text, '/api/approvals/');
    const token = new URL(approveUrl).searchParams.get('t');
    const redo = await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token, action: 'changes', note: 'Pepperoni was also $18' }) });
    assert.equal(redo.status, 200);
    f.state.outputs.push(aiReply(withPrice(withPrice(MENU, 'Margherita', '$16'), 'Pepperoni', '$18')));
    await api.runScheduledProduction(f.env);
    assert.match(f.state.prompts[1], /Pepperoni was also \$18/);
    assert.equal(f.rows(`SELECT id FROM approvals WHERE status = 'PENDING'`).length, 1);
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE status = 'SUPERSEDED'`).length, 1);
    assert.match(await hosted(f), /\$15/, 'still the old menu until the second version is approved');
  });
});

// ---------- intake ----------

test('the change form needs a genuine link, an active plan, and never limits a normal month', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const link = await menuCareLink(f.env, SUB);
    assert.equal((await call(f, link)).status, 200);
    assert.equal((await call(f, `https://menu-made.com/api/menu-care/${SUB}?t=forged.token`)).status, 403);
    const forged = await call(f, `https://menu-made.com/api/menu-care/${SUB}`, { method: 'POST', body: new URLSearchParams({ t: 'forged.token', change: 'Raise prices to $20' }) });
    assert.equal(forged.status, 403);
    assert.equal(f.rows(`SELECT id FROM menu_change_requests`).length, 0);
    assert.equal((await submit(f, 'hi')).status, 400, 'too short to be a change');

    // The plan promises unlimited changes: a normal month's worth of requests is never refused.
    for (let i = 0; i < 25; i++) assert.equal((await submit(f, `Margherita is now $${16 + i}`)).status, 200);
    // Only a runaway script hits the safety valve.
    f.sql(`INSERT INTO menu_change_requests (id, subscription_id, business_id, customer_id, request_text, status, created_at, updated_at)
           WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 80)
           SELECT 'bulk' || i, '${SUB}', 'biz', 'cust', 'x', 'NOT_APPLIED', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM n`);
    assert.equal((await submit(f, 'Margherita is now $50')).status, 429);

    f.sql(`UPDATE subscriptions SET status = 'CANCELLED'`);
    assert.equal((await submit(f, 'Margherita is now $31')).status, 403);
  });
});

function openMonth(f) {
  const t = '2026-11-01T00:00:00.000Z';
  f.sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o2', ?, ?, 'cust', 'biz', 'READY_FOR_PRODUCTION', 0, 0, 'PAID')`, t, t);
  f.sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i2', 'o2', 'offer_care', 'ov_care', 0, 0)`);
  f.sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at, metadata_json) VALUES ('p2', 'o2', 'i2', 'biz', 'cust', 'MENU', 'READY', 'MENU_CARE_V1', ?, ?, ?)`, t, t, JSON.stringify({ source: 'SUBSCRIPTION_PERIOD', subscription_id: SUB, period_start: t }));
  f.sql(`INSERT INTO workflow_runs (id, project_id, workflow_key, workflow_version, status, trigger_type, trigger_reference, attempt_number, created_at) VALUES ('r2', 'p2', 'MENU_CARE_V1', 1, 'QUEUED', 'SUBSCRIPTION_PERIOD', 'x', 1, ?)`, t);
  f.sql(`INSERT INTO workflow_steps (id, workflow_run_id, step_key, step_order, status, attempt_count) VALUES ('s1', 'r2', 'PRODUCE', 10, 'QUEUED', 0), ('s2', 'r2', 'DELIVER', 20, 'QUEUED', 0)`);
}

test('the monthly Menu Care job emails the customer their change link and finishes, even when no idea can be written', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    openMonth(f);
    await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 1);
    assert.deepEqual(f.emails[0].to, ['owner@proofcafe.example']);
    const [formLink] = linksIn(f.emails[0].text, '/api/menu-care/');
    assert.equal((await call(f, formLink)).status, 200, 'the emailed link opens the form');
    assert.doesNotMatch(f.emails[0].text, /idea for this month/);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = 'r2'`).status, 'SUCCEEDED');
  });
});

test('the monthly email carries one seasonal idea; accepting it asks only for a price and sends a normal change request', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    openMonth(f);
    f.state.outputs.push({ name: 'Pesto Margherita Flatbread', description: 'Mozzarella and basil on a thin crisp base.', section: 'Pizza' });
    await api.runScheduledProduction(f.env);
    const text = f.emails[0].text;
    assert.match(text, /idea for this month: Pesto Margherita Flatbread/);
    assert.doesNotMatch(text.split('idea for this month')[1], /\$\d/, 'the idea carries no price');
    const accept = linksIn(text, '/api/menu-care/').find((u) => /[?&]s=2026-11/.test(u));
    const page = await call(f, accept);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /name="price"/);
    const token = new URL(accept).searchParams.get('t');
    const post = (price) => call(f, `https://menu-made.com/api/menu-care/${SUB}`, { method: 'POST', body: new URLSearchParams({ t: token, s: '2026-11', price }) });
    assert.equal((await post('lots')).status, 400);
    assert.equal(f.rows(`SELECT id FROM menu_change_requests`).length, 0);
    assert.equal((await post('14')).status, 200);
    const request = f.row(`SELECT request_text, source FROM menu_change_requests`);
    assert.equal(request.source, 'SUGGESTION');
    assert.match(request.request_text, /"Pesto Margherita Flatbread" to the "Pizza" section at \$14/);
    // An idea with a made-up price or a duplicate dish is dropped, and the email still goes out.
    const g = setup();
    await withFetch(g.fetch, async () => {
      openMonth(g);
      g.state.outputs.push({ name: 'Margherita', description: 'Mozzarella and basil.', section: 'Pizza' });
      await api.runScheduledProduction(g.env);
      assert.equal(g.emails.length, 1);
      assert.doesNotMatch(g.emails[0].text, /idea for this month/);
    });
  });
});

// ---------- self-test ----------

test('the Menu Care self-test walks a change through AI, approval and the live menu, and fails loudly when the update is wrong', async () => {
  const { advanceMenuCareSelfTests } = await import('./src/selftest/menu-care-selftest.js');
  for (const broken of [false, true]) {
    const f = setup();
    await withFetch(f.fetch, async () => {
      const menu = {
        sections: [
          { name: 'Starters', items: [{ name: 'Tomato Soup', description: 'Basil and cream', price: '$9' }, { name: 'Garlic Bread', description: '', price: '$6' }] },
          { name: 'Pizza', items: [{ name: 'Margherita', description: 'Mozzarella and basil', price: '$16' }, { name: 'Pepperoni', description: '', price: broken ? '$20' : '$17.50' }] },
        ],
        notes: 'Ask about allergens.',
      };
      // $20 is not in the request or the old menu, so the quality check stops it before any draft exists.
      f.state.outputs.push(aiReply(menu));
      f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('11112222-0000-4000-8000-000000000001', 'MENU_CARE_EDIT', 'REQUESTED', 'test', '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z')`);
      const app = (request) => api.default.fetch(request, f.env, f.ctx);
      for (let tick = 0; tick < 4; tick++) {
        await advanceMenuCareSelfTests(f.env, app);
        await api.runScheduledProduction(f.env);
        await Promise.all(f.pending);
      }
      await advanceMenuCareSelfTests(f.env, app);
      const test = f.row(`SELECT status, stage, error FROM self_tests`);
      if (!broken) {
        assert.equal(test.status, 'PASSED', JSON.stringify(test));
        assert.ok(f.emails.every((e) => e.to[0] === 'delivered@resend.dev'), 'only the synthetic mailbox is emailed');
        assert.equal(f.row(`SELECT status FROM subscriptions WHERE provider_subscription_id LIKE 'sub_selftest_menucare_%'`).status, 'CANCELLED');
      } else {
        assert.equal(test.status, 'FAILED');
        assert.match(test.error, /not applied/i);
        assert.ok(f.emails.some((e) => e.to[0] === 'info@menu-made.com' && /Menu Care self-test failed/.test(e.subject)));
      }
    });
  }
});

test('period jobs of the subscription self-test customer never reach the Menu Care producer', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    f.sql(`UPDATE customers SET email = 'delivered@resend.dev'`);
    const t = '2026-10-01T00:00:00.000Z';
    f.sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o2', ?, ?, 'cust', 'biz', 'READY_FOR_PRODUCTION', 0, 0, 'PAID')`, t, t);
    f.sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i2', 'o2', 'offer_care', 'ov_care', 0, 0)`);
    f.sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at, metadata_json) VALUES ('p2', 'o2', 'i2', 'biz', 'cust', 'MENU', 'READY', 'MENU_CARE_V1', ?, ?, ?)`, t, t, JSON.stringify({ source: 'SUBSCRIPTION_PERIOD', subscription_id: SUB, period_start: t }));
    f.sql(`INSERT INTO workflow_runs (id, project_id, workflow_key, workflow_version, status, trigger_type, trigger_reference, attempt_number, created_at) VALUES ('r2', 'p2', 'MENU_CARE_V1', 1, 'QUEUED', 'SUBSCRIPTION_PERIOD', 'x', 1, ?)`, t);
    f.sql(`INSERT INTO workflow_steps (id, workflow_run_id, step_key, step_order, status, attempt_count) VALUES ('s1', 'r2', 'PRODUCE', 10, 'QUEUED', 0), ('s2', 'r2', 'DELIVER', 20, 'QUEUED', 0)`);
    await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 0);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = 'r2'`).status, 'QUEUED');
  });
});
