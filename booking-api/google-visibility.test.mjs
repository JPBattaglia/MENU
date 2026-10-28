// Stage 5, Google Visibility: Start page brief -> connect email (new-profile steps) -> audit of the connected profile ->
// planned changes from what the business gave Menu-Made (website, hosted menu, phone, story, logo, photos) and an AI
// description -> owner approval -> changes published -> before/after report emailed. Plus reminders, the "nothing to
// change" path, a held-back description, "keep their description", and the self-test. Mocked Google, Anthropic, Resend.
// Run: node --no-warnings --test booking-api/google-visibility.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { runScheduledProduction } = await import('./src/workflows/runner.js');
const { encryptToken } = await import('./src/google/oauth.js');
const { releaseGoogleWaits, googleConnectUrl } = await import('./src/google/connect.js');
const { signLinkToken } = await import('./src/lib/links.js');
const { auditProfile, planFixes, auditAfter, usHolidays, upcomingHolidays } = await import('./src/producers/google-visibility/audit.js');
const { parseGoogleBrief, startGoogleVisibility, remindGoogleVisibilityConnects } = await import('./src/producers/google-visibility/intake.js');
const { businessSources } = await import('./src/producers/google-visibility/sources.js');
const { advanceGoogleVisibilitySelfTests } = await import('./src/selftest/google-visibility-selftest.js');

const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
const PROJECT = '44444444-5555-4666-8777-888888888888';
const DAY = 864e5;
const NOW = new Date('2026-10-28T18:00:00.000Z');

function png(w, h) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(Buffer.from([0])); rows.push(Buffer.from(Array.from({ length: w * 3 }, () => Math.floor(Math.random() * 256)))); }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
}

