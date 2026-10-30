// Stage 6, Conversion Fix: brief parsing, the audit's findings, AI recommendations with their quality checks, owner approval
// and delivery. Mocked Anthropic, Resend and the customer's website; real SQLite schema and migrations.
// Run: node --no-warnings --test booking-api/conversion.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = { ...(await import('./src/worker.js')), ...(await import('./src/workflows/runner.js')) };
const { parseBrief, startConversionFix } = await import('./src/producers/conversion/intake.js');
const { auditHome, goalKind } = await import('./src/producers/conversion/audit.js');
const { validate } = await import('./src/producers/conversion/recommend.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const SITE = 'https://joespizza.example/';
const WEAK = `<!doctype html><html><head><title>Joe's</title><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script></head><body><h2>Welcome</h2><p>Family pizza since 1980.</p><a href="/about">About</a><a href="/gallery">Gallery</a><a href="/missing">Old page</a><form><input name="a"><input name="b"><input name="c"><input name="d"><input name="e"><input name="f"><input name="g"></form></body></html>`;
const STRONG = `<!doctype html><html lang="en"><head><title>Joe's Pizza</title><meta name="description" content="Pizza in Austin"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Joe's Pizza</h1><a href="tel:5125550100">Call us</a><a href="/menu">Menu</a><p>123 Main Street, Austin. Open Mon-Sun 11am to 9pm. Rated 4.8 stars by our guests.</p><a href="https://instagram.com/joes">Instagram</a></body></html>`;

test('brief parsing: the Start page note becomes a safe url and a goal; junk is rejected', () => {
  assert.deepEqual(parseBrief('Website fix: https://joespizza.example/\nGoal: phone calls\nDocument ref: x'), { url: 'https://joespizza.example/', goal: 'phone calls' });
  assert.equal(parseBrief('Website fix: http://localhost/x\nGoal: calls').url, '');
  assert.equal(parseBrief('Website fix: https://user:pw@joespizza.example/\nGoal: calls').url, '');
  assert.equal(parseBrief('Menu: 3 pages').url, '');
  assert.equal(goalKind('table reservations'), 'bookings'); assert.equal(goalKind('online orders'), 'orders'); assert.equal(goalKind('calls'), 'calls');
});

test('audit: a weak page gets specific, evidenced findings and a strong page passes the basics', () => {
  const weak = auditHome({ html: WEAK, ms: 3100, https: false }, 'phone calls').findings.map((f) => f.id);
  for (const id of ['slow-response', 'not-https', 'no-viewport', 'no-tel-link', 'no-goal-cta', 'no-h1', 'no-menu-link', 'no-address', 'no-hours', 'no-social-proof', 'long-form-1', 'form-no-submit-1', 'blocking-scripts']) assert.ok(weak.includes(id), `missing ${id}: ${weak}`);
  const strong = auditHome({ html: STRONG, ms: 400, https: true }, 'phone calls').findings.filter((f) => f.severity === 'high');
  assert.deepEqual(strong.map((f) => f.id), []);
});

test('recommendation checks: unknown ids, uncovered high findings, promises and invented facts are all refused', () => {
  const audit = { goal: 'calls', findings: [{ id: 'no-tel-link', severity: 'high' }, { id: 'no-h1', severity: 'medium' }], sample: { text: 'Joe\'s Pizza call 512-555-0100', title: '', description: '', headlines: [] } };
  const fix = (o) => ({ finding_ids: ['no-tel-link'], title: 'Make the phone number tappable', why: 'Visitors on phones cannot call in one tap.', steps: ['Wrap the number in a tel: link'], impact: 'high', effort: 'quick', snippet: '', ...o });
  const ok = validate({ summary: 'Make calling easy first, then fix the page heading.', fixes: [fix({})], copy: [{ where: 'Hero', current: 'Welcome', suggested: "Call Joe's Pizza: 512-555-0100" }] }, audit);
  assert.deepEqual(ok.problems, []);
  const bad = validate({ summary: 'This will increase calls by 40% for sure.', fixes: [fix({ finding_ids: ['made-up'] }), fix({ why: 'This will double your orders.' })], copy: [{ where: 'Hero', current: '', suggested: 'Call now 512-555-9999 or pay $5' }] }, audit).problems.join('\n');
  assert.match(bad, /finding_ids must be ids from the audit/); assert.match(bad, /promise results/); assert.match(bad, /phone "512-555-9999"/); assert.match(bad, /price "\$5"/);
  assert.match(validate({ summary: 'Fix the heading first on the page.', fixes: [fix({ finding_ids: ['no-h1'] })], copy: [] }, audit).problems.join(), /high-severity finding "no-tel-link" is not addressed/);
});

function setup({ site = WEAK, status = 0 } = {}) {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe', 'Rossi')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Joes Pizza')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_c', ?, ?, 'CONVERSION_FIX', 'Conversion Fix', 'OTHER', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'CONVERSION_FIX_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('ov_c', 'offer_c', 1, ?, ?, 'ACTIVE', 29900, '{}')`, t, t);
  DB.raw.exec(read('0004_ai_usage_index.sql')); DB.raw.exec(read('0008_conversion_fix.sql'));
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status, notes) VALUES ('o1', ?, ?, 'cust', 'biz', 'ONBOARDING_REQUIRED', 29900, 29900, 'PAID', ?)`, t, t, `Website fix: ${SITE}\nGoal: phone calls`);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'offer_c', 'ov_c', 29900, 29900)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES ('cp', 'o1', 'i1', 'biz', 'cust', 'OTHER', 'AWAITING_INPUTS', 'CONVERSION_FIX_V1', 1, ?, ?)`, t, t);
  const emails = []; const state = { outputs: [], prompts: [], site, status, fetched: [] };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body); state.prompts.push(body.messages[0].content);
      const output = state.outputs.shift(); if (!output) throw new Error('Unexpected AI call');
      return Response.json({ model: body.model, usage: { input_tokens: 2000, output_tokens: 1500 }, content: [{ type: 'tool_use', name: 'record_output', input: output }] });
    }
    if (u.startsWith('https://menu-made.com')) { state.fetched.push(u); if (u.endsWith('/missing')) return new Response('no', { status: 404 }); return new Response(u === 'https://menu-made.com/' ? WEAK : STRONG, { headers: { 'content-type': 'text/html' } }); }
    if (u.startsWith('https://joespizza.example')) { state.fetched.push(u); if (state.status) return new Response('x', { status: state.status }); return new Response(u === SITE ? state.site : (u.endsWith('/missing') ? 'no' : STRONG), { status: u.endsWith('/missing') ? 404 : 200, headers: { 'content-type': 'text/html' } }); }
    throw new Error(`Unexpected fetch ${u}`);
  };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map(r => ({ ...r }));
  return { env, DB, ASSETS, emails, state, fetch, ctx, pending, row, rows, sql };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map(m => m[0].replaceAll('&amp;', '&'));
const goodRec = () => ({
  summary: 'Make it easy to call and tell visitors where you are before anything else.',
  fixes: [
    { finding_ids: ['no-viewport'], title: 'Make the site work on phones', why: 'Most visitors arrive on a phone and see a tiny desktop page.', steps: ['Add the viewport tag', 'Check the page on your own phone'], impact: 'high', effort: 'quick', snippet: '<meta name="viewport" content="width=device-width, initial-scale=1">' },
    { finding_ids: ['no-tel-link', 'no-goal-cta'], title: 'Add a tap-to-call button at the top', why: 'Calls are your goal but there is no one-tap way to call.', steps: ['Add a Call us button linking to your number'], impact: 'high', effort: 'quick', snippet: '' },
    { finding_ids: ['no-menu-link', 'no-address', 'no-hours', 'broken-links', 'form-no-submit-1', 'long-form-1'], title: 'Show the menu, address and hours on the home page', why: 'Hungry visitors look for these first.', steps: ['Link the menu', 'Add address and hours'], impact: 'high', effort: 'moderate', snippet: '' }
  ],
  copy: [{ where: 'Main headline', current: 'Welcome', suggested: 'Family pizza since 1980 - call us to order' }]
});

test('startConversionFix turns the order brief into inputs and releases the project; a missing brief tells the owner', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const notes = f.row(`SELECT notes FROM orders`).notes;
    await startConversionFix(f.env, { projectId: 'cp', orderId: 'o1', customerId: 'cust', notes });
    assert.equal(f.row(`SELECT status FROM projects WHERE id = 'cp'`).status, 'READY');
    assert.equal(f.rows(`SELECT input_key FROM project_inputs ORDER BY input_key`).map((r) => r.input_key).join(), 'main_goal,website_url');
    assert.equal(f.rows(`SELECT id FROM workflow_runs WHERE project_id = 'cp'`).length, 1);
    f.sql(`UPDATE projects SET status = 'AWAITING_INPUTS' WHERE id = 'cp'`);
    const g = await startConversionFix(f.env, { projectId: 'cp2', orderId: 'o9', customerId: 'cust', notes: 'nothing useful' });
    assert.equal(g.started, false);
    assert.deepEqual(f.emails.at(-1).to, ['info@menu-made.com']);
  });
});

test('a paid order is audited, written up, approved by the owner and delivered with the offer', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await startConversionFix(f.env, { projectId: 'cp', orderId: 'o1', customerId: 'cust', notes: f.row(`SELECT notes FROM orders`).notes });
    f.state.outputs.push(goodRec());
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
        assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');
    const owner = f.emails.find((m) => m.to[0] === 'info@menu-made.com');
    assert.equal(f.emails.length, 2);
    assert.deepEqual(owner.to, ['info@menu-made.com']);
    assert.match(f.state.prompts[0], /\[no-tel-link\]/);
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE customer_visible = 1`).length, 0);
    const pages = await Promise.all(linksIn(owner.text, '/api/delivery/').map(async (u) => (await call(f, u)).text()));
    assert.equal(pages.length, 2);
    const page = pages.find((p) => p.includes('<!doctype html>'));
    assert.match(page, /Add a tap-to-call button/); assert.match(page, /cannot see your visitor numbers/); assert.match(page, /Family pizza since 1980 - call us to order/);
    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: new URL(approveUrl).searchParams.get('t') }) });
    await Promise.all(f.pending);
    assert.equal(f.emails.length, 3);
    assert.deepEqual(f.emails[2].to, ['joe@joespizza.example']);
    assert.match(f.emails[2].text, /Website & App Care/);
    assert.equal(f.row(`SELECT status FROM projects WHERE id = 'cp'`).status, 'DELIVERED');
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE'`).n, 1);
  });
});

