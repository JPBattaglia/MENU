// Stage 4 tests: routing (auto vs owner), digest, batch approve, request changes, auto-release, owner queue,
// and the routing self-test itself. Uses the test-only products from selftest/routing-selftest.js.
// Run: node --no-warnings --test approval-routing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = {
  ...(await import('./src/worker.js')),
  ...(await import('./src/workflows/runner.js')),
  ...(await import('./src/lib/links.js')),
  ...(await import('./src/approvals/routing.js')),
  ...(await import('./src/approvals/actions.js')),
  ...(await import('./src/approvals/digest.js')),
  ...(await import('./src/admin/queue.js')),
  ...(await import('./src/selftest/routing-selftest.js')),
};
const ADMIN = 'test-admin-token-0123456789';

async function setup() {
  const DB = createD1();
  const ASSETS = createR2();
  const emails = [];
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z', ADMIN_API_TOKEN: ADMIN };
  const fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') {
      emails.push({ ...JSON.parse(init.body), idempotencyKey: init.headers['Idempotency-Key'] });
      return Response.json({ id: `email-${emails.length}` });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map(r => ({ ...r }));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const customerId = await api.ensureScaffolding(env);
  let n = 0;
  const order = (variant) => api.createOrder(env, { id: `0000000${++n}-test` }, variant, customerId);
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const tick = async () => { while (pending.length) await pending.shift(); await api.runScheduledProduction(env); while (pending.length) await pending.shift(); };
  const call = (url, init) => api.default.fetch(new Request(url, init), env, ctx);
  const setSteps = (variant, steps) => sql(`UPDATE workflow_definitions SET steps_json = ? WHERE workflow_key = ?`, JSON.stringify(steps), api.VARIANTS[variant].workflowKey);
  return { env, DB, ASSETS, emails, fetch, row, rows, sql, order, tick, call, ctx, setSteps };
}
async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const approveForm = async (f, approvalId, fields = {}) => {
  const token = await api.signLinkToken(f.env, { kind: 'approve', id: approvalId, ttlDays: 1 });
  const form = new FormData();
  form.append('t', token);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return f.call(`https://menu-made.com/api/approvals/${approvalId}`, { method: 'POST', body: form });
};
const pendingApproval = (f, projectId) => f.row(`SELECT * FROM approvals WHERE project_id = ? AND status = 'PENDING'`, projectId);
const buyerMails = (f) => f.emails.filter(e => /Your .* is ready$/.test(e.subject));

test('routing precedence: step setting, then offer flag, then owner default; an item can only tighten', async () => {
  const f = await setup();
  const a = await f.order('AUTO');
  const o = await f.order('OWNER');
  const auto = { projectId: a.projectId, workflowKey: 'ROUTING_SELFTEST_AUTO_V1', stepKey: 'DELIVER' };
  const owner = { projectId: o.projectId, workflowKey: 'ROUTING_SELFTEST_OWNER_V1', stepKey: 'DELIVER' };
  assert.deepEqual([(await api.resolveRouting(f.env, auto)).mode, (await api.resolveRouting(f.env, auto)).source], ['AUTO', 'OFFER']);
  assert.deepEqual([(await api.resolveRouting(f.env, owner)).mode, (await api.resolveRouting(f.env, owner)).source], ['OWNER', 'OFFER']);
  f.setSteps('OWNER', [{ key: 'SELFTEST_PRODUCE', order: 10 }, { key: 'DELIVER', order: 20, approval: 'auto' }]);
  assert.deepEqual([(await api.resolveRouting(f.env, owner)).mode, (await api.resolveRouting(f.env, owner)).source], ['AUTO', 'STEP']);
  f.setSteps('AUTO', [{ key: 'SELFTEST_PRODUCE', order: 10 }, { key: 'DELIVER', order: 20, approval: 'owner' }]);
  assert.deepEqual([(await api.resolveRouting(f.env, auto)).mode, (await api.resolveRouting(f.env, auto)).source], ['OWNER', 'STEP']);
  assert.equal((await api.resolveRouting(f.env, { projectId: 'nope', workflowKey: 'MISSING', stepKey: 'DELIVER' })).mode, 'OWNER');
  const files = [{ id: 1, approval: null }, { id: 2, approval: 'owner' }];
  assert.deepEqual(api.partitionFiles({ mode: 'AUTO' }, files), { auto: [files[0]], owner: [files[1]] });
  assert.deepEqual(api.partitionFiles({ mode: 'OWNER' }, files), { auto: [], owner: files });
  assert.equal(api.itemApprovalFlag('{"approval":"owner"}'), 'owner');
  assert.equal(api.itemApprovalFlag('{"approval":"auto"}'), null);
});

