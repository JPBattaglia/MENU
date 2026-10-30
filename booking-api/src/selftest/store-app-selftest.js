// Self-test for the Store App's own steps (stage 11 part 2), run by the worker's 5-minute schedule.
// Daily at 10:20am PT, or start one by inserting a self_tests row with kind STORE_APP_RUN and status REQUESTED.
//
// A scaffold restaurant with a Stripe test-mode order and an approved app goes through the real code, one step at a time
// (each advance runs for the scaffold only, so no one else's app is touched):
//   1. Store steps: the buyer gets the store-account checklist; the buyer's Done link moves it to the owner's step; the
//      owner's Done is refused without the restaurant's keys, and accepted once they're saved (-> READY_TO_BUILD).
//   2. Build start: the tick starts the build workflow with this app's id (the GitHub call is caught, not sent) -> BUILDING;
//      the build config names the app's id, name and content address, with a 1024 px icon and Play feature graphic.
//   3. Results: iOS uploaded + Android first upload -> WAITING_SUBMIT_APPROVAL.
//   4. Listing: the eight pictures are taken in; the preview email goes out; the preview page shows the text; Approve
//      (a POST, as the owner's button) -> a test order never reaches Apple or Google: LIVE, with the [TEST] buyer email.
// Every email goes to the Resend test inbox (owner emails included). The scaffold is removed at the end. Only a failure
// emails the owner. Not covered here (they need Apple, Google or GitHub): real builds and submissions; those are proven
// by the exit test on the owner's own accounts.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { BUYER_KIND, OWNER_KIND, advanceStoreApps, handleStoreAppDone } from "../store-app/store-flow.js";
import { advanceStoreBuilds, buildConfigFor, recordBuildResult } from "../store-app/store-build.js";
import { IMAGE_NAMES, LISTING_KIND, advanceStoreListings, handleListingPage, imageKey, storeListingImage } from "../store-app/store-listing.js";
import { saveCredential } from "../store-app/keys.js";
import { servicesKey } from "../store-app/google-keys.js";
import { updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "STORE_APP_RUN";
const DAILY_HOUR_UTC = 17;
const DAILY_MINUTE_FROM = 20;
const NAME = "Store Self-Test Cafe";

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < DAILY_MINUTE_FROM) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

function png(w, h) {
  const b = new Uint8Array(120);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h);
  return b;
}

async function scaffold(env, test) {
  const t = nowIso();
  const short = String(test.id).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x";
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'STORE_APP_SETUP' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Store App Setup offer is not in the catalog");
  const s = { short, customerId: customer.id, businessId: crypto.randomUUID(), orderId: crypto.randomUUID(), itemId: crypto.randomUUID(), projectId: crypto.randomUUID(),
    appId: crypto.randomUUID(), assetId: crypto.randomUUID(), deliverableId: crypto.randomUUID(), storeAppId: crypto.randomUUID(), slug: `storeselftest-${short}`, bundleId: `com.menumade.storeselftest${short}` };
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)`).bind(s.businessId, t, t, NAME).run();
  await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes) VALUES (?, ?, ?, ?, ?, 'DELIVERED', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)`)
    .bind(s.orderId, t, t, customer.id, s.businessId, `cs_test_storeapp_${short}`, t, `Store App self-test ${test.id}`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'FULFILLED')`).bind(s.itemId, s.orderId, offer.offer_id, offer.version_id).run();
  await env.DB.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'APP', 'IN_PROGRESS', 'STORE_APP_SETUP_V1', ?, ?)`)
    .bind(s.projectId, s.orderId, s.itemId, s.businessId, customer.id, t, t).run();
  await env.DB.prepare(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(s.appId, s.slug, s.projectId, s.businessId, customer.id, JSON.stringify({ app_name: NAME, address: "1 Test Street, Austin, TX", phone: "(512) 555-0100", menu: "Lunch\nSoup | $6", hours: "Mon-Fri 9-5", brand_color: "#2d5a3d" }), t, t).run();
  // The app content approved, as the owner's approval leaves it.
  await env.DB.prepare(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, 'build.json', 'application/json', 2, 'selftest', 'VALID', ?)`)
    .bind(s.assetId, s.businessId, customer.id, s.projectId, `selftest/${test.id}/build.json`, t).run();
  await env.DB.prepare(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES (?, ?, ?, 'APP_BUILD', 1, 'FINAL', 1, ?, ?)`)
    .bind(s.deliverableId, s.projectId, s.assetId, t, t).run();
  await env.DB.prepare(`INSERT INTO store_apps (id, project_id, business_id, customer_id, bundle_id, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'WAITING_APP', 'Self-test scaffold', ?, ?)`)
    .bind(s.storeAppId, s.projectId, s.businessId, customer.id, s.bundleId, t, t).run();
  return s;
}

