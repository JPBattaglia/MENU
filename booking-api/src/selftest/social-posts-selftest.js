// Sandbox self-test for Social Posts (stage 6), run by the worker's 5-minute schedule and once a day.
// A synthetic customer with a live menu gets this month's posts from the REAL AI step, with the PNGs drawn by the REAL
// GitHub Actions renderer (resvg; see producers/social-posts/render-jobs.js). The owner approval is clicked through the approve page, then the delivered ZIP is opened:
// it must hold 12 feed + 12 story PNGs at the right sizes plus the captions file. Only a failure emails the owner.
// Start one by inserting a self_tests row, kind SOCIAL_POSTS_RUN, status REQUESTED.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { sha256Hex } from "../lib/util.js";
import { buildDesignedMenuHtml } from "../producers/menu-qr/design.js";
import { listZip as readZip } from "../producers/social-posts/render-jobs.js"; // no JS checksums: 10 ms CPU per run
import { ensureProductionWorkflow } from "../workflows/definitions.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "SOCIAL_POSTS_RUN";
const STAGE_TIMEOUT_MINUTES = 60; // the PNGs are drawn by a scheduled GitHub workflow, which GitHub can start late
const DAILY_HOUR_UTC = 17;
const MENU = { sections: [{ name: "Pizza", items: [{ name: "Margherita", description: "Mozzarella and basil", price: "$15" }, { name: "Pepperoni", description: "", price: "$17.50" }] }, { name: "Drinks", items: [{ name: "Espresso", description: "", price: "$4" }] }], notes: "" };
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
  const social = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'SOCIAL_POSTS' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!social) throw new Error("The Social Posts offer is not in the catalog");
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const id = () => crypto.randomUUID();
  const businessId = id(); const menuOrder = id(); const menuItem = id(); const menuProject = id(); const assetId = id();
  const orderId = id(); const itemId = id(); const projectId = id(); const subscriptionId = id();
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Social Posts Self-Test Cafe')`).bind(businessId, t, t).run();
  for (const [oid, iid, pid, key, wf, status] of [[menuOrder, menuItem, menuProject, "menu", "MENU_QR_V1", "DELIVERED"], [orderId, itemId, projectId, "social", "SOCIAL_POSTS_V1", "READY"]]) {
    await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes) VALUES (?, ?, ?, ?, ?, ?, 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)`)
      .bind(oid, t, t, customer.id, businessId, key === "menu" ? "DELIVERED" : "READY_FOR_PRODUCTION", `cs_test_social_${key}_${short}`, t, `Social Posts self-test ${test.id}`).run();
    await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')`).bind(iid, oid, social.offer_id, social.version_id).run();
    await env.DB.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, 'OTHER', ?, ?, 1, 'NORMAL', 0, ?, ?, ?)`)
      .bind(pid, oid, iid, businessId, customer.id, status, wf, t, t, JSON.stringify({ source: key === "menu" ? "SOCIAL_SELFTEST_MENU" : "SOCIAL_SELFTEST", self_test_id: test.id, subscription_id: subscriptionId, period_start: t })).run();
  }
  const html = buildDesignedMenuHtml({ businessName: "Social Posts Self-Test Cafe", brandColors: "#071f2c, #00d6e6", menu: MENU, logoDataUri: null });
  const bytes = new TextEncoder().encode(html);
  const key = `selftest/social-posts/${test.id}/menu.html`;
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await env.DB.prepare(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json) VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, 'menu.html', 'text/html', ?, ?, 'VALID', ?, ?, 1, 0, 1, '{}')`)
    .bind(assetId, businessId, customer.id, menuProject, key, bytes.byteLength, await sha256Hex(bytes), t, t).run();
  await env.DB.prepare(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES (?, ?, ?, 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`).bind(id(), menuProject, assetId, t, t).run();
  await ensureProductionWorkflow(projectId, "SOCIAL_POSTS_V1", 1, customer.id, orderId, env);
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_OWNER_REQUEST", project_id: projectId, order_id: orderId, state: { projectId, subscriptionId }, log: "Synthetic customer with a live menu is waiting for this month's posts" });
}

async function stageAwaitOwnerRequest(env, app, test) {
  const s = state(test);
  const approval = await env.DB.prepare(`SELECT id, json_extract(metadata_json, '$.owner_notified_at') AS notified FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1`).bind(s.projectId).first();
  if (!approval) {
    const run = await env.DB.prepare(`SELECT ws.output_json AS output_json FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id WHERE wr.project_id = ? AND ws.step_key = 'PRODUCE' AND ws.status = 'SUCCEEDED'`).bind(s.projectId).first();
    const out = parseJsonOrNull(run?.output_json);
    if (out?.outcome === "NOT_PRODUCED") throw new Error(`The posts were not produced: ${(out.reasons || []).join("; ")}`);
    return null;
  }
  if (!approval.notified) return null;
  const pack = await env.DB.prepare(`SELECT a.storage_key FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ? AND d.deliverable_type = 'SOCIAL_PACK' ORDER BY d.version DESC LIMIT 1`).bind(s.projectId).first();
  const object = pack ? await env.ASSETS.get(pack.storage_key) : null;
  if (!object) throw new Error("The graphics pack is missing from storage");
  const entries = readZip(new Uint8Array(await object.arrayBuffer()));
  const pngs = entries.filter((e) => e.name.endsWith(".png"));
  if (pngs.length !== 24 || !entries.some((e) => e.name === "captions-and-calendar.txt")) throw new Error(`The pack holds ${pngs.length} PNGs, expected 24 plus the captions file`);
  for (const png of pngs) {
    const v = new DataView(png.data.buffer, png.data.byteOffset, png.data.byteLength);
    const signature = png.data.length > 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a;
    const wanted = png.name.endsWith("-story.png") ? 1920 : 1080;
    if (!signature || v.getUint32(16) !== 1080 || v.getUint32(20) !== wanted) throw new Error(`${png.name} is not a valid 1080x${wanted} PNG`);
    if (png.data.length < 8000) throw new Error(`${png.name} is only ${png.data.length} bytes, so the text probably did not render`);
  }
  const token = await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 });
  const form = new FormData();
  form.append("t", token);
  const approved = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_DELIVERED", log: `Owner email sent; pack holds ${pngs.length} valid PNGs and the captions file; approved through the approve page` });
}

async function stageAwaitDelivered(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status !== "DELIVERED") return null;
  const mail = await env.DB.prepare(`SELECT 1 AS n FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The customer was not emailed their posts");
  const usage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id = ?`).bind(s.subscriptionId).first();
  if (Number(usage?.n) < 1) throw new Error("The AI step logged no token usage");
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: "Posts delivered to the customer after approval; AI usage logged" });
}

const STAGES = { START: stageStart, AWAIT_OWNER_REQUEST: stageAwaitOwnerRequest, AWAIT_DELIVERED: stageAwaitDelivered };

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Social Posts self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of Social Posts failed.", eyebrow: "SELF-TEST", heading: "The Social Posts self-test failed",
      paragraphs: ["A test month of posts did not come out as expected. Real customers' posts may hit the same problem."], rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Social Posts self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceSocialPostsSelfTests(env, app) {
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

export { advanceSocialPostsSelfTests };
