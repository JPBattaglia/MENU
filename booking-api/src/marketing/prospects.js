// Marketing (Nov 1, 2026, owner request): find food and drink businesses that are missing something Menu-made sells.
// .github/workflows/prospects.yml runs tools/prospects/find.mjs weekly: OpenStreetMap businesses in San Francisco and
// nearby cities (chains skipped), each website checked for a PDF or photo menu, no menu, no phone layout, a broken
// site or no tap-to-call link. The job posts its rows here over its GitHub OIDC token (no secret) because the repo is
// public: names and contact emails never appear in its logs or downloads.
//
//   POST /api/system/prospects   (OIDC, audience menu-made-prospects, schedule or manual runs on master)
//                                body: { run_id, prospects: [{ id, name, kind, cuisine, city, address, phone, website,
//                                        email, email_source, gaps: [...], menu_url, offer_code, score }] }
//
// A re-found business keeps its outreach status (DRAFTED, SENT, OPTED_OUT ...); only what was found is refreshed.
// Emails go out as Gmail drafts the owner sends himself (Resend's policy forbids cold outreach, and Resend carries
// every customer email), 20 to 25 twice a week (Monday and Thursday; owner, Nov 5, 2026).
import { nowIso } from "../lib/http.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";

const AUDIENCE = "menu-made-prospects";
const WORKFLOW = "JPBattaglia/MENU/.github/workflows/prospects.yml@refs/heads/master";
const OFFERS = new Set(["ONLINE_MENU_QR", "WEBSITE_PACKAGE", "CONVERSION_FIX"]);
const GAPS = new Set(["no_website", "menu_pdf", "menu_image", "menu_missing", "no_phone_layout", "site_down", "no_https", "no_tap_to_call"]);
// Existing clients are never prospected.
const CLIENT_HOSTS = ["myhappydonut.com", "fahyspub.com", "menu-made.com", "ninobattaglia.com"];
const MAX_ROWS = 400; // per request; the job sends larger runs in pieces

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const EMAIL = /^[^\s@<>()]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;

// One cleaned row, or null. Exported for the tests.
function prospectRow(p) {
  const id = str(p?.id, 40);
  const name = str(p?.name, 160);
  if (!id || !/^(node|way|relation)\/\d{1,15}$/.test(id) || !name) return null;
  const website = str(p.website, 300);
  if (website && CLIENT_HOSTS.some((h) => { try { return new URL(website).hostname.replace(/^www\./, "").endsWith(h); } catch { return false; } })) return null;
  const email = str(p.email, 254)?.toLowerCase() || null;
  const gaps = (Array.isArray(p.gaps) ? p.gaps : []).filter((g) => GAPS.has(g)).slice(0, 8);
  return {
    id, name, kind: str(p.kind, 40), cuisine: str(p.cuisine, 80), city: str(p.city, 80), address: str(p.address, 200),
    phone: str(p.phone, 40), website, email: email && EMAIL.test(email) ? email : null,
    email_source: ["osm", "mailto", "page"].includes(p.email_source) ? p.email_source : null,
    gaps_json: JSON.stringify(gaps), menu_url: str(p.menu_url, 300),
    offer_code: OFFERS.has(p.offer_code) ? p.offer_code : null,
    score: Number.isInteger(p.score) ? Math.max(0, Math.min(100, p.score)) : 0
  };
}

