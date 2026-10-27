// Sandbox self-test for Conversion Fix (stage 6), run by the worker's 5-minute schedule and once a day.
// A synthetic paid order for https://menu-made.com/ goes through the REAL audit and the REAL AI recommendation. The owner
// approval is clicked through the approve page, then the delivered report and checklist are checked. Only a failure
// emails the owner. Start one by inserting a self_tests row, kind CONVERSION_RUN, status REQUESTED.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { startConversionFix } from "../producers/conversion/intake.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "CONVERSION_RUN";
const STAGE_TIMEOUT_MINUTES = 30;
const DAILY_HOUR_UTC = 18;
const SCAN_URL = "https://menu-made.com/";
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function loadActiveTests(env) {
  return (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2`).bind(KIND).all()).results || [];
}

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 40) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

async function stageStart(env, app, test) {
  const t = nowIso();
  const short = test.id.slice(0, 8);
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'CONVERSION_FIX' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Conversion Fix offer is not in the catalog");
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const businessId = crypto.randomUUID(); const orderId = crypto.randomUUID(); const itemId = crypto.randomUUID(); const projectId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Conversion Fix Self-Test Cafe')`).bind(businessId, t, t).run();
  await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes) VALUES (?, ?, ?, ?, ?, 'ONBOARDING_REQUIRED', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)`)
    .bind(orderId, t, t, customer.id, businessId, `cs_test_conversion_${short}`, t, `Website fix: ${SCAN_URL}\nGoal: phone calls`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')`).bind(itemId, orderId, offer.offer_id, offer.version_id).run();
  await env.DB.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, 'OTHER', 'AWAITING_INPUTS', 'CONVERSION_FIX_V1', 1, 'NORMAL', 0, ?, ?, ?)`)
    .bind(projectId, orderId, itemId, businessId, customer.id, t, t, JSON.stringify({ source: "CONVERSION_SELFTEST", self_test_id: test.id })).run();
  const note = (await env.DB.prepare(`SELECT notes FROM orders WHERE id = ?`).bind(orderId).first()).notes;
  const started = await startConversionFix(env, { projectId, orderId, customerId: customer.id, notes: note });
  if (!started.started) throw new Error("The order brief was not accepted");
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_OWNER_REQUEST", project_id: projectId, order_id: orderId, state: { projectId }, log: "Synthetic Conversion Fix order started for menu-made.com" });
}

async function stageAwaitOwnerRequest(env, app, test) {
  const s = state(test);
  const approval = await env.DB.prepare(`SELECT id, json_extract(metadata_json, '$.owner_notified_at') AS notified FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1`).bind(s.projectId).first();
  if (!approval) {
    const run = await env.DB.prepare(`SELECT ws.output_json AS output_json FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id WHERE wr.project_id = ? AND ws.step_key = 'PRODUCE' AND ws.status = 'SUCCEEDED'`).bind(s.projectId).first();
    const out = parseJsonOrNull(run?.output_json);
    if (out?.outcome === "NOT_PRODUCED") throw new Error(`The report was not produced: ${(out.reasons || []).join("; ")}`);
    return null;
  }
  if (!approval.notified) return null;
  const files = (await env.DB.prepare(`SELECT d.deliverable_type, a.storage_key, a.metadata_json FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ? AND d.status != 'SUPERSEDED'`).bind(s.projectId).all()).results || [];
  const report = files.find((f) => f.deliverable_type === "CONVERSION_REPORT");
  const checklist = files.find((f) => f.deliverable_type === "CONVERSION_CHECKLIST");
  if (!report || !checklist) throw new Error("The report or the checklist is missing");
  const html = await (await env.ASSETS.get(report.storage_key))?.text();
  if (!html || !html.includes("What we checked") || !html.includes("cannot see your visitor numbers")) throw new Error("The report is missing its findings list or its limitations statement");
  const info = parseJsonOrNull(report.metadata_json)?.conversion;
  if (!info || info.fixes < 1) throw new Error("The report holds no fixes");
  const token = await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 });
  const form = new FormData();
  form.append("t", token);
  const approved = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_DELIVERED", log: `Owner email sent; report holds ${info.fixes} fixes from ${info.findings} findings; approved through the approve page` });
}

async function stageAwaitDelivered(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status !== "DELIVERED") return null;
  const mail = await env.DB.prepare(`SELECT 1 AS n FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The customer was not emailed their report");
  const usage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id = ?`).bind(s.projectId).first();
  if (Number(usage?.n) < 1) throw new Error("The AI step logged no token usage");
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: "Report delivered to the customer after approval; AI usage logged" });
}

const STAGES = { START: stageStart, AWAIT_OWNER_REQUEST: stageAwaitOwnerRequest, AWAIT_DELIVERED: stageAwaitDelivered };

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Conversion Fix self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of Conversion Fix failed.", eyebrow: "SELF-TEST", heading: "The Conversion Fix self-test failed",
      paragraphs: ["A test month of posts did not come out as expected. Real customers' posts may hit the same problem."], rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Conversion Fix self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceConversionSelfTests(env, app) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const results = [];
  for (let test of await loadActiveTests(env)) {
    for (let guard = 0; guard < 4; guard++) {
      const stage = test.status === "REQUESTED" ? "START" : test.stage;
      const handler = STAGES[stage];
      if (!handler) break;
      try {
        const next = await handler(env, app, test);
        if (!next) {
          if (Date.now() - Date.parse(test.stage_started_at || test.created_at) > STAGE_TIMEOUT_MINUTES * 60000) test = await failTest(env, test, `Timed out after ${STAGE_TIMEOUT_MINUTES} minutes waiting at ${stage}`);
          break;
        }
        test = next;
        if (test.status !== "RUNNING") break;
      } catch (error) {
        test = await failTest(env, test, error instanceof Error ? error.message : String(error));
        break;
      }
    }
    results.push({ id: test.id, status: test.status, stage: test.stage });
  }
  return results;
}

export { advanceConversionSelfTests };