test('a recommendation with promises is retried with feedback, then held back from the buyer', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await startConversionFix(f.env, { projectId: 'cp', orderId: 'o1', customerId: 'cust', notes: f.row(`SELECT notes FROM orders`).notes });
    const bad = goodRec(); bad.fixes[0].why = 'This will double your orders overnight.';
    f.state.outputs.push(bad, bad);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.state.prompts.length, 2);
    assert.match(f.state.prompts[1], /Your previous answer had these problems/);
    assert.equal(f.rows(`SELECT id FROM approvals`).length, 0);
    assert.deepEqual(f.emails.map((m) => m.to[0]), ['joe@joespizza.example', 'info@menu-made.com']);
    assert.equal(f.rows(`SELECT id FROM deliverables`).length, 0);
  });
});

test('an unreachable website is reported to the owner without calling the AI', async () => {
  const f = setup({ status: 500 });
  await withFetch(f.fetch, async () => {
    await startConversionFix(f.env, { projectId: 'cp', orderId: 'o1', customerId: 'cust', notes: f.row(`SELECT notes FROM orders`).notes });
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.state.prompts.length, 0);
    const alert = f.emails.find((m) => m.to[0] === 'info@menu-made.com');
    assert.match(alert.subject, /could not be read/);
    assert.equal(f.emails.filter((m) => m.to[0] !== 'info@menu-made.com' && m.to[0] !== 'joe@joespizza.example').length, 0);
  });
});

