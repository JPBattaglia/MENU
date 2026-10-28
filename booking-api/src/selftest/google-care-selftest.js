// Self-test for Google Profile Care (stage 5), run by the worker's 5-minute schedule and once a day.
// A synthetic subscriber on the owner's own Google profile (Menu-Made), with specials in their settings, one library
// photo and one synthetic 5-star review. Real: the Google token, profile and review reads, the Performance API numbers
// in the monthly report, the shared AI step writing the post, the report summary and the review reply, the photo link
// Google would download, and the weekly email. Writes (the post, the profile photo, the review reply) go to Google's real
// endpoints for a location or review that does not exist, so Google refuses each one (400/404) and nothing goes public.
// Start one by inserting a self_tests row, kind GOOGLE_PROFILE_CARE_RUN, status REQUESTED. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { sha256Hex } from "../lib/util.js";
import { OWNER } from "../google/connect.js";
import { googleConfig } from "../google/oauth.js";
import { mediaUrl } from "../producers/google-care/library.js";
import { ensureProductionWorkflow } from "../workflows/definitions.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "GOOGLE_PROFILE_CARE_RUN";
const STAGE_TIMEOUT_MINUTES = 25;
const DAILY_HOUR_UTC = 17; // 10:50am Pacific
const SPECIAL = "Pumpkin ravioli is back for autumn, $19.";
// 300 x 300 PNG, Menu-Made teal.
const PHOTO_PNG = "iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAIAAAD2HxkiAAACeUlEQVR42u3TMQ0AAAzDsPInMgTjVwy79lgygkhJZoFPEoAJwYSACcGEgAnBhIAJwYSACcGEgAnBhIAJwYSACcGEgAnBhIAJwYSACcGEgAnBhIAJwYSACcGEgAnBhIAJwYSACcGEgAnBhIAJwYSACcGEgAnBhIAJwYSACcGEgAnBhIAJwYSACcGEgAnBhIAJwYSACcGEgAnBhIAJwYSACcGEYEIJwIRgQsCEYELAhGBCwIRgQsCEYELAhGBCwIRgQsCEYELAhGBCwIRgQsCEYELAhGBCwIRgQsCEYELAhGBCwIRgQsCEYELAhGBCwIRgQsCEYELAhGBCwIRgQsCEYELAhGBCwIRgQsCEYELAhGBCwIRgQsCEYELAhGBCwIRgQsCEYEIwoQpgQjAhYEIwIWBCMCFgQjAhYEIwIWBCMCFgQjAhYEIwIWBCMCFgQjAhYEIwIWBCMCFgQjAhYEIwIWBCMCFgQjAhYEIwIWBCMCFgQjAhYEIwIWBCMCFgQjAhYEIwIWBCMCFgQjAhYEIwIWBCMCFgQjAhYEIwIWBCMCFgQjAhYEIwIZgQMCGYEDAhmBAwIZgQMCGYEDAhmBAwIZgQMCGYEDAhmBAwIZgQMCGYEDAhmBAwIZgQMCGYEDAhmBAwIZgQMCGYEDAhmBAwIZgQMCGYEDAhmBAwIZgQMCGYEDAhmBAwIZgQMCGYEDAhmBAwIZgQMCGYEDAhmBAwIZgQMCGYEJAATAgmBEwIJgRMCCYETAgmBEwIJgRMCCYETAgmBEwIJgRMCCYETAgmBEwIJgRMCCYETAgmBEwIJgRMCCYETAgmBEwIJgRMCCYETAgmBEwIJgRuCtFNA8PXnr8aAAAAAElFTkSuQmCC";
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 50 || !googleConfig(env)) return;
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
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'GOOGLE_PROFILE_CARE' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Google Profile Care offer is not in the catalog");
  const [businessId, subscriptionId, orderId, itemId, projectId, photoId] = Array.from({ length: 6 }, () => crypto.randomUUID());
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Profile Care Self-Test Trattoria')`).bind(businessId, t, t).run();
  // Cancelled from the start: it only owns settings, the library photo and AI usage, and can never create period jobs.
  await env.DB.prepare(`
      INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval,
        amount_cents, current_period_start, current_period_end, started_at, cancelled_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CANCELLED', 'MONTH', 0, ?, ?, ?, ?, ?, ?)
    `).bind(subscriptionId, customer.id, businessId, offer.offer_id, offer.version_id, `sub_selftest_gcare_${short}`, `cus_selftest_gcare_${short}`, t, t, t, t, t, t).run();
  for (const [key, value] of [["specials", SPECIAL], ["voice", "Warm, family-run"], ["reply_sign_off", "Sam, owner"]]) {
    await env.DB.prepare(`INSERT INTO subscription_settings (subscription_id, setting_key, value_text, updated_at) VALUES (?, ?, ?, ?)`).bind(subscriptionId, key, value, t).run();
  }
  const bytes = Uint8Array.from(atob(PHOTO_PNG), (c) => c.charCodeAt(0));
  const key = `selftest/google-care/${test.id}/photo.png`;
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, width_px, height_px,
        status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, NULL, 'PHOTO', 'R2', ?, 'photo.png', 'image/png', ?, ?, 300, 300, 'VALID', ?, ?, 1, 0, 1, ?)
    `).bind(photoId, businessId, customer.id, key, bytes.length, await sha256Hex(bytes), t, t, JSON.stringify({ photo_library: subscriptionId })).run();
  await env.DB.prepare(`
      INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes)
      VALUES (?, ?, ?, ?, ?, 'READY_FOR_PRODUCTION', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)
    `).bind(orderId, t, t, customer.id, businessId, `cs_test_gcare_${short}`, t, `Google Profile Care self-test ${test.id}`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')`)
    .bind(itemId, orderId, offer.offer_id, offer.version_id).run();
  const reviews = [{ id: `${short}-care`, starRating: "FIVE", reviewer: "Robin Ellis", comment: "Lovely family place, the gnocchi were perfect." }];
  await env.DB.prepare(`
      INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, 'VISIBILITY', 'READY', 'GOOGLE_PROFILE_CARE_V1', 1, 'NORMAL', 0, ?, ?, ?)
    `).bind(projectId, orderId, itemId, businessId, customer.id, t, t, JSON.stringify({ source: "GOOGLE_PROFILE_CARE_SELFTEST", self_test_id: test.id, subscription_id: subscriptionId, google_subscription_id: OWNER, selftest_reviews: reviews, period_start: t })).run();
  await ensureProductionWorkflow(projectId, "GOOGLE_PROFILE_CARE_V1", 1, customer.id, orderId, env);
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_DONE", project_id: projectId, order_id: orderId,
    state: { projectId, subscriptionId, photoId }, log: "Synthetic subscriber on the owner's Google profile with specials, one library photo and a 5-star review" });
}

