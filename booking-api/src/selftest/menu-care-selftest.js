// Sandbox self-test for Menu Care (stage 6), run by the worker's 5-minute schedule and once a day.
// A synthetic customer with a live menu asks for a change through the real intake code. The real shared AI step edits
// the menu, the real approval flow asks the owner (the test approves through the approve page), and the same hosted
// menu address must then show the new price and the new dish while every other item is untouched.
// Start one by inserting a self_tests row, kind MENU_CARE_EDIT, status REQUESTED. Only a failure emails the owner.
// The synthetic subscription is cancelled as soon as the request exists, so it can never create period jobs.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { sha256Hex } from "../lib/util.js";
import { buildDesignedMenuHtml } from "../producers/menu-qr/design.js";
import { createMenuChangeRequest } from "../producers/menu-care/intake.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "MENU_CARE_EDIT";
const STAGE_TIMEOUT_MINUTES = 25;
const DAILY_HOUR_UTC = 16;
const REQUEST = "Raise the Margherita to $16 and add Garlic Bread, $6, under Starters.";
const MENU = {
  sections: [
    { name: "Starters", items: [{ name: "Tomato Soup", description: "Basil and cream", price: "$9" }] },
    { name: "Pizza", items: [{ name: "Margherita", description: "Mozzarella and basil", price: "$15" }, { name: "Pepperoni", description: "", price: "$17.50" }] }
  ],
  notes: "Ask about allergens."
};
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

async function hostedText(app, env, slug) {
  const response = await app(new Request(`${publicBaseUrl(env)}/api/menu/${slug}`));
  return { status: response.status, html: await response.text() };
}

// A synthetic customer, business, Menu Care subscription and approved live menu.
async function scaffold(env, test) {
  const t = nowIso();
  const short = test.id.slice(0, 8);
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'MENU_CARE' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Menu Care offer is not in the catalog");
  const businessId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const slug = `menucare-selftest-${short}`;
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Menu Care Self-Test Cafe')`).bind(businessId, t, t).run();
  await env.DB.prepare(`
      INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval,
        amount_cents, current_period_start, current_period_end, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'MONTH', 0, ?, ?, ?, ?, ?)
    `).bind(subscriptionId, customer.id, businessId, offer.offer_id, offer.version_id, `sub_selftest_menucare_${short}`, `cus_selftest_menucare_${short}`, t, t, t, t, t).run();
  await env.DB.prepare(`
      INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'MENU_CARE', 'ACTIVE', ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), customer.id, businessId, subscriptionId, t, JSON.stringify({ offer_id: offer.offer_id, offer_version_id: offer.version_id, workflow_key: "MENU_CARE_V1", environment: "sandbox" }), t, t).run();
  await env.DB.prepare(`
      INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes)
      VALUES (?, ?, ?, ?, ?, 'DELIVERED', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)
    `).bind(orderId, t, t, customer.id, businessId, `cs_test_menucare_${short}`, t, `Menu Care self-test ${test.id}`).run();
  const qrOffer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'ONLINE_MENU_QR' ORDER BY v.version_number LIMIT 1`).first();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'FULFILLED')`)
    .bind(itemId, orderId, (qrOffer || offer).offer_id, (qrOffer || offer).version_id).run();
  await env.DB.prepare(`
      INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, 'MENU', 'DELIVERED', 'MENU_QR_V1', 1, 'NORMAL', 0, ?, ?, ?)
    `).bind(projectId, orderId, itemId, businessId, customer.id, t, t, JSON.stringify({ source: "MENU_CARE_SELFTEST", self_test_id: test.id })).run();
  await env.DB.prepare(`
      INSERT INTO project_inputs (id, project_id, input_key, input_type, value_text, required, status, created_at, updated_at)
      VALUES (?, ?, 'qr_destination', 'URL', ?, 1, 'VALID', ?, ?)
    `).bind(crypto.randomUUID(), projectId, `${publicBaseUrl(env)}/api/menu/${slug}`, t, t).run();
  const html = buildDesignedMenuHtml({ businessName: "Menu Care Self-Test Cafe", brandColors: "#071f2c, #00d6e6", menu: MENU, logoDataUri: null });
  const bytes = new TextEncoder().encode(html);
  const key = `selftest/menu-care/${test.id}/menu.html`;
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, 'menu.html', 'text/html', ?, ?, 'VALID', ?, ?, 1, 0, 1, '{}')
    `).bind(assetId, businessId, customer.id, projectId, key, bytes.byteLength, await sha256Hex(bytes), t, t).run();
  await env.DB.prepare(`
      INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at)
      VALUES (?, ?, ?, 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)
    `).bind(crypto.randomUUID(), projectId, assetId, t, t).run();
  return { subscriptionId, businessId, slug };
}

