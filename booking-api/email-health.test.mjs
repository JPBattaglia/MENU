// Stage 12, task 6: the daily email health check (EMAIL_HEALTH) and the render check on every sent email.
// Run: node --no-warnings --test booking-api/email-health.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './test-support/d1.mjs';

const eh = await import('./src/selftest/email-health.js');
const { lintEmail } = await import('./src/lib/email.js');
const NOW = Date.parse('2026-11-01T21:35:00.000Z');

function healthyDns() {
  return {
    'resend._domainkey.updates.menu-made.com TXT': ['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC'],
    'send.updates.menu-made.com TXT': ['v=spf1 include:amazonses.com ~all'],
    '_dmarc.menu-made.com TXT': ['v=DMARC1; p=none;'],
    '_dmarc.ninobattaglia.com TXT': ['v=DMARC1; p=quarantine;'],
    'menu-made.com TXT': ['v=spf1 include:_spf.google.com ~all', 'google-site-verification=abc'],
    'ninobattaglia.com TXT': [],
    'menu-made.com MX': ['1 smtp.google.com.'],
    'ninobattaglia.com MX': ['10 mx.example.net.']
  };
}

function setup({ dns = healthyDns(), domains = [{ id: 'd1', name: 'updates.menu-made.com', status: 'verified' }], records = [{ record: 'DKIM', name: 'resend._domainkey', status: 'verified' }], emails = {}, restricted = false } = {}) {
  const DB = createD1();
  const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (u.host === 'cloudflare-dns.com') {
      const type = u.searchParams.get('type');
      const answers = dns[`${u.searchParams.get('name')} ${type}`] || [];
      return reply(200, { Answer: answers.map((data) => ({ type: type === 'TXT' ? 16 : 15, data: type === 'TXT' ? `"${data}"` : data })) });
    }
    if (restricted) return reply(401, { message: 'restricted_api_key' });
    if (u.pathname === '/domains') return reply(200, { data: domains });
    if (u.pathname === '/domains/d1') return reply(200, { records });
    const m = u.pathname.match(/^\/emails\/(.+)$/);
    if (m) return reply(200, { id: m[1], last_event: emails[m[1]] || 'delivered' });
    return reply(404, {});
  };
  const comm = (template, recipient, status, provider, meta = {}, at = '2026-11-01T10:00:00.000Z') => sql(`INSERT INTO communications (id, created_at, channel, direction, purpose, template_key, subject, recipient, status, provider_message_id, metadata_json) VALUES (?, ?, 'EMAIL', 'OUTBOUND', 'ORDER_DELIVERY', ?, 's', ?, ?, ?, ?)`, crypto.randomUUID(), at, template, recipient, status, provider, JSON.stringify(meta));
  const env = { DB, RESEND_API_KEY: 're_placeholder' };
  const run = async () => {
    sql(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, 'EMAIL_HEALTH', 'REQUESTED', 'test', 'x', 'x')`, crypto.randomUUID());
    await eh.advanceEmailHealthSelfTests(env, { fetch: fetcher, clock: () => NOW });
    const row = DB.raw.prepare(`SELECT status, error, log_json FROM self_tests ORDER BY rowid DESC LIMIT 1`).get();
    return { ...row, notes: JSON.parse(row.log_json || '[]').map((l) => l.note) };
  };
  return { DB, sql, comm, env, run, calls };
}

test('healthy setup passes and notes p=none and the missing root SPF', async () => {
  const s = setup();
  s.comm('delivery_website_v1', 'owner@restaurant.example', 'SENT', 'em_1');
  s.comm('delivery_website_v1', 'delivered@resend.dev', 'SENT', 'em_2');
  const r = await s.run();
  assert.equal(r.status, 'PASSED', r.error);
  assert.ok(r.notes.some((n) => /verified, every record verified/.test(n)));
  assert.ok(r.notes.some((n) => /menu-made.com DMARC p=none/.test(n)));
  assert.ok(r.notes.some((n) => /ninobattaglia.com has no SPF/.test(n)));
  assert.ok(r.notes.some((n) => /latest 1 customer emails delivered/.test(n)));
  assert.ok(!s.calls.some((u) => u.includes('em_2')), 'self-test buyer emails are not sampled');
});

test('unverified domain, missing DKIM, two SPF records, no DMARC and no MX each fail', async () => {
  const dns = healthyDns();
  delete dns['resend._domainkey.updates.menu-made.com TXT'];
  dns['menu-made.com TXT'] = ['v=spf1 a ~all', 'v=spf1 include:x ~all'];
  delete dns['_dmarc.ninobattaglia.com TXT'];
  delete dns['ninobattaglia.com MX'];
  const s = setup({ dns, domains: [{ id: 'd1', name: 'updates.menu-made.com', status: 'pending' }] });
  const r = await s.run();
  assert.equal(r.status, 'FAILED');
  for (const want of [/is pending, not verified/, /no DKIM key/, /menu-made.com has 2 SPF records/, /ninobattaglia.com has 0 DMARC/, /ninobattaglia.com has no mail server/]) assert.match(r.error, want);
});

test('a record Resend reports as not verified fails', async () => {
  const s = setup({ records: [{ record: 'SPF', name: 'send', status: 'failed' }] });
  const r = await s.run();
  assert.equal(r.status, 'FAILED');
  assert.match(r.error, /SPF send is failed/);
});

test('render problems, send failures and bounces fail', async () => {
  const s = setup({ emails: { em_b: 'bounced' } });
  s.comm('delivery_menu_qr_v1', 'delivered@resend.dev', 'SENT', 'em_x', { lint: ['undefined'] });
  s.comm('merch_shipped_v1', 'buyer@example.com', 'FAILED', null, {}, '2026-11-01T20:00:00.000Z');
  s.comm('delivery_website_v1', 'owner@example.com', 'SENT', 'em_b');
  const r = await s.run();
  assert.equal(r.status, 'FAILED');
  assert.match(r.error, /Templates: delivery_menu_qr_v1 \(undefined\)/);
  assert.match(r.error, /1 email failed to send/);
  assert.match(r.error, /delivery_website_v1 bounced/);
});

test('a send-only Resend key falls back to DNS without failing', async () => {
  const s = setup({ restricted: true });
  s.comm('delivery_website_v1', 'owner@example.com', 'SENT', 'em_1');
  const r = await s.run();
  assert.equal(r.status, 'PASSED', r.error);
  assert.ok(r.notes.some((n) => /can only send/.test(n)));
});

test('daily slot: 21:30-21:49 UTC, once', async () => {
  const s = setup();
  await eh.maybeScheduleDaily(s.env, new Date('2026-11-01T21:10:00Z'));
  await eh.maybeScheduleDaily(s.env, new Date('2026-11-01T21:31:00Z'));
  await eh.maybeScheduleDaily(s.env, new Date('2026-11-01T21:36:00Z'));
  assert.equal(s.DB.raw.prepare(`SELECT COUNT(*) AS n FROM self_tests WHERE kind = 'EMAIL_HEALTH'`).get().n, 1);
});

test('lintEmail finds leftovers in what the reader sees, not in markup', () => {
  assert.deepEqual(lintEmail({ subject: 'Your menu', html: '<p data-x="undefined">Hi Ana</p><style>.a{}</style>', text: 'Hi Ana' }), []);
  assert.deepEqual(lintEmail({ subject: 'Hi undefined', html: '<p>Total: NaN</p>', text: 'Plan: [object Object] ${name} {{x}} null.' }).sort(), ['NaN', '[object Object]', 'null', 'undefined', 'unfilled ${...}', 'unfilled {{...}}'].sort());
  assert.deepEqual(lintEmail({ subject: ' ', html: '', text: '' }), ['empty subject']);
});