test('an automatic product reaches the buyer with no owner step; an approval product waits, then ships after the click', async () => {
  const f = await setup();
  await withFetch(f.fetch, async () => {
    const a = await f.order('AUTO');
    const o = await f.order('OWNER');
    await f.tick();
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, a.projectId).status, 'DELIVERED');
    assert.equal(f.row(`SELECT COUNT(*) n FROM approvals WHERE project_id = ?`, a.projectId).n, 0);
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, o.projectId).status, 'QC_REQUIRED');
    // One owner email for the one waiting item; the buyer has only the automatic delivery.
    const ownerMails = f.emails.filter(e => /Approve /.test(e.subject));
    assert.equal(ownerMails.length, 1);
    assert.equal(buyerMails(f).length, 1);
    const approval = pendingApproval(f, o.projectId);
    // GET shows the page and approves nothing.
    const token = await api.signLinkToken(f.env, { kind: 'approve', id: approval.id, ttlDays: 1 });
    const page = await f.call(`https://menu-made.com/api/approvals/${approval.id}?t=${token}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Request changes/);
    assert.equal(pendingApproval(f, o.projectId).id, approval.id);
    assert.equal((await approveForm(f, approval.id)).status, 200);
    await f.tick();
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, o.projectId).status, 'DELIVERED');
    assert.equal(buyerMails(f).length, 2);
    assert.equal(f.row(`SELECT json_extract(payload_json,'$.routing') r FROM business_events WHERE entity_id = ? AND event_type = 'PROJECT_DELIVERED'`, o.projectId).r, 'OWNER');
  });
});

test('several waiting items get one digest email and one approve-all page', async () => {
  const f = await setup();
  await withFetch(f.fetch, async () => {
    const items = [await f.order('OWNER'), await f.order('OWNER'), await f.order('OWNER')];
    await f.tick();
    const digests = f.emails.filter(e => /items waiting for your approval/.test(e.subject));
    assert.equal(digests.length, 1);
    assert.match(digests[0].subject, /^\[TEST\] 3 items/);
    assert.equal(f.emails.filter(e => /Approve /.test(e.subject)).length, 0);
    // Running the tick again never re-sends.
    await f.tick();
    assert.equal(f.emails.filter(e => /items waiting/.test(e.subject)).length, 1);
    const batchUrl = /https:\/\/menu-made\.com\/api\/approvals\/batch\/[^\s"<]+/.exec(digests[0].text)[0];
    const get = await f.call(batchUrl);
    assert.equal(get.status, 200);
    assert.match(await get.text(), /Approve all 3 waiting/);
    const post = await f.call(batchUrl.split('?')[0], { method: 'POST', body: (() => { const fd = new FormData(); fd.append('t', new URL(batchUrl).searchParams.get('t')); return fd; })() });
    assert.equal(post.status, 200);
    assert.match(await post.text(), /3 items approved/);
    await f.tick();
    for (const item of items) assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, item.projectId).status, 'DELIVERED');
    // A bad token approves nothing.
    assert.equal((await f.call(batchUrl.split('?')[0], { method: 'POST', body: (() => { const fd = new FormData(); fd.append('t', 'bad'); return fd; })() })).status, 403);
  });
});

test('request changes regenerates once and re-asks; a second request is flagged for a manual fix', async () => {
  const f = await setup();
  await withFetch(f.fetch, async () => {
    f.setSteps('OWNER', [{ key: 'SELFTEST_PRODUCE', order: 10 }, { key: 'DELIVER', order: 20, regenerate_from: 'SELFTEST_PRODUCE' }]);
    const o = await f.order('OWNER');
    await f.tick();
    const first = pendingApproval(f, o.projectId);
    assert.equal((await approveForm(f, first.id, { action: 'changes', note: 'x' })).status, 400);
    const res = await approveForm(f, first.id, { action: 'changes', note: 'Make it warmer' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /being redone/);
    await f.tick();
    const second = pendingApproval(f, o.projectId);
    assert.ok(second && second.id !== first.id, 'a fresh approval is requested');
    assert.equal(second.revision_number, 2);
    assert.deepEqual(f.rows(`SELECT version, status FROM deliverables WHERE project_id = ? ORDER BY version`, o.projectId), [{ version: 1, status: 'SUPERSEDED' }, { version: 2, status: 'DRAFT' }]);
    assert.equal(f.rows(`SELECT 1 FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY'`, o.projectId).length, 0, 'nothing reached the buyer');
    // Second request: no more automatic regeneration.
    const again = await approveForm(f, second.id, { action: 'changes', note: 'Still not right' });
    assert.match(await again.text(), /flagged in your queue/);
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, o.projectId).status, 'BLOCKED');
    assert.equal(f.row(`SELECT COUNT(*) n FROM system_errors WHERE project_id = ? AND manual_intervention_required = 1`, o.projectId).n, 1);
    const queue = await api.buildQueue(f.env);
    assert.ok(queue.needs_attention.some(r => r.kind === 'CHANGES_REQUESTED'));
    assert.equal(queue.counts.waiting_approval, 0);
    assert.equal(buyerMails(f).length, 0);
  });
});