async function stageAwaitDone(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status, blocked_reason FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status === "FAILED") throw new Error(`The run failed: ${project.blocked_reason || "no reason recorded"}`);
  if (project?.status !== "DELIVERED") return null;
  const items = (await env.DB.prepare(`SELECT * FROM profile_care_items WHERE project_id = ?`).bind(s.projectId).all()).results || [];
  const post = items.find((i) => i.kind === "POST");
  const summary = parseJsonOrNull(post?.content)?.summary || "";
  if (post?.status !== "PROBED") throw new Error(`The weekly post did not reach Google's post endpoint: ${post?.status || "no post"}${post?.error ? ` (${post.error})` : ""}`);
  if (summary.length < 80) throw new Error(`The weekly post is too short: ${summary}`);
  if (!/ravioli/i.test(summary)) throw new Error(`The weekly post did not feature the special: ${summary}`);
  if (post.asset_id !== s.photoId) throw new Error("The weekly post did not use the library photo");
  const photo = items.find((i) => i.kind === "PHOTO");
  if (photo?.status !== "PROBED") throw new Error(`The library photo did not reach Google's photo endpoint: ${photo?.status || "none"}${photo?.error ? ` (${photo.error})` : ""}`);
  const image = await app(new Request(await mediaUrl(env, s.photoId)));
  if (image.status !== 200 || image.headers.get("Content-Type") !== "image/png") throw new Error(`The photo link Google downloads from answered HTTP ${image.status}`);
  const report = items.find((i) => i.kind === "REPORT");
  if (report?.status !== "PUBLISHED") throw new Error(`The monthly report was not made: ${report?.error || report?.status || "none"}`);
  const visible = await env.DB.prepare(`SELECT customer_visible FROM deliverables WHERE id = ?`).bind(report.content).first();
  if (Number(visible?.customer_visible) !== 1) throw new Error("The monthly report was not released to the customer");
  const reply = await env.DB.prepare(`SELECT status, error FROM review_replies WHERE project_id = ?`).bind(s.projectId).first();
  if (reply?.status !== "PROBED") throw new Error(`The review reply did not reach Google: ${reply?.status || "none"}${reply?.error ? ` (${reply.error})` : ""}`);
  const mail = await env.DB.prepare(`SELECT 1 FROM communications WHERE project_id = ? AND purpose = 'GOOGLE_CARE_SUMMARY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The weekly email was not sent");
  return updateTest(env, test, { status: "PASSED", stage: "DONE",
    log: `Post (featuring the special, with the library photo), profile photo and review reply reached Google's write endpoints (${post.error}; ${photo.error}); real Performance report made and released; photo link serves the image; weekly email sent` });
}

const STAGES = { START: stageStart, AWAIT_DONE: stageAwaitDone };

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
    subject: "Google Profile Care self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of Google Profile Care failed.", eyebrow: "SELF-TEST", heading: "The Google Profile Care self-test failed",
      paragraphs: ["A test week of Google Profile Care did not finish as expected. Real customers' posts, photos or reports may hit the same problem."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Google Profile Care self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceGoogleCareSelfTests(env, app) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2`).bind(KIND).all()).results || [];
  const results = [];
  for (let test of tests) {
    for (let guard = 0; guard < 3; guard++) {
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

export { advanceGoogleCareSelfTests, maybeScheduleDaily, KIND, PHOTO_PNG };
