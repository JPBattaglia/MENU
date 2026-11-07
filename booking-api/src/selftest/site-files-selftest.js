// Daily self-test for Your Website ($299 site files, the site generator's product), run by the 5-minute schedule.
// A synthetic paid order (Stripe test session) for a chosen design WITH Website Care goes through the real steps:
//   START       a preview's saved data in R2 (as the generator leaves it), the order, its project; production released
//   AWAIT_DONE  the runner zips the chosen design and delivers it with no approval; the zip holds the three files of
//               that design; the site answers live at its address; the buyer's email went to the test inbox
// Then the scaffold's site row is removed so the address is freed. Only a failure emails the owner.
// Start one by inserting a self_tests row with kind SITE_FILES_RUN and status REQUESTED.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { refreshOnboardingState } from "../onboarding/onboarding.js";
import { readZip } from "../producers/social-posts/zip.js";
import { updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "SITE_FILES_RUN";
const STAGE_TIMEOUT_MINUTES = 25;
const DAILY_HOUR_UTC = 18;
const DESIGN = "farmhouse";
const SITE = {
  name: "Site Files Self-Test Cafe", kind: "restaurant", about: "A small cafe.", offerings: "# Breakfast\nOatmeal | Brown sugar, berries | $7\nEgg Sandwich | Cheddar, brioche | $9",
  phone: "(512) 555-0148", address: "125 Main Street, Austin, TX", hours: "Mon-Fri: 7am-2pm", email: "", style: "modern", brand: "", facebook: "", instagram: "", photos: [], logo: null
};
const COPY = { tagline: "Breakfast on Main Street", intro: "Oatmeal and egg sandwiches every weekday morning.", about: ["A small cafe on Main Street."], meta_description: "Site Files Self-Test Cafe: breakfast on Main Street in Austin.", meta_about: "About Site Files Self-Test Cafe." };
const state = (test) => parseJsonOrNull(test.state_json) || {};

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 10) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