function setup({ notes = 'Google: existing profile', created = new Date(Date.now() - DAY).toISOString() } = {}) {
  const DB = createD1();
  const ASSETS = createR2();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = created;
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, sort_order, is_public, is_featured, cta_text)
       VALUES ('offer_google_visibility', ?, ?, 'GOOGLE_VISIBILITY', 'Google Visibility', 'VISIBILITY', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 0, 0, 'GOOGLE_VISIBILITY_V1', 'google-visibility', 1, 1, 0, 'Get Started')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, scope_json, stripe_price_id)
       VALUES ('offerv1_google_visibility', 'offer_google_visibility', 1, ?, ?, 'ACTIVE', 14900, 'USD', '{}', 'price_gv')`, t, t);
  for (const m of ['0004_ai_usage_index.sql', '0007_plan_settings.sql', '0009_website_package.sql', '0013_google_connections.sql', '0014_review_replies.sql', '0015_google_profile_care.sql', '0016_google_visibility.sql']) DB.raw.exec(read(m));
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'pat@cornercafe.example', 'Pat', 'Lee')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name, phone) VALUES ('biz', ?, ?, 'Corner Cafe', '(415) 555-0000')`, t, t);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes)
       VALUES ('ord', ?, ?, 'cust', 'biz', 'PAID', 'USD', 14900, 0, 0, 14900, 'PAID', 'cs_live_gv', ?, ?)`, t, t, t, notes);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES ('item', 'ord', 'offer_google_visibility', 'offerv1_google_visibility', 1, 14900, 14900, 'READY')`);
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at)
       VALUES (?, 'ord', 'item', 'biz', 'cust', 'VISIBILITY', 'AWAITING_INPUTS', 'GOOGLE_VISIBILITY_V1', 1, 'NORMAL', 0, ?, ?)`, PROJECT, t, t);
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map((r) => ({ ...r }));
  return { env, DB, ASSETS, sql, row, rows };
}

async function connect(f, key = PROJECT) {
  const t = new Date().toISOString();
  f.sql(`INSERT INTO google_connections (id, subscription_id, business_id, customer_id, status, refresh_token_enc, scope, account_name, location_name, location_title, connected_at, created_at, updated_at)
    VALUES (?, ?, 'biz', 'cust', 'ACTIVE', ?, 'business.manage', 'accounts/7', 'locations/70', 'Corner Cafe', ?, ?, ?)`, `gc-${key}`, key, await encryptToken(f.env, 'rt'), t, t, t);
  return releaseGoogleWaits(f.env, key);
}

// What Menu-Made knows about Corner Cafe: a live website, a hosted menu, the website form (phone + story), a logo, 2 photos.
async function seedSources(f) {
  const t = new Date().toISOString();
  const asset = async (id, type, meta, bytes) => {
    const key = `customers/cust/${id}`;
    await f.ASSETS.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
    f.sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, 'biz', 'cust', NULL, ?, 'R2', ?, ?, 'image/png', ?, 'x', 'VALID', ?, ?, 1, 1, 1, ?)`, id, type, key, `${id}.png`, bytes.length, t, t, JSON.stringify(meta));
  };
  f.sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, placed_at) VALUES ('ord-w', ?, ?, 'cust', 'biz', 'DELIVERED', 'USD', 0, 0, 0, 0, 'PAID', ?)`, t, t, t);
  for (const [id, wf] of [['proj-web', 'WEBSITE_PACKAGE_V1'], ['proj-menu', 'MENU_QR_V1']]) {
    f.sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, 'ord-w', 'offer_google_visibility', 'offerv1_google_visibility', 1, 0, 0, 'FULFILLED')`, `item-${id}`);
    f.sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at)
      VALUES (?, 'ord-w', ?, 'biz', 'cust', 'OTHER', 'DELIVERED', ?, 1, 'NORMAL', 0, ?, ?)`, id, `item-${id}`, wf, t, t);
  }
  for (const [key, value] of [['phone', '(510) 555-0100'], ['about', 'Family cafe in Oakland with fresh pasta made every morning and a sunny patio.'], ['kind', 'restaurant']]) {
    f.sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, value_text, required, status, created_at, updated_at) VALUES (?, 'proj-web', ?, 'TEXT', ?, 1, 'VALID', ?, ?)`, `pi-${key}`, key, value, t, t);
  }
  f.sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, value_text, required, status, created_at, updated_at) VALUES ('pi-qr', 'proj-menu', 'qr_destination', 'URL', 'https://menu-made.com/api/menu/corner-cafe', 1, 'VALID', ?, ?)`, t, t);
  f.sql(`INSERT INTO website_sites (id, slug, project_id, business_id, customer_id, style, created_at, updated_at) VALUES ('site', 'corner-cafe', 'proj-web', 'biz', 'cust', 'modern', ?, ?)`, t, t);
  await asset('site-build', 'DELIVERABLE', { website: { slug: 'corner-cafe' } }, new Uint8Array([1]));
  await asset('menu-page', 'DELIVERABLE', {}, new Uint8Array([1]));
  for (const [id, project, type, assetId] of [['d-site', 'proj-web', 'SITE_BUILD', 'site-build'], ['d-menu', 'proj-menu', 'MENU_DRAFT', 'menu-page']]) {
    f.sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES (?, ?, ?, ?, 1, 'FINAL', 1, ?, ?)`, id, project, assetId, type, t, t);
  }
  await asset('aaaaaaaa-0000-4000-8000-000000000001', 'LOGO', { site_image: 'logo' }, png(300, 300));
  await asset('aaaaaaaa-0000-4000-8000-000000000002', 'PHOTO', { site_image: 'photo' }, png(400, 300));
  await asset('aaaaaaaa-0000-4000-8000-000000000003', 'PHOTO', { site_image: 'photo' }, png(400, 300));
  await asset('aaaaaaaa-0000-4000-8000-000000000004', 'PHOTO', { site_image: 'photo' }, png(100, 100)); // too small for Google
}

const SPARSE = { name: 'locations/70', title: 'Corner Cafe', categories: { primaryCategory: { name: 'categories/gcid:cafe', displayName: 'Cafe' } },
  storefrontAddress: { regionCode: 'US', addressLines: ['1 Main St'], locality: 'Oakland', administrativeArea: 'CA' }, metadata: { mapsUri: 'https://maps.google.com/?cid=1' } };
const COMPLETE = { ...SPARSE, categories: { ...SPARSE.categories, additionalCategories: [{ name: 'categories/gcid:pasta', displayName: 'Pasta shop' }] },
  phoneNumbers: { primaryPhone: '(510) 555-0100' }, websiteUri: 'https://cornercafe.example', profile: { description: 'x'.repeat(300) },
  regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 8 }, closeDay: 'MONDAY', closeTime: { hours: 15 } }] },
  specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 11, day: 26 }, closed: true }] } };

