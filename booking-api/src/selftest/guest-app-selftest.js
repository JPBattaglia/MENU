// Sandbox self-test for the Guest App (stage 8), run by the worker's 5-minute schedule.
// A synthetic paid Guest App Setup order fills in the REAL intake form (multipart POST with a real PNG logo); the REAL
// GitHub renderer draws the icons; the preview is checked (page, manifest, offline worker, icons at their exact pixel
// sizes) and must not be live yet; the owner approval is clicked through the approve page; then the live app is fetched.
// The app stays live afterwards, so a phone can install it from the address in the log (the stage 8 phone check).
// Daily at 1pm Pacific (stage 12: every offer's self-test runs daily), or start one by inserting a self_tests row,
// kind GUEST_APP_RUN, status REQUESTED. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { appUrl } from "../producers/guest-app/app-step.js";
import { intakeLink, startGuestAppIntake } from "../producers/guest-app/intake.js";
import { appPreviewUrl } from "../producers/guest-app/presenter.js";
import { pngSize } from "../producers/social-posts/render-jobs.js";
import { updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "GUEST_APP_RUN";
const DAILY_HOUR_UTC = 20;

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() >= 20) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = now.toISOString();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}
const STAGE_TIMEOUT_MINUTES = 40; // includes the GitHub renderer picking the job up
const NAME = "App Self-Test Cafe";
const state = (test) => parseJsonOrNull(test.state_json) || {};
// A valid 1x1 PNG (drawn into the icons as the logo).
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const ICONS = [["icons/icon-192.png", 192], ["icons/icon-512.png", 512], ["icons/maskable-512.png", 512], ["icons/apple-touch-icon.png", 180]];

const reasonOf = async (response) => {
  const page = await response.text();
  return (/<strong>([^<]+)<\/strong>/.exec(page)?.[1] || page.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 200);
};

// Every file a phone needs to install and run the app, from base (ending in /).
async function checkServedApp(app, base, label) {
  const page = await app(new Request(base));
  if (page.status !== 200) throw new Error(`${label}: the app page returned HTTP ${page.status}`);
  const html = await page.text();
  if (!html.includes(NAME) || !html.includes('rel="manifest"')) throw new Error(`${label}: the app page is missing the name or the manifest link`);
  const manifestRes = await app(new Request(`${base}manifest.webmanifest`));
  const manifest = await manifestRes.json().catch(() => null);
  if (manifestRes.headers.get("content-type") !== "application/manifest+json" || manifest?.display !== "standalone" || manifest.start_url !== "./") throw new Error(`${label}: the manifest is missing or incomplete`);
  const sw = await app(new Request(`${base}sw.js`));
  if (sw.status !== 200 || !/javascript/.test(sw.headers.get("content-type") || "") || !(await sw.text()).includes('addEventListener("fetch"')) throw new Error(`${label}: the offline worker is not served`);
  for (const [path, size] of ICONS) {
    const res = await app(new Request(`${base}${path}`));
    const bytes = new Uint8Array(await res.arrayBuffer());
    const dims = pngSize(bytes);
    if (res.status !== 200 || !dims || dims.width !== size || dims.height !== size) throw new Error(`${label}: ${path} is not a ${size}x${size} PNG`);
  }
}

