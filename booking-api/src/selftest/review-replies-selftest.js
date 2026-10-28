// Self-test for Review Replies (stage 5), run by the worker's 5-minute schedule and once a day.
// Uses the owner's own connected Google profile (Menu-Made). That profile has no reviews, so the test adds two synthetic
// reviews (5 stars and 2 stars) to what Google returns. Everything else is real: the Google token refresh, the review
// list and profile read, the shared AI step drafting both replies, the routing (5 stars posted on its own, 2 stars to the
// owner), the owner approval email, "Request changes" redrafting once from the owner's note, approval, and the posting
// call. Posting goes to Google's real reply endpoint for the synthetic review ids, which must answer 404 (no such review):
// that proves the token, scope, endpoint and request reach the reply API without posting anything public.
// Start one by inserting a self_tests row, kind REVIEW_REPLIES_RUN, status REQUESTED. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { OWNER } from "../google/connect.js";
import { googleConfig } from "../google/oauth.js";
import { PROMISE } from "../producers/review-replies/draft.js";
import { SELFTEST_SOURCE } from "../producers/review-replies/review-step.js";
import { ensureProductionWorkflow } from "../workflows/definitions.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "REVIEW_REPLIES_RUN";
const STAGE_TIMEOUT_MINUTES = 25;
const DAILY_HOUR_UTC = 17; // 10:40am Pacific, after the 10am Google check
const NOTE = "Keep it to two sentences and apologise for the wait.";
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 40 || !googleConfig(env)) return;
  const owner = await env.DB.prepare(`SELECT 1 FROM google_connections WHERE subscription_id = ? AND status = 'ACTIVE'`).bind(OWNER).first();
  if (!owner) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

