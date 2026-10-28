// Stage 5 exit test: "a sandbox subscriber connected to a test Google profile gets a month of replies and posts plus a
// report", plus the one-time Google Visibility order. One synthetic Growth-style subscriber (Review Replies and Google
// Profile Care together, as in the Growth and Pro bundles) on the owner's own Google profile (Menu-Made):
//   - Review Replies week 1: one synthetic 5-star review, answered automatically (the reply call reaches Google's real
//     reply endpoint, which refuses the synthetic review id with 404)
//   - Google Profile Care weeks 1-4: four weekly posts with the library photo; week 1 also a profile photo and the real
//     monthly Performance report; reviews are left to Review Replies (answered once, not twice)
//   - a Google Visibility self-test (GOOGLE_VISIBILITY_RUN) started alongside and required to pass
// Every write goes to Google's real endpoints for a location or review that does not exist, or with validateOnly, so
// nothing goes public. Run on demand: insert a self_tests row, kind STAGE5_EXIT, status REQUESTED. A failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { sha256Hex } from "../lib/util.js";
import { OWNER } from "../google/connect.js";
import { ensureProductionWorkflow } from "../workflows/definitions.js";
import { PHOTO_PNG } from "./google-care-selftest.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "STAGE5_EXIT";
const STAGE_TIMEOUT_MINUTES = 40;
const SPECIAL = "Pumpkin ravioli is back for autumn, $19.";
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function offerIds(env, code) {
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = ? AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).bind(code).first();
  if (!offer) throw new Error(`The ${code} offer is not in the catalog`);
  return offer;
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
  const care = await offerIds(env, "GOOGLE_PROFILE_CARE");
  const replies = await offerIds(env, "REVIEW_REPLIES");
  const [businessId, subscriptionId, orderId, photoId] = Array.from({ length: 4 }, () => crypto.randomUUID());
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Stage 5 Exit Test Trattoria')`).bind(businessId, t, t).run();
  // Cancelled from the start, as in the other Google self-tests: it owns settings, entitlements and AI usage, and the
  // daily pass never syncs it with Stripe or creates period jobs for it.
  await env.DB.prepare(`
      INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval,
        amount_cents, current_period_start, current_period_end, started_at, cancelled_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CANCELLED', 'MONTH', 0, ?, ?, ?, ?, ?, ?)
    `).bind(subscriptionId, customer.id, businessId, care.offer_id, care.version_id, `sub_selftest_exit5_${short}`, `cus_selftest_exit5_${short}`, t, t, t, t, t, t).run();
  for (const [type, offer] of [["REVIEW_REPLIES", replies], ["GOOGLE_PROFILE_CARE", care]]) {
    await env.DB.prepare(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), customer.id, businessId, subscriptionId, type, t, JSON.stringify({ offer_id: offer.offer_id, offer_version_id: offer.version_id, workflow_key: `${type}_V1`, self_test: test.id }), t, t).run();
  }
  for (const [key, value] of [["specials", SPECIAL], ["voice", "Warm, family-run"], ["reply_sign_off", "Sam, owner"]]) {
    await env.DB.prepare(`INSERT INTO subscription_settings (subscription_id, setting_key, value_text, updated_at) VALUES (?, ?, ?, ?)`).bind(subscriptionId, key, value, t).run();
  }
  const bytes = Uint8Array.from(atob(PHOTO_PNG), (c) => c.charCodeAt(0));
  const key = `selftest/stage5-exit/${test.id}/photo.png`;
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, width_px, height_px,
        status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, NULL, 'PHOTO', 'R2', ?, 'photo.png', 'image/png', ?, ?, 300, 300, 'VALID', ?, ?, 1, 0, 1, ?)
    `).bind(photoId, businessId, customer.id, key, bytes.length, await sha256Hex(bytes), t, t, JSON.stringify({ photo_library: subscriptionId })).run();
  await env.DB.prepare(`
      INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes)
      VALUES (?, ?, ?, ?, ?, 'READY_FOR_PRODUCTION', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)
    `).bind(orderId, t, t, customer.id, businessId, `cs_test_exit5_${short}`, t, `Stage 5 exit test ${test.id}`).run();

  const projects = [];
  const addProject = async (workflow, offer, meta) => {
    const itemId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')`)
      .bind(itemId, orderId, offer.offer_id, offer.version_id).run();
    await env.DB.prepare(`
        INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, 'VISIBILITY', 'READY', ?, 1, 'NORMAL', 0, ?, ?, ?)
      `).bind(projectId, orderId, itemId, businessId, customer.id, workflow, t, t, JSON.stringify({ self_test_id: test.id, subscription_id: subscriptionId, google_subscription_id: OWNER, ...meta })).run();
    await ensureProductionWorkflow(projectId, workflow, 1, customer.id, orderId, env);
    projects.push({ id: projectId, workflow, week: meta.selftest_week || 1 });
  };
  await addProject("REVIEW_REPLIES_V1", replies, { source: "REVIEW_REPLIES_SELFTEST", selftest_reviews: [{ id: `${short}-exit`, starRating: "FIVE", reviewer: "Robin Ellis", comment: "Lovely family place, the gnocchi were perfect." }] });
  for (const week of [1, 2, 3, 4]) await addProject("GOOGLE_PROFILE_CARE_V1", care, { source: "GOOGLE_PROFILE_CARE_SELFTEST", ...(week > 1 ? { selftest_week: week } : {}) });
  const visibilityTest = `${test.id}-gvis`.slice(0, 64);
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, 'GOOGLE_VISIBILITY_RUN', 'REQUESTED', ?, ?, ?)`).bind(visibilityTest, KIND, t, t).run();
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_DONE", order_id: orderId, project_id: projects[1].id,
    state: { subscriptionId, photoId, projects, visibilityTest },
    log: "Growth-style subscriber on the owner's Google profile: Review Replies week 1, Google Profile Care weeks 1-4, and a Google Visibility self-test" });
}

async function stageAwaitDone(env, app, test) {
  const s = state(test);
  const statuses = [];
  for (const p of s.projects) {
    const row = await env.DB.prepare(`SELECT status, blocked_reason FROM projects WHERE id = ?`).bind(p.id).first();
    if (row?.status === "FAILED") throw new Error(`${p.workflow} week ${p.week} failed: ${row.blocked_reason || "no reason recorded"}`);
    statuses.push(row?.status);
  }
  const visibility = await env.DB.prepare(`SELECT status, error FROM self_tests WHERE id = ?`).bind(s.visibilityTest).first();
  if (visibility?.status === "FAILED") throw new Error(`Google Visibility failed: ${visibility.error}`);
  if (statuses.some((x) => x !== "DELIVERED") || visibility?.status !== "PASSED") return null;

  const care = s.projects.filter((p) => p.workflow === "GOOGLE_PROFILE_CARE_V1");
  const items = (await env.DB.prepare(`SELECT * FROM profile_care_items WHERE subscription_id = ?`).bind(s.subscriptionId).all()).results || [];
  const posts = items.filter((i) => i.kind === "POST");
  if (posts.length !== 4) throw new Error(`Expected 4 weekly posts, found ${posts.length}`);
  for (const post of posts) {
    const summary = parseJsonOrNull(post.content)?.summary || "";
    if (post.status !== "PROBED") throw new Error(`A weekly post did not reach Google's post endpoint: ${post.status}${post.error ? ` (${post.error})` : ""}`);
    if (summary.length < 80) throw new Error(`A weekly post is too short: ${summary}`);
  }
  if (!posts.some((p) => /ravioli/i.test(parseJsonOrNull(p.content)?.summary || ""))) throw new Error("No weekly post featured the special");
  const photos = items.filter((i) => i.kind === "PHOTO");
  if (photos.length !== 1 || photos[0].project_id !== care[0].id || photos[0].status !== "PROBED") throw new Error(`Expected one profile photo in week 1, found ${photos.map((p) => p.status).join(", ") || "none"}`);
  const reports = items.filter((i) => i.kind === "REPORT");
  if (reports.length !== 1 || reports[0].project_id !== care[0].id || reports[0].status !== "PUBLISHED") throw new Error(`Expected one monthly report in week 1, found ${reports.length}`);
  const visible = await env.DB.prepare(`SELECT customer_visible FROM deliverables WHERE id = ?`).bind(reports[0].content).first();
  if (Number(visible?.customer_visible) !== 1) throw new Error("The monthly report was not released to the customer");

  const replies = (await env.DB.prepare(`SELECT project_id, status, error FROM review_replies WHERE subscription_id = ?`).bind(s.subscriptionId).all()).results || [];
  const rr = s.projects.find((p) => p.workflow === "REVIEW_REPLIES_V1");
  if (replies.length !== 1) throw new Error(`The review should be answered once (bundle), found ${replies.length} drafts`);
  if (replies[0].project_id !== rr.id || replies[0].status !== "PROBED") throw new Error(`The review reply did not reach Google from Review Replies: ${replies[0].status} (${replies[0].error || ""})`);
  for (const p of care) {
    const out = parseJsonOrNull((await env.DB.prepare(`SELECT ws.output_json FROM workflow_runs wr JOIN workflow_steps ws ON ws.workflow_run_id = wr.id AND ws.step_key = 'PRODUCE' WHERE wr.project_id = ?`).bind(p.id).first())?.output_json) || {};
    if (out.reviews !== "BY_REVIEW_REPLIES_PLAN") throw new Error(`Profile Care week ${p.week} handled reviews itself: ${JSON.stringify(out.reviews)}`);
  }
  const mails = await env.DB.prepare(`
      SELECT purpose, COUNT(*) AS n FROM communications WHERE project_id IN (${s.projects.map(() => "?").join(",")}) AND status = 'SENT' GROUP BY purpose
    `).bind(...s.projects.map((p) => p.id)).all();
  const sent = Object.fromEntries((mails.results || []).map((r) => [r.purpose, Number(r.n)]));
  if (sent.GOOGLE_CARE_SUMMARY !== 4) throw new Error(`Expected 4 weekly Profile Care emails, sent ${sent.GOOGLE_CARE_SUMMARY || 0}`);
  if (sent.REVIEW_SUMMARY !== 1) throw new Error(`Expected 1 Review Replies summary, sent ${sent.REVIEW_SUMMARY || 0}`);
  const ai = await env.DB.prepare(`
      SELECT COUNT(*) AS n, SUM(COALESCE(json_extract(payload_json, '$.input_tokens'), 0) + COALESCE(json_extract(payload_json, '$.output_tokens'), 0)) AS tokens
      FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id = ?`).bind(s.subscriptionId).first().catch(() => null);
  return updateTest(env, test, { status: "PASSED", stage: "DONE",
    log: `A month for one subscriber: 4 weekly posts and 1 profile photo reached Google's write endpoints, the real monthly report was made and released, the review was answered once by Review Replies, 4 weekly emails + 1 review summary sent${ai?.n ? `, ${ai.n} AI calls (${ai.tokens} tokens)` : ""}; Google Visibility self-test ${s.visibilityTest} PASSED` });
}

const STAGES = { START: stageStart, AWAIT_DONE: stageAwaitDone };

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: message.slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject: "Stage 5 exit test failed",
    html: brandedEmailHtml({ preheader: "The stage 5 exit test failed.", eyebrow: "SELF-TEST", heading: "The stage 5 exit test failed",
      paragraphs: ["A test month of the Google products did not finish as expected."], rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The stage 5 exit test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceStage5ExitTests(env, app) {
  if (!env.DB) return [];
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 1`).bind(KIND).all()).results || [];
  const results = [];
  for (let test of tests) {
    const stage = test.status === "REQUESTED" ? "START" : test.stage;
    try {
      const next = await STAGES[stage]?.(env, app, test);
      if (next) test = next;
      else if (Date.now() - Date.parse(test.stage_started_at || test.created_at) > STAGE_TIMEOUT_MINUTES * 60000) test = await failTest(env, test, `Timed out after ${STAGE_TIMEOUT_MINUTES} minutes waiting at ${stage}`);
    } catch (error) {
      test = await failTest(env, test, error instanceof Error ? error.message : String(error));
    }
    results.push({ id: test.id, status: test.status, stage: test.stage });
  }
  return results;
}

export { advanceStage5ExitTests, KIND };