async function stageStart(env, app, test) {
  const t = nowIso();
  const short = String(test.id).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x";
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'GUEST_APP_SETUP' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Guest App Setup offer is not in the catalog");
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const businessId = crypto.randomUUID(); const orderId = crypto.randomUUID(); const itemId = crypto.randomUUID(); const projectId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)`).bind(businessId, t, t, NAME).run();
  await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at) VALUES (?, ?, ?, ?, ?, 'ONBOARDING_REQUIRED', 'USD', 0, 0, 0, 0, 'PAID', ?, ?)`)
    .bind(orderId, t, t, customer.id, businessId, `cs_test_guestapp_${short}`, t).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')`).bind(itemId, orderId, offer.offer_id, offer.version_id).run();
  await env.DB.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, 'APP', 'AWAITING_INPUTS', 'GUEST_APP_SETUP_V1', 1, 'NORMAL', 0, ?, ?, ?)`)
    .bind(projectId, orderId, itemId, businessId, customer.id, t, t, JSON.stringify({ source: "GUEST_APP_SELFTEST", self_test_id: test.id })).run();
  const started = await startGuestAppIntake(env, { projectId });
  if (!started.started) throw new Error("The intake email was not sent");
  const link = new URL(await intakeLink(env, projectId));
  const form = new FormData();
  form.append("t", link.searchParams.get("t"));
  const slug = `appselftest-${short}`;
  const answers = {
    app_name: NAME, short_name: "Self-Test", menu: "# Lunch\nTomato soup | Roasted tomatoes and basil | $7\nCheese sandwich | Aged cheddar on fresh bread | $9\n# Drinks\nDrip coffee | Fresh brewed | $3",
    specials: "Friday: soup and half sandwich for $10", phone: "(512) 555-0147", address: "123 Main Street, Austin, TX", hours: "Mon-Fri: 7am-3pm\nSat: 8am-2pm",
    order_url: "https://menu-made.com/", brand_color: "#1f4e5f", subdomain: slug
  };
  for (const [k, v] of Object.entries(answers)) form.append(k, v);
  form.append("logo", new File([PNG], "logo.png", { type: "image/png" }));
  const posted = await app(new Request(`${publicBaseUrl(env)}/api/app-intake/${projectId}`, { method: "POST", body: form }));
  if (posted.status !== 200) throw new Error(`The intake form was not accepted (HTTP ${posted.status}): ${await reasonOf(posted)}`);
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_OWNER_REQUEST", project_id: projectId, order_id: orderId, state: { projectId, slug }, log: "Synthetic Guest App Setup order started; intake form submitted with a logo" });
}

async function stageAwaitOwnerRequest(env, app, test) {
  const s = state(test);
  const approval = await env.DB.prepare(`SELECT id, json_extract(metadata_json, '$.owner_notified_at') AS notified FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1`).bind(s.projectId).first();
  if (!approval) {
    const step = await env.DB.prepare(`SELECT ws.status, ws.error_message, ws.output_json FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id WHERE wr.project_id = ? AND ws.step_key = 'PRODUCE' ORDER BY ws.started_at DESC LIMIT 1`).bind(s.projectId).first();
    const out = parseJsonOrNull(step?.output_json);
    if (out?.outcome === "NOT_PRODUCED") throw new Error(`The app was not produced: ${(out.reasons || []).join("; ")}`);
    if (step?.status === "FAILED") throw new Error(`The app step failed: ${step.error_message || "unknown error"}`);
    return null;
  }
  if (!approval.notified) return null;
  const build = await env.DB.prepare(`SELECT id FROM deliverables WHERE project_id = ? AND deliverable_type = 'APP_BUILD' AND status != 'SUPERSEDED' ORDER BY version DESC LIMIT 1`).bind(s.projectId).first();
  if (!build) throw new Error("The app build is missing");
  const early = await app(new Request(`${publicBaseUrl(env)}/api/site/${s.slug}/app/`));
  if ((await early.text()).includes(NAME)) throw new Error("The app is live before the owner approved it");
  await checkServedApp(app, await appPreviewUrl(env, build.id, 1), "Preview");
  const token = await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 });
  const form = new FormData();
  form.append("t", token);
  const approved = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_DELIVERED", log: "Icons drawn by the GitHub renderer at 192, 512, maskable 512 and 180 px; preview page, manifest and offline worker served; not live before approval; approved through the approve page" });
}

async function stageAwaitDelivered(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status !== "DELIVERED") return null;
  const mail = await env.DB.prepare(`SELECT 1 AS n FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The customer was not emailed their live app");
  await checkServedApp(app, `${publicBaseUrl(env)}/api/site/${s.slug}/app/`, "Live app");
  const root = await app(new Request(`${publicBaseUrl(env)}/api/site/${s.slug}/`));
  if (root.status !== 302 || !/\/app\/$/.test(root.headers.get("location") || "")) throw new Error(`The address root did not open the app (HTTP ${root.status})`);
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: `App live after approval and customer emailed. Install it on a phone from ${appUrl(env, s.slug)}` });
}

const STAGES = { START: stageStart, AWAIT_OWNER_REQUEST: stageAwaitOwnerRequest, AWAIT_DELIVERED: stageAwaitDelivered };

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Guest App self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of the Guest App failed.", eyebrow: "SELF-TEST", heading: "The Guest App self-test failed",
      paragraphs: ["A test Guest App did not come out as expected. Real customers' apps may hit the same problem."], rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Guest App self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceGuestAppSelfTests(env, app, deps = {}) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env, deps.now).catch(() => null);
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

export { advanceGuestAppSelfTests, maybeScheduleDaily };