async function stageStart(env, app, test) {
  const owner = await env.DB.prepare(`SELECT status FROM google_connections WHERE subscription_id = ?`).bind(OWNER).first();
  if (owner?.status !== "ACTIVE") throw new Error(`The owner's Google profile is ${owner?.status || "not connected"}: open ${publicBaseUrl(env)}/api/google/connect/owner`);
  const t = nowIso();
  const short = test.id.slice(0, 8);
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'REVIEW_REPLIES' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Review Replies offer is not in the catalog");
  const businessId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Review Replies Self-Test Cafe')`).bind(businessId, t, t).run();
  // Cancelled from the start: it exists only so settings and AI usage have an owner, and can never create period jobs.
  await env.DB.prepare(`
      INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval,
        amount_cents, current_period_start, current_period_end, started_at, cancelled_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CANCELLED', 'MONTH', 0, ?, ?, ?, ?, ?, ?)
    `).bind(subscriptionId, customer.id, businessId, offer.offer_id, offer.version_id, `sub_selftest_reviews_${short}`, `cus_selftest_reviews_${short}`, t, t, t, t, t, t).run();
  for (const [key, value] of [["reply_sign_off", "Sam, owner"], ["reply_complaints", "Email us at info@menu-made.com"]]) {
    await env.DB.prepare(`INSERT INTO subscription_settings (subscription_id, setting_key, value_text, updated_at) VALUES (?, ?, ?, ?)`).bind(subscriptionId, key, value, t).run();
  }
  await env.DB.prepare(`
      INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes)
      VALUES (?, ?, ?, ?, ?, 'READY_FOR_PRODUCTION', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)
    `).bind(orderId, t, t, customer.id, businessId, `cs_test_reviews_${short}`, t, `Review Replies self-test ${test.id}`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')`)
    .bind(itemId, orderId, offer.offer_id, offer.version_id).run();
  const reviews = [
    { id: `${short}-five`, starRating: "FIVE", reviewer: "Jordan Avery", comment: "Best margherita in town. The crust was perfect and our server Lena was lovely. We'll be back!" },
    { id: `${short}-two`, starRating: "TWO", reviewer: "Casey Morgan", comment: "We waited 40 minutes for two pizzas and they arrived lukewarm. Call me on 510-555-0199 if you care." }
  ];
  await env.DB.prepare(`
      INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, 'VISIBILITY', 'READY', 'REVIEW_REPLIES_V1', 1, 'NORMAL', 0, ?, ?, ?)
    `).bind(projectId, orderId, itemId, businessId, customer.id, t, t, JSON.stringify({ source: SELFTEST_SOURCE, self_test_id: test.id, subscription_id: subscriptionId, google_subscription_id: OWNER, selftest_reviews: reviews })).run();
  await ensureProductionWorkflow(projectId, "REVIEW_REPLIES_V1", 1, customer.id, orderId, env);
  return updateTest(env, test, {
    status: "RUNNING", stage: "AWAIT_OWNER", project_id: projectId, order_id: orderId,
    state: { projectId, subscriptionId, five: reviews[0].id, two: reviews[1].id },
    log: "Synthetic subscriber on the owner's Google profile with a 5-star and a 2-star review"
  });
}

const rowFor = (env, s, suffix) => env.DB.prepare(`SELECT * FROM review_replies WHERE project_id = ? AND review_name LIKE ?`).bind(s.projectId, `%/reviews/menu-made-selftest-${suffix}`).first();

async function pendingNotified(env, projectId, revision) {
  return env.DB.prepare(`
      SELECT id, revision_number FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' AND revision_number = ?
        AND json_extract(metadata_json, '$.owner_notified_at') IS NOT NULL LIMIT 1
    `).bind(projectId, revision).first();
}

async function post(env, app, approvalId, fields) {
  const form = new FormData();
  form.append("t", await signLinkToken(env, { kind: "approve", id: approvalId, ttlDays: 1 }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const response = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approvalId}`, { method: "POST", body: form }));
  return { status: response.status, html: await response.text() };
}

function checkDraft(row, label) {
  if (!row) throw new Error(`No reply was drafted for the ${label} review`);
  const reply = String(row.draft_reply || "");
  if (reply.length < 15) throw new Error(`The ${label} reply is empty or too short`);
  if (PROMISE.test(reply)) throw new Error(`The ${label} reply promises compensation: ${reply}`);
  if (reply.replace(/\D/g, "").includes("5105550199")) throw new Error(`The ${label} reply repeats the reviewer's phone number`);
}

async function stageAwaitOwner(env, app, test) {
  const s = state(test);
  const approval = await pendingNotified(env, s.projectId, 1);
  if (!approval) return null;
  const five = await rowFor(env, s, s.five);
  const two = await rowFor(env, s, s.two);
  checkDraft(five, "5-star"); checkDraft(two, "2-star");
  if (five.route !== "AUTO") throw new Error(`The 5-star reply was routed ${five.route} (${five.route_reason})`);
  if (five.status !== "PROBED") throw new Error(`The 5-star reply was not sent to Google before the owner step: ${five.status}${five.error ? ` (${five.error})` : ""}`);
  if (two.route !== "OWNER" || two.status !== "DRAFTED") throw new Error(`The 2-star reply should wait for the owner, but is ${two.route}/${two.status}`);
  const page = await env.DB.prepare(`SELECT 1 FROM deliverables WHERE project_id = ? AND deliverable_type = 'REVIEW_REPLY_DRAFTS'`).bind(s.projectId).first();
  if (!page) throw new Error("The owner's drafts page was not made");
  const asked = await post(env, app, approval.id, { action: "changes", note: NOTE });
  if (asked.status !== 200 || !/being redone/.test(asked.html)) throw new Error(`Request changes did not start a redraft (HTTP ${asked.status})`);
  return updateTest(env, test, { stage: "AWAIT_REDRAFT", state: { ...s, firstDraft: two.draft_reply },
    log: `5-star auto-routed and its reply call reached Google (404 for the synthetic review); 2-star waited for the owner; owner asked for changes` });
}

async function stageAwaitRedraft(env, app, test) {
  const s = state(test);
  const approval = await pendingNotified(env, s.projectId, 2);
  if (!approval) return null;
  const two = await rowFor(env, s, s.two);
  checkDraft(two, "redrafted 2-star");
  if (two.draft_reply === s.firstDraft) throw new Error("The redraft is identical to the first draft");
  const approved = await post(env, app, approval.id, { action: "approve" });
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_DONE", log: "Redraft arrived as a fresh approval; approved through the approve page" });
}

async function stageAwaitDone(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status !== "DELIVERED") return null;
  const two = await rowFor(env, s, s.two);
  if (two?.status !== "PROBED") throw new Error(`The approved 2-star reply was not sent to Google: ${two?.status}${two?.error ? ` (${two.error})` : ""}`);
  const mail = await env.DB.prepare(`SELECT 1 FROM communications WHERE project_id = ? AND purpose = 'REVIEW_SUMMARY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The weekly summary email was not sent");
  const usage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id = ?`).bind(s.subscriptionId).first();
  if (Number(usage?.n) < 2) throw new Error("The AI step did not log usage for the draft and the redraft");
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: "Approved reply's call reached Google (404 for the synthetic review); weekly summary sent; AI usage logged" });
}

const STAGES = { START: stageStart, AWAIT_OWNER: stageAwaitOwner, AWAIT_REDRAFT: stageAwaitRedraft, AWAIT_DONE: stageAwaitDone };

async function failTest(env, test, message) {
  const s = state(test);
  let detail = "";
  if (s.projectId) {
    const run = await env.DB.prepare(`SELECT id, status, error_message FROM workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`).bind(s.projectId).first().catch(() => null);
    if (run) {
      const steps = (await env.DB.prepare(`SELECT step_key, status, error_message FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_order`).bind(run.id).all().catch(() => ({ results: [] }))).results || [];
      detail = `run ${run.status}${run.error_message ? ` (${run.error_message})` : ""}; ${steps.map((x) => `${x.step_key}=${x.status}${x.error_message ? ` (${x.error_message})` : ""}`).join(", ")}`;
    }
  }
  const failed = await updateTest(env, test, { status: "FAILED", error: `${message}${detail ? ` | ${detail}` : ""}`.slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Review Replies self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of Review Replies failed.", eyebrow: "SELF-TEST", heading: "The Review Replies self-test failed",
      paragraphs: ["A test review did not get its reply drafted, approved and sent to Google as expected. Real customers' replies may hit the same problem."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Review Replies self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceReviewRepliesSelfTests(env, app) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2`).bind(KIND).all()).results || [];
  const results = [];
  for (let test of tests) {
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

export { advanceReviewRepliesSelfTests, maybeScheduleDaily, KIND };
