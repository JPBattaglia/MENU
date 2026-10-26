// Owner queue (stage 4): every order, where it is, what waits for the owner, and what failed.
//   GET  /api/admin/queue               a sign-in page (no data)
//   POST /api/admin/queue  token=...    the queue as a page (token in the body, never in the URL)
//   GET|POST with  Authorization: Bearer <ADMIN_API_TOKEN>   the queue as JSON
// Needs the ADMIN_API_TOKEN secret on the worker; without it the endpoint refuses everything.
import { escapeHtml } from "../lib/email.js";
import { jsonResponse, nowIso, parseJsonOrNull, simplePage } from "../lib/http.js";

const LIMIT = 100;

function constantTimeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length === y.length ? 0 : 1;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function buildQueue(env) {
  const all = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  const waitingApproval = await all(`
      SELECT a.id AS approval_id, a.requested_at, a.revision_number, a.project_id,
             json_extract(a.metadata_json, '$.owner_notified_at') AS owner_notified_at,
             json_extract(a.metadata_json, '$.digest_id') AS digest_id,
             p.workflow_key, b.name AS business, c.email AS buyer, p.order_id, o.stripe_checkout_session_id AS session
      FROM approvals a JOIN projects p ON p.id = a.project_id JOIN businesses b ON b.id = p.business_id
      JOIN customers c ON c.id = p.customer_id JOIN orders o ON o.id = p.order_id
      WHERE a.approval_type = 'OWNER_RELEASE' AND a.status = 'PENDING'
      ORDER BY a.requested_at ASC LIMIT ${LIMIT}`);
  const inProgress = await all(`
      SELECT r.id AS run_id, r.status AS run_status, r.workflow_key, r.created_at, p.id AS project_id, p.order_id, b.name AS business,
             o.stripe_checkout_session_id AS session,
             (SELECT step_key FROM workflow_steps s WHERE s.workflow_run_id = r.id AND s.status IN ('QUEUED','RUNNING','WAITING','FAILED') ORDER BY s.step_order LIMIT 1) AS current_step,
             (SELECT status FROM workflow_steps s WHERE s.workflow_run_id = r.id AND s.status IN ('QUEUED','RUNNING','WAITING','FAILED') ORDER BY s.step_order LIMIT 1) AS step_status
      FROM workflow_runs r JOIN projects p ON p.id = r.project_id JOIN businesses b ON b.id = p.business_id JOIN orders o ON o.id = p.order_id
      WHERE r.status IN ('QUEUED','RUNNING','WAITING')
        AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.project_id = p.id AND a.status = 'PENDING' AND a.approval_type = 'OWNER_RELEASE')
      ORDER BY r.created_at DESC LIMIT ${LIMIT}`);
  const needsAttention = await all(`
      SELECT 'RUN_FAILED' AS kind, r.id AS ref, r.workflow_key, b.name AS business, p.order_id, COALESCE(r.error_message, p.blocked_reason, '') AS detail, r.failed_at AS at
      FROM workflow_runs r JOIN projects p ON p.id = r.project_id JOIN businesses b ON b.id = p.business_id
      WHERE r.status = 'FAILED'
      UNION ALL
      SELECT 'CHANGES_REQUESTED', a.id, p.workflow_key, b.name, p.order_id, COALESCE(a.customer_comments, ''), a.responded_at
      FROM approvals a JOIN projects p ON p.id = a.project_id JOIN businesses b ON b.id = p.business_id
      WHERE a.status = 'CHANGES_REQUESTED' AND p.status = 'BLOCKED'
      UNION ALL
      SELECT 'ERROR', e.id, NULL, NULL, e.order_id, e.message, e.created_at
      FROM system_errors e WHERE e.status = 'OPEN' AND e.manual_intervention_required = 1
      ORDER BY at DESC LIMIT ${LIMIT}`);
  const delivered = await all(`
      SELECT p.id AS project_id, p.order_id, p.workflow_key, b.name AS business, p.completed_at,
             (SELECT json_extract(e.payload_json, '$.routing') FROM business_events e WHERE e.entity_id = p.id AND e.event_type = 'PROJECT_DELIVERED' ORDER BY e.created_at DESC LIMIT 1) AS routing,
             o.stripe_checkout_session_id AS session
      FROM projects p JOIN businesses b ON b.id = p.business_id JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'DELIVERED' ORDER BY p.completed_at DESC LIMIT 25`);
  const selfTests = await all(`
      SELECT kind, status, stage, error, finished_at, created_at FROM self_tests ORDER BY created_at DESC LIMIT 12`);
  const now = Date.now();
  const hoursAgo = (iso) => (iso ? Math.round((now - Date.parse(iso)) / 36e5 * 10) / 10 : null);
  const test = (session) => String(session || "").startsWith("cs_test_");
  return {
    generated_at: nowIso(),
    counts: { waiting_approval: waitingApproval.length, in_progress: inProgress.length, needs_attention: needsAttention.length, delivered_recent: delivered.length },
    waiting_approval: waitingApproval.map((r) => ({ ...r, hours_waiting: hoursAgo(r.requested_at), test: test(r.session), session: undefined })),
    in_progress: inProgress.map((r) => ({ ...r, test: test(r.session), session: undefined })),
    needs_attention: needsAttention,
    delivered_recent: delivered.map((r) => ({ ...r, test: test(r.session), session: undefined })),
    self_tests: selfTests
  };
}