function services({ location = SPARSE, attributes = [], media = { mediaItems: [], totalMediaItemCount: 2 }, description } = {}) {
  const log = { patches: [], attributes: [], media: [], emails: [], prompts: [] };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    if (u === 'https://api.resend.com/emails') { log.emails.push({ ...JSON.parse(init.body), key: init.headers['Idempotency-Key'] }); return Response.json({ id: `e${log.emails.length}` }); }
    if (u === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'at', expires_in: 3599 });
    const info = 'https://mybusinessbusinessinformation.googleapis.com/v1/';
    if (method === 'GET' && u.startsWith(`${info}locations/70?readMask=`)) return Response.json(location);
    if (method === 'GET' && u === `${info}locations/70/attributes`) return Response.json({ name: 'locations/70/attributes', attributes: attributes.map((name) => ({ name, valueType: 'URL' })) });
    if (method === 'GET' && u.startsWith(`${info}attributes?parent=locations%2F70`)) return Response.json({ attributeMetadata: [{ parent: 'attributes/url_menu', valueType: 'URL' }, { parent: 'attributes/has_wifi', valueType: 'BOOL' }] });
    if (method === 'PATCH' && u.startsWith(`${info}locations/70?updateMask=`)) { log.patches.push({ mask: new URL(u).searchParams.get('updateMask'), validateOnly: new URL(u).searchParams.get('validateOnly'), body: JSON.parse(init.body) }); return Response.json({}); }
    if (method === 'PATCH' && u.startsWith(`${info}locations/`) && u.includes('/attributes?attributeMask=')) {
      if (!u.startsWith(`${info}locations/70/`)) return Response.json({ error: { code: 400, message: 'Invalid location' } }, { status: 400 });
      log.attributes.push({ mask: new URL(u).searchParams.get('attributeMask'), body: JSON.parse(init.body) }); return Response.json({});
    }
    if (method === 'GET' && u.startsWith('https://mybusiness.googleapis.com/v4/accounts/7/locations/70/media?')) return Response.json(media);
    if (method === 'GET' && u.startsWith('https://mybusiness.googleapis.com/v4/accounts/7/locations/70/reviews?')) return Response.json({ reviews: [{ name: 'r1', starRating: 'FIVE' }], averageRating: 5, totalReviewCount: 1 });
    const write = u.match(/^https:\/\/mybusiness\.googleapis\.com\/v4\/accounts\/7\/(locations\/[^/]+)\/media$/);
    if (write && method === 'POST') {
      if (write[1] !== 'locations/70') return Response.json({ error: { code: 404, message: 'Requested entity was not found.' } }, { status: 404 });
      log.media.push(JSON.parse(init.body)); return Response.json({ name: `m${log.media.length}` });
    }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      log.prompts.push(body.messages[0].content);
      const text = description ? description(body.messages[0].content, log.prompts.length)
        : 'Corner Cafe is a family cafe in Oakland, California, where fresh pasta is made every morning and served at the counter or out on the sunny patio. Locals come for simple, honest cooking and a relaxed room that suits a quick lunch or a slow coffee. We keep the menu short, seasonal and made by hand, the way it has been since the family opened the doors.';
      return Response.json({ model: body.model, usage: { input_tokens: 300, output_tokens: 120 }, content: [{ type: 'tool_use', name: 'record_output', input: { description: text } }] });
    }
    return Response.json({ error: { message: `unexpected ${method} ${u}` } }, { status: 404 });
  };
  return { fetch, log };
}

async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const tick = (f, s) => withFetch(s.fetch, () => runScheduledProduction(f.env));
const app = (f) => async (request) => { const pending = []; const res = await worker.fetch(request, f.env, { waitUntil: (p) => pending.push(p) }); await Promise.all(pending); return res; };
async function decide(f, s, action, note) {
  const approval = f.row(`SELECT id FROM approvals WHERE project_id = ? AND status = 'PENDING'`, PROJECT);
  const form = new FormData();
  form.append('t', await signLinkToken(f.env, { kind: 'approve', id: approval.id, ttlDays: 1 }));
  form.append('action', action);
  if (note) form.append('note', note);
  return withFetch(s.fetch, () => app(f)(new Request(`https://menu-made.com/api/approvals/${approval.id}`, { method: 'POST', body: form })));
}
const start = (f) => startGoogleVisibility(f.env, { projectId: PROJECT, orderId: 'ord', customerId: 'cust', notes: f.row(`SELECT notes FROM orders WHERE id = 'ord'`).notes });

// ---------- pure ----------

