// Stage 5 Google connection: signed connect link, OAuth callback, encrypted token storage, profile choice,
// the owner connection and the read-only GOOGLE_API_HEALTH self-test. Mocked Google and Resend; real SQLite schema.
// Run: node --no-warnings --test booking-api/google-connect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { googleConnectUrl } = await import('./src/google/connect.js');
const { decryptToken } = await import('./src/google/oauth.js');
const { advanceGoogleSelfTests } = await import('./src/selftest/google-selftest.js');

const SUB = '11111111-2222-4333-8444-555555555555';
const read = (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');

function setup({ status = 'ACTIVE' } = {}) {
  const DB = createD1();
  DB.raw.exec(read('0013_google_connections.sql'));
  DB.raw.exec('PRAGMA foreign_keys = OFF'); // a bare subscription row is enough here
  const t = new Date().toISOString();
  DB.raw.prepare(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status,
    billing_interval, amount_cents, started_at, created_at, updated_at) VALUES (?, 'cus', 'biz', 'off', 'offv', 'sub_x', 'cus_x', ?, 'MONTH', 4900, ?, ?, ?)`)
    .run(SUB, status, t, t, t);
  const env = { DB, PRODUCTION_RUNNER_SECRET: 'runner-secret', GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'csecret',
    RESEND_API_KEY: 're_test' };
  const connection = (id = SUB) => { const r = DB.raw.prepare(`SELECT * FROM google_connections WHERE subscription_id = ?`).get(id); return r ? { ...r } : null; };
  return { env, DB, connection };
}

// Fake Google: token endpoint, accounts, locations, a location read and v4 reviews.
function google({ profiles = [{ account: 'accounts/1', location: 'locations/10', title: 'Corner Cafe' }], scope = 'https://www.googleapis.com/auth/business.manage',
  refresh = 'ok' } = {}) {
  const calls = []; const emails = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'e' }); }
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? String(init.body) : '' });
    if (u === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init.body));
      if (body.get('grant_type') === 'authorization_code') return Response.json({ access_token: 'at1', refresh_token: 'rt-secret-value', scope, expires_in: 3599 });
      if (refresh === 'revoked') return Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 });
      return Response.json({ access_token: 'at2', expires_in: 3599 });
    }
    if (u.startsWith('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')) {
      return Response.json({ accounts: [...new Set(profiles.map((p) => p.account))].map((name) => ({ name })) });
    }
    const loc = u.match(/^https:\/\/mybusinessbusinessinformation\.googleapis\.com\/v1\/(accounts\/\d+)\/locations\?/);
    if (loc) return Response.json({ locations: profiles.filter((p) => p.account === loc[1]).map((p) => ({ name: p.location, title: p.title, storefrontAddress: { addressLines: ['1 Main St'], locality: 'Oakland' } })) });
    const one = u.match(/^https:\/\/mybusinessbusinessinformation\.googleapis\.com\/v1\/(locations\/\d+)\?/);
    if (one) { const p = profiles.find((x) => x.location === one[1]); return p ? Response.json({ name: p.location, title: p.title }) : Response.json({ error: { message: 'not found' } }, { status: 404 }); }
    if (/^https:\/\/mybusiness\.googleapis\.com\/v4\/accounts\/\d+\/locations\/\d+\/reviews\?/.test(u)) return Response.json({ reviews: [], totalReviewCount: 12 });
    return Response.json({ error: { message: `unexpected ${u}` } }, { status: 404 });
  };
  return { fetch, calls, emails };
}

async function call(env, g, url, init) {
  const original = globalThis.fetch; globalThis.fetch = g.fetch;
  try { return await worker.fetch(new Request(url, init), env, { waitUntil() {} }); } finally { globalThis.fetch = original; }
}

async function selfTest(env, g, extra = {}) {
  const original = globalThis.fetch; globalThis.fetch = g.fetch; // the failure email goes through the global fetch
  try { return await advanceGoogleSelfTests(env, { fetch: g.fetch, ...extra }); } finally { globalThis.fetch = original; }
}

async function authUrlFrom(env, g) {
  const page = await call(env, g, await googleConnectUrl(env, SUB));
  assert.equal(page.status, 200);
  const html = await page.text();
  const href = html.match(/href="(https:\/\/accounts\.google\.com[^"]+)"/)[1].replaceAll('&amp;', '&');
  return new URL(href);
}

test('the connect page needs a valid link and sends the buyer to Google with the right request', async () => {
  const f = setup(); const g = google();
  assert.equal((await call(f.env, g, `https://menu-made.com/api/google/connect/${SUB}?t=forged.token`)).status, 403);
  const auth = await authUrlFrom(f.env, g);
  assert.equal(auth.searchParams.get('client_id'), 'cid.apps.googleusercontent.com');
  assert.equal(auth.searchParams.get('redirect_uri'), 'https://menu-made.com/api/google/callback');
  assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/business.manage');
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  assert.equal(auth.searchParams.get('prompt'), 'consent');
  assert.ok(auth.searchParams.get('state'));
});