test('the self-test drives a synthetic order through audit, approval and delivery, and fails loudly when the report is not produced', async () => {
  const { advanceConversionSelfTests } = await import('./src/selftest/conversion-selftest.js');
  for (const broken of [false, true]) {
    const f = setup();
    f.sql(`UPDATE projects SET status = 'CANCELLED'`);
    await withFetch(f.fetch, async () => {
      const rec = goodRec(); if (broken) rec.fixes = rec.fixes.slice(0, 1);
      f.state.outputs.push(rec, rec);
      f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('55556666-0000-4000-8000-000000000001', 'CONVERSION_RUN', 'REQUESTED', 'test', '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z')`);
      const app = (request) => api.default.fetch(request, f.env, f.ctx);
      for (let tick = 0; tick < 5; tick++) { await advanceConversionSelfTests(f.env, app); await api.runScheduledProduction(f.env); await Promise.all(f.pending); }
      await advanceConversionSelfTests(f.env, app);
      const result = f.row(`SELECT status, error FROM self_tests`);
      if (!broken) { assert.equal(result.status, 'PASSED', JSON.stringify(result)); assert.ok(f.emails.filter((e) => e.to[0] !== 'info@menu-made.com').every((e) => e.to[0] === 'delivered@resend.dev')); }
      else { assert.equal(result.status, 'FAILED', JSON.stringify(result)); assert.ok(f.emails.some((e) => e.to[0] === 'info@menu-made.com' && /self-test failed/i.test(e.subject))); }
    });
  }
});