async function stageStart(env, app, test) {
  const t = nowIso();
  const short = String(test.id).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x";
  const token = `${crypto.randomUUID().replace(/-/g, "")}5e1f`; // 36 hex characters, like a real preview token
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'SITE_FILES' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  const care = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'WEBSITE_CARE' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer || !care) throw new Error("Your Website or Website Care is not in the catalog");
  const s = { token, businessId: crypto.randomUUID(), orderId: crypto.randomUUID(), itemId: crypto.randomUUID(), careItemId: crypto.randomUUID(), projectId: crypto.randomUUID(), customerId: customer.id };
  await env.ASSETS.put(`website-previews/${token}/data.json`, JSON.stringify({ site: { ...SITE, name: `${SITE.name} ${short}` }, copy: COPY }));
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)`).bind(s.businessId, t, t, `${SITE.name} ${short}`).run();
  await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes) VALUES (?, ?, ?, ?, ?, 'ONBOARDING_REQUIRED', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)`)
    .bind(s.orderId, t, t, customer.id, s.businessId, `cs_test_sitefiles_${short}`, t, `Your Website self-test ${test.id}`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status, metadata_json) VALUES (?, ?, ?, ?, 1, 0, 0, 'PENDING', ?)`)
    .bind(s.itemId, s.orderId, offer.offer_id, offer.version_id, JSON.stringify({ offer_code: "SITE_FILES", site_preview: token, site_design: DESIGN, self_test: true })).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status, metadata_json) VALUES (?, ?, ?, ?, 1, 0, 0, 'FULFILLED', ?)`)
    .bind(s.careItemId, s.orderId, care.offer_id, care.version_id, JSON.stringify({ billing: "RECURRING", plan_code: "WEBSITE_CARE", self_test: true })).run();
  await env.DB.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'WEBSITE', 'AWAITING_INPUTS', 'SITE_FILES_V1', ?, ?)`)
    .bind(s.projectId, s.orderId, s.itemId, s.businessId, customer.id, t, t).run();
  await refreshOnboardingState(s.projectId, s.orderId, customer.id, "SITE_FILES_V1", env);
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_DONE", order_id: s.orderId, project_id: s.projectId, state: s, log: `Paid test order for the ${DESIGN} design with Website Care; production released` });
}

async function cleanup(env, s) {
  await env.DB.prepare(`DELETE FROM website_sites WHERE business_id = ?`).bind(s.businessId).run().catch(() => null);
  await env.ASSETS.delete(`website-previews/${s.token}/data.json`).catch(() => null);
}

async function stageAwaitDone(env, app, test) {
  const s = state(test);
  const zip = await env.DB.prepare(`SELECT d.status, d.customer_visible, a.storage_key FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ? AND d.deliverable_type = 'SITE_ZIP' ORDER BY d.version DESC LIMIT 1`).bind(s.projectId).first();
  if (!zip || zip.status !== "FINAL" || !Number(zip.customer_visible)) return null; // not delivered yet
  if (await env.DB.prepare(`SELECT 1 AS w FROM approvals WHERE project_id = ? LIMIT 1`).bind(s.projectId).first()) throw new Error("The delivery waited for an owner approval; it should go out by itself");
  const entries = readZip(new Uint8Array(await (await env.ASSETS.get(zip.storage_key)).arrayBuffer()));
  const names = entries.map((e) => e.name.split("/").pop()).sort().join(",");
  if (names !== "README.txt,index.html,styles.css") throw new Error(`The zip holds ${names}`);
  const html = new TextDecoder().decode(entries.find((e) => e.name.endsWith("index.html")).data);
  if (!html.includes("Egg Sandwich") || !html.includes("Caveat")) throw new Error("The zip's page isn't the chosen design with the menu");
  const site = await env.DB.prepare(`SELECT slug FROM website_sites WHERE business_id = ?`).bind(s.businessId).first();
  if (!site?.slug) throw new Error("With Website Care the site should have an address");
  const live = await app(new Request(`${publicBaseUrl(env)}/api/site/${site.slug}/`));
  const page = await live.text();
  if (live.status !== 200 || !page.includes("Egg Sandwich")) throw new Error(`The live site answered ${live.status}`);
  const sent = await env.DB.prepare(`SELECT 1 AS ok FROM communications WHERE template_key = 'delivery_site_files_v1' AND project_id = ? LIMIT 1`).bind(s.projectId).first();
  if (!sent) throw new Error("The buyer's email wasn't sent");
  await cleanup(env, s);
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: `Zip of the ${DESIGN} design delivered with no approval; live at /api/site/${site.slug}/; buyer email sent` });
}

const STAGES = { START: stageStart, AWAIT_DONE: stageAwaitDone };

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await cleanup(env, state(test)).catch(() => null);
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Your Website self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of the $299 website failed.", eyebrow: "SELF-TEST", heading: "The Your Website self-test failed", paragraphs: ["A test order for a chosen site design did not come out as expected. Real orders may hit the same problem. Forward this email to Claude."], rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Your Website self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceSiteFilesSelfTests(env, app) {
  if (!env.DB || !env.ASSETS) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const results = [];
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2`).bind(KIND).all()).results || [];
  for (let test of tests) {
    const stage = test.status === "REQUESTED" ? "START" : test.stage;
    const handler = STAGES[stage];
    if (!handler) continue;
    try {
      const next = await handler(env, app, test);
      if (!next && Date.now() - Date.parse(test.stage_started_at || test.created_at) > STAGE_TIMEOUT_MINUTES * 60000) test = await failTest(env, test, `Timed out after ${STAGE_TIMEOUT_MINUTES} minutes waiting at ${stage}`);
      else if (next) test = next;
    } catch (error) {
      test = await failTest(env, test, error instanceof Error ? error.message : String(error));
    }
    results.push({ id: test.id, status: test.status, stage: test.stage });
  }
  return results;
}

export { KIND as SITE_FILES_KIND, advanceSiteFilesSelfTests };
