// Stage 6, Accessibility Monitoring: static scanner, plan settings page, waiting for the website address, report, trend.
// Mocked Anthropic, Resend and the customer's website; real SQLite schema and migrations.
// Run: node --no-warnings --test booking-api/accessibility.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = { ...(await import('./src/worker.js')), ...(await import('./src/workflows/runner.js')) };
const { scanHtml, scanSite, summarize, sameSiteLinks } = await import('./src/producers/accessibility/scan.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
const SUB = '33333333-3333-4333-8333-333333333333';
const RUN = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const rules = (html) => scanHtml(html).map((f) => f.rule).sort();

const GOOD = '<!doctype html><html lang="en"><head><title>Cafe</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main><h1>Cafe</h1><h2>Menu</h2><img src="a.jpg" alt="Pizza"><a href="/menu">Menu</a><label for="e">Email</label><input id="e" name="e"><button>Send</button></main></body></html>';
const BAD = '<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head><body><img src="a.jpg"><a href="/x"><img src="b.jpg"></a><button></button><input name="email"><h3>Hi</h3><div id="a"></div><div id="a"></div><iframe src="m"></iframe></body></html>';

test('scanner: a clean page has no findings and a bad page reports each rule once with examples', () => {
  assert.deepEqual(rules(GOOD), []);
  const found = rules(BAD);
  for (const r of ['html-lang', 'page-title', 'image-alt', 'link-name', 'button-name', 'label', 'heading-one', 'zoom-blocked', 'duplicate-id', 'landmark-main', 'frame-title']) assert.ok(found.includes(r), `missing ${r}: ${found}`);
  assert.equal(scanHtml(BAD).find((f) => f.rule === 'image-alt').count, 2);
  assert.deepEqual(rules('<html lang="en"><title>x</title><body><main><h1>a</h1><img src="d.png" alt=""></main></body></html>'), [], 'empty alt on decorative images is correct');
});

test('scanner: only same-site pages are followed, with a cap', async () => {
  const links = sameSiteLinks('<a href="/a">1</a><a href="https://other.com/x">2</a><a href="/a#top">3</a><a href="/b.pdf">4</a><a href="mailto:x@y.z">5</a><a href="/c">6</a>', 'https://cafe.example/', 10);
  assert.deepEqual(links, ['https://cafe.example/a', 'https://cafe.example/c']);
  const pages = { 'https://cafe.example/': `<html lang="en"><title>x</title><body><main><h1>h</h1><a href="/p1">one</a><a href="/p2">two</a><a href="/p3">three</a></main></body></html>` };
  for (const p of ['p1', 'p2', 'p3']) pages[`https://cafe.example/${p}`] = BAD;
  const fetcher = async (url) => pages[url] ? new Response(pages[url], { headers: { 'content-type': 'text/html' } }) : new Response('no', { status: 404 });
  const site = await scanSite('https://cafe.example/', { maxPages: 3, fetcher });
  assert.equal(site.pages.length, 3);
  const dead = await scanSite('https://gone.example/', { fetcher });
  assert.equal(dead.scanned, 0);
  const summary = summarize(site);
  assert.ok(summary.total > 0 && summary.issues[0].impact === 'critical' || summary.issues[0].impact === 'serious');
});

function setup({ website } = {}) {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'owner@proofcafe.example', 'Pat', 'Lee')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Proof Cafe')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_a', ?, ?, 'ACCESSIBILITY_MONITORING', 'Accessibility Monitoring', 'OTHER', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 'ACCESSIBILITY_MONITORING_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, billing_interval, scope_json) VALUES ('ov_a', 'offer_a', 1, ?, ?, 'ACTIVE', 4900, 'MONTH', '{}')`, t, t);
  sql(`INSERT INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES ('wd_a', 'ACCESSIBILITY_MONITORING_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20}]', ?, ?)`, t, t);
  DB.raw.exec(read('0004_ai_usage_index.sql')); DB.raw.exec(read('0007_plan_settings.sql'));
  sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, current_period_start, current_period_end, started_at, created_at, updated_at) VALUES (?, 'cust', 'biz', 'offer_a', 'ov_a', 'sub_test', 'cus_test', 'ACTIVE', 'MONTH', 4900, ?, ?, ?, ?, ?)`, SUB, t, t, t, t, t);
  sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, metadata_json, created_at, updated_at) VALUES ('en1', 'cust', 'biz', ?, 'ACCESSIBILITY_MONITORING', 'ACTIVE', ?, '{}', ?, ?)`, SUB, t, t, t);
  if (website) sql(`INSERT INTO subscription_settings (subscription_id, setting_key, value_text, updated_at) VALUES (?, 'website_url', ?, ?)`, SUB, website, t);
  const job = (n, periodStart) => {
    const [o, i, p, r] = [`o${n}`, `i${n}`, `p${n}`, n === 1 ? RUN : `bbbbbbbb-2222-4222-8222-bbbbbbbbbb0${n}`];
    sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES (?, ?, ?, 'cust', 'biz', 'READY_FOR_PRODUCTION', 0, 0, 'PAID')`, o, t, t);
    sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES (?, ?, 'offer_a', 'ov_a', 0, 0)`, i, o);
    sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at, metadata_json) VALUES (?, ?, ?, 'biz', 'cust', 'OTHER', 'READY', 'ACCESSIBILITY_MONITORING_V1', ?, ?, ?)`, p, o, i, t, t, JSON.stringify({ source: 'SUBSCRIPTION_PERIOD', subscription_id: SUB, period_start: periodStart }));
    sql(`INSERT INTO workflow_runs (id, project_id, workflow_key, workflow_version, status, trigger_type, trigger_reference, attempt_number, created_at) VALUES (?, ?, 'ACCESSIBILITY_MONITORING_V1', 1, 'QUEUED', 'SUBSCRIPTION_PERIOD', 'x', 1, ?)`, r, p, t);
    sql(`INSERT INTO workflow_steps (id, workflow_run_id, step_key, step_order, status, attempt_count) VALUES (?, ?, 'PRODUCE', 10, 'QUEUED', 0), (?, ?, 'DELIVER', 20, 'QUEUED', 0)`, `ps${n}`, r, `ds${n}`, r);
    return { project: p, run: r };
  };
  const emails = []; const state = { outputs: [], site: { html: GOOD }, fetched: [] };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body); const output = state.outputs.shift(); if (!output) throw new Error('Unexpected AI call');
      return Response.json({ model: body.model, usage: { input_tokens: 300, output_tokens: 100 }, content: [{ type: 'tool_use', name: 'record_output', input: output }] });
    }
    if (u.startsWith('https://cafe.example')) { state.fetched.push(u); return state.site.status ? new Response('x', { status: state.site.status }) : new Response(u === 'https://cafe.example/' ? state.site.html : GOOD, { headers: { 'content-type': 'text/html' } }); }
    if (u === 'https://menu-made.com/') return new Response(state.selfSite ?? GOOD, { headers: { 'content-type': 'text/html' } });
    throw new Error(`Unexpected fetch ${u}`);
  };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map(r => ({ ...r }));
  return { env, DB, ASSETS, emails, state, fetch, ctx, pending, row, rows, sql, job };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map(m => m[0].replaceAll('&amp;', '&'));

test('the report is delivered straight to the buyer, with the limits of a static scan stated and the AI summary kept honest', async () => {
  const f = setup({ website: 'https://cafe.example/' });
  f.state.site.html = BAD;
  f.job(1, '2026-11-01T00:00:00.000Z');
  await withFetch(f.fetch, async () => {
    f.state.outputs.push({ summary: 'Your site is fully compliant with WCAG and safe from lawsuits, congratulations on that.' });
    await api.runScheduledProduction(f.env);
    await Promise.all(f.pending);
    assert.equal(f.rows(`SELECT id FROM approvals`).length, 0, 'no owner step for this plan');
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, RUN).status, 'SUCCEEDED');
    assert.equal(f.emails.length, 1);
    assert.deepEqual(f.emails[0].to, ['owner@proofcafe.example']);
    const [url] = linksIn(f.emails[0].text, '/api/delivery/');
    const page = await (await call(f, url)).text();
    assert.match(page, /cannot check colour contrast/);
    assert.match(page, /does not guarantee|no automated scan can guarantee/i);
    assert.doesNotMatch(page, /fully compliant|safe from lawsuits/, 'a model claim of compliance is replaced by the plain summary');
    assert.match(page, /image-alt|Images need descriptions|alt/i);
    assert.match(page, /first report/);
  });
});

test('a second month shows the trend against the previous report', async () => {
  const f = setup({ website: 'https://cafe.example/' });
  f.job(1, '2026-11-01T00:00:00.000Z');
  f.state.site.html = BAD;
  await withFetch(f.fetch, async () => {
    f.state.outputs.push({ summary: 'We found several problems on your pages, listed by importance below.' });
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    f.job(2, '2026-12-01T00:00:00.000Z');
    f.state.site.html = GOOD; f.state.outputs.push({ summary: 'Good news: the problems from last month are fixed on your pages.' });
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    const last = f.emails.at(-1);
    const page = await (await call(f, linksIn(last.text, '/api/delivery/')[0])).text();
    assert.match(page, /Down from \d+ problems last month/);
    assert.match(page, /0 problems/);
  });
});

test('without a website the buyer is asked once and the run waits; saving the page releases it', async () => {
  const f = setup();
  f.job(1, '2026-11-01T00:00:00.000Z');
  await withFetch(f.fetch, async () => {
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE id = 'ps1'`).status, 'WAITING');
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, RUN).status, 'WAITING');
    assert.equal(f.emails.length, 1);
    const [link] = linksIn(f.emails[0].text, '/api/plan-settings/');
    await api.runScheduledProduction(f.env);
    assert.equal(f.emails.length, 1, 'a waiting run is not retried or re-emailed');

    const form = await call(f, link);
    assert.equal(form.status, 200);
    assert.match(await form.text(), /<label for="website_url">/);
    assert.equal((await call(f, link.replace(/t=.*/, 't=bad'))).status, 403);
    const token = new URL(link).searchParams.get('t');
    const post = (value) => call(f, link.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token, website_url: value }) });
    assert.equal((await post('not a url')).status, 400);
    assert.equal((await post('http://localhost/x')).status, 400);
    assert.equal((await post('https://cafe.example/')).status, 200);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, RUN).status, 'QUEUED');

    f.state.outputs.push({ summary: 'We found no problems that a scan of your page markup can detect, which is a good start.' });
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, RUN).status, 'SUCCEEDED');
    assert.equal(f.emails.length, 2);
  });
});

