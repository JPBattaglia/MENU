// Self-test for Google Visibility (stage 5), run by the worker's 5-minute schedule and once a day.
// A synthetic one-time order on the owner's own Google profile (Menu-Made). The profile is really read and audited; the
// description, website, menu link and photo checks are made to look empty so every kind of change is planned. Real: the
// Google token and reads, the shared AI step writing the description, the owner approval email and approve page, and the
// buyer's report email. Writes: the description and website go to the real profile with validateOnly (Google checks
// them and changes nothing); the menu link and the photo go to a location id that does not exist (Google refuses:
// 403 for the Business Information attribute call, 400 for the v4 photo call, as seen live Oct 28, 2026).
// Start one by inserting a self_tests row, kind GOOGLE_VISIBILITY_RUN, status REQUESTED. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { sha256Hex } from "../lib/util.js";
import { OWNER } from "../google/connect.js";
import { googleConfig } from "../google/oauth.js";
import { mediaUrl } from "../producers/google-care/library.js";
import { SELFTEST_SOURCE } from "../producers/google-visibility/visibility-step.js";
import { ensureProductionWorkflow } from "../workflows/definitions.js";
import { PHOTO_PNG } from "./google-care-selftest.js";
import { updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "GOOGLE_VISIBILITY_RUN";
const STAGE_TIMEOUT_MINUTES = 25;
const DAILY_HOUR_UTC = 18; // 11am Pacific (PDT)
const ABOUT = "Family-run trattoria in North Beach since the owners moved from Bologna. Fresh pasta rolled every morning, slow-cooked ragù and a small natural wine list. Big tables for families and groups.";
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() > 10 || !googleConfig(env)) return;
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
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'GOOGLE_VISIBILITY' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Google Visibility offer is not in the catalog");
  const [businessId, orderId, itemId, projectId, photoId] = Array.from({ length: 5 }, () => crypto.randomUUID());
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Visibility Self-Test Trattoria')`).bind(businessId, t, t).run();
  const bytes = Uint8Array.from(atob(PHOTO_PNG), (c) => c.charCodeAt(0));
  const key = `selftest/google-visibility/${test.id}/photo.png`;
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, width_px, height_px,
        status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, NULL, 'PHOTO', 'R2', ?, 'photo.png', 'image/png', ?, ?, 300, 300, 'VALID', ?, ?, 1, 0, 1, '{}')
    `).bind(photoId, businessId, customer.id, key, bytes.length, await sha256Hex(bytes), t, t).run();
  await env.DB.prepare(`
      INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes)
      VALUES (?, ?, ?, ?, ?, 'READY_FOR_PRODUCTION', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)
    `).bind(orderId, t, t, customer.id, businessId, `cs_test_gvis_${short}`, t, `Google: existing profile\nGoogle Visibility self-test ${test.id}`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')`)
    .bind(itemId, orderId, offer.offer_id, offer.version_id).run();
  const meta = {
    source: SELFTEST_SOURCE, self_test_id: test.id, google_subscription_id: OWNER,
    selftest_blank: ["description", "website", "menu_link", "photos"],
    selftest_sources: { website: "https://menu-made.com/", menu: `${publicBaseUrl(env)}/api/menu/visibility-self-test`, about: ABOUT, photoAssetIds: [photoId] }
  };
  await env.DB.prepare(`
      INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, 'VISIBILITY', 'READY', 'GOOGLE_VISIBILITY_V1', 1, 'NORMAL', 0, ?, ?, ?)
    `).bind(projectId, orderId, itemId, businessId, customer.id, t, t, JSON.stringify(meta)).run();
  await ensureProductionWorkflow(projectId, "GOOGLE_VISIBILITY_V1", 1, customer.id, orderId, env);
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_OWNER", project_id: projectId, order_id: orderId,
    state: { projectId, photoId }, log: "Synthetic Google Visibility order on the owner's Google profile (description, website, menu link and photos treated as empty)" });
}

