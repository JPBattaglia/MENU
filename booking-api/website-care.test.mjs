// Stage 7, Website Care: change requests applied to a live site with strict checks, owner approval, redeploy at the same
// address, the daily health check and the monthly report. Mocked Anthropic and Resend; real SQLite schema and migrations.
// Run: node --no-warnings --test booking-api/website-care.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = { ...(await import('./src/worker.js')), ...(await import('./src/workflows/runner.js')) };
const { buildSite } = await import('./src/producers/website/build.js');
const { checkSite } = await import('./src/producers/website/check.js');
const { createSiteChangeRequest } = await import('./src/producers/website-care/intake.js');
const { checkChange, currentDetails } = await import('./src/producers/website-care/edit.js');
const { runSiteHealthPass } = await import('./src/producers/website-care/health.js');
const { monthlyReport } = await import('./src/producers/website-care/report.js');
const { createPeriodJobs } = await import('./src/subscriptions/periods.js');
const { signLinkToken } = await import('./src/lib/links.js');
const { advanceWebsiteCareSelfTests } = await import('./src/selftest/website-care-selftest.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const SITE = {
  name: "Joe's Pizza", kind: 'restaurant', about: 'Family pizza made fresh every day.', offerings: '# Starters\nTomato Soup | Basil and cream | $9\n# Pizza\nMargherita | Mozzarella and basil | $15\nPepperoni | Spicy | $17.50\nCalzone | Folded | $14',
  phone: '(512) 555-0100', address: '123 Main Street, Austin, TX', hours: 'Mon-Fri: 11am-9pm\nSat: 12pm-10pm', email: '', style: 'modern', brand: '', facebook: '', instagram: '', photos: [], logo: null
};
const COPY = { tagline: 'Fresh pizza, made daily', intro: "Joe's Pizza serves family pizza made fresh every day on Main Street.", about: ["Joe's Pizza is a family business that makes pizza fresh every day. Come and see us for a slice."], meta_description: "Joe's Pizza: family pizza made fresh every day at 123 Main Street, Austin.", meta_about: "About Joe's Pizza, a family pizza business on Main Street." };
const NEW_OFFERINGS = '# Starters\nTomato Soup | Basil and cream | $9\nGarlic Bread | Warm and buttery | $6\n# Pizza\nMargherita | Mozzarella and basil | $16\nPepperoni | Spicy | $17.50\nCalzone | Folded | $14';
const REQUEST = 'Raise the Margherita to $16 and add Garlic Bread, $6, under Starters.';
const SUB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('change checks: invented facts, wrong styles, mass deletion and no-op changes are all refused', () => {
  const before = currentDetails(SITE, COPY);
  const run = (patch, requestText = REQUEST) => { const after = { ...before, ...patch }; return checkChange({ before, after, afterSite: { ...SITE, ...patch }, afterCopy: COPY, requestText, updates: [] }).join('\n'); };
  assert.equal(run({ offerings: NEW_OFFERINGS }), '');
  assert.match(run({ offerings: NEW_OFFERINGS.replace('$6', '$7') }), /price "\$7"/);
  assert.match(run({}), /did not change anything/);
  assert.match(run({ phone: '(512) 555-9999' }), /phone/);
  assert.match(run({ address: '999 Elm Street, Austin, TX' }), /Address number 999/);
  assert.match(run({ style: 'neon' }), /not one of our styles/);
  assert.match(run({ offerings: '# Pizza\nMargherita | Mozzarella and basil | $16' }, 'Margherita $16'), /removes most of the menu/);
  assert.match(run({ hours: 'Daily: 8am-11pm' }, 'We are open daily'), /hours "8am"/);
});