test('a product with no regenerate_from flags the first change request for a manual fix', async () => {
  const f = await setup();
  await withFetch(f.fetch, async () => {
    const o = await f.order('OWNER');
    await f.tick();
    const res = await approveForm(f, pendingApproval(f, o.projectId).id, { action: 'changes', note: 'Wrong logo' });
    assert.match(await res.text(), /manual fix/);
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, o.projectId).status, 'BLOCKED');
  });
});

test('auto-release is off by default and releases an approval only after the configured days', async () => {
  const f = await setup();
  await withFetch(f.fetch, async () => {
    const o = await f.order('OWNER');
    await f.tick();
    assert.equal(await api.autoReleaseWaitingApprovals(f.env, null), 0);
    f.setSteps('OWNER', [{ key: 'SELFTEST_PRODUCE', order: 10 }, { key: 'DELIVER', order: 20, auto_release_days: 2 }]);
    assert.equal(await api.autoReleaseWaitingApprovals(f.env, null), 0, 'notified just now');
    const approval = pendingApproval(f, o.projectId);
    const meta = JSON.parse(approval.metadata_json);
    meta.owner_notified_at = new Date(Date.now() - 3 * 864e5).toISOString();
    f.sql(`UPDATE approvals SET metadata_json = ? WHERE id = ?`, JSON.stringify(meta), approval.id);
    assert.equal(await api.autoReleaseWaitingApprovals(f.env, null), 1);
    assert.equal(f.row(`SELECT approved_by FROM approvals WHERE id = ?`, approval.id).approved_by, 'AUTO_RELEASE');
    await f.tick();
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, o.projectId).status, 'DELIVERED');
  });
});

