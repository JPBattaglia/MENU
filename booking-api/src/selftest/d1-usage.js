// Stage 12, task 7: D1 usage against the free plan's daily limits (D1_USAGE). .github/workflows/d1-usage.yml reads
// today's rows read and written for every D1 database on the account (Menu-made's and the Nino shop's share the
// limits) from Cloudflare's analytics once an hour and posts them here over GitHub OIDC (no secret).
//   - One self_tests row per UTC day (id d1-usage-<date>, updated each hour): PASSED, or FAILED when near the limit or
//     when the numbers couldn't be read. It's on the coverage map with the other shared systems.
//   - Near the limit (half used, or on pace for 80% after 6 hours): one email to the owner a day, with one action.
//
//   POST /api/system/d1-usage   (OIDC, audience menu-made-d1-usage, schedule or manual runs on master)
//                               body: { date, run_id, error, databases: [{ id, rows_read, rows_written }] }
import { nowIso } from "../lib/http.js";
import { alertOnce } from "../lib/alert-once.js";
import { brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { ownerEmailAddress } from "../lib/config.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";

const KIND = "D1_USAGE";
const AUDIENCE = "menu-made-d1-usage";
const WORKFLOW = "JPBattaglia/MENU/.github/workflows/d1-usage.yml@refs/heads/master";
const LIMITS = { rows_read: 5000000, rows_written: 100000, requests: 100000 }; // Workers Free, per day, whole account
const NAMES = { "1387bcdc-e462-41ce-bc6b-5cc1b0a47ad0": "Menu-made", "3b48a25e-1854-48ca-b821-ef1552d385cc": "Nino shop" };
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

// The verdict for one report. now: when the report arrived (for the day's pace).
function assessUsage(body, now = Date.now()) {
  const dbs = Array.isArray(body?.databases) ? body.databases.filter((d) => d && typeof d.id === "string").slice(0, 50) : [];
  if (body?.error || !dbs.length) return { ok: false, near: false, problem: `D1 usage couldn't be read${body?.error ? `: ${String(body.error).slice(0, 200)}` : ""}`, notes: [] };
  const total = (k) => dbs.reduce((n, d) => n + (Number(d[k]) || 0), 0);
  const day = new Date(now); const elapsed = (now - Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())) / 86400000;
  const notes = []; const near = [];
  const workers = Array.isArray(body?.workers) ? body.workers.filter((w) => w && typeof w.script === "string").slice(0, 50) : [];
  const rows = { rows_read: dbs.map((d) => [NAMES[d.id] || d.id.slice(0, 8), Number(d.rows_read) || 0]), rows_written: dbs.map((d) => [NAMES[d.id] || d.id.slice(0, 8), Number(d.rows_written) || 0]),
    requests: workers.map((w) => [w.script, Number(w.requests) || 0]).sort((a, b) => b[1] - a[1]).slice(0, 4) };
  for (const k of ["rows_read", "rows_written", ...(workers.length ? ["requests"] : [])]) {
    const used = k === "requests" ? workers.reduce((n, w) => n + (Number(w.requests) || 0), 0) : total(k); const share = used / LIMITS[k];
    const pace = elapsed >= 0.25 ? used / elapsed / LIMITS[k] : null;
    const label = { rows_read: "reads", rows_written: "writes", requests: "Worker requests" }[k];
    notes.push(`${label}: ${used.toLocaleString("en-US")} of ${LIMITS[k].toLocaleString("en-US")} today (${Math.round(share * 100)}%${pace !== null ? `, on pace for ${Math.round(pace * 100)}%` : ""}; ${rows[k].map(([n, v]) => `${n} ${v.toLocaleString("en-US")}`).join(", ")})`);
    if (share >= 0.5 || (pace !== null && pace >= 0.8)) near.push(`${label} ${Math.round(share * 100)}% used${pace !== null ? `, on pace for ${Math.round(pace * 100)}%` : ""}`);
  }
  return { ok: near.length === 0, near: near.length > 0, problem: near.length ? `Near the free daily limit: ${near.join("; ")}` : null, notes };
}

async function recordUsage(env, body, now = Date.now()) {
  const verdict = assessUsage(body, now);
  // The last 5-minute tick's D1 query count (src/lib/query-count.js): Workers Free refuses more than 50 per invocation.
  const tick = await env.DB.prepare(`SELECT value FROM worker_settings WHERE key = 'tick:queries'`).first().catch(() => null);
  let t0 = null; try { t0 = tick ? JSON.parse(tick.value) : null; } catch { t0 = null; }
  if (t0) {
    verdict.notes.push(`last 5-minute tick: ${t0.queries} database queries${t0.refused ? `, ${t0.refused} refused for too many in one run` : ""} (Workers Free allows 50)`);
    if (t0.refused) { verdict.ok = false; verdict.near = true; verdict.problem = [verdict.problem, `the 5-minute tick hit the 50-query limit (${t0.refused} queries refused)`].filter(Boolean).join("; "); }
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || "")) ? body.date : new Date(now).toISOString().slice(0, 10);
  const t = new Date(now).toISOString();
  const log = verdict.notes.map((note) => ({ at: t, stage: "CHECK", note }));
  await env.DB.prepare(`
      INSERT INTO self_tests (id, kind, status, requested_by, stage, error, log_json, created_at, updated_at, finished_at)
      VALUES (?, ?, ?, 'hourly', 'DONE', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, error = excluded.error, log_json = excluded.log_json, updated_at = excluded.updated_at, finished_at = excluded.finished_at`)
    .bind(`d1-usage-${date}`, KIND, verdict.ok ? "PASSED" : "FAILED", verdict.problem, JSON.stringify(log), t, t, t).run();
  let alerted = false;
  if (verdict.near && await alertOnce(env, "d1-near-limit", 20 * 3600000, now)) {
    const heading = "Cloudflare is near its free daily limit";
    const paragraphs = [
      `${verdict.problem}. ${verdict.notes.join(". ")}.`,
      "If a daily limit is reached, checkouts, deliveries, restaurant sites and the Nino shop stop working until midnight UTC (5 pm Pacific).",
      "What to do: upgrade Cloudflare to Workers Paid ($5 a month; the daily limits go away). Go to https://dash.cloudflare.com, click Workers & Pages in the left sidebar, then Plans, and choose Purchase under Workers Paid. Then tell Claude, so it can find what grew."
    ];
    const sent = await sendTransactionalEmail(env, {
      to: ownerEmailAddress(env), subject: heading,
      html: brandedEmailHtml({ preheader: verdict.problem, eyebrow: "AUTOMATION ALERT", heading, paragraphs }),
      text: `${heading}\n\n${paragraphs.join("\n\n")}`,
      idempotencyKey: `d1-near-limit/${date}`, purpose: "AUTOMATION_ALERT", templateKey: "d1_near_limit_v1"
    }).catch(() => ({ ok: false }));
    alerted = Boolean(sent?.ok);
  }
  return { status: verdict.ok ? "PASSED" : "FAILED", alerted };
}

async function handleD1Usage(request, env) {
  const auth = await verifyRenderer(request, env, { audience: AUDIENCE, workflow: WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.DB) return json({ ok: false, error: "No database" }, 503);
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Bad request" }, 400);
  const out = await recordUsage(env, body);
  return json({ ok: true, ...out, at: nowIso() });
}

export { KIND as D1_USAGE_KIND, LIMITS, assessUsage, handleD1Usage, recordUsage };
