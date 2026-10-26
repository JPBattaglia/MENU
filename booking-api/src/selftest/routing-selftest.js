// Sandbox self-test for approval routing (stage 4 exit), run by the worker's 5-minute schedule.
// Two synthetic paid orders for test-only products go through the real shared deliver step:
//   one whose offer is automatic  -> delivered to the buyer with no owner step
//   one whose offer needs approval -> owner digest/email -> approve page (POST) -> delivered to the buyer
// then the owner queue must show both. Start one by inserting a self_tests row, kind ROUTING_APPROVAL, status REQUESTED.
// The checkout and Stripe path are proven by the Menu + QR and subscription self-tests; this one starts at a paid order.
// Test-only offers are not public, so they can never be sold. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { buildQueue } from "../admin/queue.js";
import { ensureProductionWorkflow } from "../workflows/definitions.js";
import { completeStep } from "../workflows/runner.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "ROUTING_APPROVAL";
const STAGE_TIMEOUT_MINUTES = 25;
const DAILY_HOUR_UTC = 15;
const VARIANTS = {
  AUTO: { workflowKey: "ROUTING_SELFTEST_AUTO_V1", offerId: "offer_routing_selftest_auto", code: "ROUTING_SELFTEST_AUTO", name: "Routing self-test (automatic)", requiresApproval: 0 },
  OWNER: { workflowKey: "ROUTING_SELFTEST_OWNER_V1", offerId: "offer_routing_selftest_owner", code: "ROUTING_SELFTEST_OWNER", name: "Routing self-test (needs approval)", requiresApproval: 1 }
};
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function loadActiveTests(env) {
  return (await env.DB.prepare(`
      SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2
    `).bind(KIND).all()).results || [];
}

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 40) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`)
    .bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`)
    .bind(crypto.randomUUID(), KIND, t, t).run();
}

// Test-only catalog rows and workflows. Fixed ids, so they are created once and reused.
async function ensureScaffolding(env) {
  const t = nowIso();
  const steps = JSON.stringify([{ key: "SELFTEST_PRODUCE", order: 10 }, { key: "DELIVER", order: 20 }]);
  for (const variant of Object.values(VARIANTS)) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type,
          requires_approval, requires_assets, default_workflow_key, sort_order, is_public, is_featured, cta_text)
        VALUES (?, ?, ?, ?, ?, 'OTHER', 'PAUSED', 'ONE_TIME', 'DIGITAL', ?, 0, ?, 999, 0, 0, 'Not for sale')
      `).bind(variant.offerId, t, t, variant.code, variant.name, variant.requiresApproval, variant.workflowKey).run();
    await env.DB.prepare(`
        INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, scope_json)
        VALUES (?, ?, 1, ?, ?, 'ACTIVE', 0, 'USD', '{"service":"routing_selftest"}')
      `).bind(`${variant.offerId}_v1`, variant.offerId, t, t).run();
    await env.DB.prepare(`
        INSERT OR IGNORE INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at)
        VALUES (?, ?, 1, 'ACTIVE', ?, ?, ?)
      `).bind(`wd_${variant.workflowKey}`, variant.workflowKey, steps, t, t).run();
  }
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`)
      .bind(id, t, t, SELF_TEST_EMAIL).run();
    customer = { id };
  }
  return customer.id;
}

