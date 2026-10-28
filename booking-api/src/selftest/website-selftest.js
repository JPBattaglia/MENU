// Sandbox self-test for Website Package (stage 7), run by the worker's 5-minute schedule and once a day.
// A synthetic paid order fills in the REAL intake form (a real multipart POST with a real PNG), the REAL AI writes the copy,
// the owner approval is clicked through the approve page, then the live site is fetched. Only a failure emails the owner.
// Start one by inserting a self_tests row, kind WEBSITE_PACKAGE_RUN, status REQUESTED.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { intakeLink } from "../producers/website/intake.js";
import { previewUrl } from "../producers/website/presenter.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "WEBSITE_PACKAGE_RUN";
const STAGE_TIMEOUT_MINUTES = 30;
const DAILY_HOUR_UTC = 18;
const state = (test) => parseJsonOrNull(test.state_json) || {};
// A valid 1x1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

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
  // Letters and digits only: a hand-named id like "wpkg-st-1" once made the invalid address "selftest-wpkg-st-".
  const short = String(test.id).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x";
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'WEBSITE_PACKAGE' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Website Package offer is not in the catalog");
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const businessId = crypto.randomUUID(); const orderId = crypto.randomUUID(); const itemId = crypto.randomUUID(); const projectId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, 'Website Self-Test Cafe')`).bind(businessId, t, t).run();
  await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at) VALUES (?, ?, ?, ?, ?, 'ONBOARDING_REQUIRED', 'USD', 0, 0, 0, 0, 'PAID', ?, ?)`)
    .bind(orderId, t, t, customer.id, businessId, `cs_test_website_${short}`, t).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'READY')`).bind(itemId, orderId, offer.offer_id, offer.version_id).run();
  await env.DB.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, priority, manual_review_required, created_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, 'WEBSITE', 'AWAITING_INPUTS', 'WEBSITE_PACKAGE_V1', 1, 'NORMAL', 0, ?, ?, ?)`)
    .bind(projectId, orderId, itemId, businessId, customer.id, t, t, JSON.stringify({ source: "WEBSITE_SELFTEST", self_test_id: test.id })).run();
  const { startWebsiteIntake } = await import("../producers/website/intake.js");
  const started = await startWebsiteIntake(env, { projectId });
  if (!started.started) throw new Error("The intake email was not sent");
  const link = new URL(await intakeLink(env, projectId));
  const form = new FormData();
  form.append("t", link.searchParams.get("t"));
  const answers = {
    kind: "restaurant", about: "Website Self-Test Cafe is a small family cafe. We bake bread every morning and serve soup and sandwiches at lunch.",
    offerings: "# Lunch\nTomato soup | Roasted tomatoes and basil | $7\nCheese sandwich | Aged cheddar on fresh bread | $9\n# Drinks\nDrip coffee | Fresh brewed | $3",
    phone: "(512) 555-0147", address: "123 Main Street, Austin, TX", hours: "Mon-Fri: 7am-3pm\nSat: 8am-2pm", style: "modern", subdomain: `selftest-${short}`, photo_captions: "Our morning bread"
  };
  for (const [k, v] of Object.entries(answers)) form.append(k, v);
  form.append("logo", new File([PNG], "logo.png", { type: "image/png" }));
  form.append("photos", new File([PNG], "bread.png", { type: "image/png" }));
  const posted = await app(new Request(`${publicBaseUrl(env)}/api/site-intake/${projectId}`, { method: "POST", body: form }));
  if (posted.status !== 200) {
    // The form re-renders with its error in <strong>; report that, not the page's CSS.
    const page = await posted.text();
    const reason = /<strong>([^<]+)<\/strong>/.exec(page)?.[1] || page.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    throw new Error(`The intake form was not accepted (HTTP ${posted.status}): ${reason.slice(0, 200)}`);
  }
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_OWNER_REQUEST", project_id: projectId, order_id: orderId, state: { projectId, slug: answers.subdomain }, log: "Synthetic Website Package order started; intake form submitted with a logo and a photo" });
}

async function stageAwaitOwnerRequest(env, app, test) {
  const s = state(test);
  const approval = await env.DB.prepare(`SELECT id, json_extract(metadata_json, '$.owner_notified_at') AS notified FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1`).bind(s.projectId).first();
  if (!approval) {
    const step = await env.DB.prepare(`SELECT ws.output_json AS output_json FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id WHERE wr.project_id = ? AND ws.step_key = 'PRODUCE' AND ws.status = 'SUCCEEDED'`).bind(s.projectId).first();
    const out = parseJsonOrNull(step?.output_json);
    if (out?.outcome === "NOT_PRODUCED") throw new Error(`The website was not produced: ${(out.reasons || []).join("; ")}`);
    return null;
  }
  if (!approval.notified) return null;
  const build = await env.DB.prepare(`SELECT d.id FROM deliverables d WHERE d.project_id = ? AND d.deliverable_type = 'SITE_BUILD' AND d.status != 'SUPERSEDED' ORDER BY d.version DESC LIMIT 1`).bind(s.projectId).first();
  if (!build) throw new Error("The site build is missing");
  const live = await app(new Request(`${publicBaseUrl(env)}/api/site/${s.slug}/`));
  if ((await live.text()).includes("Website Self-Test Cafe")) throw new Error("The site is live before the owner approved it");
  for (const page of ["", "menu.html", "about.html", "contact.html", "img/logo.png", "img/photo-1.png"]) {
    const res = await app(new Request(`${await previewUrl(env, build.id, 1)}${page}`));
    if (res.status !== 200) throw new Error(`The preview of ${page || "the home page"} returned HTTP ${res.status}`);
    if (!page) {
      const html = await res.text();
      if (!html.includes("Website Self-Test Cafe") || !html.includes("<h1")) throw new Error("The preview home page is missing the business name or its heading");
    }
  }
  const token = await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 });
  const form = new FormData();
  form.append("t", token);
  const approved = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_DELIVERED", log: "Preview pages and images served; not live before approval; approved through the approve page" });
}

async function stageAwaitDelivered(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status !== "DELIVERED") return null;
  const mail = await env.DB.prepare(`SELECT 1 AS n FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The customer was not emailed their live website");
  const live = await app(new Request(`${publicBaseUrl(env)}/api/site/${s.slug}/`));
  const html = await live.text();
  if (live.status !== 200 || !html.includes("Website Self-Test Cafe")) throw new Error(`The live site did not serve after approval (HTTP ${live.status})`);
  const usage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id = ?`).bind(s.projectId).first();
  if (Number(usage?.n) < 1) throw new Error("The AI step logged no token usage");
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: "Website live after approval; customer emailed; AI usage logged" });
}

const STAGES = { START: stageStart, AWAIT_OWNER_REQUEST: stageAwaitOwnerRequest, AWAIT_DELIVERED: stageAwaitDelivered };

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Website Package self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of the Website Package failed.", eyebrow: "SELF-TEST", heading: "The Website Package self-test failed",
      paragraphs: ["A test website did not come out as expected. Real customers' websites may hit the same problem."], rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Website Package self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceWebsiteSelfTests(env, app) {
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

export { advanceWebsiteSelfTests };
