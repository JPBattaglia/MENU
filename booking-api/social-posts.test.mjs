// Stage 6, Social Posts: AI plan with quality checks, SVG graphics, PNG pack (rasterizer injected here, real resvg in the
// live self-test), owner approval and delivery. Mocked Anthropic and Resend, real SQLite schema and migrations.
// Run: node --no-warnings --test booking-api/social-posts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1, createR2 } from './test-support/d1.mjs';

const api = { ...(await import('./src/worker.js')), ...(await import('./src/workflows/runner.js')) };
const { createZip, crc32 } = await import('./src/producers/social-posts/zip.js');
const { renderPostSvg, fitText, brandOf } = await import('./src/producers/social-posts/render.js');
const { validatePosts } = await import('./src/producers/social-posts/plan.js');
const { buildDesignedMenuHtml } = await import('./src/producers/menu-qr/design.js');
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

const MENU = { sections: [{ name: 'Pizza', items: [{ name: 'Margherita', description: 'Mozzarella and basil', price: '$15' }, { name: 'Pepperoni', description: '', price: '$17.50' }] }, { name: 'Drinks', items: [{ name: 'Espresso', description: '', price: '$4' }] }], notes: '' };
const SUB = '22222222-2222-4222-8222-222222222222';
const goodPosts = () => Array.from({ length: 12 }, (_, i) => ({
  day: i * 2 + 1, kind: i % 3 === 0 ? 'dish' : 'story', headline: `Fresh favorite number ${i + 1}`,
  caption: `Come see what is new at Proof Cafe this month, post number ${i + 1}. We would love to see you.`,
  hashtags: ['#proofcafe', '#localfood', '#pizza'], featured_item: i % 3 === 0 ? 'Margherita' : '',
}));
const fakePng = (svg, width) => { const b = new Uint8Array(24); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(b.buffer).setUint32(16, width); return b; };

function setup() {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = '2026-10-01T00:00:00.000Z';
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'owner@proofcafe.example', 'Pat', 'Lee')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Proof Cafe')`, t, t);
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('offer_social', ?, ?, 'SOCIAL_POSTS', 'Social Posts', 'OTHER', 'ACTIVE', 'RECURRING', 'DIGITAL', 1, 'SOCIAL_POSTS_V1')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, billing_interval, scope_json) VALUES ('ov_social', 'offer_social', 1, ?, ?, 'ACTIVE', 12900, 'MONTH', '{}')`, t, t);
  sql(`INSERT INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES ('wd_s', 'SOCIAL_POSTS_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20}]', ?, ?)`, t, t);
  DB.raw.exec(read('0004_ai_usage_index.sql')); DB.raw.exec(read('0006_social_posts.sql')); DB.raw.exec(read('0007_plan_settings.sql'));
  // The buyer's live menu (from an earlier Menu + QR order).
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o0', ?, ?, 'cust', 'biz', 'DELIVERED', 0, 0, 'PAID')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i0', 'o0', 'offer_social', 'ov_social', 0, 0)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES ('menuproj', 'o0', 'i0', 'biz', 'cust', 'MENU', 'DELIVERED', 'MENU_QR_V1', ?, ?)`, t, t);
  const html = buildDesignedMenuHtml({ businessName: 'Proof Cafe', brandColors: '#071f2c, #00d6e6', menu: MENU, logoDataUri: null });
  ASSETS.put('m.html', html);
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_key, original_filename, mime_type, size_bytes, status, uploaded_at) VALUES ('am', 'biz', 'cust', 'menuproj', 'DELIVERABLE', 'm.html', 'm.html', 'text/html', 1, 'VALID', ?)`, t);
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('dm', 'menuproj', 'am', 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`, t, t);
  // This month's Social Posts job.
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('o1', ?, ?, 'cust', 'biz', 'READY_FOR_PRODUCTION', 0, 0, 'PAID')`, t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('i1', 'o1', 'offer_social', 'ov_social', 0, 0)`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at, metadata_json) VALUES ('sp', 'o1', 'i1', 'biz', 'cust', 'OTHER', 'READY', 'SOCIAL_POSTS_V1', ?, ?, ?)`, t, t, JSON.stringify({ source: 'SUBSCRIPTION_PERIOD', subscription_id: SUB, period_start: '2026-11-01T00:00:00.000Z' }));
  sql(`INSERT INTO workflow_runs (id, project_id, workflow_key, workflow_version, status, trigger_type, trigger_reference, attempt_number, created_at) VALUES ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'sp', 'SOCIAL_POSTS_V1', 1, 'QUEUED', 'SUBSCRIPTION_PERIOD', 'x', 1, ?)`, t);
  sql(`INSERT INTO workflow_steps (id, workflow_run_id, step_key, step_order, status, attempt_count) VALUES ('s1', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'PRODUCE', 10, 'QUEUED', 0), ('s2', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'DELIVER', 20, 'QUEUED', 0)`);
  const emails = []; const state = { outputs: [], prompts: [] };
  const fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: `e${emails.length}` }); }
    if (String(url) === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body); state.prompts.push(body.messages[0].content);
      const output = state.outputs.shift(); if (!output) throw new Error('Unexpected AI call');
      return Response.json({ model: body.model, usage: { input_tokens: 1200, output_tokens: 1800 }, content: [{ type: 'tool_use', name: 'record_output', input: output }] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const env = { DB, ASSETS, SOCIAL_RASTERIZER: async (svg, w) => fakePng(svg, w), PRODUCTION_RUNNER_SECRET: 'test-runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map(r => ({ ...r }));
  return { env, DB, ASSETS, emails, state, fetch, ctx, pending, row, rows, sql };
}
async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const call = (f, url, init) => api.default.fetch(new Request(url, init), f.env, f.ctx);
const linksIn = (text, path) => [...text.matchAll(new RegExp(`https://menu-made\\.com${path}[^\\s"<]+`, 'g'))].map(m => m[0].replaceAll('&amp;', '&'));

