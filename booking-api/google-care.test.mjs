// Stage 5, Google Profile Care: weekly post (AI, facts checked) with a library photo, monthly profile photos and the
// Performance report, review replies (skipped when the bundle also has Review Replies), the weekly email, the photo
// library page and the self-test. Mocked Google, Anthropic and Resend; real SQLite schema and migrations.
// Run: node --no-warnings --test booking-api/google-care.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { runScheduledProduction } = await import('./src/workflows/runner.js');
const { encryptToken } = await import('./src/google/oauth.js');
const { createPeriodJobs } = await import('./src/subscriptions/periods.js');
const { createReviewWeekJobs } = await import('./src/producers/review-replies/weeks.js');
const { imageSize, photoLibraryLink, storePhoto } = await import('./src/producers/google-care/library.js');
const { hoursText } = await import('./src/producers/google-care/post.js');
const { advanceGoogleCareSelfTests } = await import('./src/selftest/google-care-selftest.js');

const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
const SUB = '33333333-4444-4555-8666-777777777777';
const LOC = 'accounts/7/locations/70';
const DAY = 864e5;

function png(w, h, noise = false) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(Buffer.from([0])); rows.push(Buffer.from(Array.from({ length: w * 3 }, () => (noise ? Math.floor(Math.random() * 256) : 120)))); }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
}