test('US holidays, the Start page brief, and the audit score with fixes planned only from what we know', () => {
  const h = Object.fromEntries(usHolidays(2026).map((x) => [x.name, x.date]));
  assert.equal(h.Thanksgiving, '2026-11-26'); assert.equal(h['Memorial Day'], '2026-05-25'); assert.equal(h['Labor Day'], '2026-09-07');
  assert.deepEqual(upcomingHolidays(NOW).map((x) => x.name), ['Thanksgiving']);
  assert.deepEqual(parseGoogleBrief('Menu: 3 pages\nGoogle: new profile'), { mode: 'new', profileUrl: '' });
  assert.deepEqual(parseGoogleBrief('Google: existing profile; https://maps.app.goo.gl/abc'), { mode: 'existing', profileUrl: 'https://maps.app.goo.gl/abc' });
  assert.equal(parseGoogleBrief('').mode, 'existing');

  const audit = auditProfile({ location: SPARSE, attributes: new Set(), available: new Set(['attributes/url_menu']), media: { mediaItems: [], totalMediaItemCount: 2 } }, NOW);
  const byKey = Object.fromEntries(audit.checks.map((c) => [c.key, c]));
  assert.equal(byKey.category_primary.ok, true); assert.equal(byKey.address.ok, true);
  assert.equal(byKey.holiday_hours.detail, 'Thanksgiving (2026-11-26)');
  assert.equal(audit.score, 20); // primary category 10 + address 10 of 100
  assert.deepEqual(planFixes(audit, {}).map((x) => x.kind), ['DESCRIPTION'], 'nothing known: only the AI description');
  const fixes = planFixes(audit, { phone: '(510) 555-0100', website: 'https://w.example/', menu: 'https://menu-made.com/api/menu/x', logoAssetId: 'L', photoAssetIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.deepEqual(fixes.map((x) => x.kind), ['DESCRIPTION', 'PHONE', 'WEBSITE', 'MENU_LINK', 'LOGO', 'PHOTO', 'PHOTO', 'PHOTO', 'PHOTO', 'PHOTO'], 'at most 5 photos');
  const after = auditAfter(audit, fixes);
  assert.equal(after.score, 65, 'hours, extra categories, holiday hours and photos (7 of 10) still fail');
  assert.equal(after.checks.find((c) => c.key === 'photos').count, 7);
  // A complete profile, and a menu link that isn't offered for this category, needs nothing.
  const done = auditProfile({ location: COMPLETE, attributes: new Set(), available: new Set(), media: { mediaItems: [{ locationAssociation: { category: 'LOGO' } }], totalMediaItemCount: 12 } }, NOW);
  assert.equal(done.score, 100);
  assert.equal(done.checks.find((c) => c.key === 'menu_link').applicable, false);
  assert.deepEqual(planFixes(done, { website: 'x' }), []);
});

test('sources: live website, hosted menu, website-form phone and story, logo and photos big enough for Google (never the checkout phone)', async () => {
  const f = setup();
  assert.deepEqual(await businessSources(f.env, 'biz'), { website: null, menu: null, phone: null, about: null, logoAssetId: null, photoAssetIds: [] });
  await seedSources(f);
  const s = await businessSources(f.env, 'biz');
  assert.equal(s.website, 'https://menu-made.com/api/site/corner-cafe/');
  assert.equal(s.menu, 'https://menu-made.com/api/menu/corner-cafe');
  assert.equal(s.phone, '(510) 555-0100');
  assert.match(s.about, /fresh pasta/);
  assert.equal(s.logoAssetId, 'aaaaaaaa-0000-4000-8000-000000000001');
  assert.deepEqual(s.photoAssetIds.sort(), ['aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003']);
});

// ---------- the order ----------

test('paid order: connect email with the new-profile steps, then audit, owner approval, changes on Google and the report', async () => {
  const f = setup({ notes: 'Google: new profile' });
  await seedSources(f);
  const s = services();
  assert.deepEqual(await start(f), { started: true, mode: 'new' });
  await tick(f, s);
  const connectMail = s.log.emails.find((m) => /create and connect Corner Cafe's Google profile/.test(m.subject));
  assert.ok(connectMail, 'connect email for a new profile');
  assert.match(connectMail.html, /business\.google\.com\/create/);
  assert.match(connectMail.html, /Verify it/);
  assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, PROJECT).status, 'AWAITING_INPUTS');

  // The connect page works for this one-time order (no subscription) and says what it's for.
  const page = await withFetch(s.fetch, () => app(f)(new Request(connectMail.text.match(/Connect Google: (\S+)/)[1])));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /fill in what's missing/);

  assert.equal(await connect(f), 1, 'connecting releases the waiting step');
  await tick(f, s);
  const planned = f.rows(`SELECT kind, status, value, asset_id FROM visibility_fixes WHERE project_id = ? ORDER BY kind, ref`, PROJECT);
  assert.deepEqual(planned.map((x) => x.kind), ['DESCRIPTION', 'LOGO', 'MENU_LINK', 'PHONE', 'PHOTO', 'PHOTO', 'WEBSITE']);
  assert.ok(planned.every((x) => x.status === 'PLANNED'));
  assert.equal(s.log.patches.length + s.log.attributes.length + s.log.media.length, 0, 'nothing on Google before the owner approves');
  assert.match(s.log.prompts[0], /What the owner wrote about the business: Family cafe in Oakland/);
  assert.doesNotMatch(s.log.prompts[0], /555-0000/, 'checkout phone never reaches the AI');
  const owner = s.log.emails.find((m) => /Approve 7 Google profile changes for Corner Cafe/.test(m.subject));
  assert.ok(owner, 'owner approval email');
  assert.match(owner.html, /New description:/);

  assert.equal((await decide(f, s, 'approve')).status, 200);
  await tick(f, s);
  assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, PROJECT).status, 'DELIVERED');
  assert.deepEqual(s.log.patches.map((p) => p.mask).sort(), ['phoneNumbers', 'profile.description', 'websiteUri']);
  assert.ok(s.log.patches.every((p) => p.validateOnly === null), 'real edits, not validation');
  assert.equal(s.log.patches.find((p) => p.mask === 'websiteUri').body.websiteUri, 'https://menu-made.com/api/site/corner-cafe/');
  assert.deepEqual(s.log.attributes[0].body.attributes, [{ name: 'attributes/url_menu', valueType: 'URL', uriValues: [{ uri: 'https://menu-made.com/api/menu/corner-cafe' }] }]);
  assert.deepEqual(s.log.media.map((m) => m.locationAssociation.category).sort(), ['ADDITIONAL', 'ADDITIONAL', 'LOGO']);
  const image = await app(f)(new Request(s.log.media[0].sourceUrl));
  assert.equal(image.status, 200, 'Google can download the image');
  assert.ok(f.rows(`SELECT status FROM visibility_fixes WHERE project_id = ?`, PROJECT).every((x) => x.status === 'APPLIED'));
  assert.ok(JSON.parse(f.row(`SELECT metadata_json FROM assets WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001'`).metadata_json).google_visibility_uploaded);

  const report = s.log.emails.find((m) => m.key.startsWith('gv-delivery/'));
  assert.match(report.subject, /^Corner Cafe's Google profile: 20 → 65$/);
  assert.match(report.html, /Google Profile Care/);
  const html = await (await app(f)(new Request(report.text.match(/Open your report: (\S+)/)[1]))).text();
  assert.match(html, /What we changed on your profile/);
  assert.match(html, /Opening hours/);
  assert.match(html, /Thanksgiving \(2026-11-26\)/);
  assert.match(html, /not a Google ranking/);
});