// ---------- pure pieces ----------

test('the ZIP writer produces archives that a standard unzip reads, with correct checksums', () => {
  const files = [{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'dir/b.png', data: new Uint8Array(5000).map((_, i) => i % 251) }];
  const path = join(mkdtempSync(join(tmpdir(), 'zip-')), 't.zip');
  writeFileSync(path, createZip(files));
  const out = execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(sorted(z.namelist())); print(z.read("a.txt").decode())', path]).toString();
  assert.match(out, /^None\n\['a\.txt', 'dir\/b\.png'\]\nhello/);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('graphics: headline fits or the post is refused; featured price comes from the menu; text is escaped', () => {
  const brand = brandOf({ brandColors: '#071f2c, #00d6e6' });
  const ok = renderPostSvg({ headline: 'Fresh basil, hot oven', featured: { name: 'Margherita', price: '$15' } }, { businessName: 'Tom & Jerry\'s <Cafe>', brand }, 'square');
  assert.match(ok.svg, /width="1080" height="1080"/);
  assert.match(ok.svg, /Margherita · \$15/);
  assert.match(ok.svg, /Tom &amp; Jerry's &lt;Cafe&gt;/);
  assert.equal(renderPostSvg({ headline: 'Fresh basil, hot oven' }, { businessName: 'X', brand }, 'story').svg.includes('height="1920"'), true);
  assert.match(renderPostSvg({ headline: 'Supercalifragilisticexpialidocious-and-more' }, { businessName: 'X', brand }, 'square').error, /does not fit/);
  assert.ok(fitText(Array(40).fill('wonderful').join(' '), { maxWidth: 900, maxHeight: 430, start: 104, min: 52 }) === null);
});

test('plan validation: count, lengths, duplicates and invented facts', () => {
  const src = { menu: MENU, sourceText: 'Proof Cafe\nPizza: Margherita $15' };
  assert.deepEqual(validatePosts(goodPosts(), src).problems, []);
  const bad = goodPosts(); bad[1].caption = 'Everything is half price at $9 until 11pm, call 555-123-4567 today friends!'; bad[2].headline = bad[3].headline;
  const problems = validatePosts(bad, src).problems.join('\n');
  assert.match(problems, /price "\$9"/); assert.match(problems, /hours "11pm"/); assert.match(problems, /phone/); assert.match(problems, /duplicate headline/);
  assert.match(validatePosts(goodPosts().slice(0, 5), src).problems[0], /Expected 12 posts/);
  const featured = validatePosts(goodPosts(), src).posts.find((p) => p.featured);
  assert.deepEqual(featured.featured, { name: 'Margherita', price: '$15' });
});

// ---------- end to end ----------

test('a month of posts is planned, rendered, approved by the owner and delivered as a ZIP of PNGs', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    f.state.outputs.push({ posts: goodPosts() });
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');
    assert.equal(f.emails.length, 1);
    const owner = f.emails[0];
    assert.deepEqual(owner.to, ['info@menu-made.com']);
    assert.match(owner.text, /Posting calendar/); assert.match(owner.text, /Graphics pack/);
    assert.match(f.state.prompts[0], /Margherita \$15/, 'the plan is written from the real menu');
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE project_id = 'sp' AND customer_visible = 1`).length, 0);

    // Owner reviews the calendar page.
    const [calendarUrl] = linksIn(owner.text, '/api/delivery/');
    const page = await call(f, calendarUrl);
    const body = await page.text();
    assert.equal(page.status, 200);
    assert.equal((body.match(/<article>/g) || []).length, 12);
    assert.match(body, /Margherita · \$15/);

    const [approveUrl] = linksIn(owner.text, '/api/approvals/');
    const token = new URL(approveUrl).searchParams.get('t');
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token }) });
    await Promise.all(f.pending);
    assert.equal(f.emails.length, 2);
    assert.deepEqual(f.emails[1].to, ['owner@proofcafe.example']);
    const packLink = linksIn(f.emails[1].text, '/api/delivery/').find((u) => /download=1/.test(u));
    const zip = await call(f, packLink);
    assert.match(zip.headers.get('content-type'), /zip/);
    const path = join(mkdtempSync(join(tmpdir(), 'pack-')), 'p.zip');
    writeFileSync(path, new Uint8Array(await zip.arrayBuffer()));
    const names = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))', path]).toString());
    assert.equal(names.length, 25);
    assert.ok(names.includes('post-01-square.png') && names.includes('post-12-story.png') && names.includes('captions-and-calendar.txt'));
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'`).status, 'SUCCEEDED');
    assert.equal(f.row(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id = ?`, SUB).n, 1);
  });
});

test('a plan with invented prices is retried once with feedback, then held back from the buyer', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const bad = goodPosts(); bad[0].caption = 'Our Margherita is only $9 this month, come and get one friends, limited time!';
    f.state.outputs.push({ posts: bad }, { posts: bad });
    await api.runScheduledProduction(f.env);
    assert.equal(f.state.prompts.length, 2);
    assert.match(f.state.prompts[1], /Your previous answer had these problems/);
    assert.equal(f.rows(`SELECT id FROM approvals`).length, 0);
    assert.equal(f.emails.length, 1);
    assert.deepEqual(f.emails[0].to, ['info@menu-made.com']);
    assert.match(f.emails[0].text, /price "\$9"/);
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE project_id = 'sp'`).length, 0);
    assert.equal(f.row(`SELECT status FROM workflow_runs WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'`).status, 'SUCCEEDED');
  });
});