function section(title, rows, columns) {
  const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows.length
    ? rows.map((row) => `<tr>${columns.map(([, get]) => `<td>${escapeHtml(get(row) ?? "")}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}"><em>None</em></td></tr>`;
  return `<h2>${escapeHtml(title)} (${rows.length})</h2><div style="overflow-x:auto"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderQueue(queue) {
  const tag = (row) => (row.test ? " [test]" : "");
  return simplePage(200, "Owner queue", `
<style>table{border-collapse:collapse;width:100%;margin-bottom:8px}th,td{border:1px solid #cfdde2;padding:6px 8px;text-align:left;font-size:13px;vertical-align:top}th{background:#eef5f7}</style>
<p>Generated ${escapeHtml(queue.generated_at)}. Reload by signing in again.</p>
${section("Waiting for your approval", queue.waiting_approval, [["Business", (r) => r.business + tag(r)], ["Product", (r) => r.workflow_key], ["Waiting (h)", (r) => r.hours_waiting], ["Emailed", (r) => (r.owner_notified_at ? "yes" : "not yet")], ["Order", (r) => r.order_id]])}
${section("Needs you", queue.needs_attention, [["What", (r) => r.kind], ["Business", (r) => r.business], ["Product", (r) => r.workflow_key], ["Detail", (r) => String(r.detail || "").slice(0, 200)], ["When", (r) => r.at]])}
${section("In production", queue.in_progress, [["Business", (r) => r.business + tag(r)], ["Product", (r) => r.workflow_key], ["Step", (r) => `${r.current_step || "-"} (${r.step_status || r.run_status})`], ["Started", (r) => r.created_at], ["Order", (r) => r.order_id]])}
${section("Recently delivered", queue.delivered_recent, [["Business", (r) => r.business + tag(r)], ["Product", (r) => r.workflow_key], ["Route", (r) => r.routing || "-"], ["Delivered", (r) => r.completed_at], ["Order", (r) => r.order_id]])}
${section("Self-tests", queue.self_tests, [["Test", (r) => r.kind], ["Result", (r) => r.status], ["Stage", (r) => r.stage], ["Error", (r) => String(r.error || "").slice(0, 160)], ["Finished", (r) => r.finished_at]])}`);
}

async function handleAdminQueue(request, env) {
  const noStore = (response) => { response.headers.set("Cache-Control", "no-store"); response.headers.set("X-Robots-Tag", "noindex"); return response; };
  if (!env.ADMIN_API_TOKEN) return noStore(jsonResponse({ ok: false, error: "The owner queue is not set up: ADMIN_API_TOKEN is missing" }, 503));
  if (!env.DB) return noStore(jsonResponse({ ok: false, error: "D1 binding DB is not available" }, 500));
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let supplied = bearer;
  let wantsPage = false;
  if (!supplied && request.method === "POST") {
    try {
      const form = await request.formData();
      supplied = String(form.get("token") || "").trim();
      wantsPage = true;
    } catch { supplied = ""; }
  }
  if (!supplied && request.method === "GET") {
    return noStore(simplePage(200, "Owner queue", `<form method="post" action="/api/admin/queue"><label for="token">Admin token</label><br><input id="token" name="token" type="password" autocomplete="current-password" required style="width:100%;margin:8px 0"><br><button type="submit">Open the queue</button></form>`));
  }
  if (!supplied || !constantTimeEqual(supplied, env.ADMIN_API_TOKEN)) {
    return noStore(jsonResponse({ ok: false, error: "Not authorized" }, 401));
  }
  const queue = await buildQueue(env);
  return noStore(wantsPage ? renderQueue(queue) : jsonResponse({ ok: true, ...queue }));
}

export { buildQueue, handleAdminQueue, constantTimeEqual };