async function cleanup(env, s) {
  if (!s?.storeAppId) return;
  for (const name of IMAGE_NAMES) await env.ASSETS?.delete(imageKey(s.storeAppId, name)).catch(() => null);
  await env.ASSETS?.delete(servicesKey(s.businessId)).catch(() => null);
  await env.DB.prepare(`DELETE FROM store_app_listings WHERE store_app_id = ?`).bind(s.storeAppId).run();
  await env.DB.prepare(`DELETE FROM store_app_builds WHERE store_app_id = ?`).bind(s.storeAppId).run();
  await env.DB.prepare(`DELETE FROM store_apps WHERE id = ?`).bind(s.storeAppId).run();
  await env.DB.prepare(`DELETE FROM store_credentials WHERE scope = ?`).bind(s.businessId).run();
  await env.DB.prepare(`DELETE FROM deliverables WHERE id = ?`).bind(s.deliverableId).run();
  await env.DB.prepare(`DELETE FROM assets WHERE id = ?`).bind(s.assetId).run();
  await env.DB.prepare(`DELETE FROM guest_apps WHERE id = ?`).bind(s.appId).run();
  await env.DB.prepare(`UPDATE projects SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).bind(nowIso(), s.projectId).run().catch(() => null);
}

const statusOf = async (env, id) => (await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ?`).bind(id).first());