test('an unreachable website fails the step instead of delivering an empty report', async () => {
  const f = setup({ website: 'https://cafe.example/' });
  f.state.site.status = 500;
  f.job(1, '2026-11-01T00:00:00.000Z');
  await withFetch(f.fetch, async () => {
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE customer_visible = 1`).length, 0);
    assert.notEqual(f.row(`SELECT status FROM workflow_runs WHERE id = ?`, RUN).status, 'SUCCEEDED');
    assert.ok(f.emails.every((e) => e.to[0] !== 'owner@proofcafe.example'));
  });
});

test('the self-test drives the whole loop (waits, asks, saves the website, scans, delivers) and fails loudly when the scan cannot read the site', async () => {
  const { advanceAccessibilitySelfTests } = await import('./src/selftest/accessibility-selftest.js');
  for (const broken of [false, true]) {
    const f = setup();
    f.sql(`UPDATE workflow_runs SET status = 'CANCELLED'`);
    await withFetch(async (url, init) => (broken && String(url) === 'https://menu-made.com/') ? new Response('down', { status: 503 }) : f.fetch(url, init), async () => {
      f.state.outputs.push({ summary: 'We found no problems that a scan of your page markup can detect, which is a good start.' });
      f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('44445555-0000-4000-8000-000000000001', 'ACCESSIBILITY_RUN', 'REQUESTED', 'test', '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z')`);
      const app = (request) => api.default.fetch(request, f.env, f.ctx);
      for (let tick = 0; tick < 5; tick++) { await advanceAccessibilitySelfTests(f.env, app); await api.runScheduledProduction(f.env); await Promise.all(f.pending); }
      await advanceAccessibilitySelfTests(f.env, app);
      const result = f.row(`SELECT status, error FROM self_tests`);
      if (!broken) {
        assert.equal(result.status, 'PASSED', JSON.stringify(result));
        assert.ok(f.emails.every((e) => e.to[0] === 'delivered@resend.dev'));
      } else {
        assert.equal(result.status, 'FAILED', JSON.stringify(result));
        assert.ok(f.emails.some((e) => e.to[0] === 'info@menu-made.com' && /self-test failed/i.test(e.subject)));
      }
    });
  }
});