test('the second attempt can fix the plan; the owner asking for changes redoes the month once with the note', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    const bad = goodPosts(); bad[0].caption = 'Our Margherita is only $9 this month, come and get one friends, limited time!';
    f.state.outputs.push({ posts: bad }, { posts: goodPosts() });
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');
    const [approveUrl] = linksIn(f.emails[0].text, '/api/approvals/');
    const token = new URL(approveUrl).searchParams.get('t');
    await call(f, approveUrl.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: token, action: 'changes', note: 'More about the coffee please' }) });
    f.state.outputs.push({ posts: goodPosts() });
    await api.runScheduledProduction(f.env);
    assert.match(f.state.prompts[2], /More about the coffee please/);
    assert.equal(f.rows(`SELECT id FROM approvals WHERE status = 'PENDING'`).length, 1);
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE status = 'SUPERSEDED'`).length, 2);
    assert.equal(f.rows(`SELECT version FROM deliverables WHERE status = 'DRAFT' ORDER BY deliverable_type`).map(r => r.version).join(), '2,2');
  });
});

test('the Social Posts self-test checks the delivered pack and fails loudly when a graphic is broken', async () => {
  const { advanceSocialPostsSelfTests } = await import('./src/selftest/social-posts-selftest.js');
  for (const broken of [false, true]) {
    const f = setup();
    // The self-test builds its own offer lookup; the fixture already has SOCIAL_POSTS.
    // A "rasterizer" that returns a tiny blank image stands in for resvg failing to draw text.
    f.env.SOCIAL_RASTERIZER = async (svg, w) => { const b = new Uint8Array(broken ? 40 : 9000); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, svg.includes('height="1920"') ? 1920 : 1080); return b; };
    await withFetch(f.fetch, async () => {
      f.sql(`UPDATE workflow_runs SET status = 'CANCELLED'`); // only the self-test's own job should run here
      f.state.outputs.push({ posts: goodPosts() });
      f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('33334444-0000-4000-8000-000000000001', 'SOCIAL_POSTS_RUN', 'REQUESTED', 'test', '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z')`);
      const app = (request) => api.default.fetch(request, f.env, f.ctx);
      for (let tick = 0; tick < 4; tick++) { await advanceSocialPostsSelfTests(f.env, app); await api.runScheduledProduction(f.env); await Promise.all(f.pending); }
      await advanceSocialPostsSelfTests(f.env, app);
      const test = f.row(`SELECT status, error FROM self_tests`);
      if (!broken) { assert.equal(test.status, 'PASSED', JSON.stringify(test)); assert.ok(f.emails.every((e) => e.to[0] === 'delivered@resend.dev')); }
      else { assert.equal(test.status, 'FAILED'); assert.match(test.error, /text probably did not render/); assert.ok(f.emails.some((e) => e.to[0] === 'info@menu-made.com' && /Social Posts self-test failed/.test(e.subject))); }
    });
  }
});