function setup({ plans = ['GOOGLE_PROFILE_CARE'] } = {}) {
  const DB = createD1();
  const ASSETS = createR2();
  for (const m of ['0001_subscription_catalog.sql', '0004_ai_usage_index.sql', '0007_plan_settings.sql', '0013_google_connections.sql', '0014_review_replies.sql', '0015_google_profile_care.sql']) DB.raw.exec(read(m));
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = new Date(Date.now() - 2 * DAY).toISOString();
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES ('cust', ?, ?, 'pat@cornercafe.example', 'Pat', 'Lee')`, t, t);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES ('biz', ?, ?, 'Corner Cafe')`, t, t);
  sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, current_period_start, current_period_end, started_at, created_at, updated_at)
    VALUES (?, 'cust', 'biz', 'offer_google_profile_care', 'offerv1_google_profile_care', 'sub_gc', 'cus_gc', 'ACTIVE', 'MONTH', 14900, ?, ?, ?, ?, ?)`, SUB, t, t, t, t, t);
  for (const plan of plans) {
    const offer = plan.toLowerCase();
    sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, metadata_json, created_at, updated_at) VALUES (?, 'cust', 'biz', ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
      `ent_${offer}`, SUB, plan, t, JSON.stringify({ offer_id: `offer_${offer}`, offer_version_id: `offerv1_${offer}`, workflow_key: `${plan}_V1` }), t, t);
  }
  sql(`INSERT INTO subscription_settings (subscription_id, setting_key, value_text, updated_at) VALUES (?, 'specials', 'Pumpkin ravioli, $19, all October.', ?)`, SUB, t);
  sql(`INSERT INTO google_connections (id, subscription_id, business_id, customer_id, status, refresh_token_enc, scope, account_name, location_name, location_title, connected_at, created_at, updated_at)
    VALUES ('gc1', ?, 'biz', 'cust', 'ACTIVE', 'x', 'business.manage', 'accounts/7', 'locations/70', 'Corner Cafe', ?, ?, ?)`, SUB, t, t, t);
  const env = { DB, ASSETS, PRODUCTION_RUNNER_SECRET: 'runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  const row = (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; };
  const rows = (q, ...a) => DB.raw.prepare(q).all(...a).map((r) => ({ ...r }));
  return { env, DB, ASSETS, sql, row, rows };
}

async function seal(f, subscriptionId = SUB) {
  f.sql(`UPDATE google_connections SET refresh_token_enc = ? WHERE subscription_id = ?`, await encryptToken(f.env, 'rt'), subscriptionId);
}

async function addPhotos(f, n, subscriptionId = SUB) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await storePhoto(f.env, { id: subscriptionId, customer_id: 'cust', business_id: 'biz' }, png(300, 300, true), `p${i}.png`)).id);
  return ids;
}

function services({ post, reviews = [], refresh = 'ok' } = {}) {
  const log = { posts: [], media: [], replies: [], emails: [], prompts: [], perf: [] };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { log.emails.push({ ...JSON.parse(init.body), key: init.headers['Idempotency-Key'] }); return Response.json({ id: `e${log.emails.length}` }); }
    if (u === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'at', expires_in: 3599 });
    if (u.startsWith('https://mybusinessbusinessinformation.googleapis.com/v1/locations/70?')) {
      return Response.json({ name: 'locations/70', title: 'Corner Cafe', websiteUri: 'https://cornercafe.example', phoneNumbers: { primaryPhone: '(510) 555-0100' }, profile: { description: 'Family cafe with fresh pasta.' },
        regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 11 }, closeDay: 'MONDAY', closeTime: { hours: 21 } }] } });
    }
    if (u.startsWith('https://businessprofileperformance.googleapis.com/v1/locations/70:fetchMultiDailyMetricsTimeSeries?')) {
      log.perf.push(u);
      const q = new URL(u).searchParams;
      const start = Date.UTC(+q.get('dailyRange.startDate.year'), +q.get('dailyRange.startDate.month') - 1, +q.get('dailyRange.startDate.day'));
      const series = q.getAll('dailyMetrics').map((m) => ({ dailyMetric: m, timeSeries: { datedValues: Array.from({ length: 60 }, (_, i) => {
        const d = new Date(start + i * DAY);
        const v = m === 'CALL_CLICKS' ? (i < 30 ? 1 : 2) : m === 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH' ? 10 : 0;
        return { date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, ...(v ? { value: String(v) } : {}) };
      }) } }));
      return Response.json({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: series }] });
    }
    if (u.startsWith(`https://mybusiness.googleapis.com/v4/${LOC}/reviews?`)) return Response.json({ reviews, averageRating: 4.5, totalReviewCount: reviews.length });
    const write = u.match(/^https:\/\/mybusiness\.googleapis\.com\/v4\/accounts\/7\/(locations\/[^/]+)\/(localPosts|media)$/);
    if (write) {
      const body = JSON.parse(init.body);
      if (write[1] !== 'locations/70') return Response.json({ error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } }, { status: 404 });
      (write[2] === 'localPosts' ? log.posts : log.media).push(body);
      return Response.json({ name: `${LOC}/${write[2]}/${log.posts.length + log.media.length}` });
    }
    const one = u.match(/^https:\/\/mybusiness\.googleapis\.com\/v4\/(accounts\/7\/locations\/70\/reviews\/[^/]+)(\/reply)?$/);
    if (one && init.method === 'PUT') {
      log.replies.push(one[1]);
      return reviews.some((r) => r.name === one[1]) ? Response.json({}) : Response.json({ error: { code: 404, message: 'not found' } }, { status: 404 });
    }
    if (one) { const r = reviews.find((x) => x.name === one[1]); return r ? Response.json(r) : Response.json({ error: { message: 'nf' } }, { status: 404 }); }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      const content = body.messages[0].content;
      log.prompts.push({ purpose: /Google Business Profile post/.test(body.system) ? 'post' : /summary of a restaurant's Google profile/.test(body.system) ? 'report' : 'reply', content, system: body.system });
      let input;
      if (/Google Business Profile post/.test(body.system)) input = { summary: post ? post(content) : 'Pumpkin ravioli is back at Corner Cafe for October, made fresh every morning. Come by this week and taste the season with us.' };
      else if (/summary of a restaurant/.test(body.system)) input = { summary: 'Calls dropped a little while search views held steady over the last 30 days.' };
      else input = { replies: [...content.matchAll(/<review id="(r\d+)"/g)].map(([, id]) => ({ id, reply: 'Thank you so much for visiting us, we are glad you enjoyed it!\nThe team' })) };
      return Response.json({ model: body.model, usage: { input_tokens: 400, output_tokens: 150 }, content: [{ type: 'tool_use', name: 'record_output', input }] });
    }
    return Response.json({ error: { message: `unexpected ${u}` } }, { status: 404 });
  };
  return { fetch, log };
}

async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const tick = (f, s) => withFetch(s.fetch, () => runScheduledProduction(f.env));
const app = (f) => async (request) => { const pending = []; const res = await worker.fetch(request, f.env, { waitUntil: (p) => pending.push(p) }); await Promise.all(pending); return res; };
async function periodJob(f, start = new Date(Date.now() - DAY).toISOString()) {
  return createPeriodJobs(f.env, { id: SUB, status: 'ACTIVE', customerId: 'cust', businessId: 'biz', plan: { offerCode: 'GOOGLE_PROFILE_CARE' }, stripeSubscriptionId: 'sub_gc', environment: 'live' }, start, new Date(Date.parse(start) + 30 * DAY).toISOString());
}
const review = (id, stars, comment) => ({ name: `${LOC}/reviews/${id}`, starRating: stars, comment, reviewer: { displayName: 'Alex Kim' }, createTime: new Date(Date.now() - DAY).toISOString(), updateTime: new Date(Date.now() - DAY).toISOString() });

// ---------- pure ----------

