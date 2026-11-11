// Holiday Menu outreach (owner, Nov 10, 2026: "promote it through the emails", to new prospects and the ones already
// emailed). Through the holiday season the Monday and Thursday prospect drafts (tools/prospects/drafts.mjs) are holiday
// emails instead of the regular first email: one per business, ever, each with the menu from their site shown in the
// holiday designs when it can be read. Prospects already emailed come first, then new ones by score. Anyone who
// replied, opted out or bounced is never included.
//
//   POST /api/system/prospects/holiday  {}            -> { ok, season, occasion, prospects: [...] }   who is due (up to 50)
//                                       { id }        -> { ok, url } | { ok:false, skip }             their holiday preview
//                                       { mark: [] }  -> { ok, changed }                              drafts made
// Same OIDC audience and workflow as the other prospect endpoints.
import { nowIso } from "../lib/http.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";
import { menuColors } from "../producers/menu-qr/claude-reader.js";
import { DRAFTS_AUDIENCE, DRAFTS_WORKFLOW } from "./prospects.js";
import { readProspectMenu, PREVIEW_DAYS } from "./demo-menu.js";
import { storeMenuDesigns, viewUrl } from "./public-preview.js";
import { holidayEndsOn, holidayOnSale, seasonYear } from "../checkout/holiday.js";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const daysFromNow = (days, now) => new Date(now + days * 86400000).toISOString();
// A prospect emailed in the last few days isn't emailed again so soon.
const RECENT_DAYS = 5;

// The season the emails run in: from Nov 1 to Dec 20 (time left to order and print). Christmas until Dec 20, then
// nothing; the preview shows Christmas designs first while Christmas is on sale.
function holidaySeason(now = Date.now()) {
  const year = seasonYear(now);
  const start = Date.parse(`${year}-11-01T00:00:00-07:00`);
  const end = Date.parse(`${year}-12-20T23:59:59-08:00`);
  return now >= start && now <= end;
}
const currentOccasion = (now) => (holidayOnSale("christmas", now) ? "christmas" : "newyear");

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function dueProspects(env, now, limit) {
  const recent = daysFromNow(-RECENT_DAYS, now);
  const { results = [] } = await env.DB.prepare(`
      SELECT id, name, city, email, website, status, sent_at, menu_url, opened_on FROM prospects
      WHERE email IS NOT NULL AND holiday_drafted_at IS NULL
        AND (status = 'SENT' AND (sent_at IS NULL OR sent_at <= ?) OR status = 'NEW')
      ORDER BY CASE status WHEN 'SENT' THEN 0 ELSE 1 END, sent_at, score DESC, id
      LIMIT ?`).bind(recent, limit).all();
  return results.map((r) => ({ ...r, contacted: r.status === "SENT" }));
}

// Their regular menu in the holiday designs. No file is kept: at checkout they upload the holiday menu itself, and
// the paid menu takes the design they picked from this preview (public-preview.js menuPreviewChoice).
async function holidayPreview(env, p, now, fetcher) {
  const occasion = currentOccasion(now);
  const existing = await env.DB.prepare(`SELECT d.token FROM prospect_demos d WHERE d.prospect_id = ? AND d.kind = 'holiday' AND d.status = 'READY' AND d.expires_at > ? ORDER BY d.created_at DESC LIMIT 1`)
    .bind(p.id, daysFromNow(7, now)).first();
  if (existing) return { ok: true, url: viewUrl(existing.token), reused: true };
  if (!p.menu_url) return { ok: false, skip: "no menu link" };
  if (!env.ANTHROPIC_API_KEY) return { ok: false, skip: "menu reading is not configured" };
  const token = newToken();
  const t = new Date(now).toISOString();
  // Up to three weeks, never past the holiday.
  const end = Date.parse(`${holidayEndsOn(occasion, now)}T23:59:59-08:00`);
  const expires = new Date(Math.min(now + PREVIEW_DAYS * 86400000, end)).toISOString();
  try {
    const read = await readProspectMenu(p.menu_url, env, fetcher);
    await storeMenuDesigns(env, token, { business: p.name, menu: read.menu, colors: menuColors(read.menu), custom: {}, customized: 0, prospect: true, occasion });
    const itemCount = read.extraction?.item_count ?? null;
    await env.DB.prepare(`INSERT INTO menu_previews (token, request_id, email, business, ip_hash, campaign, status, item_count, created_at, expires_at, occasion) VALUES (?, ?, ?, ?, '', 'prospect', 'READY', ?, ?, ?, ?)`)
      .bind(token, crypto.randomUUID(), String(p.email || "").toLowerCase(), p.name, itemCount, t, expires, occasion).run();
    await env.DB.prepare(`INSERT INTO prospect_demos (token, prospect_id, status, kind, item_count, created_at, expires_at) VALUES (?, ?, 'READY', 'holiday', ?, ?, ?)`)
      .bind(token, p.id, itemCount, t, expires).run();
    return { ok: true, url: viewUrl(token) };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await env.DB.prepare(`INSERT INTO prospect_demos (token, prospect_id, status, kind, error, created_at, expires_at) VALUES (?, ?, 'FAILED', 'holiday', ?, ?, ?)`)
      .bind(token, p.id, reason, t, t).run();
    return { ok: false, skip: reason };
  }
}

async function handleHolidayOutreach(request, env, { now = Date.now(), fetcher = fetch } = {}) {
  const auth = await verifyRenderer(request, env, { audience: DRAFTS_AUDIENCE, workflow: DRAFTS_WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.DB || !env.ASSETS) return json({ ok: false, error: "Storage is not available" }, 503);
  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body?.mark)) {
    const ids = body.mark.filter((id) => typeof id === "string").slice(0, 50);
    if (!ids.length) return json({ ok: true, changed: 0 });
    const t = nowIso();
    // One holiday email each, ever; it also stands in for the regular day-3 follow-up.
    const result = await env.DB.prepare(`UPDATE prospects SET holiday_drafted_at = ?, followup_drafted_at = COALESCE(followup_drafted_at, ?), status = CASE WHEN status = 'NEW' THEN 'DRAFTED' ELSE status END, updated_at = ?
        WHERE holiday_drafted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).bind(t, t, t, ...ids).run();
    return json({ ok: true, changed: result?.meta?.changes || 0 });
  }
  if (typeof body?.id === "string") {
    const p = await env.DB.prepare(`SELECT id, name, email, status, menu_url FROM prospects WHERE id = ?`).bind(body.id).first();
    if (!p) return json({ ok: false, skip: "unknown prospect" }, 404);
    if (["REPLIED", "OPTED_OUT", "BOUNCED"].includes(p.status)) return json({ ok: false, skip: "not to be emailed" });
    return json(await holidayPreview(env, p, now, fetcher));
  }
  const season = holidaySeason(now);
  const limit = Math.max(1, Math.min(50, Number(body?.limit) || 25));
  return json({ ok: true, season, occasion: currentOccasion(now), prospects: season ? await dueProspects(env, now, limit) : [] });
}

export { handleHolidayOutreach, holidaySeason };