test('a complete profile needs no changes: no owner step, the report goes straight to the buyer', async () => {
  const f = setup();
  const s = services({ location: COMPLETE, attributes: ['attributes/url_menu'], media: { mediaItems: [{ locationAssociation: { category: 'LOGO' } }], totalMediaItemCount: 14 } });
  await start(f); await connect(f);
  await tick(f, s);
  assert.equal(f.row(`SELECT status FROM projects WHERE id = ?`, PROJECT).status, 'DELIVERED');
  assert.equal(f.rows(`SELECT 1 FROM approvals WHERE project_id = ?`, PROJECT).length, 0);
  assert.equal(s.log.prompts.length, 0, 'no AI needed');
  assert.match(s.log.emails.find((m) => m.key.startsWith('gv-delivery/')).subject, /: 100 → 100$/);
});

test('a description with an invented phone number is held back and the owner told; "keep their description" leaves it out of the redo', async () => {
  const f = setup();
  await seedSources(f);
  const s = services({ description: () => `Corner Cafe in Oakland makes fresh pasta every morning. Call 212-555-9999 to book a table on the patio. ${'We cook simple, honest food. '.repeat(8)}` });
  await start(f); await connect(f);
  await tick(f, s);
  assert.equal(s.log.prompts.length, 2, 'one retry');
  assert.equal(f.rows(`SELECT 1 FROM visibility_fixes WHERE project_id = ? AND kind = 'DESCRIPTION'`, PROJECT).length, 0);
  assert.ok(s.log.emails.some((m) => /new Google description was held back/.test(m.subject)));

  const g = setup();
  await seedSources(g);
  const t = services();
  await start(g); await connect(g);
  await tick(g, t);
  assert.equal(g.rows(`SELECT 1 FROM visibility_fixes WHERE project_id = ? AND kind = 'DESCRIPTION'`, PROJECT).length, 1);
  assert.equal((await decide(g, t, 'changes', 'Please keep their description, they like it.')).status, 200);
  await tick(g, t); // redo PRODUCE, new approval
  assert.equal(g.rows(`SELECT 1 FROM visibility_fixes WHERE project_id = ? AND kind = 'DESCRIPTION'`, PROJECT).length, 0);
  assert.equal(g.row(`SELECT COUNT(*) AS n FROM approvals WHERE project_id = ? AND status = 'PENDING'`, PROJECT).n, 1);
  await decide(g, t, 'approve');
  await tick(g, t);
  assert.ok(!t.log.patches.some((p) => p.mask === 'profile.description'));
  assert.equal(g.row(`SELECT status FROM projects WHERE id = ?`, PROJECT).status, 'DELIVERED');
});