test('image sizes are read from PNG and JPEG headers; opening hours become plain text', () => {
  assert.deepEqual(imageSize(png(320, 260)), { width: 320, height: 260 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03]);
  assert.deepEqual(imageSize(jpeg), { height: 300, width: 600 });
  assert.equal(hoursText({ periods: [{ openDay: 'MONDAY', openTime: { hours: 11, minutes: 30 }, closeTime: { hours: 22 } }, { openDay: 'SUNDAY', openTime: {}, closeTime: { hours: 24 } }] }),
    'Monday 11:30 am to 10:00 pm; Sunday 12:00 am to 12:00 am');
});

// ---------- the weekly run ----------

test('week 1: the post (with a library photo and the website button), 3 profile photos, the report and review replies, then one weekly email', async () => {
  const f = setup(); await seal(f);
  const photos = await addPhotos(f, 4);
  const s = services({ reviews: [review('five', 'FIVE', 'Great pasta!')] });
  const { projects } = await periodJob(f);
  await tick(f, s);
  const project = f.row(`SELECT status FROM projects WHERE id = ?`, projects[0].id);
  assert.equal(project.status, 'DELIVERED');

  assert.equal(s.log.posts.length, 1);
  const post = s.log.posts[0];
  assert.match(post.summary, /Pumpkin ravioli/);
  assert.equal(post.topicType, 'STANDARD');
  assert.deepEqual(post.callToAction, { actionType: 'LEARN_MORE', url: 'https://cornercafe.example' });
  assert.match(post.media[0].sourceUrl, /^https:\/\/menu-made\.com\/api\/gmedia\/[0-9a-f-]{36}\?t=/);
  const image = await app(f)(new Request(post.media[0].sourceUrl));
  assert.equal(image.status, 200); assert.equal(image.headers.get('Content-Type'), 'image/png');
  assert.equal((await app(f)(new Request(post.media[0].sourceUrl.replace(/t=.*/, 't=forged')))).status, 404);

  assert.equal(s.log.media.length, 3, 'three photos a month');
  assert.ok(s.log.media.every((m) => m.mediaFormat === 'PHOTO' && m.locationAssociation.category === 'ADDITIONAL'));
  const used = f.rows(`SELECT id, json_extract(metadata_json, '$.used_upload_at') AS up FROM assets WHERE asset_type = 'PHOTO'`).filter((r) => r.up).map((r) => r.id);
  assert.equal(used.length, 3);
  assert.ok(photos.some((id) => !used.includes(id)), 'one photo left for next month');

  assert.equal(s.log.replies.length, 1, 'review answered');
  const postPrompt = s.log.prompts.find((p) => p.purpose === 'post');
  assert.match(postPrompt.content, /Opening hours: Monday 11:00 am to 9:00 pm/);
  assert.match(postPrompt.content, /Pumpkin ravioli, \$19/);

  const reportItem = f.row(`SELECT * FROM profile_care_items WHERE kind = 'REPORT'`);
  assert.equal(reportItem.status, 'PUBLISHED');
  const deliverable = f.row(`SELECT d.customer_visible, a.metadata_json FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.id = ?`, reportItem.content);
  assert.equal(deliverable.customer_visible, 1);
  const headline = JSON.parse(deliverable.metadata_json).google_report;
  assert.deepEqual(headline.calls, { current: 60, previous: 30 });
  assert.deepEqual(headline.views, { current: 300, previous: 300 });

  const mail = s.log.emails.find((m) => m.key.startsWith('google-care-summary/'));
  assert.match(mail.subject, /This week on Corner Cafe's Google profile \+ your monthly report/);
  assert.match(mail.html, /Open your monthly report/);
  assert.match(mail.html, /Add photos/);
  const reportUrl = mail.text.match(/Monthly report: (\S+)/)[1];
  const reportPage = await (await app(f)(new Request(reportUrl))).text();
  assert.match(reportPage, /\+100% vs the 30 days before/);

  // Week 2: a post and reviews, but no photos or report.
  assert.equal((await withFetch(s.fetch, () => createReviewWeekJobs(f.env, new Date(Date.now() + 7 * DAY)))).created, 1);
  await tick(f, s);
  assert.equal(s.log.posts.length, 2);
  assert.equal(s.log.media.length, 3);
  assert.equal(f.rows(`SELECT 1 FROM profile_care_items WHERE kind = 'REPORT'`).length, 1);
  assert.match(s.log.prompts.filter((p) => p.purpose === 'post').at(-1).content, /Recent posts \(do not repeat\):\n- Pumpkin ravioli/);
});

test('a post that invents a phone number is held back, the owner is told, and nothing is posted', async () => {
  const f = setup(); await seal(f);
  const s = services({ post: () => 'Come try our new tasting menu this week! Book by calling 212-555-9999 and ask for the chef special tonight.' });
  await periodJob(f);
  await tick(f, s);
  assert.equal(s.log.posts.length, 0);
  const item = f.row(`SELECT * FROM profile_care_items WHERE kind = 'POST'`);
  assert.equal(item.status, 'SKIPPED');
  assert.ok(s.log.emails.some((m) => /Google post for Corner Cafe was held back/.test(m.subject)));
  assert.ok(s.log.emails.some((m) => m.key.startsWith('google-care-summary/') && /Held back/.test(m.text)));
  assert.equal(s.log.prompts.filter((p) => p.purpose === 'post').length, 2, 'one retry');
});

test('in a bundle with Review Replies, Profile Care leaves reviews to that plan', async () => {
  const f = setup({ plans: ['GOOGLE_PROFILE_CARE', 'REVIEW_REPLIES'] }); await seal(f);
  const s = services({ reviews: [review('five', 'FIVE', 'Great!')] });
  const { projects } = await periodJob(f);
  await tick(f, s);
  const care = projects.find((p) => p.plan === 'GOOGLE_PROFILE_CARE');
  assert.equal(f.rows(`SELECT 1 FROM review_replies WHERE project_id = ?`, care.id).length, 0);
  assert.equal(f.rows(`SELECT 1 FROM review_replies`).length, 1, 'the Review Replies job answered it once');
  assert.equal(s.log.replies.length, 1);
  assert.ok(s.log.emails.some((m) => m.key.startsWith('google-care-summary/') && /review replies come in their own weekly email/.test(m.html)));
});

// ---------- photo library ----------

test('the photo library page takes PNG/JPG photos of the right size and refuses the rest', async () => {
  const f = setup();
  const link = await photoLibraryLink(f.env, SUB);
  const page = await app(f)(new Request(link));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /0<\/strong> photos in your library/);
  assert.equal((await app(f)(new Request(link.replace(/t=.*/, 't=forged')))).status, 403);
  const form = new FormData();
  form.append('t', new URL(link).searchParams.get('t'));
  form.append('photos', new File([png(400, 400, true)], 'good.png', { type: 'image/png' }));
  form.append('photos', new File([png(100, 100, true)], 'small.png', { type: 'image/png' }));
  form.append('photos', new File([new TextEncoder().encode('not an image'.repeat(2000))], 'notes.txt', { type: 'text/plain' }));
  const res = await app(f)(new Request(`https://menu-made.com/api/photo-library/${SUB}`, { method: 'POST', body: form }));
  const html = await res.text();
  assert.match(html, /1 photo added/);
  assert.match(html, /small\.png is (?:too small a file|smaller than 250 x 250 pixels)/);
  assert.match(html, /notes\.txt must be a PNG or JPG photo/);
  assert.equal(f.rows(`SELECT 1 FROM assets WHERE asset_type = 'PHOTO'`).length, 1);
});