test('one file marked approval=owner waits even when the product is automatic', async () => {
  const f = await setup();
  await withFetch(f.fetch, async () => {
    const a = await f.order('AUTO');
    await f.tick(); // delivers the unmarked file
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, a.projectId).status, 'DELIVERED');
    const b = await f.order('AUTO');
    // Produce first, then mark the asset before the deliver step runs.
    await api.runNextProductionStep(api.internalRunnerRequest(f.env, { workflow_run_id: f.row(`SELECT id FROM workflow_runs WHERE project_id = ?`, b.projectId).id, step_key: 'SELFTEST_PRODUCE' }), f.env);
    f.sql(`UPDATE assets SET metadata_json = '{"approval":"owner"}' WHERE project_id = ? AND asset_type = 'DELIVERABLE'`, b.projectId);
    await f.tick();
    assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, b.projectId).status, 'QC_REQUIRED');
    assert.ok(pendingApproval(f, b.projectId));
  });
});

test('the owner queue is locked without the token and lists orders with it', async () => {
  const f = await setup();
  await withFetch(f.fetch, async () => {
    await f.order('AUTO');
    const o = await f.order('OWNER');
    await f.tick();
    const url = 'https://menu-made.com/api/admin/queue';
    assert.equal((await f.call(url)).status, 200); // sign-in page, no data
    assert.doesNotMatch(await (await f.call(url)).text(), /Routing Self-Test/);
    assert.equal((await f.call(url, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await f.call(url, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const ok = await f.call(url, { headers: { Authorization: `Bearer ${ADMIN}` } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const body = await ok.json();
    assert.equal(body.counts.waiting_approval, 1);
    assert.equal(body.counts.delivered_recent, 1);
    assert.equal(body.waiting_approval[0].test, true);
    assert.equal(body.waiting_approval[0].project_id, o.projectId);
    const form = new FormData();
    form.append('token', ADMIN);
    const page = await f.call(url, { method: 'POST', body: form });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Waiting for your approval \(1\)/);
    const none = { ...f.env, ADMIN_API_TOKEN: undefined };
    assert.equal((await api.default.fetch(new Request(url), none, f.ctx)).status, 503);
  });
});

test('the routing self-test passes end to end and stays passed', async () => {
  const f = await setup();
  await withFetch(f.fetch, async () => {
    const t = new Date().toISOString();
    f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('rt1', 'ROUTING_APPROVAL', 'REQUESTED', 'test', ?, ?)`, t, t);
    let result;
    for (let i = 0; i < 6; i++) {
      const pending = [];
      await api.default.scheduled({ cron: '*/5 * * * *' }, f.env, { waitUntil: (p) => pending.push(p) });
      while (pending.length) await pending.shift();
      result = f.row(`SELECT * FROM self_tests WHERE id = 'rt1'`);
      if (['PASSED', 'FAILED'].includes(result.status)) break;
    }
    assert.equal(result.status, 'PASSED', `${result.stage}: ${result.error}\n${result.log_json}`);
    for (const email of f.emails) assert.deepEqual(email.to, ['delivered@resend.dev'], email.subject);
    await api.default.scheduled({ cron: '*/5 * * * *' }, f.env, { waitUntil() {} });
    assert.equal(f.row(`SELECT status FROM self_tests WHERE id = 'rt1'`).status, 'PASSED');
  });
});

test('the test-only deliver step never runs for a real product run', async () => {
  const f = await setup();
  await withFetch(f.fetch, async () => {
    const t = new Date().toISOString();
    f.sql(`INSERT INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES ('real', 'SOME_REAL_V1', 1, 'ACTIVE', ?, ?, ?)`, JSON.stringify([{ key: 'SELFTEST_PRODUCE', order: 10 }]), t, t);
    const a = await f.order('AUTO');
    f.sql(`UPDATE workflow_runs SET workflow_key = 'SOME_REAL_V1' WHERE project_id = ?`, a.projectId);
    await f.tick();
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE workflow_run_id = (SELECT id FROM workflow_runs WHERE project_id = ?) AND step_key = 'SELFTEST_PRODUCE'`, a.projectId).status, 'QUEUED');
  });
});