test('buyers who never connect get reminders at 5 and 14 days, then the owner is told at 30', async () => {
  const f = setup({ created: new Date(Date.now() - 2 * DAY).toISOString() });
  const s = services();
  await start(f);
  await tick(f, s);
  const run = async (days) => withFetch(s.fetch, () => remindGoogleVisibilityConnects(f.env, new Date(Date.now() + days * DAY)));
  assert.equal((await run(0)).sent, 0);
  assert.equal((await run(4)).sent, 1);
  assert.equal((await run(4)).sent, 0, 'once');
  assert.equal((await run(13)).sent, 1);
  assert.equal((await run(29)).sent, 1);
  assert.equal((await run(30)).sent, 0, 'once');
  assert.deepEqual(s.log.emails.map((m) => m.subject).filter((x) => /Reminder|hasn't connected/.test(x)),
    ["Reminder: connect Google so we can improve Corner Cafe's profile", "Reminder: connect Google so we can improve Corner Cafe's profile", "Corner Cafe paid for Google Visibility 30 days ago and hasn't connected Google"]);
  // Delivered orders can't use the link any more.
  f.sql(`UPDATE projects SET status = 'DELIVERED' WHERE id = ?`, PROJECT);
  assert.equal((await app(f)(new Request(await googleConnectUrl(f.env, PROJECT)))).status, 403);
});

test('self-test: owner profile, every change planned, approved through the approve page, validated or refused by Google, report emailed', async () => {
  const f = setup();
  f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('st1', 'GOOGLE_VISIBILITY_RUN', 'REQUESTED', 'test', ?, ?)`, new Date().toISOString(), new Date().toISOString());
  const s = services({ location: COMPLETE, attributes: ['attributes/url_menu'], media: { mediaItems: [], totalMediaItemCount: 12 },
    description: () => 'Visibility Self-Test Trattoria is a family-run trattoria in Oakland where the owners roll fresh pasta every morning and slow-cook ragù the way they learned in Bologna. Big tables suit families and groups, and a small natural wine list keeps dinner relaxed. Expect a short menu that changes with what is good that week.' });
  await connect(f, 'owner');
  const step = async () => { await withFetch(s.fetch, () => advanceGoogleVisibilitySelfTests(f.env, app(f))); await tick(f, s); };
  for (let i = 0; i < 6; i++) await step();
  await withFetch(s.fetch, () => advanceGoogleVisibilitySelfTests(f.env, app(f)));
  const st = f.row(`SELECT * FROM self_tests WHERE id = 'st1'`);
  assert.equal(st.status, 'PASSED', st.error || '');
  assert.ok(s.log.patches.every((p) => p.validateOnly === 'true'), 'profile edits only validated');
  assert.equal(s.log.media.length, 0, 'no photo reached the real profile');
  assert.equal(s.log.attributes.length, 0, 'no menu link on the real profile');
});
