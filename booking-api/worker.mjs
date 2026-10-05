const SESSIONS = new Set(['Menu + QR consultation (30 minutes)', 'Website + visibility consultation (30 minutes)', 'Project planning (30 minutes)']);
const SERVICES = new Set(['Online Menu + QR', 'Conversion Fix', 'Google Visibility', 'Accessibility Upgrade', 'Other project']);
const TIMES = new Set(['9:00 AM', '10:00 AM', '11:00 AM', '1:00 PM', '2:00 PM', '3:00 PM']);
const ORIGINS = new Set(['https://menu-made.com', 'https://www.menu-made.com']);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Empty body');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); throw new Error('Body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function validate(data, now = new Date()) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.type === 'inquiry') {
    const clean = { type: 'inquiry' };
    for (const [key, limit] of Object.entries({ name: 100, email: 150, business: 150, notes: 1200, service: 100, requestId: 36 })) {
      if (typeof data[key] !== 'string' || data[key].length > limit) return null;
      clean[key] = data[key].trim();
      if (key !== 'notes' && /[\r\n\x00]/.test(clean[key])) return null;
    }
    if (!clean.name || !clean.notes || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email) || !SERVICES.has(clean.service)) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean.requestId)) return null;
    return clean;
  }
  if (data.type !== undefined) return null;
  const limits = { name: 100, email: 150, business: 150, notes: 1200, session: 100, date: 10, time: 10, timezone: 100, requestId: 36 };
  const clean = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof data[key] !== 'string' || data[key].length > limit) return null;
    clean[key] = data[key].trim();
    if (key !== 'notes' && /[\r\n\x00]/.test(clean[key])) return null;
  }
  if (!clean.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean.requestId)) return null;
  if (!SESSIONS.has(clean.session) || !TIMES.has(clean.time)) return null;
  const date = new Date(`${clean.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== clean.date) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: clean.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = key => parts.find(item => item.type === key).value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    if (clean.date <= today) return null;
  } catch { return null; }
  if (date.getTime() > now.getTime() + 366 * 86400000) return null;
  return clean;
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export async function deliver(env, row) {
  const data = JSON.parse(row.payload);
  const inquiry = data.type === 'inquiry';
  const details = inquiry ? `Service: ${data.service}\nName: ${data.name}\nEmail: ${data.email}\nBusiness: ${data.business || 'Not provided'}\nProject details: ${data.notes}\nReference: ${row.id}` : `Session: ${data.session}\nPreferred date: ${data.date}\nPreferred time: ${data.time}\nTimezone: ${data.timezone}\nName: ${data.name}\nEmail: ${data.email}\nBusiness: ${data.business || 'Not provided'}\nNotes: ${data.notes || 'None'}\nReference: ${row.id}`;
  for (const kind of ['owner', 'customer']) {
    if (row[`${kind}_sent`]) continue;
    // Resend deduplicates concurrent deliveries; sent flags retain that protection after its retry window.
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `booking/${row.id}/${kind}` },
        body: JSON.stringify({
          from: env.BOOKING_FROM,
          to: [kind === 'owner' ? env.BOOKING_TO : data.email],
          reply_to: kind === 'owner' ? data.email : (env.BOOKING_REPLY_TO || env.BOOKING_TO),
          subject: inquiry ? (kind === 'owner' ? `MENU-MADE project inquiry — ${data.service}` : 'MENU-MADE — project inquiry received') : kind === 'owner' ? `MENU-MADE session request — ${data.date}` : 'MENU-MADE — session request received',
          text: kind === 'owner' ? details : inquiry ? `Hello ${data.name},\n\nThanks for telling us about your project. Your inquiry was received, and we’ll reply to discuss the next steps.\n\nService: ${data.service}\nReference: ${row.id}\n\nMENU-MADE` : `Hello ${data.name},\n\nYour session request was received. We’ll reply to confirm availability; this is not a confirmed appointment.\n\nSession: ${data.session}\nPreferred date: ${data.date}\nPreferred time: ${data.time} (${data.timezone})\nReference: ${row.id}\n\nMENU-MADE`
        })
      });
      if (!response.ok) throw new Error('Email provider rejected delivery');
      await env.DB.prepare(`UPDATE mm_booking_requests SET ${kind}_sent = 1 WHERE id = ?`).bind(row.id).run();
    } catch {
      // Do not log personal details or provider responses. Durable requests remain available for retry.
      console.error(`Booking ${kind} notification pending`);
    }
  }
  await env.DB.prepare('UPDATE mm_booking_requests SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
}

export default {
  async fetch(request, env, ctx) {
    if (!['/api/booking', '/api/inquiry'].includes(new URL(request.url).pathname)) return json({ ok: false }, 404);
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (!ORIGINS.has(request.headers.get('Origin'))) return json({ ok: false }, 403);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ ok: false }, 415);
    if (!env.DB || !env.RESEND_API_KEY || !env.BOOKING_FROM || !env.BOOKING_TO || !env.BOOKING_RATE_SALT) return json({ ok: false }, 503);
    let raw;
    try { raw = await readBody(request); } catch { return json({ ok: false }, 400); }
    if (typeof raw?.website !== 'string' || raw.website !== '') return json({ ok: false }, 400);
    if (new URL(request.url).pathname === '/api/inquiry' && raw.type !== 'inquiry') return json({ ok: false }, 400);
    const data = validate(raw);
    if (!data) return json({ ok: false }, 400);
    const payload = JSON.stringify(data);
    try {
      const existing = await env.DB.prepare('SELECT * FROM mm_booking_requests WHERE id = ?').bind(data.requestId).first();
      if (existing) return existing.payload === payload ? json({ ok: true, requestId: existing.id }) : json({ ok: false }, 409);
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip) return json({ ok: false }, 403);
      const now = Math.floor(Date.now() / 1000);
      const ipHash = await hash(`${env.BOOKING_RATE_SALT}:${ip}`);
      // Rate checks and insertion occur in one SQL statement to prevent concurrent bypass.
      const result = await env.DB.prepare(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at)
        SELECT ?, ?, ?, ? WHERE
        (SELECT COUNT(*) FROM mm_booking_requests WHERE ip_hash = ? AND created_at > ?) < 5
        AND (SELECT COUNT(*) FROM mm_booking_requests WHERE created_at > ?) < 100
        ON CONFLICT(id) DO NOTHING`).bind(data.requestId, payload, ipHash, now, ipHash, now - 3600, now - 3600).run();
      if (!result.meta.changes) {
        const concurrent = await env.DB.prepare('SELECT * FROM mm_booking_requests WHERE id = ?').bind(data.requestId).first();
        if (concurrent) return concurrent.payload === payload ? json({ ok: true, requestId: concurrent.id }) : json({ ok: false }, 409);
        return json({ ok: false }, 429);
      }
      ctx.waitUntil(deliver(env, { id: data.requestId, payload, owner_sent: 0, customer_sent: 0 }).catch(() => console.error('Booking notification retry required')));
      return json({ ok: true, requestId: data.requestId }, 201);
    } catch {
      console.error('Booking persistence failed');
      return json({ ok: false }, 503);
    }
  },
  async scheduled(_event, env, ctx) {
    if (!env.DB || !env.RESEND_API_KEY || !env.BOOKING_FROM || !env.BOOKING_TO) return;
    ctx.waitUntil((async () => {
      const cutoff = Math.floor(Date.now() / 1000) - 20 * 3600;
      const rows = await env.DB.prepare('SELECT * FROM mm_booking_requests WHERE (owner_sent = 0 OR customer_sent = 0) AND created_at > ? AND attempts < 12 ORDER BY created_at LIMIT 10').bind(cutoff).all();
      for (const row of rows.results) await deliver(env, row);
    })());
  }
};