function setup({ site = true, live = true, entitlement = true } = {}) {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'joe@joespizza.example', 'Joe', 'Rossi')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Joe''s Pizza')`, t, t);
  for (const [id, code, name, bt, wf] of [['offer_p', 'WEBSITE_PACKAGE', 'Website Package', 'ONE_TIME', 'WEBSITE_PACKAGE_V1'], ['offer_c', 'WEBSITE_CARE', 'Website Care', 'RECURRING', 'WEBSITE_CARE_V1']]) {
    sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES (?, ?, ?, ?, ?, 'WEBSITE', 'ACTIVE', ?, 'DIGITAL', 1, ?)`, id, t, t, code, name, bt, wf);
    sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES (?, ?, 1, ?, ?, 'ACTIVE', 4900, '{}')`, `ov_${id}`, id, t, t);
  }
  DB.raw.exec(read('0004_ai_usage_index.sql')); DB.raw.exec(read('0009_website_package.sql')); DB.raw.exec(read('0010_website_care.sql'));
  sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, current_period_start, current_period_end, started_at, created_at, updated_at) VALUES (?, 'cust', 'biz', 'offer_c', 'ov_offer_c', 'sub_x', 'cus_x', 'ACTIVE', 'MONTH', 4900, ?, ?, ?, ?, ?)`, SUB, t, t, t, t, t);
  if (entitlement) sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, metadata_json, created_at, updated_at) VALUES ('ent1', 'cust', 'biz', ?, 'WEBSITE_CARE', 'ACTIVE', ?, ?, ?, ?)`, SUB, t, JSON.stringify({ offer_id: 'offer_c', offer_version_id: 'ov_offer_c', workflow_key: 'WEBSITE_CARE_V1', environment: 'sandbox' }), t, t);
  if (site) {
    sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o0', ?, ?, 'cust', 'biz', 'DELIVERED', 49900, 49900, 'PAID')`, t, t);
    sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i0', 'o0', 'offer_p', 'ov_offer_p', 49900, 49900)`);
    sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES ('p0', 'o0', 'i0', 'biz', 'cust', 'WEBSITE', 'DELIVERED', 'WEBSITE_PACKAGE_V1', 1, ?, ?)`, t, t);
    sql(`INSERT INTO website_sites (id, slug, project_id, business_id, customer_id, style, created_at, updated_at) VALUES ('ws1', 'joes-pizza', 'p0', 'biz', 'cust', 'modern', ?, ?)`, t, t);
  }
  const pages = buildSite(SITE, COPY);
  assert.deepEqual(checkSite({ pages, images: {}, site: SITE }), []);
  if (site && live) {
    const build = { version: 1, slug: 'joes-pizza', style: 'modern', built_at: t, pages, images: [], site: SITE, copy: COPY };
    ASSETS.put('seed/build.json', new TextEncoder().encode(JSON.stringify(build)));
    sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, approved_for_use, metadata_json) VALUES ('a0', 'biz', 'cust', 'p0', 'DELIVERABLE', 'R2', 'seed/build.json', 'b.json', 'application/json', 10, 'x', 'VALID', ?, 1, ?)`, t, JSON.stringify({ website: { slug: 'joes-pizza' } }));
    sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('d0', 'p0', 'a0', 'SITE_BUILD', 1, 'FINAL', 1, ?, ?)`, t, t);
  }
  const emails = []; const state = { outputs: [], prompts: [] };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body); state.prompts.push(body.messages[0].content);
      const output = state.outputs.shift(); if (!output) throw new Error('Unexpected AI call');
      return Response.json({ model: body.model, usage: { input_tokens: 1200, output_tokens: 300 }, content: [{ type: 'tool_use', name: 'record_output', input: output }] });
    }
    if (u.startsWith('https://menu-made.com/api/site/')) return api.default.fetch(new Request(u), env, ctx);
    throw new Error(`Unexpected fetch ${u}`);
  };
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map((r) => ({ ...r }));
  return { env, DB, ASSETS, emails, state, fetch, ctx, pending, row, rows, sql };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map((m) => m[0].replaceAll('&amp;', '&'));
const good = () => ({ understood: true, summary: 'Raised the Margherita to $16 and added Garlic Bread at $6.', updates: [{ field: 'offerings', value: NEW_OFFERINGS }] });
const careToken = (f) => signLinkToken(f.env, { kind: 'sitecare', id: SUB, ttlDays: 1 });
const post = async (f, change, token) => call(f, `https://menu-made.com/api/site-care/${SUB}`, { method: 'POST', body: new URLSearchParams({ t: token ?? await careToken(f), change }) });

test('intake: signed form, active entitlement and a live Menu-made site are required', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const t = await careToken(f);
    assert.equal((await call(f, `https://menu-made.com/api/site-care/${SUB}?t=${t}`)).status, 200);
    assert.equal((await call(f, `https://menu-made.com/api/site-care/${SUB}?t=forged.token`)).status, 403);
    assert.equal((await post(f, REQUEST, 'forged.token')).status, 403);
    assert.equal((await post(f, 'no')).status, 400);
    assert.equal((await post(f, REQUEST)).status, 200);
    assert.equal(f.rows(`SELECT id FROM site_change_requests`).length, 1);
    assert.equal(f.row(`SELECT status FROM projects WHERE metadata_json LIKE '%SITE_CARE_REQUEST%'`).status, 'READY');
  });
  for (const [opts, pattern] of [[{ entitlement: false }, /not included/], [{ site: false }, /built by Menu-made/], [{ live: false }, /live yet/]]) {
    const g = setup(opts);
    await withFetch(g.fetch, async () => { const res = await post(g, REQUEST); assert.equal(res.status >= 400, true); assert.match(await res.text(), pattern); });
  }
});