async function stageAwaitOwner(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status, blocked_reason FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status === "FAILED") throw new Error(`The run failed: ${project.blocked_reason || "no reason recorded"}`);
  const approval = await env.DB.prepare(`
      SELECT id FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' AND json_extract(metadata_json, '$.owner_notified_at') IS NOT NULL LIMIT 1
    `).bind(s.projectId).first();
  if (!approval) return null;
  const fixes = (await env.DB.prepare(`SELECT kind, status, value FROM visibility_fixes WHERE project_id = ?`).bind(s.projectId).all()).results || [];
  const kinds = fixes.map((f) => f.kind).sort().join(",");
  if (kinds !== "DESCRIPTION,MENU_LINK,PHOTO,WEBSITE") throw new Error(`Planned changes were ${kinds || "none"}, expected DESCRIPTION, MENU_LINK, PHOTO and WEBSITE`);
  const description = String(fixes.find((f) => f.kind === "DESCRIPTION").value || "");
  if (description.length < 250 || description.length > 750) throw new Error(`The new description is ${description.length} characters`);
  if (!/pasta|ragù|ragu|trattoria/i.test(description)) throw new Error(`The description ignores what the owner wrote: ${description}`);
  if (/https?:|www\.|\$\d|\d{3}[\s.-]\d{3}[\s.-]\d{4}/i.test(description)) throw new Error(`The description contains a link, price or phone number: ${description}`);
  const plan = await env.DB.prepare(`SELECT 1 FROM deliverables WHERE project_id = ? AND deliverable_type = 'GOOGLE_VISIBILITY_PLAN'`).bind(s.projectId).first();
  if (!plan) throw new Error("The owner's review page was not made");
  if (fixes.some((f) => f.status !== "PLANNED")) throw new Error("Something was published before the owner approved");
  const form = new FormData();
  form.append("t", await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 }));
  form.append("action", "approve");
  const response = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (response.status !== 200) throw new Error(`Approving failed (HTTP ${response.status})`);
  return updateTest(env, test, { stage: "AWAIT_DONE", state: { ...s, description },
    log: "Audit planned the description, website, menu link and photo; nothing published before approval; approved through the approve page" });
}

async function stageAwaitDone(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status, blocked_reason FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status === "FAILED") throw new Error(`The run failed: ${project.blocked_reason || "no reason recorded"}`);
  if (project?.status !== "DELIVERED") return null;
  const fixes = (await env.DB.prepare(`SELECT kind, status, error FROM visibility_fixes WHERE project_id = ?`).bind(s.projectId).all()).results || [];
  for (const f of fixes) if (f.status !== "PROBED") throw new Error(`${f.kind} did not reach Google as expected: ${f.status}${f.error ? ` (${f.error})` : ""}`);
  for (const kind of ["DESCRIPTION", "WEBSITE"]) {
    if (!/validateOnly/.test(fixes.find((f) => f.kind === kind)?.error || "")) throw new Error(`${kind} was not validated by Google`);
  }
  const image = await app(new Request(await mediaUrl(env, s.photoId)));
  if (image.status !== 200 || image.headers.get("Content-Type") !== "image/png") throw new Error(`The photo link Google downloads from answered HTTP ${image.status}`);
  const report = await env.DB.prepare(`SELECT d.customer_visible, a.metadata_json FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ? AND d.deliverable_type = 'GOOGLE_VISIBILITY_REPORT'`).bind(s.projectId).first();
  if (Number(report?.customer_visible) !== 1) throw new Error("The report was not released to the customer");
  const scores = parseJsonOrNull(report.metadata_json)?.google_visibility || {};
  if (!(scores.after > scores.before)) throw new Error(`The score did not go up: ${scores.before} to ${scores.after}`);
  const mail = await env.DB.prepare(`SELECT 1 FROM communications WHERE project_id = ? AND template_key = 'delivery_google_visibility_v1' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The report email was not sent");
  return updateTest(env, test, { status: "PASSED", stage: "DONE",
    log: `Description and website validated by Google on the real profile (validateOnly); menu link and photo reached Google's write endpoints (${fixes.filter((f) => ["MENU_LINK", "PHOTO"].includes(f.kind)).map((f) => f.error).join("; ")}); score ${scores.before} -> ${scores.after}; report released and emailed` });
}

const STAGES = { START: stageStart, AWAIT_OWNER: stageAwaitOwner, AWAIT_DONE: stageAwaitDone };

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
    subject: "Google Visibility self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of Google Visibility failed.", eyebrow: "SELF-TEST", heading: "The Google Visibility self-test failed",
      paragraphs: ["A test Google Visibility order did not finish as expected. Real orders may hit the same problem."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Google Visibility self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceGoogleVisibilitySelfTests(env, app) {
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

export { advanceGoogleVisibilitySelfTests, maybeScheduleDaily, KIND };
