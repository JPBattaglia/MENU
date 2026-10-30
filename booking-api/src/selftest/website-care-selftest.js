// Sandbox self-test for Website & App Care (stage 7), run by the worker's 5-minute schedule and once a day.
// A synthetic customer with a live website asks for a menu change through the real intake code. The real shared AI step edits
// the site, the real approval flow asks the owner (the test approves through the approve page), and the same address must then
// show the new price and dish while everything else is untouched. The test also runs the real health check against the
// public address, which proves the Worker can reach its own site the way the daily monitor will.
// Start one by inserting a self_tests row, kind WEBSITE_CARE_RUN, status REQUESTED. Only a failure emails the owner.
// The synthetic subscription is cancelled as soon as the request exists, so it can never create period jobs.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { sha256Hex } from "../lib/util.js";
import { buildSite } from "../producers/website/build.js";
import { checkOne } from "../producers/website-care/health.js";
import { createSiteChangeRequest } from "../producers/website-care/intake.js";
import { updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "WEBSITE_CARE_RUN";
const STAGE_TIMEOUT_MINUTES = 25;
const DAILY_HOUR_UTC = 17;
const REQUEST = "Raise the Margherita to $16 and add Garlic Bread, $6, under Starters.";
const SITE = {
  name: "Website Care Self-Test Cafe", kind: "restaurant", about: "A small family cafe that bakes bread every morning.",
  offerings: "# Starters\nTomato Soup | Basil and cream | $9\n# Pizza\nMargherita | Mozzarella and basil | $15\nPepperoni | Spicy | $17.50",
  phone: "(512) 555-0147", address: "123 Main Street, Austin, TX", hours: "Mon-Fri: 7am-3pm\nSat: 8am-2pm", email: "", style: "modern", brand: "", facebook: "", instagram: "", photos: [], logo: null
};
const COPY = {
  tagline: "Fresh bread and soup daily", intro: "Website Care Self-Test Cafe is a small family cafe that bakes bread every morning and serves lunch.",
  about: ["Website Care Self-Test Cafe is a small family cafe. We bake bread every morning and serve soup and pizza at lunch for our neighbours."],
  meta_description: "Website Care Self-Test Cafe bakes bread every morning and serves soup and pizza at lunch in Austin.", meta_about: "About Website Care Self-Test Cafe, a small family cafe in Austin."
};
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function loadActiveTests(env) {
  return (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2`).bind(KIND).all()).results || [];
}

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 40) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

async function livePage(app, env, slug, page) {
  const response = await app(new Request(`${publicBaseUrl(env)}/api/site/${slug}/${page}`));
  return { status: response.status, html: await response.text() };
}

// A synthetic customer, business, Website & App Care subscription and an approved live website.
async function scaffold(env, test) {
  const t = nowIso();
  // Letters and digits only: a hand-named id like "wpkg-st-1" once made the invalid address "selftest-wpkg-st-".
  const short = String(test.id).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x";
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const care = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'WEBSITE_CARE' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  const pkg = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'WEBSITE_PACKAGE' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!care || !pkg) throw new Error("The Website & App Care or Website Package offer is not in the catalog");
  const businessId = crypto.randomUUID(); const subscriptionId = crypto.randomUUID(); const orderId = crypto.randomUUID();
  const itemId = crypto.randomUUID(); const projectId = crypto.randomUUID(); const assetId = crypto.randomUUID();
  const slug = `carest-${short}`;
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Website Care Self-Test Cafe')`).bind(businessId, t, t).run();
  await env.DB.prepare(`
      INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval,
        amount_cents, current_period_start, current_period_end, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'MONTH', 0, ?, ?, ?, ?, ?)
    `).bind(subscriptionId, customer.id, businessId, care.offer_id, care.version_id, `sub_selftest_sitecare_${short}`, `cus_selftest_sitecare_${short}`, t, t, t, t, t).run();
  await env.DB.prepare(`
      INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'WEBSITE_CARE', 'ACTIVE', ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), customer.id, businessId, subscriptionId, t, JSON.stringify({ offer_id: care.offer_id, offer_version_id: care.version_id, workflow_key: "WEBSITE_CARE_V1", environment: "sandbox" }), t, t).run();
  await env.DB.prepare(`
      INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes)
      VALUES (?, ?, ?, ?, ?, 'DELIVERED', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)
    `).bind(orderId, t, t, customer.id, businessId, `cs_test_sitecare_${short}`, t, `Website & App Care self-test ${test.id}`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'FULFILLED')`).bind(itemId, orderId, pkg.offer_id, pkg.version_id).run();
  await env.DB.prepare(`
      INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, 'WEBSITE', 'DELIVERED', 'WEBSITE_PACKAGE_V1', 1, 'NORMAL', 0, ?, ?, ?)
    `).bind(projectId, orderId, itemId, businessId, customer.id, t, t, JSON.stringify({ source: "WEBSITE_CARE_SELFTEST", self_test_id: test.id })).run();
  await env.DB.prepare(`INSERT INTO website_sites (id, slug, project_id, business_id, customer_id, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'modern', ?, ?)`).bind(crypto.randomUUID(), slug, projectId, businessId, customer.id, t, t).run();
  const build = { version: 1, slug, style: "modern", built_at: t, pages: buildSite(SITE, COPY), images: [], site: SITE, copy: COPY };
  const bytes = new TextEncoder().encode(JSON.stringify(build));
  const key = `selftest/website-care/${test.id}/build.json`;
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: "application/json" } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, 'build.json', 'application/json', ?, ?, 'VALID', ?, ?, 1, 0, 1, ?)
    `).bind(assetId, businessId, customer.id, projectId, key, bytes.byteLength, await sha256Hex(bytes), t, t, JSON.stringify({ website: { slug } })).run();
  await env.DB.prepare(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES (?, ?, ?, 'SITE_BUILD', 1, 'FINAL', 1, ?, ?)`).bind(crypto.randomUUID(), projectId, assetId, t, t).run();
  return { subscriptionId, businessId, slug };
}