async function createOrder(env, test, variantKey, customerId) {
  const variant = VARIANTS[variantKey];
  const t = nowIso();
  const businessId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)`)
    .bind(businessId, t, t, `Routing Self-Test ${variantKey === "AUTO" ? "Auto" : "Approval"} Cafe`).run();
  await env.DB.prepare(`
      INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents,
        tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes)
      VALUES (?, ?, ?, ?, ?, 'READY_FOR_PRODUCTION', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)
    `).bind(orderId, t, t, customerId, businessId, `cs_test_routing_${test.id.slice(0, 8)}_${variantKey.toLowerCase()}`, t, `Routing self-test ${test.id}`).run();
  await env.DB.prepare(`
      INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status)
      VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')
    `).bind(itemId, orderId, variant.offerId, `${variant.offerId}_v1`).run();
  await env.DB.prepare(`
      INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version,
        priority, manual_review_required, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, 'OTHER', 'READY', ?, 1, 'NORMAL', 0, ?, ?, ?)
    `).bind(projectId, orderId, itemId, businessId, customerId, variant.workflowKey, t, t, JSON.stringify({ source: "ROUTING_SELFTEST", self_test_id: test.id })).run();
  await ensureProductionWorkflow(projectId, variant.workflowKey, 1, customerId, orderId, env);
  return { orderId, projectId };
}

// The test-only producer: one small file per project, left unreleased for the shared deliver step.
async function runSelfTestProduceStep(targetStep, env) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const latest = await env.DB.prepare(`SELECT version, status FROM deliverables WHERE project_id = ? AND deliverable_type = 'SELFTEST_FILE' ORDER BY version DESC LIMIT 1`).bind(targetStep.project_id).first();
  const now = nowIso();
  // First run, or a regeneration after the owner superseded the previous version: make the next version.
  if (!latest || latest.status === "SUPERSEDED") {
    const version = Number(latest?.version || 0) + 1;
    const assetId = crypto.randomUUID();
    const key = `selftest/routing/${targetStep.project_id}/v${version}/note.txt`;
    const body = new TextEncoder().encode(`Routing self-test file for project ${targetStep.project_id}, version ${version}\n`);
    await env.ASSETS.put(key, body, { httpMetadata: { contentType: "text/plain" } });
    await env.DB.prepare(`
        INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type,
          size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
        VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, 'routing-self-test.txt', 'text/plain', ?, NULL, 'VALID', ?, ?, 1, 0, 1, '{}')
      `).bind(assetId, targetStep.business_id, targetStep.customer_id, targetStep.project_id, key, body.byteLength, now, now).run();
    await env.DB.prepare(`
        INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, created_at)
        VALUES (?, ?, ?, 'SELFTEST_FILE', ?, 'DRAFT', 0, ?)
      `).bind(crypto.randomUUID(), targetStep.project_id, assetId, version, now).run();
  }
  const output = { produced: ["SELFTEST_FILE"] };
  await completeStep(targetStep, output, env);
  return output;
}

// ---------- Stages ----------

async function stageStart(env, app, test) {
  const customerId = await ensureScaffolding(env);
  const auto = await createOrder(env, test, "AUTO", customerId);
  const owner = await createOrder(env, test, "OWNER", customerId);
  return updateTest(env, test, {
    status: "RUNNING", stage: "AWAIT_AUTO", order_id: auto.orderId, project_id: auto.projectId,
    state: { auto, owner },
    log: `Two paid test orders created: automatic ${auto.orderId}, approval ${owner.orderId}`
  });
}

async function deliveredRouting(env, projectId) {
  const project = await env.DB.prepare(`SELECT status FROM projects WHERE id = ?`).bind(projectId).first();
  if (project?.status !== "DELIVERED") return null;
  const email = await env.DB.prepare(`SELECT recipient FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(projectId).first();
  if (!email) throw new Error("Project delivered but no delivery email was logged");
  const event = await env.DB.prepare(`
      SELECT json_extract(payload_json, '$.routing') AS routing FROM business_events
      WHERE entity_id = ? AND event_type = 'PROJECT_DELIVERED' ORDER BY created_at DESC LIMIT 1
    `).bind(projectId).first();
  const files = await env.DB.prepare(`SELECT COUNT(*) AS n FROM deliverables WHERE project_id = ? AND customer_visible = 1 AND status = 'FINAL'`).bind(projectId).first();
  if (!files || Number(files.n) < 1) throw new Error("Delivered, but no deliverable was released to the buyer");
  return { routing: event?.routing || null, recipient: email.recipient };
}

