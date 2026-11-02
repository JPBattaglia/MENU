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
// every customer email), 20 to 25 a week.
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

export { AUDIENCE as PROSPECTS_AUDIENCE, WORKFLOW as PROSPECTS_WORKFLOW, handleProspects, prospectRow };
