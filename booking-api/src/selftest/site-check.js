// Stage 12, task 4: results of the daily site checks (.github/workflows/site-check.yml, tools/site-check/check.mjs)
// for menu-made.com and ninobattaglia.com. The workflow posts its result.json here over its GitHub OIDC token (no
// secret); it is stored as a self_tests row of kind SITE_CHECK, so it shows on the coverage map and in the daily
// failure-only report like every other self-test.
//
//   POST /api/system/site-check   (OIDC, audience menu-made-site-check, schedule or manual runs on master)
//                                 body: { ok, axe, sites: [{ site, pages: [...], failures: [...], warnings: [...] }], run_id }
import { nowIso } from "../lib/http.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";

const KIND = "SITE_CHECK";
const AUDIENCE = "menu-made-site-check";
const WORKFLOW = "JPBattaglia/MENU/.github/workflows/site-check.yml@refs/heads/master";
const RUNS_URL = "https://github.com/JPBattaglia/MENU/actions/runs/";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

// The stored row for one result. Exported for the tests.
function siteCheckRow(body, now = nowIso()) {
  const sites = Array.isArray(body?.sites) ? body.sites.slice(0, 5) : [];
  if (!sites.length || !sites.every((s) => typeof s?.site === "string" && Array.isArray(s.pages) && Array.isArray(s.failures))) return null;
  const failures = sites.flatMap((s) => s.failures.map((f) => `${new URL(s.site).hostname} ${String(f)}`));
  const runId = /^\d{1,20}$/.test(String(body.run_id || "")) ? String(body.run_id) : null;
  const passed = failures.length === 0 && body.ok === true;
  const summary = sites.map((s) => `${new URL(s.site).hostname}: ${s.pages.length} pages, ${s.failures.length} failures, ${(s.warnings || []).length} warnings`).join("; ");
  const log = [{ at: now, stage: "DONE", note: `${summary}${body.axe ? "" : " (accessibility scan didn't run)"}${runId ? `. Screenshots and details: ${RUNS_URL}${runId}` : ""}` },
    ...sites.flatMap((s) => (s.warnings || []).slice(0, 20).map((w) => ({ at: now, stage: "WARN", note: `${new URL(s.site).hostname} ${String(w).slice(0, 300)}` })))];
  return {
    status: passed ? "PASSED" : "FAILED",
    error: passed ? null : (failures.length ? `${failures.length} problem${failures.length === 1 ? "" : "s"}: ${failures.slice(0, 5).join(" | ")}` : "The site check didn't finish").slice(0, 1000),
    log_json: JSON.stringify(log).slice(0, 20000),
    state_json: JSON.stringify({ run_id: runId, pages: sites.reduce((n, s) => n + s.pages.length, 0), failures: failures.length })
  };
}

async function handleSiteCheckResult(request, env) {
  const auth = await verifyRenderer(request, env, { audience: AUDIENCE, workflow: WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.DB) return json({ ok: false, error: "No database" }, 503);
  const body = await request.json().catch(() => null);
  const row = siteCheckRow(body);
  if (!row) return json({ ok: false, error: "Expected { ok, sites: [{ site, pages, failures, warnings }] }" }, 400);
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, stage, requested_by, error, log_json, state_json, created_at, updated_at, stage_started_at, finished_at)
      VALUES (?, ?, ?, 'DONE', 'github-site-check', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), KIND, row.status, row.error, row.log_json, row.state_json, t, t, t, t).run();
  return json({ ok: true, status: row.status });
}

export { AUDIENCE as SITE_CHECK_AUDIENCE, KIND as SITE_CHECK_KIND, WORKFLOW as SITE_CHECK_WORKFLOW, handleSiteCheckResult, siteCheckRow };