async function handleProspects(request, env) {
  const auth = await verifyRenderer(request, env, { audience: AUDIENCE, workflow: WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.DB) return json({ ok: false, error: "No database" }, 503);
  const body = await request.json().catch(() => null);
  const input = Array.isArray(body?.prospects) ? body.prospects : null;
  if (!input || input.length > MAX_ROWS) return json({ ok: false, error: `Expected { prospects: [...] } with at most ${MAX_ROWS} rows` }, 400);
  const rows = input.map(prospectRow).filter(Boolean);
  const t = nowIso();
  const sql = `INSERT INTO prospects (id, name, kind, cuisine, city, address, phone, website, email, email_source, gaps_json, menu_url,
      offer_code, score, status, found_at, checked_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, cuisine = excluded.cuisine, city = excluded.city,
      address = excluded.address, phone = excluded.phone, website = excluded.website,
      email = COALESCE(excluded.email, prospects.email), email_source = COALESCE(excluded.email_source, prospects.email_source),
      gaps_json = excluded.gaps_json, menu_url = excluded.menu_url, offer_code = excluded.offer_code, score = excluded.score,
      checked_at = excluded.checked_at, updated_at = excluded.updated_at`;
  // One batch counts as one query against the 50-per-invocation limit.
  if (rows.length) {
    await env.DB.batch(rows.map((r) => env.DB.prepare(sql).bind(r.id, r.name, r.kind, r.cuisine, r.city, r.address, r.phone, r.website,
      r.email, r.email_source, r.gaps_json, r.menu_url, r.offer_code, r.score, t, t, t)));
  }
  return json({ ok: true, stored: rows.length, rejected: input.length - rows.length });
}

// ---------- Weekly drafts (.github/workflows/prospect-drafts.yml) ----------
// The job takes the week's batch, places branded drafts in the Drafts folder of info@menu-made.com (iCloud Mail, the
// owner reviews and taps Send), then reports what it did and what it saw in Sent and the inbox:
//   POST /api/system/prospects/batch   { limit }  -> NEW prospects with an email, menu-file prospects first (they get their
//                                                    own menu preview; owner, Nov 5, 2026), then best score, one per email,
//                                                    never an address already drafted, sent, replied or opted out
//   POST /api/system/prospects/status  { updates: [{ id?, email?, status }] }  SKIPPED | BOUNCED | DRAFTED | SENT | REPLIED | OPTED_OUT
const DRAFTS_AUDIENCE = "menu-made-prospect-drafts";
const DRAFTS_WORKFLOW = "JPBattaglia/MENU/.github/workflows/prospect-drafts.yml@refs/heads/master";
const NEXT = { NEW: ["NEW"], SKIPPED: ["NEW"], BOUNCED: ["NEW", "DRAFTED", "SENT"], DRAFTED: ["NEW", "DRAFTED"], SENT: ["NEW", "DRAFTED"], REPLIED: ["NEW", "DRAFTED", "SENT"], OPTED_OUT: ["NEW", "DRAFTED", "SENT", "REPLIED", "SKIPPED"] };

async function handleProspectBatch(request, env) {
  const auth = await verifyRenderer(request, env, { audience: DRAFTS_AUDIENCE, workflow: DRAFTS_WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const body = await request.json().catch(() => ({}));
  // { ids }: rows already DRAFTED, to rebuild drafts still in the owner's Drafts folder.
  if (Array.isArray(body?.ids)) {
    const ids = body.ids.filter((id) => typeof id === "string").slice(0, 50);
    if (!ids.length) return json({ ok: true, prospects: [] });
    const rows = (await env.DB.prepare(`SELECT id, name, kind, cuisine, city, website, email, gaps_json, menu_url, offer_code, score FROM prospects
        WHERE status = 'DRAFTED' AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results || [];
    return json({ ok: true, prospects: rows });
  }
  const limit = Math.max(1, Math.min(50, Number(body?.limit) || 25));
  const rows = (await env.DB.prepare(`
      SELECT id, name, kind, cuisine, city, website, email, gaps_json, menu_url, offer_code, score FROM prospects p
      WHERE status = 'NEW' AND email IS NOT NULL AND offer_code IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM prospects q WHERE q.email = p.email AND q.status != 'NEW')
      ORDER BY (offer_code = 'ONLINE_MENU_QR' AND menu_url IS NOT NULL AND (gaps_json LIKE '%menu_pdf%' OR gaps_json LIKE '%menu_image%')) DESC,
        score DESC, id LIMIT ?`).bind(limit * 3).all()).results || [];
  const seen = new Set(); const batch = [];
  for (const r of rows) { if (seen.has(r.email)) continue; seen.add(r.email); batch.push(r); if (batch.length === limit) break; }
  return json({ ok: true, prospects: batch });
}

// A SENT row may carry the message's own date (sent_at) so day-3 follow-ups count from the real send, not the sync.
function stampTime(u, t) {
  if (u.status !== "SENT" || typeof u.sent_at !== "string") return t;
  const at = Date.parse(u.sent_at);
  return Number.isFinite(at) && at <= Date.parse(t) && at > Date.parse(t) - 60 * 86400000 ? new Date(at).toISOString() : t;
}

async function handleProspectStatus(request, env) {
  const auth = await verifyRenderer(request, env, { audience: DRAFTS_AUDIENCE, workflow: DRAFTS_WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const body = await request.json().catch(() => null);
  const updates = Array.isArray(body?.updates) ? body.updates.slice(0, 500) : null;
  if (!updates) return json({ ok: false, error: "Expected { updates: [...] }" }, 400);
  const t = nowIso(); const statements = [];
  for (const u of updates) {
    const from = NEXT[u?.status]; if (!from) continue;
    const via = u.status === "SENT" && u.via === "getmenumade" ? ", sent_via = 'getmenumade'" : "";
    const stamp = (u.status === "DRAFTED" ? ", drafted_at = COALESCE(drafted_at, ?)" : u.status === "SENT" ? ", sent_at = ?" : "") + via;
    const where = typeof u.id === "string" ? "id = ?" : typeof u.email === "string" ? "email = ?" : null; if (!where) continue;
    const key = u.id || String(u.email).toLowerCase();
    // Browser-confirmed gaps (verify.mjs) replace the finder's, so the email states only what was confirmed.
    const gaps = Array.isArray(u.gaps) ? u.gaps.filter((g) => GAPS.has(g)).slice(0, 8) : null;
    const offer = OFFERS.has(u.offer_code) ? u.offer_code : null;
    const extra = gaps && offer ? ", gaps_json = ?, offer_code = ?, notes = ?" : "";
    const extraValues = gaps && offer ? [JSON.stringify(gaps), offer, `browser-checked ${t.slice(0, 10)}`] : [];
    if (u.status === "NEW" && !extra) continue;
    statements.push(env.DB.prepare(`UPDATE prospects SET status = ?, updated_at = ?${stamp}${extra} WHERE ${where} AND status IN (${from.map(() => "?").join(",")})`)
      .bind(u.status, t, ...(u.status === "DRAFTED" || u.status === "SENT" ? [stampTime(u, t)] : []), ...extraValues, key, ...from));
  }
  let changed = 0;
  if (statements.length) for (const r of await env.DB.batch(statements)) changed += r?.meta?.changes || 0;
  return json({ ok: true, changed });
}


// ---------- Auto-sending from jp@getmenumade.com (owner decision, Nov 5, 2026) ----------
// A new sending domain has to warm up: a few emails a day, rising, weekdays only, counted from the first auto-send.
//   POST /api/system/prospects/send-plan  {}  -> { day, cap, sent_today, left, warmup_done }
// Business day 1 to 5: 3 a day; 6 to 10: 6; 11 to 15: 8; from day 16 (warm-up over): 10 a day, about 50 a week,
// which replaces the Monday/Thursday iCloud drafts (the owner's pace of 40 to 50 a week). Follow-ups count too.
const WARMUP = [[5, 3], [10, 6], [15, 8]];
const STEADY_CAP = 10;
const pacificDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
function businessDays(fromDay, toDay) {
  let n = 0;
  for (let d = new Date(`${fromDay}T12:00:00Z`); d <= new Date(`${toDay}T12:00:00Z`); d = new Date(d.getTime() + 86400000)) if (d.getUTCDay() % 6) n++;
  return Math.max(1, n);
}
function sendCap(day) { for (const [last, cap] of WARMUP) if (day <= last) return cap; return STEADY_CAP; }

async function sendPlan(env, now = Date.now()) {
  const first = await env.DB.prepare(`SELECT MIN(sent_at) AS at FROM prospects WHERE sent_via = 'getmenumade'`).first("at");
  const today = pacificDay(now);
  const day = first ? businessDays(pacificDay(Date.parse(first)), today) : 1;
  const since = new Date(now - 36 * 3600000).toISOString();
  const recent = (await env.DB.prepare(`SELECT sent_at, followup_drafted_at FROM prospects WHERE sent_via = 'getmenumade' AND (sent_at >= ? OR followup_drafted_at >= ?)`).bind(since, since).all()).results || [];
  let sentToday = 0;
  for (const r of recent) { if (r.sent_at && pacificDay(Date.parse(r.sent_at)) === today) sentToday++; if (r.followup_drafted_at && pacificDay(Date.parse(r.followup_drafted_at)) === today) sentToday++; }
  const cap = sendCap(day);
  return { day, cap, sent_today: sentToday, left: Math.max(0, cap - sentToday), warmup_done: day > WARMUP.at(-1)[0] && !!first };
}

async function handleSendPlan(request, env, { now = Date.now() } = {}) {
  const auth = await verifyRenderer(request, env, { audience: DRAFTS_AUDIENCE, workflow: DRAFTS_WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  return json({ ok: true, ...(await sendPlan(env, now)) });
}

export { sendPlan, handleSendPlan, businessDays, sendCap };
export { AUDIENCE as PROSPECTS_AUDIENCE, WORKFLOW as PROSPECTS_WORKFLOW, DRAFTS_AUDIENCE, DRAFTS_WORKFLOW, handleProspects, handleProspectBatch, handleProspectStatus, prospectRow };