test('a single profile connects, and the refresh token is stored encrypted', async () => {
  const f = setup(); const g = google();
  const state = (await authUrlFrom(f.env, g)).searchParams.get('state');
  const res = await call(f.env, g, `https://menu-made.com/api/google/callback?code=abc&state=${encodeURIComponent(state)}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Corner Cafe/);
  const c = f.connection();
  assert.equal(c.status, 'ACTIVE');
  assert.equal(c.account_name, 'accounts/1');
  assert.equal(c.location_name, 'locations/10');
  assert.ok(!c.refresh_token_enc.includes('rt-secret-value'), 'the plain refresh token is never stored');
  assert.equal(await decryptToken(f.env, c.refresh_token_enc), 'rt-secret-value');
  const exchange = g.calls.find((x) => x.url === 'https://oauth2.googleapis.com/token');
  assert.match(exchange.body, /redirect_uri=https%3A%2F%2Fmenu-made\.com%2Fapi%2Fgoogle%2Fcallback/);
});

test('several profiles: the buyer picks one, and only a signed choice is accepted', async () => {
  const f = setup();
  const g = google({ profiles: [{ account: 'accounts/1', location: 'locations/10', title: 'Corner Cafe' }, { account: 'accounts/2', location: 'locations/20', title: 'Corner Cafe Downtown' }] });
  const state = (await authUrlFrom(f.env, g)).searchParams.get('state');
  const page = await (await call(f.env, g, `https://menu-made.com/api/google/callback?code=abc&state=${encodeURIComponent(state)}`)).text();
  assert.match(page, /Which business is this for/);
  assert.equal(f.connection().status, 'PENDING_LOCATION');
  const id = f.connection().id;
  const token = page.match(/name="t" value="([^"]+)"/)[1];
  const forged = await call(f.env, g, `https://menu-made.com/api/google/location/${id}`, { method: 'POST', body: new URLSearchParams({ t: 'x.y', choice: '1' }) });
  assert.equal(forged.status, 403);
  const ok = await call(f.env, g, `https://menu-made.com/api/google/location/${id}`, { method: 'POST', body: new URLSearchParams({ t: token, choice: '1' }) });
  assert.equal(ok.status, 200);
  assert.equal(f.connection().status, 'ACTIVE');
  assert.equal(f.connection().location_name, 'locations/20');
  assert.equal(f.connection().candidates_json, null);
});

test('a refused permission, a forged state, a cancelled consent or an inactive plan store nothing', async () => {
  const f = setup();
  const narrow = google({ scope: 'openid' });
  const state = (await authUrlFrom(f.env, narrow)).searchParams.get('state');
  const refused = await call(f.env, narrow, `https://menu-made.com/api/google/callback?code=abc&state=${encodeURIComponent(state)}`);
  assert.equal(refused.status, 400);
  assert.match(await refused.text(), /leave <strong>See, edit, create and delete/);
  assert.equal((await call(f.env, narrow, `https://menu-made.com/api/google/callback?code=abc&state=bad.state`)).status, 400);
  assert.equal((await call(f.env, narrow, `https://menu-made.com/api/google/callback?error=access_denied&state=${encodeURIComponent(state)}`)).status, 200);
  assert.equal(f.connection(), null);
  const ended = setup({ status: 'CANCELLED' });
  assert.equal((await call(ended.env, google(), await googleConnectUrl(ended.env, SUB))).status, 403);
});