test('zip reader round-trips what the writer made', async () => {
  const { readZip } = await import('./src/producers/social-posts/zip.js');
  const files = [{ name: 'x.txt', data: new TextEncoder().encode('abc') }, { name: 'y.bin', data: new Uint8Array(300).fill(7) }];
  assert.deepEqual(readZip(createZip(files)).map((e) => [e.name, e.data.length]), [['x.txt', 3], ['y.bin', 300]]);
});

// ---------- drawn outside the Worker (GitHub Actions), as live ----------

const renderJobs = await import('./src/producers/social-posts/render-jobs.js');
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
async function oidcKit(kid) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://token.actions.githubusercontent.com', aud: 'menu-made-render', exp: now + 300, nbf: now - 5, repository: 'JPBattaglia/MENU', ref: 'refs/heads/master', job_workflow_ref: renderJobs.RENDER_WORKFLOW };
  const sign = async (claims, key = pair.privateKey) => {
    const head = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })); const body = b64u(JSON.stringify(claims));
    return `${head}.${body}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))))}`;
  };
  return { good, sign, jwks: async () => Response.json({ keys: [jwk] }) };
}
const pngOf = (width, height) => { const b = new Uint8Array(4096); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(b.buffer).setUint32(16, width); new DataView(b.buffer).setUint32(20, height); return b; };