async function stageAwaitAuto(env, app, test) {
  const { auto } = state(test);
  const done = await deliveredRouting(env, auto.projectId);
  if (!done) return null;
  if (done.routing !== "AUTO") throw new Error(`The automatic order was routed ${done.routing}, expected AUTO`);
  const approvals = await env.DB.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE project_id = ?`).bind(auto.projectId).first();
  if (Number(approvals?.n) !== 0) throw new Error("The automatic order created an owner approval it should not have");
  return updateTest(env, test, { stage: "AWAIT_OWNER_REQUEST", order_id: state(test).owner.orderId, project_id: state(test).owner.projectId,
    log: "Automatic order delivered to the buyer with no owner step" });
}

async function stageAwaitOwnerRequest(env, app, test) {
  const { owner } = state(test);
  const delivered = await env.DB.prepare(`SELECT status FROM projects WHERE id = ?`).bind(owner.projectId).first();
  if (delivered?.status === "DELIVERED") throw new Error("The approval order was delivered without the owner approving it");
  const approval = await env.DB.prepare(`
      SELECT id, json_extract(metadata_json, '$.owner_notified_at') AS notified FROM approvals
      WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1
    `).bind(owner.projectId).first();
  if (!approval || !approval.notified) return null; // the owner email goes out at the end of the runner tick
  const buyerMail = await env.DB.prepare(`SELECT 1 AS n FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' LIMIT 1`).bind(owner.projectId).first();
  if (buyerMail) throw new Error("The buyer was emailed before the owner approved");
  const queue = await buildQueue(env);
  if (!queue.waiting_approval.some((row) => row.approval_id === approval.id)) throw new Error("The owner queue does not list the waiting approval");
  const token = await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 });
  const form = new FormData();
  form.append("t", token);
  const approved = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_OWNER_DELIVERY", log: "Owner email sent, queue lists the item, approved through the approve page" });
}

async function stageAwaitOwnerDelivery(env, app, test) {
  const { owner, auto } = state(test);
  const done = await deliveredRouting(env, owner.projectId);
  if (!done) return null;
  if (done.routing !== "OWNER") throw new Error(`The approval order was routed ${done.routing}, expected OWNER`);
  const queue = await buildQueue(env);
  const listed = new Set(queue.delivered_recent.map((row) => row.project_id));
  if (!listed.has(auto.projectId) || !listed.has(owner.projectId)) throw new Error("The owner queue does not show both delivered orders");
  if (env.ADMIN_API_TOKEN) {
    const response = await app(new Request(`${publicBaseUrl(env)}/api/admin/queue`, { headers: { Authorization: `Bearer ${env.ADMIN_API_TOKEN}` } }));
    const body = await response.json().catch(() => null);
    if (response.status !== 200 || !body?.ok) throw new Error(`The queue endpoint refused the admin token (HTTP ${response.status})`);
  }
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: "Approval order delivered after approval; queue shows both orders" });
}

const STAGES = { START: stageStart, AWAIT_AUTO: stageAwaitAuto, AWAIT_OWNER_REQUEST: stageAwaitOwnerRequest, AWAIT_OWNER_DELIVERY: stageAwaitOwnerDelivery };

async function diagnose(env, test) {
  const parts = [];
  for (const [label, entry] of Object.entries(state(test))) {
    if (!entry?.projectId) continue;
    const run = await env.DB.prepare(`SELECT id, status, error_message FROM workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`).bind(entry.projectId).first();
    if (!run) { parts.push(`${label}: no run`); continue; }
    const steps = (await env.DB.prepare(`SELECT step_key, status FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_order`).bind(run.id).all()).results || [];
    parts.push(`${label}: run ${run.status}${run.error_message ? ` (${run.error_message})` : ""}; ${steps.map((s) => `${s.step_key}=${s.status}`).join(", ")}`);
  }
  return parts.join(" | ");
}

async function failTest(env, test, message) {
  const detail = await diagnose(env, test).catch(() => "");
  const failed = await updateTest(env, test, { status: "FAILED", error: `${message}${detail ? ` | ${detail}` : ""}`.slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Approval routing self-test failed",
    html: brandedEmailHtml({
      preheader: "The automated test of approval routing failed.",
      eyebrow: "SELF-TEST",
      heading: "The approval routing self-test failed",
      paragraphs: ["Test orders did not reach the buyer as expected. Real orders may hit the same problem."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]]
    }),
    text: `The approval routing self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`,
    purpose: "AUTOMATION_ALERT",
    templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceRoutingSelfTests(env, app) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const results = [];
  for (let test of await loadActiveTests(env)) {
    for (let guard = 0; guard < 6; guard++) {
      const stage = test.status === "REQUESTED" ? "START" : test.stage;
      const handler = STAGES[stage];
      if (!handler) break;
      try {
        const next = await handler(env, app, test);
        if (!next) {
          if (Date.now() - Date.parse(test.stage_started_at || test.created_at) > STAGE_TIMEOUT_MINUTES * 60000) {
            test = await failTest(env, test, `Timed out after ${STAGE_TIMEOUT_MINUTES} minutes waiting at ${stage}`);
          }
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

export { advanceRoutingSelfTests, runSelfTestProduceStep, maybeScheduleDaily, ensureScaffolding, createOrder, VARIANTS };