test('end to end: request, AI edit, checks, owner preview, approval, same address updated, customer told; nothing changes before approval', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await post(f, REQUEST);
    f.state.outputs.push(good());
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.match(f.state.prompts[0], /Margherita/);
    assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');
    assert.equal(f.row(`SELECT status FROM site_change_requests`).status, 'DRAFTED');
    const before = await (await call(f, 'https://menu-made.com/api/site/joes-pizza/menu.html')).text();
    assert.ok(before.includes('$15') && !before.includes('Garlic Bread'));
    const owner = f.emails.find((m) => m.to[0] === 'info@menu-made.com');
    assert.match(owner.subject, /Approve Joe's Pizza's website change/); assert.match(owner.text, /Added Garlic Bread \$6/); assert.match(owner.text, /Changed Margherita: price \$15 → \$16/);
    const [preview] = linksIn(owner.text, '/api/site-preview/');
    const draft = await (await call(f, preview + 'menu.html')).text();
    assert.ok(draft.includes('$16') && draft.includes('Garlic Bread'));
    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: new URL(approveUrl).searchParams.get('t') }) });
    await Promise.all(f.pending);
    const after = await (await call(f, 'https://menu-made.com/api/site/joes-pizza/menu.html')).text();
    assert.ok(after.includes('$16') && after.includes('Garlic Bread') && after.includes('Pepperoni') && after.includes('$17.50') && after.includes('Calzone'));
    assert.ok(!after.includes('>$15<'));
    assert.equal(f.row(`SELECT status FROM site_change_requests`).status, 'DRAFTED');
    const buyer = f.emails.at(-1);
    assert.deepEqual(buyer.to, ['joe@joespizza.example']); assert.match(buyer.text, /Your website now shows/); assert.match(buyer.text, /api\/site\/joes-pizza\//);
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE'`).n, 1);
    assert.match(await (await call(f, 'https://menu-made.com/api/site/joes-pizza/')).text(), /Fresh pizza, made daily/);
  });
});

test('an invented price, an unclear request and a failed rebuild are never drafted; the customer and owner are told', async () => {
  for (const [output, reason] of [[{ ...good(), updates: [{ field: 'offerings', value: NEW_OFFERINGS.replace('$6', '$7') }] }, /price "\$7"/], [{ understood: false, summary: 'That needs new photos, which I cannot do.', updates: [] }, /Not applied/], [{ ...good(), updates: [{ field: 'style', value: 'neon' }] }, /not one of our styles/]]) {
    const f = setup();
    await withFetch(f.fetch, async () => {
      await post(f, REQUEST);
      f.state.outputs.push(output);
      await api.runScheduledProduction(f.env); await Promise.all(f.pending);
      assert.equal(f.rows(`SELECT id FROM approvals`).length, 0);
      assert.equal(f.row(`SELECT status FROM site_change_requests`).status, 'NOT_APPLIED');
      assert.match(JSON.parse(f.row(`SELECT result_json FROM site_change_requests`).result_json).reasons.join('; '), reason);
      assert.deepEqual(f.emails.map((m) => m.to[0]).sort(), ['info@menu-made.com', 'joe@joespizza.example']);
      assert.ok((await (await call(f, 'https://menu-made.com/api/site/joes-pizza/menu.html')).text()).includes('$15'));
    });
  }
});

test('request changes redoes the edit once with the owner note, and the old live site stays until approval', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    await post(f, REQUEST);
    f.state.outputs.push(good());
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    const owner = f.emails.find((m) => m.to[0] === 'info@menu-made.com');
    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    f.state.outputs.push({ ...good(), updates: [{ field: 'offerings', value: NEW_OFFERINGS.replace('Warm and buttery', 'Garlic and herbs') }] });
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: new URL(approveUrl).searchParams.get('t'), action: 'changes', note: 'Describe the bread as garlic and herbs' }) });
    await Promise.all(f.pending);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.state.prompts.length, 2); assert.match(f.state.prompts[1], /garlic and herbs/);
    assert.ok((await (await call(f, 'https://menu-made.com/api/site/joes-pizza/menu.html')).text()).includes('$15'));
  });
});