test('only the render workflow on master of JPBattaglia/MENU may collect or return graphics', async () => {
  const f = setup();
  const kit = await oidcKit('kid-auth');
  f.env.RENDER_OIDC_FETCH = kit.jwks;
  const status = async (token) => (await call(f, 'https://menu-made.com/api/render-jobs/next', { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status;
  assert.equal(await status(await kit.sign(kit.good)), 200);
  assert.equal(await status(null), 401);
  for (const change of [{ repository: 'someone/MENU' }, { ref: 'refs/heads/feature' }, { job_workflow_ref: 'JPBattaglia/MENU/.github/workflows/menu-checkout.yml@refs/heads/master' },
    { aud: 'other' }, { exp: Math.floor(Date.now() / 1000) - 10 }, { iss: 'https://evil.example' }]) {
    assert.equal(await status(await kit.sign({ ...kit.good, ...change })), 403, JSON.stringify(change));
  }
  const stranger = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  assert.equal(await status(await kit.sign(kit.good, stranger.privateKey)), 403, 'a token signed by another key');
});

test('live, the posts wait for GitHub to draw them, then go to the owner and the buyer as before', async () => {
  const f = setup();
  delete f.env.SOCIAL_RASTERIZER;
  const kit = await oidcKit('kid-e2e');
  f.env.RENDER_OIDC_FETCH = kit.jwks;
  await withFetch(f.fetch, async () => {
    f.state.outputs.push({ posts: goodPosts() });
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE id = 's1'`).status, 'WAITING');
    assert.equal(f.row(`SELECT status, error_code FROM workflow_runs`).error_code, 'RENDER_PENDING');
    assert.equal(f.emails.length, 0, 'the owner hears nothing until the graphics exist');
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE id = 's1'`).status, 'WAITING', 'a tick does not disturb the waiting job');

    const auth = { Authorization: `Bearer ${await kit.sign(kit.good)}` };
    const { job } = await (await call(f, 'https://menu-made.com/api/render-jobs/next', { headers: auth })).json();
    assert.equal(job, 's1');
    // The job id in the route must be a UUID in production; this fixture's step id is not, so call the handler directly.
    const spec = await (await renderJobs.handleRenderJobs(new Request('https://menu-made.com/api/render-jobs/s1', { headers: auth }), f.env, 's1')).json();
    assert.equal(spec.files.length, 24);
    assert.match(spec.files[0].svg, /^<\?xml|<svg/);

    const wrong = createZip([{ name: 'post-01-square.png', data: pngOf(1080, 1080) }]);
    const refused = await renderJobs.handleRenderJobs(new Request('https://menu-made.com/api/render-jobs/s1', { method: 'POST', headers: auth, body: wrong }), f.env, 's1');
    assert.equal(refused.status, 422);
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE id = 's1'`).status, 'WAITING', 'a bad ZIP changes nothing');

    const zip = createZip([...spec.files.map((s) => ({ name: s.name, data: pngOf(s.width, s.height) })), ...spec.extra.map((e) => ({ name: e.name, data: new TextEncoder().encode(e.text) }))]);
    const ok = await renderJobs.handleRenderJobs(new Request('https://menu-made.com/api/render-jobs/s1', { method: 'POST', headers: auth, body: zip }), f.env, 's1');
    assert.equal(ok.status, 200, await ok.clone().text());
    const again = await renderJobs.handleRenderJobs(new Request('https://menu-made.com/api/render-jobs/s1', { method: 'POST', headers: auth, body: zip }), f.env, 's1');
    assert.equal(again.status, 404, 'the same job cannot be returned twice');
    assert.equal(f.rows(`SELECT id FROM deliverables WHERE project_id = 'sp' AND deliverable_type = 'SOCIAL_PACK'`).length, 1);

    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM approvals`).status, 'PENDING');
    assert.match(f.emails[0].text, /Graphics pack/);
    const [approve] = linksIn(f.emails[0].text, '/api/approvals/');
    await call(f, approve.split('?')[0], { method: 'POST', body: new URLSearchParams({ t: new URL(approve).searchParams.get('t') }) });
    await Promise.all(f.pending);
    assert.equal(f.row(`SELECT status FROM workflow_runs`).status, 'SUCCEEDED');
    assert.equal(f.emails.at(-1).to[0], 'owner@proofcafe.example');
  });
});

test('a step cut off mid-run is failed after 20 minutes and the owner is told, instead of waiting forever', async () => {
  const f = setup();
  await withFetch(f.fetch, async () => {
    f.sql(`UPDATE workflow_steps SET status = 'RUNNING', started_at = ? WHERE id = 's1'`, new Date(Date.now() - 5 * 60000).toISOString());
    f.sql(`UPDATE workflow_runs SET status = 'RUNNING'`);
    assert.deepEqual(await api.recoverStuckSteps(f.env), [], 'five minutes in, it may still be working');
    f.sql(`UPDATE workflow_steps SET started_at = ? WHERE id = 's1'`, new Date(Date.now() - 21 * 60000).toISOString());
    await api.runScheduledProduction(f.env);
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE id = 's1'`).status, 'FAILED');
    assert.equal(f.row(`SELECT status, error_code FROM workflow_runs`).error_code, 'PRODUCTION_STEP_STUCK');
    assert.equal(f.row(`SELECT status FROM projects WHERE id = 'sp'`).status, 'FAILED');
    const alert = f.emails.find((e) => /Automation stopped/.test(e.subject));
    assert.ok(alert, 'the owner is emailed');
    assert.match(alert.text, /CPU limit/);
  });
});

test('graphics still undrawn an hour after queueing alert the owner once, with how to run the renderer', async () => {
  const f = setup();
  delete f.env.SOCIAL_RASTERIZER;
  await withFetch(f.fetch, async () => {
    f.state.outputs.push({ posts: goodPosts() });
    await api.runScheduledProduction(f.env);
    assert.deepEqual(await renderJobs.alertStaleRenders(f.env), [], 'a fresh job is left alone');
    const later = Date.now() + 61 * 60000;
    assert.deepEqual(await renderJobs.alertStaleRenders(f.env, later), ['s1']);
    assert.deepEqual(await renderJobs.alertStaleRenders(f.env, later), [], 'only once per job');
    const alerts = f.emails.filter((e) => /waiting to be drawn/.test(e.subject));
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].text, /Run workflow/);
    assert.equal(f.row(`SELECT status FROM workflow_steps WHERE id = 's1'`).status, 'WAITING', 'the job still waits for the renderer');
  });
});