async function stageStart(env, app, test) {
  const scaffolding = await scaffold(env, test);
  const before = await livePage(app, env, scaffolding.slug, "menu.html");
  if (before.status !== 200 || !before.html.includes("$15")) throw new Error(`The synthetic live website is not served (HTTP ${before.status})`);
  const created = await createSiteChangeRequest(env, scaffolding.subscriptionId, REQUEST, { source: "SELFTEST" });
  await env.DB.prepare(`UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = ?, updated_at = ? WHERE id = ?`).bind(nowIso(), nowIso(), scaffolding.subscriptionId).run();
  await env.DB.prepare(`UPDATE entitlements SET status = 'EXPIRED', updated_at = ? WHERE subscription_id = ?`).bind(nowIso(), scaffolding.subscriptionId).run();
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_OWNER_REQUEST", project_id: created.projectId,
    state: { ...scaffolding, requestId: created.requestId, projectId: created.projectId }, log: "Synthetic customer with a live website asked for a price change and a new dish" });
}

async function stageAwaitOwnerRequest(env, app, test) {
  const s = state(test);
  const request = await env.DB.prepare(`SELECT status, result_json FROM site_change_requests WHERE id = ?`).bind(s.requestId).first();
  if (request?.status === "NOT_APPLIED") throw new Error(`The request was not applied: ${(parseJsonOrNull(request.result_json)?.reasons || []).join("; ")}`);
  const approval = await env.DB.prepare(`SELECT id, json_extract(metadata_json, '$.owner_notified_at') AS notified FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1`).bind(s.projectId).first();
  if (!approval || !approval.notified) return null;
  const draft = await env.DB.prepare(`SELECT a.metadata_json FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ? AND d.deliverable_type = 'SITE_BUILD' ORDER BY d.version DESC LIMIT 1`).bind(s.projectId).first();
  const changes = parseJsonOrNull(draft?.metadata_json)?.care?.changes || [];
  if (!changes.some((l) => /Margherita/.test(l) && /\$16/.test(l))) throw new Error(`The draft does not show the Margherita price change: ${changes.join("; ") || "no changes listed"}`);
  if (!changes.some((l) => /Garlic Bread/i.test(l) && /Added/.test(l))) throw new Error(`The draft does not show Garlic Bread added: ${changes.join("; ")}`);
  if (changes.length !== 2) throw new Error(`The draft changed more than asked (${changes.length} changes): ${changes.join("; ")}`);
  const live = await livePage(app, env, s.slug, "menu.html");
  if (live.html.includes("Garlic Bread") || !live.html.includes("$15")) throw new Error("The live website changed before the owner approved");
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
  const live = await livePage(app, env, s.slug, "menu.html");
  for (const must of ["$16", "Garlic Bread", "$6", "Pepperoni", "$17.50", "Tomato Soup", "$9"]) if (!live.html.includes(must)) throw new Error(`The live website is missing "${must}" after the update`);
  if (live.html.includes(">$15<")) throw new Error("The live website still shows the old Margherita price");
  const home = await livePage(app, env, s.slug, "");
  if (home.status !== 200 || !home.html.includes("Fresh bread and soup daily")) throw new Error("The home page lost its copy after the update");
  const mail = await env.DB.prepare(`SELECT 1 AS n FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The customer was not told the website is updated");
  const usage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id = ?`).bind(s.subscriptionId).first();
  if (Number(usage?.n) < 1) throw new Error("The AI step logged no token usage");
  const health = await checkOne(env, s.slug, fetch);
  if (!health.ok) throw new Error(`The health check could not reach the live site through its public address: ${health.detail}`);
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: `Update live at the same address; other items untouched; customer emailed; AI usage logged; health check answered in ${health.ms} ms` });
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
    subject: "Website & App Care self-test failed",
    html: brandedEmailHtml({
      preheader: "The automated test of Website & App Care failed.",
      eyebrow: "SELF-TEST",
      heading: "The Website & App Care self-test failed",
      paragraphs: ["A test website change did not go live as expected. Real customers' website changes may hit the same problem."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]]
    }),
    text: `The Website & App Care self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`,
    purpose: "AUTOMATION_ALERT",
    templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceWebsiteCareSelfTests(env, app) {
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

export { advanceWebsiteCareSelfTests, maybeScheduleDaily, REQUEST as SELFTEST_REQUEST };
