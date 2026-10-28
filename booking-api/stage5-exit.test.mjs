// Stage 5 exit test, run locally with mocked Google, Anthropic and Resend: a month (Review Replies week 1 and Google
// Profile Care weeks 1-4) for one bundle subscriber plus a Google Visibility self-test, all on the owner's profile.
// Run: node --no-warnings --test booking-api/stage5-exit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { runScheduledProduction } = await import('./src/workflows/runner.js');
const { encryptToken } = await import('./src/google/oauth.js');
const { advanceStage5ExitTests } = await import('./src/selftest/stage5-exit-selftest.js');
const { advanceGoogleVisibilitySelfTests } = await import('./src/selftest/google-visibility-selftest.js');

const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
const DAY = 864e5;

function setup() {
  const DB = createD1();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const t = new Date().toISOString();
  sql(`INSERT INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, sort_order, is_public, is_featured, cta_text)
       VALUES ('offer_google_visibility', ?, ?, 'GOOGLE_VISIBILITY', 'Google Visibility', 'VISIBILITY', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 0, 0, 'GOOGLE_VISIBILITY_V1', 'google-visibility', 1, 1, 0, 'Get Started')`, t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, scope_json, stripe_price_id)
       VALUES ('offerv1_google_visibility', 'offer_google_visibility', 1, ?, ?, 'ACTIVE', 14900, 'USD', '{}', 'price_gv')`, t, t);
  for (const m of ['0001_subscription_catalog.sql', '0004_ai_usage_index.sql', '0007_plan_settings.sql', '0013_google_connections.sql', '0014_review_replies.sql', '0015_google_profile_care.sql', '0016_google_visibility.sql']) DB.raw.exec(read(m));
  const env = { DB, ASSETS: createR2(), PRODUCTION_RUNNER_SECRET: 'runner-secret', RESEND_API_KEY: 're_test', ANTHROPIC_API_KEY: 'sk-ant-test', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', AUTOMATION_START_AT: '2000-01-01T00:00:00.000Z' };
  return { env, DB, sql, row: (q, ...a) => { const r = DB.raw.prepare(q).get(...a); return r ? { ...r } : null; } };
}

const LOCATION = { name: 'locations/70', title: 'Menu-Made', categories: { primaryCategory: { name: 'categories/gcid:web', displayName: 'Website designer' } }, websiteUri: 'https://menu-made.com/',
  phoneNumbers: { primaryPhone: '(415) 555-0100' }, profile: { description: 'x'.repeat(300) }, storefrontAddress: { regionCode: 'US', addressLines: ['1 Main St'], locality: 'San Francisco', administrativeArea: 'CA' },
  regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }] } };

function services() {
  const log = { writes: [], emails: [] };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    if (u === 'https://api.resend.com/emails') { log.emails.push(JSON.parse(init.body)); return Response.json({ id: `e${log.emails.length}` }); }
    if (u === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'at', expires_in: 3599 });
    const info = 'https://mybusinessbusinessinformation.googleapis.com/v1/';
    if (method === 'GET' && u.startsWith(`${info}locations/70?readMask=`)) return Response.json(LOCATION);
    if (method === 'GET' && u === `${info}locations/70/attributes`) return Response.json({ attributes: [] });
    if (method === 'GET' && u.startsWith(`${info}attributes?parent=`)) return Response.json({ attributeMetadata: [] });
    if (method === 'PATCH' && u.startsWith(`${info}locations/70?`)) { log.writes.push(u); return Response.json({}); }
    if (method === 'PATCH' && u.includes('/attributes?attributeMask=')) return Response.json({ error: { code: 403, message: 'The caller does not have permission' } }, { status: 403 });
    if (u.startsWith('https://businessprofileperformance.googleapis.com/')) return Response.json({ multiDailyMetricTimeSeries: [] });
    if (method === 'GET' && u.includes('/locations/70/media?')) return Response.json({ mediaItems: [], totalMediaItemCount: 12 });
    if (method === 'GET' && u.includes('/locations/70/reviews?')) return Response.json({ reviews: [], averageRating: 5, totalReviewCount: 0 });
    if (method === 'GET' && u.includes('/locations/70?readMask=')) return Response.json(LOCATION);
    if (u.startsWith('https://mybusiness.googleapis.com/v4/') && method !== 'GET') {
      log.writes.push(u);
      return u.includes('/locations/70/') ? Response.json({ error: { code: 404, message: 'not found' } }, { status: 404 }) : Response.json({ error: { code: 400, message: 'bad location' } }, { status: 400 });
    }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const body = JSON.parse(init.body);
      const s = body.system || '';
      const input = /Google Business Profile post/.test(s) ? { summary: 'Pumpkin ravioli is back for autumn at our family table. Come in this week, pull up a chair and taste the season with us.' }
        : /summary of a restaurant/.test(s) ? { summary: 'Views and calls held steady over the last 30 days compared with the month before.' }
        : /From the business/.test(s) ? { description: 'Visibility Self-Test Trattoria is a family-run trattoria in North Beach where the owners roll fresh pasta every morning and slow-cook ragù the way they learned in Bologna. Big tables suit families and groups, and a small natural wine list keeps dinner relaxed and easy.' }
        : { replies: [...body.messages[0].content.matchAll(/<review id="(r\d+)"/g)].map(([, id]) => ({ id, reply: 'Thank you so much, we are glad you enjoyed the gnocchi!\nSam, owner' })) };
      return Response.json({ model: body.model, usage: { input_tokens: 300, output_tokens: 100 }, content: [{ type: 'tool_use', name: 'record_output', input }] });
    }
    return Response.json({ error: { message: `unexpected ${method} ${u}` } }, { status: 404 });
  };
  return { fetch, log };
}

async function withFetch(fake, fn) { const o = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = o; } }
const app = (f) => async (request) => { const pending = []; const res = await worker.fetch(request, f.env, { waitUntil: (p) => pending.push(p) }); await Promise.all(pending); return res; };

test('stage 5 exit: a month of posts, one report, reviews answered once, and Google Visibility, all on the owner profile', async () => {
  const f = setup();
  const s = services();
  const t = new Date().toISOString();
  f.sql(`INSERT INTO google_connections (id, subscription_id, status, refresh_token_enc, scope, account_name, location_name, location_title, connected_at, created_at, updated_at)
    VALUES ('gco', 'owner', 'ACTIVE', ?, 'business.manage', 'accounts/7', 'locations/70', 'Menu-Made', ?, ?, ?)`, await encryptToken(f.env, 'rt'), t, t, t);
  f.sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('exit1', 'STAGE5_EXIT', 'REQUESTED', 'test', ?, ?)`, t, t);
  for (let i = 0; i < 10; i++) {
    await withFetch(s.fetch, async () => {
      await advanceStage5ExitTests(f.env, app(f));
      await advanceGoogleVisibilitySelfTests(f.env, app(f));
      await runScheduledProduction(f.env);
    });
    if (f.row(`SELECT status FROM self_tests WHERE id = 'exit1'`).status !== 'RUNNING' && i > 0) break;
  }
  const exit = f.row(`SELECT * FROM self_tests WHERE id = 'exit1'`);
  assert.equal(exit.status, 'PASSED', exit.error || '');
  assert.match(exit.log_json, /4 weekly posts/);
  assert.ok(!s.log.writes.some((u) => u.includes('validateOnly') === false && u.startsWith('https://mybusinessbusinessinformation')), 'profile edits only validated');
  assert.ok(!s.log.writes.some((u) => /\/locations\/70\/(localPosts|media)$/.test(u)), 'nothing posted to the real profile');
});