async function stageStart(env, app, test) {
  const scaffolding = await scaffold(env, test);
  const before = await hostedText(app, env, scaffolding.slug);
  if (before.status !== 200 || !before.html.includes("$15")) throw new Error(`The synthetic live menu is not served (HTTP ${before.status})`);
  const created = await createMenuChangeRequest(env, scaffolding.subscriptionId, REQUEST, { source: "SELFTEST" });
  // Cancelled at once: the request is already queued, and no renewal can ever create period jobs for it.
  await env.DB.prepare(`UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = ?, updated_at = ? WHERE id = ?`).bind(nowIso(), nowIso(), scaffolding.subscriptionId).run();
  await env.DB.prepare(`UPDATE entitlements SET status = 'EXPIRED', updated_at = ? WHERE subscription_id = ?`).bind(nowIso(), scaffolding.subscriptionId).run();
  return updateTest(env, test, {
    status: "RUNNING", stage: "AWAIT_OWNER_REQUEST", project_id: created.projectId,
    state: { ...scaffolding, requestId: created.requestId, projectId: created.projectId },
    log: "Synthetic customer with a live menu asked for a price change and a new dish"
  });
}

async function stageAwaitOwnerRequest(env, app, test) {
  const s = state(test);
  const request = await env.DB.prepare(`SELECT status, result_json FROM menu_change_requests WHERE id = ?`).bind(s.requestId).first();
  if (request?.status === "NOT_APPLIED") throw new Error(`The request was not applied: ${(parseJsonOrNull(request.result_json)?.reasons || []).join("; ")}`);
  const approval = await env.DB.prepare(`
      SELECT id, json_extract(metadata_json, '$.owner_notified_at') AS notified FROM approvals
      WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1
    `).bind(s.projectId).first();
  if (!approval || !approval.notified) return null;
  const draft = await env.DB.prepare(`
      SELECT a.metadata_json FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ? AND d.deliverable_type = 'MENU_DRAFT' ORDER BY d.version DESC LIMIT 1
    `).bind(s.projectId).first();
  const changes = parseJsonOrNull(draft?.metadata_json)?.care?.changes || [];
  if (!changes.some((line) => /Margherita/.test(line) && /\$16/.test(line))) throw new Error(`The draft does not show the Margherita price change: ${changes.join("; ") || "no changes listed"}`);
  if (!changes.some((line) => /Garlic Bread/i.test(line) && /Added/.test(line))) throw new Error(`The draft does not show Garlic Bread added: ${changes.join("; ")}`);
  if (changes.length !== 2) throw new Error(`The draft changed more than asked (${changes.length} changes): ${changes.join("; ")}`);
  const live = await hostedText(app, env, s.slug);
  if (live.html.includes("Garlic Bread") || !live.html.includes("$15")) throw new Error("The live menu changed before the owner approved");
  const token = await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 });
  const form = new FormData();
  form.append("t", token);
  const approved = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_LIVE", log: `Owner email sent; draft lists exactly: ${changes.join("; ")}. Approved through the approve page` });
}

async function stageAwaitLive(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status !== "DELIVERED") return null;
  const live = await hostedText(app, env, s.slug);
  const html = live.html;
  for (const must of ["$16", "Garlic Bread", "$6", "Pepperoni", "$17.50", "Tomato Soup", "$9", "Ask about allergens."]) {
    if (!html.includes(must)) throw new Error(`The live menu is missing "${must}" after the update`);
  }
  if (html.includes(">$15<")) throw new Error("The live menu still shows the old Margherita price");
  const mail = await env.DB.prepare(`SELECT 1 AS n FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The customer was not told the menu is updated");
  const usage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id = ?`).bind(s.subscriptionId).first();
  if (Number(usage?.n) < 1) throw new Error("The AI step logged no token usage");
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: "Update approved and live at the same address; other items untouched; customer emailed; AI usage logged" });
}

const STAGES = { START: stageStart, AWAIT_OWNER_REQUEST: stageAwaitOwnerRequest, AWAIT_LIVE: stageAwaitLive };

async function failTest(env, test, message) {
  const s = state(test);
  let detail = "";
  if (s.projectId) {
    const run = await env.DB.prepare(`SELECT id, status, error_message FROM workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`).bind(s.projectId).first().catch(() => null);
    if (run) {
      const steps = (await env.DB.prepare(`SELECT step_key, status FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_order`).bind(run.id).all().catch(() => ({ results: [] }))).results || [];
      detail = `run ${run.status}${run.error_message ? ` (${run.error_message})` : ""}; ${steps.map((x) => `${x.step_key}=${x.status}`).join(", ")}`;
    }
  }
  const failed = await updateTest(env, test, { status: "FAILED", error: `${message}${detail ? ` | ${detail}` : ""}`.slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Menu Care self-test failed",
    html: brandedEmailHtml({
      preheader: "The automated test of Menu Care failed.",
      eyebrow: "SELF-TEST",
      heading: "The Menu Care self-test failed",
      paragraphs: ["A test menu change did not go live as expected. Real customers' menu changes may hit the same problem."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]]
    }),
    text: `The Menu Care self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`,
    purpose: "AUTOMATION_ALERT",
    templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceMenuCareSelfTests(env, app) {
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

export { advanceMenuCareSelfTests, maybeScheduleDaily, REQUEST as SELFTEST_REQUEST };