async function run(env, test) {
  const base = publicBaseUrl(env);
  const s = await scaffold(env, test);
  await updateTest(env, test, { status: "RUNNING", stage: "RUN", state: s, log: `Scaffold ${s.bundleId} made` });
  const notes = [];
  const dispatched = [];
  // Owner emails go to the test inbox; the GitHub call is caught.
  const testEnv = { ...env, OWNER_EMAIL: SELF_TEST_EMAIL, GITHUB_DISPATCH_TOKEN: "selftest",
    GITHUB_DISPATCH_FETCH: async (url, init) => { dispatched.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); } };
  const only = { only: s.storeAppId };
  const press = async (kind, id = s.storeAppId) => {
    const form = new FormData(); form.set("t", await signLinkToken(env, { kind, id, ttlDays: 1 }));
    return form;
  };
  try {
    // 1. store steps
    await advanceStoreApps(testEnv, Date.now(), only);
    if ((await statusOf(env, s.storeAppId)).status !== "WAITING_STORE_ACCESS") throw new Error("The approved app didn't move to the store-account step");
    await handleStoreAppDone(new Request(`${base}/api/store-app/${s.storeAppId}/done`, { method: "POST", body: await press(BUYER_KIND) }), testEnv, s.storeAppId);
    if ((await statusOf(env, s.storeAppId)).status !== "WAITING_OWNER_SETUP") throw new Error("The buyer's Done didn't move it to the owner's step");
    const refused = await handleStoreAppDone(new Request(`${base}/api/store-app/${s.storeAppId}/done`, { method: "POST", body: await press(OWNER_KIND) }), testEnv, s.storeAppId);
    if (refused.status !== 409) throw new Error(`The owner's Done was accepted without the restaurant's keys (HTTP ${refused.status})`);
    await saveCredential(env, s.businessId, "APPLE_API_KEY", { keyId: "SELFTEST01", issuerId: "selftest", teamId: "SELFTEST", p8: "self-test placeholder", status: "VERIFIED", note: "Self-test" });
    await saveCredential(env, s.businessId, "APPLE_PUSH_KEY", { keyId: "SELFTEST02", teamId: "SELFTEST", p8: "self-test placeholder", status: "VERIFIED", note: "Self-test" });
    await env.ASSETS.put(servicesKey(s.businessId), JSON.stringify({ project_info: { project_id: "selftest" }, client: [{ client_info: { android_client_info: { package_name: s.bundleId } } }] }));
    await handleStoreAppDone(new Request(`${base}/api/store-app/${s.storeAppId}/done`, { method: "POST", body: await press(OWNER_KIND) }), testEnv, s.storeAppId);
    if ((await statusOf(env, s.storeAppId)).status !== "READY_TO_BUILD") throw new Error("The owner's Done with keys saved didn't make it ready to build");
    notes.push("checklist, buyer Done, key gate, owner Done");

    // 2. build start and config
    await advanceStoreBuilds(testEnv, Date.now(), only);
    const started = dispatched[0]?.body;
    if (dispatched.length !== 1 || started?.inputs?.store_app !== s.storeAppId || started.inputs.upload !== "true" || started.inputs.platforms !== "both") throw new Error(`The build wasn't started for this app: ${JSON.stringify(started || null)}`);
    const building = await statusOf(env, s.storeAppId);
    if (building.status !== "BUILDING") throw new Error("Starting the build didn't mark it BUILDING");
    const cfg = await buildConfigFor(env, building);
    if (cfg.status !== 200 || cfg.body.config.app_id !== s.bundleId || cfg.body.config.app_name !== NAME || cfg.body.config.api_base !== `https://${s.slug}.menu-made.com/app/api`) throw new Error(`The build config is wrong: ${JSON.stringify(cfg.body.config || cfg.body)}`);
    if (!/width="1024" height="1024"/.test(cfg.body.icon_svg) || !/width="1024" height="500"/.test(cfg.body.feature_svg)) throw new Error("The build config's icons are the wrong size");
    notes.push("build started for this app, config and icons right");

    // 3. results
    await recordBuildResult(testEnv, building, { platform: "ios", outcome: "UPLOADED", version: 1, run_id: "1" });
    await recordBuildResult(testEnv, building, { platform: "android", outcome: "FIRST_UPLOAD", version: 1, run_id: "1" });
    if ((await statusOf(env, s.storeAppId)).status !== "WAITING_SUBMIT_APPROVAL") throw new Error("Both platforms reported but it didn't move to the listing step");
    notes.push("results moved it to the listing");

    // 4. listing, approval, sandbox go-live
    for (const name of IMAGE_NAMES) {
      const out = await storeListingImage(env, building, name, name.startsWith("ios") ? png(1290, 2796) : name.startsWith("android") ? png(1080, 1920) : name === "feature" ? png(1024, 500) : png(512, 512));
      if (out.status !== 200) throw new Error(`The picture ${name} was refused: ${out.body.error}`);
    }
    await advanceStoreListings(testEnv, Date.now(), only);
    const listing = await env.DB.prepare(`SELECT * FROM store_app_listings WHERE store_app_id = ?`).bind(s.storeAppId).first();
    const text = parseJsonOrNull(listing?.listing_json);
    if (!listing?.preview_sent_at || text?.name !== NAME || !/The official app of Store Self-Test Cafe in Austin/.test(text.description || "")) throw new Error("The listing preview wasn't written or sent");
    const previewToken = await signLinkToken(env, { kind: LISTING_KIND, id: s.storeAppId, ttlDays: 1 });
    const page = await handleListingPage(new Request(`${base}/api/store-app/${s.storeAppId}/listing?t=${encodeURIComponent(previewToken)}`), testEnv, s.storeAppId);
    if (page.status !== 200 || !(await page.text()).includes("Approve and submit")) throw new Error("The preview page didn't open");
    const form = new FormData(); form.set("t", previewToken);
    await handleListingPage(new Request(`${base}/api/store-app/${s.storeAppId}/listing`, { method: "POST", body: form }), testEnv, s.storeAppId);
    await advanceStoreListings(testEnv, Date.now(), { ...only, fetchImpl: async (url) => { throw new Error(`A test order reached ${String(url).slice(0, 60)}`); } });
    const done = await statusOf(env, s.storeAppId);
    const after = await env.DB.prepare(`SELECT apple_json, google_json FROM store_app_listings WHERE store_app_id = ?`).bind(s.storeAppId).first();
    if (done.status !== "LIVE" || !parseJsonOrNull(after?.apple_json)?.sandbox || !parseJsonOrNull(after?.google_json)?.sandbox) throw new Error(`The approved test listing didn't go live in sandbox (status ${done.status})`);
    const liveMail = await env.DB.prepare(`SELECT status FROM communications WHERE template_key = 'store_app_live_v1' AND recipient = ? AND json_extract(metadata_json, '$.idempotency_key') = ?`).bind(SELF_TEST_EMAIL, `store-live/${s.storeAppId}`).first();
    if (liveMail?.status !== "SENT") throw new Error("The [TEST] live email wasn't sent");
    notes.push("pictures, preview, approve, sandbox live and buyer email");
  } finally {
    await cleanup(env, s).catch(() => null);
  }
  return updateTest(env, { ...test, status: "RUNNING", stage: "RUN", state_json: JSON.stringify(s) }, { status: "PASSED", stage: "DONE", log: `PASSED: ${notes.join("; ")}. Scaffold removed.` });
}

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Store App self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of the Store App steps failed.", eyebrow: "SELF-TEST", heading: "The Store App steps need a look",
      paragraphs: ["The daily test of the Store App's steps (store accounts, builds, listing and approval) failed. New Store App orders may stall at that step until this is fixed. Forward this to Claude."], rows: [["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Store App self-test failed.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceStoreAppSelfTests(env) {
  if (!env.DB || !env.ASSETS) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 1`).bind(KIND).all()).results || [];
  const results = [];
  for (const test of tests) {
    if (test.status === "RUNNING") {
      await cleanup(env, parseJsonOrNull(test.state_json)).catch(() => null);
      results.push(await failTest(env, test, "The run was cut off before it finished"));
      continue;
    }
    try { results.push(await run(env, test)); } catch (error) {
      const latest = await env.DB.prepare(`SELECT * FROM self_tests WHERE id = ?`).bind(test.id).first();
      results.push(await failTest(env, latest || test, error instanceof Error ? error.message : String(error)));
    }
  }
  return results;
}

export { KIND, advanceStoreAppSelfTests };
