// Sandbox self-test for Accessibility Monitoring (stage 6), run by the worker's 5-minute schedule and once a day.
// A synthetic subscriber with NO website saved starts a monthly report. The test checks the whole loop: the run waits and the
// settings email is recorded, the settings page (signed link) accepts https://menu-made.com/, the run resumes, the REAL scan
// fetches our own site, and the report reaches the customer with its limitations stated. Only a failure emails the owner.
// Start one by inserting a self_tests row, kind ACCESSIBILITY_RUN, status REQUESTED.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { ensureProductionWorkflow } from "../workflows/definitions.js";
import { DISCLAIMER } from "../producers/accessibility/access-step.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "ACCESSIBILITY_RUN";
const STAGE_TIMEOUT_MINUTES = 30;
const DAILY_HOUR_UTC = 17;
const SCAN_URL = "https://menu-made.com/";
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function loadActiveTests(env) {
  return (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2`).bind(KIND).all()).results || [];
}

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 50) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

async function stageStart(env, app, test) {
  const t = nowIso();
  const short = test.id.slice(0, 8);
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'ACCESSIBILITY_MONITORING' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Accessibility Monitoring offer is not in the catalog");
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const id = () => crypto.randomUUID();
  const businessId = id(); const subscriptionId = id(); const orderId = id(); const itemId = id(); const projectId = id();
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Accessibility Self-Test Cafe')`).bind(businessId, t, t).run();
  await env.DB.prepare(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, current_period_start, current_period_end, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'MONTH', 0, ?, ?, ?, ?, ?)`).bind(subscriptionId, customer.id, businessId, offer.offer_id, offer.version_id, `sub_selftest_access_${short}`, `cus_selftest_access_${short}`, t, t, t, t, t).run();
  await env.DB.prepare(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACCESSIBILITY_MONITORING', 'ACTIVE', ?, ?, ?, ?)`)
    .bind(id(), customer.id, businessId, subscriptionId, t, JSON.stringify({ offer_id: offer.offer_id, offer_version_id: offer.version_id, workflow_key: "ACCESSIBILITY_MONITORING_V1", environment: "sandbox" }), t, t).run();
  await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes) VALUES (?, ?, ?, ?, ?, 'READY_FOR_PRODUCTION', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)`)
    .bind(orderId, t, t, customer.id, businessId, `cs_test_access_${short}`, t, `Accessibility self-test ${test.id}`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')`).bind(itemId, orderId, offer.offer_id, offer.version_id).run();
  await env.DB.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, 'OTHER', 'READY', 'ACCESSIBILITY_MONITORING_V1', 1, 'NORMAL', 0, ?, ?, ?)`)
    .bind(projectId, orderId, itemId, businessId, customer.id, t, t, JSON.stringify({ source: "ACCESS_SELFTEST", self_test_id: test.id, subscription_id: subscriptionId, period_start: t })).run();
  await ensureProductionWorkflow(projectId, "ACCESSIBILITY_MONITORING_V1", 1, customer.id, orderId, env);
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_WAITING", project_id: projectId, order_id: orderId, state: { projectId, subscriptionId }, log: "Synthetic subscriber with no website saved; waiting for the run to ask for it" });
}

async function stageAwaitWaiting(env, app, test) {
  const s = state(test);
  const step = await env.DB.prepare(`SELECT ws.status FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id WHERE wr.project_id = ? AND ws.step_key = 'PRODUCE'`).bind(s.projectId).first();
  if (!step || step.status === "QUEUED" || step.status === "RUNNING") return null;
  if (step.status !== "WAITING") throw new Error(`Expected the report to wait for the website address, but the step is ${step.status}`);
  const mail = await env.DB.prepare(`SELECT 1 AS n FROM communications WHERE project_id = ? AND purpose = 'ACCESSIBILITY_SETTINGS' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The customer was not asked for their website address");
  const token = await signLinkToken(env, { kind: "settings", id: s.subscriptionId, ttlDays: 1 });
  const bad = await app(new Request(`${publicBaseUrl(env)}/api/plan-settings/${s.subscriptionId}?t=${token}`));
  if (bad.status !== 200 || !(await bad.text()).includes('name="website_url"')) throw new Error("The settings page did not show the website field");
  const form = new FormData();
  form.append("t", token); form.append("website_url", SCAN_URL);
  const saved = await app(new Request(`${publicBaseUrl(env)}/api/plan-settings/${s.subscriptionId}`, { method: "POST", body: form }));
  if (saved.status !== 200) throw new Error(`Saving the website failed (HTTP ${saved.status})`);
  return updateTest(env, test, { stage: "AWAIT_DELIVERED", log: "Run waited, the customer was asked, and the website was saved through the settings page" });
}

async function stageAwaitDelivered(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status !== "DELIVERED") {
    const run = await env.DB.prepare(`SELECT status, error_message FROM workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`).bind(s.projectId).first();
    if (run?.status === "FAILED") throw new Error(`The report run failed: ${run.error_message}`);
    return null;
  }
  const report = await env.DB.prepare(`SELECT a.storage_key, a.metadata_json FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ? AND d.deliverable_type = 'ACCESSIBILITY_REPORT' ORDER BY d.version DESC LIMIT 1`).bind(s.projectId).first();
  const object = report ? await env.ASSETS.get(report.storage_key) : null;
  if (!object) throw new Error("The report is missing from storage");
  const html = await object.text();
  const meta = parseJsonOrNull(report.metadata_json)?.accessibility;
  if (!meta || meta.scanned < 1) throw new Error("The scan read no pages from the website");
  if (!html.includes("Pages scanned") || !html.includes(DISCLAIMER.slice(0, 40))) throw new Error("The report is missing its page list or its limitations statement");
  const mail = await env.DB.prepare(`SELECT 1 AS n FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The customer was not emailed their report");
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: `Report delivered: ${meta.scanned} page(s) scanned, ${meta.total} problem(s) found` });
}

const STAGES = { START: stageStart, AWAIT_WAITING: stageAwaitWaiting, AWAIT_DELIVERED: stageAwaitDelivered };

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Accessibility Monitoring self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of Accessibility Monitoring failed.", eyebrow: "SELF-TEST", heading: "The Accessibility Monitoring self-test failed",
      paragraphs: ["A test monthly report did not come out as expected. Real subscribers' reports may hit the same problem."], rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Accessibility Monitoring self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceAccessibilitySelfTests(env, app) {
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

export { advanceAccessibilitySelfTests };