test('daily health check records answers and speed; the monthly period run emails the report and the change link', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    assert.deepEqual(await runSiteHealthPass(f.env, { now: new Date('2026-10-27T15:00:00Z') }), { skipped: 'outside the check hour' });
    assert.deepEqual(await runSiteHealthPass(f.env, { now: new Date('2026-10-27T09:05:00Z'), fetchImpl: f.fetch }), { checked: 1 });
    assert.deepEqual(await runSiteHealthPass(f.env, { now: new Date('2026-10-27T09:10:00Z'), fetchImpl: f.fetch }), { checked: 0 });
    const check = f.row(`SELECT ok, status FROM site_health_checks`); assert.deepEqual(check, { ok: 1, status: 200 });
    f.sql(`INSERT INTO site_health_checks (id, slug, checked_at, ok, status, ms, bytes, detail) VALUES ('h2', 'joes-pizza', ?, 0, 500, 40, 0, 'HTTP 500')`, new Date(Date.now() - 86400000).toISOString());
    const report = await monthlyReport(f.env, { slug: 'joes-pizza', build: JSON.parse(await (await f.ASSETS.get('seed/build.json')).text()), subscriptionId: SUB });
    assert.equal(report.checks, 2); assert.equal(report.answered, 1); assert.match(report.lines.join('\n'), /answered 1 of 2 daily checks \(50%\)/); assert.match(report.lines.join('\n'), /HTTP 500/);
    const jobs = await createPeriodJobs(f.env, { id: SUB, status: 'ACTIVE', customerId: 'cust', businessId: 'biz', stripeSubscriptionId: 'sub_x', environment: 'sandbox', plan: { offerCode: 'WEBSITE_CARE' } }, '2026-10-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z');
    assert.equal(jobs.created, 1);
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    const mail = f.emails.find((m) => m.to[0] === 'joe@joespizza.example');
    assert.match(mail.subject, /monthly report/); assert.match(mail.text, /daily checks/); assert.match(mail.text, /not minute-by-minute uptime/);
    const [link] = linksIn(mail.text, '/api/site-care/');
    assert.equal((await call(f, link)).status, 200);
  });
});

test('a monthly run before the site is live sends nothing', async () => {
  const f = setup({ live: false });
  await withFetch(f.fetch, async () => {
    await createPeriodJobs(f.env, { id: SUB, status: 'ACTIVE', customerId: 'cust', businessId: 'biz', stripeSubscriptionId: 'sub_x', environment: 'sandbox', plan: { offerCode: 'WEBSITE_CARE' } }, '2026-10-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z');
    await api.runScheduledProduction(f.env); await Promise.all(f.pending);
    assert.equal(f.emails.length, 0);
  });
});

test('the self-test runs a synthetic customer through a real AI edit to the live site and fails loudly when the edit is wrong', async () => {
  for (const broken of [false, true]) {
    const f = setup({ site: false });
    f.sql(`UPDATE subscriptions SET status = 'CANCELLED'`);
    await withFetch(f.fetch, async () => {
      const fixed = { ...good(), updates: [{ field: 'offerings', value: '# Starters\nTomato Soup | Basil and cream | $9\nGarlic Bread | Warm and buttery | $6\n# Pizza\nMargherita | Mozzarella and basil | $16\nPepperoni | Spicy | $17.50' }] };
      f.state.outputs.push(broken ? { understood: false, summary: 'no', updates: [] } : fixed);
      f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('99990000-0000-4000-8000-000000000001', 'WEBSITE_CARE_RUN', 'REQUESTED', 'test', '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z')`);
      const app = (request) => api.default.fetch(request, f.env, f.ctx);
      for (let tick = 0; tick < 5; tick++) { await advanceWebsiteCareSelfTests(f.env, app); await api.runScheduledProduction(f.env); await Promise.all(f.pending); }
      await advanceWebsiteCareSelfTests(f.env, app);
      const result = f.row(`SELECT status, error FROM self_tests`);
      if (!broken) assert.equal(result.status, 'PASSED', JSON.stringify(result));
      else { assert.equal(result.status, 'FAILED', JSON.stringify(result)); assert.ok(f.emails.some((e) => e.to[0] === 'info@menu-made.com' && /self-test failed/i.test(e.subject))); }
    });
  }
});