// The owner presses "Email me the link", opens the emailed link, and goes to Google. Returns the OAuth state.
async function ownerState(f, g) {
  const sent = await call(f.env, g, 'https://menu-made.com/api/google/connect/owner', { method: 'POST' });
  assert.equal(sent.status, 200);
  const email = g.emails.at(-1);
  assert.equal(email.to?.[0] ?? email.to, 'info@menu-made.com');
  const link = email.text.match(/https:\/\/menu-made\.com\/api\/google\/connect\/owner\?t=\S+/)[0];
  const go = await call(f.env, g, link);
  assert.equal(go.status, 302);
  return new URL(go.headers.get('Location')).searchParams.get('state');
}

test('the owner gets a one-hour emailed link instead of a token, and the daily Google check passes read-only', async () => {
  const f = setup(); const g = google();
  const page = await call(f.env, g, 'https://menu-made.com/api/google/connect/owner');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Email me the link/);
  assert.equal((await call(f.env, g, 'https://menu-made.com/api/google/connect/owner?t=forged.token')).status, 403);
  const state = await ownerState(f, g);
  await call(f.env, g, `https://menu-made.com/api/google/callback?code=abc&state=${encodeURIComponent(state)}`);
  assert.equal(f.connection('owner').status, 'ACTIVE');
  const emailsBefore = g.emails.length;

  const t = new Date().toISOString();
  f.DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('gt', 'GOOGLE_API_HEALTH', 'REQUESTED', 'test', ?, ?)`).run(t, t);
  await selfTest(f.env, g);
  const row = f.DB.raw.prepare(`SELECT status, log_json FROM self_tests WHERE id = 'gt'`).get();
  assert.equal(row.status, 'PASSED');
  assert.match(row.log_json, /grant refreshed; 1 profile\(s\) listed; profile \\"Corner Cafe\\" read; reviews endpoint answered \(12 reviews\)/);
  assert.ok(g.calls.filter((c) => !c.url.startsWith('https://oauth2.')).every((c) => c.method === 'GET'), 'nothing is written to Google');
  assert.equal(g.emails.length, emailsBefore, 'a passing check emails nobody');
});

test('a revoked grant fails the check, marks the connection for reconnecting and emails the owner', async () => {
  const f = setup(); const g = google();
  await call(f.env, g, `https://menu-made.com/api/google/callback?code=abc&state=${encodeURIComponent(await ownerState(f, g))}`);
  const revoked = google({ refresh: 'revoked' });
  const t = new Date().toISOString();
  f.DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('gt', 'GOOGLE_API_HEALTH', 'REQUESTED', 'test', ?, ?)`).run(t, t);
  await selfTest(f.env, revoked);
  const row = f.DB.raw.prepare(`SELECT status, error FROM self_tests WHERE id = 'gt'`).get();
  assert.equal(row.status, 'FAILED');
  assert.match(row.error, /invalid_grant|expired or revoked/);
  assert.equal(f.connection('owner').status, 'NEEDS_RECONNECT');
  assert.match(revoked.emails[0].subject, /Google Business Profile check failed/);
});

test('without an owner connection the check fails with the link to connect, and is not scheduled daily', async () => {
  const f = setup(); const g = google();
  await selfTest(f.env, g, { now: new Date('2026-10-29T17:05:00Z') });
  assert.equal(f.DB.raw.prepare(`SELECT COUNT(*) AS n FROM self_tests`).get().n, 0, 'no daily run before the owner connects');
  const t = new Date().toISOString();
  f.DB.raw.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES ('gt', 'GOOGLE_API_HEALTH', 'REQUESTED', 'test', ?, ?)`).run(t, t);
  await selfTest(f.env, g);
  assert.match(f.DB.raw.prepare(`SELECT error FROM self_tests WHERE id = 'gt'`).get().error, /not connected yet: open https:\/\/menu-made\.com\/api\/google\/connect\/owner/);
});
