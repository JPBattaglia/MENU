import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validate, deliver } from './worker.mjs';
const data = () => ({ requestId: crypto.randomUUID(), name: 'JP', email: 'jp@example.com', business: 'Cafe', notes: 'A menu', session: 'Menu + QR consultation (30 minutes)', date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), time: '9:00 AM', timezone: 'America/Los_Angeles', website: '' });
const request = (body, overrides = {}) => new Request('https://menu-made.com/api/booking', { method: 'POST', headers: { Origin: 'https://menu-made.com', 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', ...overrides }, body: JSON.stringify(body) });
function fixture() {
  const rows = new Map(); let fail = false; let insertions = 0;
  const env = { RESEND_API_KEY: 'test', BOOKING_FROM: 'bookings@menu-made.com', BOOKING_TO: 'info@menu-made.com', BOOKING_RATE_SALT: 'test', DB: { prepare(sql) { let args; return { bind(...values) { args = values; return this; }, async first() { if (fail) throw Error('DB down'); return rows.get(args[0]) || null; }, async run() { if (fail) throw Error('DB down'); if (sql.startsWith('INSERT')) { const [id, payload] = args; if (rows.has(id)) return { meta: { changes: 0 } }; rows.set(id, { id, payload, owner_sent: 0, customer_sent: 0 }); insertions++; return { meta: { changes: 1 } }; } if (/SET (owner|customer)_sent/.test(sql)) rows.get(args[0])[/SET (owner|customer)_sent/.exec(sql)[1] + '_sent'] = 1; return { meta: { changes: 1 } }; } }; } } };
  const pending = []; const ctx = { waitUntil(p) { pending.push(p); } };
  return { env, ctx, rows, pending, fail() { fail = true; }, get insertions() { return insertions; } };
}
test('validates sessions, date rollover, timezone, headers, limits', () => {
  assert.ok(validate(data()));
  for (const patch of [{ date: '2026-02-30' }, { date: '2000-01-01' }, { timezone: 'wrong' }, { time: '8:00 AM' }, { session: 'Fake' }, { name: ' ' }, { email: 'bad' }, { email: 'jp@example.com\r\nBcc:x@y.com' }, { notes: 'x'.repeat(1201) }]) assert.equal(validate({ ...data(), ...patch }), null);
});
test('rejects cross-origin requests, missing config, oversized bodies and honeypots', async () => {
  const f = fixture();
  assert.equal((await worker.fetch(request(data(), { Origin: 'https://evil.example' }), f.env, f.ctx)).status, 403);
  assert.equal((await worker.fetch(request(data()), {}, f.ctx)).status, 503);
  assert.equal((await worker.fetch(request({ ...data(), notes: 'x'.repeat(9000) }), f.env, f.ctx)).status, 400);
  assert.equal((await worker.fetch(request({ ...data(), website: 'spam' }), f.env, f.ctx)).status, 400);
  assert.equal(f.insertions, 0);
});
test('persists once, deduplicates retry, refuses ID reuse with changed content', async () => {
  const f = fixture(); const d = data(); const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  try {
    assert.equal((await worker.fetch(request(d), f.env, f.ctx)).status, 201);
    await Promise.all(f.pending);
    assert.equal((await worker.fetch(request(d), f.env, f.ctx)).status, 200);
    assert.equal((await worker.fetch(request({ ...d, notes: 'Changed' }), f.env, f.ctx)).status, 409);
    assert.equal(f.insertions, 1);
  } finally { globalThis.fetch = previous; }
});
test('DB failure cannot produce success', async () => {
  const f = fixture(); f.fail();
  assert.equal((await worker.fetch(request(data()), f.env, f.ctx)).status, 503);
});
test('email failure leaves durable request and retries only unsent notification', async () => {
  const f = fixture(); const d = data(); const previous = globalThis.fetch; const emails = [];
  globalThis.fetch = async (_url, options) => { const body = JSON.parse(options.body); emails.push(body); return new Response('{}', { status: body.to[0] === 'info@menu-made.com' ? 503 : 200 }); };
  try {
    assert.equal((await worker.fetch(request(d), f.env, f.ctx)).status, 201);
    await Promise.all(f.pending);
    assert.equal(f.rows.get(d.requestId).customer_sent, 1);
    assert.equal(f.rows.get(d.requestId).owner_sent, 0);
    globalThis.fetch = async (_url, options) => { emails.push(JSON.parse(options.body)); return new Response('{}'); };
    await deliver(f.env, f.rows.get(d.requestId));
    assert.equal(emails.length, 3);
    assert.equal(emails[2].reply_to, d.email);
    assert.equal(emails[2].from, f.env.BOOKING_FROM);
  } finally { globalThis.fetch = previous; }
});