// ---------- self-test ----------

test('self-test: real reads and report, writes refused by Google for the synthetic location and review', async () => {
  const f = setup();
  f.sql(`INSERT INTO google_connections (id, subscription_id, business_id, customer_id, status, refresh_token_enc, scope, account_name, location_name, location_title, connected_at, created_at, updated_at)
    VALUES ('gco', 'owner', NULL, NULL, 'ACTIVE', ?, 'business.manage', 'accounts/7', 'locations/70', 'Menu-Made', ?, ?, ?)`, await encryptToken(f.env, 'rt'), new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  const s = services({});
  const t = new Date().toISOString();
  f.sql(`INSERT INTO self_tests (id, kind, status, created_at, updated_at) VALUES ('st-gc-1', 'GOOGLE_PROFILE_CARE_RUN', 'REQUESTED', ?, ?)`, t, t);
  for (let i = 0; i < 4; i++) {
    await withFetch(s.fetch, async () => { await advanceGoogleCareSelfTests(f.env, app(f)); await runScheduledProduction(f.env); await advanceGoogleCareSelfTests(f.env, app(f)); });
    if (!['REQUESTED', 'RUNNING'].includes(f.row(`SELECT status FROM self_tests WHERE id = 'st-gc-1'`).status)) break;
  }
  const st = f.row(`SELECT * FROM self_tests WHERE id = 'st-gc-1'`);
  assert.equal(st.status, 'PASSED', st.error || st.log_json);
  assert.equal(s.log.posts.length + s.log.media.length, 0, 'nothing published on the real location');
  assert.ok(s.log.emails.every((m) => m.to[0] === 'delivered@resend.dev'));
});
