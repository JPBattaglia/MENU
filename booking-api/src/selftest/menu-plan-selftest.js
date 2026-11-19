// Daily self-tests for the two menu plans (four choices, owner Nov 15, 2026): MΞNU Plus ($19.99/mo) and MΞNU Max ($79/mo, offer BUNDLE_PREMIUM); formerly called Pro
// ($79/mo, offer code BUNDLE_PREMIUM). Run by the worker's own 5-minute schedule, the way a buyer goes, in Stripe test
// mode with a test clock, through the real routes (same shape as HOLIDAY_MENU_RUN):
//   START            a 2-page menu uploaded as at checkout; its preview stored as the generator stores one (no AI read,
//                    no public limits); the preview opens on Classic with all nine designs; "Make it live" on a design
//                    that isn't the first; the checkout handoff carries the menu file; test checkout of the plan with
//                    the Online Menu + QR line exactly as the Start page sends it: one monthly subscription at the
//                    plan's catalog price, the menu line free (setup_waived_cents); paid with the test card
//   AWAIT_ACTIVE     the subscription is ACTIVE with exactly the plan's entitlements (Plus: MENU_PLUS; Pro: Plus plus
//                    Menu Care, Google Profile Care, Review Replies, Accessibility Monitoring); Plus has no period work,
//                    Pro has one first-month job for each of its four services (cancelled here so no producer runs on
//                    the test business); the welcome email went out; the menu project is paid with the menu attached;
//                    the optional extras are skipped
//   AWAIT_APPROVAL   menu and QR produced; owner approval requested and approved
//   AWAIT_DELIVERY   delivered; the live menu is in the chosen design with every uploaded item and price, with no
//                    "Made with MΞNU" badge (the plan covers it), the QR code points at it, the print PDF, tri-fold and
//                    table tent are real PDFs and the TV screen shows the menu (the print set is paid-only); the menu's
//                    hosting is covered by the plan. Then the subscription is cancelled in Stripe
//   AWAIT_CANCELLED  CANCELLED, every entitlement EXPIRED; Plus still made no period work; the menu stays online and,
//                    goes offline past the grace period (the plan hosts the menu; no free plan since Nov 19, 2026).
//                    Test clock deleted, preview removed.
// Start one by inserting a self_tests row with kind MENU_PLUS_RUN or MENU_PRO_RUN and status REQUESTED.
// Only a failure emails the owner.
import { ownerSandboxToken } from "../lib/owner-sandbox.js";
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { storeMenuDesigns } from "../marketing/public-preview.js";
import { hostedMenuSlug } from "../onboarding/menu-inputs.js";
import { MENU_DESIGNS, menuDesignFor } from "../producers/menu-qr/menu-designs.js";
import { menuHostingState } from "../producers/menu-qr/hosting-renewal.js";
import { resolvePlan } from "../subscriptions/plans.js";
import { MENU_PACKAGE_PRICING } from "../checkout/quote.js";
import { dailyClock } from "./daily-clock.js";
import { buildMenuPdf, cancelTestOrder, diagnose, payTestCheckout, stripeTest, updateTest } from "./menu-qr-selftest.js";

const PRO_SERVICES = ["ACCESSIBILITY_MONITORING", "GOOGLE_PROFILE_CARE", "MENU_CARE", "REVIEW_REPLIES"];
// Each kind: the plan it buys, the entitlements it must grant (sorted), the period jobs of a month, its daily slot
// (UTC, after the Guest App test's 20:00-20:20) and its own test business, so the two runs never share a menu.
const RUNS = {
  // New pricing (Nov 19, 2026): Plus pays the $149 setup; Max (offer BUNDLE_PREMIUM, kind name kept) has none.
  MENU_PLUS_RUN: { plan: "MENU_PLUS", label: "MΞNU Plus", entitlements: ["MENU_PLUS"], jobs: [], setupFree: false, hour: 20, minute: 20, business: "Plus Self-Test Cafe", design: "chalkboard" },
  MENU_PRO_RUN: { plan: "BUNDLE_PREMIUM", label: "MΞNU Max", entitlements: [...PRO_SERVICES, "MENU_PLUS", "MENU_PRO"].sort(), jobs: PRO_SERVICES, setupFree: true, hour: 20, minute: 40, business: "Pro Self-Test Bistro", design: "garden" }
};
const KINDS = Object.keys(RUNS);
const runOf = (test) => RUNS[test.kind];
const STAGE_TIMEOUT_MINUTES = 25;
const ATTACH_GRACE_MINUTES = 10; // a Stripe webhook retry can take minutes
const GRACE_PLUS_DAYS = 40;      // past hosting-renewal.js GRACE_DAYS (30)
const MENU_PAGES = [
  ["Starters", [["Burrata Toast", "$13"], ["Crispy Calamari", "$15"], ["Tomato Soup", "$8"]]],
  ["Mains", [["Steak Frites", "$32"], ["Mushroom Risotto", "$24"], ["Fish Tacos", "$19"]]]
];
const CHECK_ITEM = "Steak Frites";
const ALL_ITEMS = MENU_PAGES.flatMap(([, items]) => items);
const PREVIEW_MENU = {
  sections: MENU_PAGES.map(([name, items]) => ({ name, items: items.map(([item, price]) => ({ name: item, description: "", price })) })),
  notes: "", unreadable: ""
};
const BADGE = "mm-made-with"; // delivery.js MADE_WITH, the free plan's badge
const state = (test) => parseJsonOrNull(test.state_json) || {};
const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });
const dollars = (cents) => `$${cents / 100}`;

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  for (const [kind, run] of Object.entries(RUNS)) {
    if (now.getUTCHours() !== run.hour || now.getUTCMinutes() < run.minute || now.getUTCMinutes() >= run.minute + 20) continue;
    const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(kind, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
    if (recent) continue;
    const t = now.toISOString();
    await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), kind, t, t).run();
  }
}

// The upload and stored preview a buyer has when they tap "Make it live" (no AI read, no public daily limits).
async function makePreview(env, app, { run, now }) {
  const requestId = crypto.randomUUID();
  const stamp = nowIso().slice(0, 16).replace("T", " ");
  const upload = new FormData();
  upload.append("payload", JSON.stringify({ type: "inquiry", purpose: "checkout", service: "Other project", name: "Menu-Made Self-Test",
    business: run.business, email: SELF_TEST_EMAIL, notes: `Automated ${run.label} self-test ${stamp}`, website: "", requestId }));
  upload.append("document", new File([buildMenuPdf(MENU_PAGES, run.business)], "self-test-plan-menu.pdf", { type: "application/pdf" }));
  const uploaded = await json(await app(new Request(`${publicBaseUrl(env)}/api/inquiry`, { method: "POST", body: upload, headers: { Origin: "https://menu-made.com", "CF-Connecting-IP": "self-test" } })));
  if (!uploaded.body?.ok) throw new Error(`Menu upload failed (HTTP ${uploaded.status})`);
  const token = `${crypto.randomUUID().replace(/-/g, "")}9a1e`; // 36 hex characters, like a real preview token
  await storeMenuDesigns(env, token, { business: run.business, menu: PREVIEW_MENU, colors: "", custom: {}, customized: 0 });
  await env.DB.prepare(`INSERT INTO menu_previews (token, request_id, email, business, ip_hash, campaign, status, item_count, created_at, expires_at) VALUES (?, ?, ?, ?, '', 'selftest', 'READY', 6, ?, ?)`)
    .bind(token, requestId, SELF_TEST_EMAIL, run.business, new Date(now).toISOString(), new Date(now + 86400000).toISOString()).run();
  return { token, requestId };
}

async function removePreview(env, token) {
  if (!/^[a-f0-9]{36}$/.test(String(token || ""))) return;
  await env.DB.prepare(`DELETE FROM menu_previews WHERE token = ? AND campaign = 'selftest'`).bind(token).run().catch(() => null);
  for (const key of [...MENU_DESIGNS.map((d) => `${d.key}.html`), "data.json"]) await env.ASSETS.delete(`menu-previews/${token}/${key}`).catch(() => null);
}

async function subscriptionFor(env, test) {
  return env.DB.prepare(`SELECT * FROM subscriptions WHERE provider_customer_id = ? ORDER BY created_at DESC LIMIT 1`).bind(state(test).customer_id || "").first();
}

async function entitlementLine(env, subscriptionId) {
  const rows = (await env.DB.prepare(`SELECT entitlement_type, status FROM entitlements WHERE subscription_id = ? ORDER BY entitlement_type`).bind(subscriptionId).all()).results || [];
  return rows.map((e) => `${e.entitlement_type}:${e.status}`).join(",");
}

async function periodJobs(env, subscriptionId) {
  return (await env.DB.prepare(`
      SELECT p.id, json_extract(p.metadata_json, '$.plan_code') AS plan FROM projects p
      WHERE json_extract(p.metadata_json, '$.subscription_id') = ? ORDER BY plan
    `).bind(subscriptionId).all()).results || [];
}

// Period jobs of the test subscription never reach a producer (the test business has no Google profile or website).
async function cancelPeriodJobs(env, subscriptionId) {
  if (!subscriptionId) return;
  const t = nowIso();
  await env.DB.prepare(`
      UPDATE workflow_steps SET status = 'CANCELLED', completed_at = ? WHERE status IN ('QUEUED', 'WAITING') AND workflow_run_id IN (
        SELECT r.id FROM workflow_runs r JOIN projects p ON p.id = r.project_id WHERE json_extract(p.metadata_json, '$.subscription_id') = ?)
    `).bind(t, subscriptionId).run();
  await env.DB.prepare(`
      UPDATE workflow_runs SET status = 'CANCELLED', completed_at = ? WHERE status IN ('QUEUED', 'WAITING') AND project_id IN (
        SELECT id FROM projects WHERE json_extract(metadata_json, '$.subscription_id') = ?)
    `).bind(t, subscriptionId).run();
  await env.DB.prepare(`
      UPDATE projects SET status = 'CANCELLED', updated_at = ? WHERE json_extract(metadata_json, '$.subscription_id') = ? AND status NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED')
    `).bind(t, subscriptionId).run();
}

// ---------- Stages ----------

async function stageStart(env, app, test) {
  if (!env.STRIPE_SECRET_KEY_TEST) throw new Error("STRIPE_SECRET_KEY_TEST is not configured");
  const run = runOf(test);
  const base = publicBaseUrl(env);
  const now = Date.now();
  const clock = await stripeTest(env, "/v1/test_helpers/test_clocks", "POST", { frozen_time: String(Math.floor(now / 1000)), name: `menu-made ${run.plan} self-test ${test.id.slice(0, 8)}` });
  const customer = await stripeTest(env, "/v1/customers", "POST", { email: SELF_TEST_EMAIL, name: "Menu-Made Self-Test", test_clock: clock.id, "metadata[self_test]": "1" });
  const { token, requestId } = await makePreview(env, app, { run, now });
  test = await updateTest(env, test, { status: "RUNNING", stage: "START", state: { clock_id: clock.id, customer_id: customer.id, token, request_id: requestId, design: run.design } });
  try {
    return await buyAndPay(env, app, test, { run, base, token, requestId, customerId: customer.id });
  } catch (error) {
    if (error && typeof error === "object") error.selfTest = test.current || test;
    throw error;
  }
}

async function buyAndPay(env, app, holder, { run, base, token, requestId, customerId }) {
  let test = holder;
  const first = MENU_DESIGNS[0];
  const design = menuDesignFor(run.design);
  // The generator: nine designs, Classic first.
  const opened = await app(new Request(`${base}/api/menu-preview/view/${token}`, { headers: { "User-Agent": "MenuMadeSelfTest (preview check)" } }));
  const openedHtml = await opened.text();
  if (opened.status !== 200 || !openedHtml.includes(`Design 1 of ${MENU_DESIGNS.length}: ${first.label}`) || !openedHtml.includes(CHECK_ITEM)) throw new Error(`The preview didn't open on ${first.label} with the menu (HTTP ${opened.status})`);
  const generator = await json(await app(new Request(`${base}/api/menu-preview/state/${token}`)));
  const keys = (generator.body?.designs || []).map((d) => d.key).join(",");
  if (keys !== MENU_DESIGNS.map((d) => d.key).join(",")) throw new Error(`The generator shows ${keys || "no designs"}`);
  // "Make it live" on the chosen design, then the checkout prefill.
  const chose = await app(new Request(`${base}/api/menu-preview/choose/${token}/${design.key}`));
  const to = chose.headers.get("location") || "";
  if (chose.status !== 303 || !to.includes(token)) throw new Error(`Make it live didn't go to checkout with the preview (HTTP ${chose.status} ${to})`);
  const handoff = await json(await app(new Request(`${base}/api/menu-preview/handoff/${token}`)));
  if (handoff.body?.request_id !== requestId || handoff.body?.design !== design.label) throw new Error(`Checkout prefill is wrong: ${JSON.stringify(handoff.body).slice(0, 200)}`);

  // Checkout as the Start page sends it: the plan (monthly) and the menu line, with the preview and the file named.
  const opened2 = await json(await app(new Request(`${base}/api/create-checkout-test`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://menu-made.com" },
    body: JSON.stringify({ sandbox_token: await ownerSandboxToken(env), items: [{ key: run.plan, qty: 1, interval: "month" }, { key: "ONLINE_MENU_QR", qty: 1 }],
      interval: "month", menu_pages: MENU_PAGES.length, stripe_test_customer: customerId,
      customer: { name: "Menu-Made Self-Test", business: run.business, email: SELF_TEST_EMAIL, phone: "", notes: `Preview ref: ${token}\nDocument ref: ${requestId}` } })
  })));
  if (!opened2.body?.ok || opened2.body.mode !== "subscription" || !opened2.body.order_id) throw new Error(`${run.label} checkout failed (HTTP ${opened2.status}): ${JSON.stringify(opened2.body).slice(0, 300)}`);
  const orderId = opened2.body.order_id;
  test = await updateTest(env, test, { order_id: orderId });
  holder.current = test;
  // The plan's own catalog price, never a typed number; the $149 setup is charged with Plus, free with Max.
  const cents = (await resolvePlan(run.plan, "MONTH", env, { requirePublic: false }))?.priceCents;
  const setupCents = run.setupFree ? 0 : MENU_PACKAGE_PRICING.setupCents;
  const order = await env.DB.prepare(`SELECT stripe_checkout_session_id, total_cents FROM orders WHERE id = ?`).bind(orderId).first();
  if (!cents || order?.total_cents !== cents + setupCents) throw new Error(`Expected a ${cents ? dollars(cents + setupCents) : "catalog-priced"} ${run.label} order, got ${order?.total_cents}`);
  const menuLine = parseJsonOrNull((await env.DB.prepare(`SELECT i.metadata_json FROM order_items i JOIN offers o ON o.id = i.offer_id WHERE i.order_id = ? AND o.code = 'ONLINE_MENU_QR'`).bind(orderId).first())?.metadata_json);
  if (run.setupFree !== (Number(menuLine?.setup_waived_cents) > 0)) throw new Error(`The menu setup should be ${run.setupFree ? "free" : "charged"} with ${run.label}: ${JSON.stringify(menuLine).slice(0, 200)}`);
  if (menuLine?.plan_hosted !== run.plan) throw new Error(`The menu isn't hosted by ${run.label}: ${JSON.stringify(menuLine).slice(0, 200)}`);
  const paid = await payTestCheckout(env, order.stripe_checkout_session_id);
  return updateTest(env, test, { stage: "AWAIT_ACTIVE", state: { session_id: order.stripe_checkout_session_id, price_cents: cents },
    log: `Preview opened with ${MENU_DESIGNS.length} designs; ${design.label} chosen; ${run.label} order ${orderId} at ${dollars(cents)}/mo ${run.setupFree ? "with no setup fee" : `plus the ${dollars(setupCents)} setup`}; paid with test card (${paid.amount})` });
}

async function stageAwaitActive(env, app, test) {
  const run = runOf(test);
  const s = state(test);
  const sub = await subscriptionFor(env, test);
  if (!sub || sub.status !== "ACTIVE") return null;
  const line = await entitlementLine(env, sub.id);
  const expected = run.entitlements.map((e) => `${e}:ACTIVE`).join(",");
  if (line !== expected) {
    if (Date.now() - Date.parse(test.stage_started_at || test.created_at) < ATTACH_GRACE_MINUTES * 60000) return null;
    throw new Error(`Expected entitlements ${expected}, found ${line || "none"}`);
  }
  const jobs = await periodJobs(env, sub.id);
  if (jobs.length < run.jobs.length) return null;
  const plans = jobs.map((j) => j.plan).sort();
  if (JSON.stringify(plans) !== JSON.stringify(run.jobs)) throw new Error(`First month: expected period jobs [${run.jobs.join(", ")}], found [${plans.join(", ")}]`);
  // The menu project: paid, the menu file attached, the extras window open.
  const order = await env.DB.prepare(`SELECT payment_status FROM orders WHERE id = ?`).bind(test.order_id).first();
  const project = await env.DB.prepare(`SELECT id, metadata_json FROM projects WHERE order_id = ? AND workflow_key = 'MENU_QR_V1' LIMIT 1`).bind(test.order_id).first();
  const menuFile = project ? await env.DB.prepare(`SELECT status FROM project_inputs WHERE project_id = ? AND input_key = 'menu_file'`).bind(project.id).first() : null;
  const meta = parseJsonOrNull(project?.metadata_json) || {};
  if (order?.payment_status !== "PAID" || !project || menuFile?.status !== "VALID" || !meta.extras_until) {
    if (Date.now() - Date.parse(test.stage_started_at || test.created_at) < ATTACH_GRACE_MINUTES * 60000) return null;
    if (order?.payment_status !== "PAID") throw new Error(`The order is ${order?.payment_status || "missing"}, not PAID`);
    if (!project) throw new Error(`No menu project was made for the ${run.label} order`);
    if (menuFile?.status !== "VALID") throw new Error("The menu uploaded at checkout was not attached to the project");
    throw new Error("The optional extras window did not open");
  }
  const welcome = await env.DB.prepare(`SELECT status FROM communications WHERE template_key = 'subscription_welcome_v1' AND customer_id = ? ORDER BY created_at DESC LIMIT 1`).bind(sub.customer_id).first();
  if (welcome?.status !== "SENT") return null; // sent by the webhook; a retry can take a minute
  await cancelPeriodJobs(env, sub.id);
  const skip = await json(await app(new Request(`${publicBaseUrl(env)}/api/onboarding/start`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: test.order_id, session_id: s.session_id })
  })));
  if (!skip.body?.ok) throw new Error(`Skipping extras failed (HTTP ${skip.status})`);
  return updateTest(env, test, { stage: "AWAIT_APPROVAL", project_id: project.id,
    state: { subscription_id: sub.id, stripe_subscription_id: sub.provider_subscription_id, business_id: sub.business_id },
    log: `Subscription ACTIVE with ${run.entitlements.join(", ")}; ${run.jobs.length ? `first-month jobs for ${run.jobs.join(", ")} (cancelled: test business)` : "no period work, as Plus should"}; welcome email sent; menu attached; extras skipped` });
}

async function stageAwaitApproval(env, app, test) {
  const billing = parseJsonOrNull((await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(test.project_id).first())?.metadata_json)?.page_billing;
  if (billing?.status === "PAYMENT_REQUIRED") throw new Error(`A ${MENU_PAGES.length}-page menu was asked to pay for extra pages (counted ${billing.counted_pages})`);
  const approval = await env.DB.prepare(`SELECT id FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1`).bind(test.project_id).first();
  if (!approval) return null;
  const notified = await env.DB.prepare(`SELECT 1 AS ok FROM approvals WHERE id = ? AND json_extract(metadata_json, '$.owner_notified_at') IS NOT NULL`).bind(approval.id).first();
  if (!notified) return null; // the approval email goes out at the end of the runner tick
  const form = new FormData();
  form.append("t", await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 }));
  const approved = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_DELIVERY", log: "Menu and QR produced; owner approval requested and approved" });
}

async function stageAwaitDelivery(env, app, test) {
  const run = runOf(test);
  const s = state(test);
  const project = await env.DB.prepare(`SELECT p.status, b.name AS business_name FROM projects p JOIN businesses b ON b.id = p.business_id WHERE p.id = ?`).bind(test.project_id).first();
  if (project?.status !== "DELIVERED") return null;
  const delivery = await env.DB.prepare(`SELECT 1 AS ok FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(test.project_id).first();
  if (!delivery) throw new Error("Project delivered but no delivery email was logged");
  const base = publicBaseUrl(env);
  const slug = hostedMenuSlug(test.project_id, project.business_name);
  const page = await app(new Request(`${base}/api/menu/${slug}`));
  const html = await page.text();
  if (page.status !== 200 || !html.includes(CHECK_ITEM)) throw new Error(`The live menu page is missing "${CHECK_ITEM}" (HTTP ${page.status})`);
  const design = menuDesignFor(s.design);
  if (!html.toLowerCase().includes(design.style.paper)) throw new Error(`The live menu isn't in the chosen design (${design.label})`);
  if (html.includes(BADGE)) throw new Error(`The live menu shows the free plan's "Made with MΞNU" badge although ${run.label} covers it`);
  const quality = await checkWhatTheBuyerGot(env, app, test, { base, slug, html });
  const hosting = await menuHostingState(env, s.business_id);
  if (!hosting.live || hosting.reason !== "menu_care") throw new Error(`The menu's hosting isn't covered by ${run.label} (${hosting.reason})`);
  await stripeTest(env, `/v1/subscriptions/${s.stripe_subscription_id}`, "DELETE");
  return updateTest(env, test, { stage: "AWAIT_CANCELLED",
    log: `Delivered; live at /api/menu/${slug} in ${design.label}, no badge; ${quality}; hosting covered by the plan; subscription cancelled in Stripe` });
}

// Quality, not only completion (owner, Nov 12, 2026): what the buyer was sent is opened and read.
async function checkWhatTheBuyerGot(env, app, test, { base, slug, html }) {
  const text = html.replace(/&(#0?39|apos);/g, "'").replace(/&amp;/g, "&");
  const missing = ALL_ITEMS.filter(([item, price]) => !text.includes(item) || !new RegExp(`\\$?\\s*${price.replace(/[^0-9.]/g, "")}(?![0-9])`).test(text)).map(([item, price]) => `${item} ${price}`);
  if (missing.length) throw new Error(`The live menu is missing ${missing.length} of ${ALL_ITEMS.length} items or prices from the uploaded menu: ${missing.join(", ")}`);
  const address = `${base}/api/menu/${slug}`;
  const qr = await env.DB.prepare(`
      SELECT json_extract(a.metadata_json, '$.destination_url') AS url FROM deliverables d JOIN assets a ON a.id = d.asset_id
      WHERE d.project_id = ? AND d.deliverable_type = 'QR_CODE' ORDER BY d.version DESC LIMIT 1`).bind(test.project_id).first();
  if (qr?.url !== address) throw new Error(`The QR code points at ${qr?.url || "nothing"}, not this menu's address (${address})`);
  // The tri-fold and table tent come with Pro and Max (Nov 19, 2026); with Plus they say so instead.
  const pro = runOf(test).entitlements.includes("MENU_PRO");
  for (const format of pro ? ["print.pdf", "tri-fold.pdf", "table-tent.pdf"] : ["print.pdf"]) {
    const file = await app(new Request(`${address}/${format}`));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = bytes.length > 1000 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
    if (file.status !== 200 || !/application\/pdf/.test(file.headers.get("content-type") || "") || !isPdf) throw new Error(`The buyer's ${format} is not a PDF (HTTP ${file.status}, ${file.headers.get("content-type") || "no type"}, ${bytes.length} bytes)`);
  }
  if (!pro) {
    const held = await app(new Request(`${address}/tri-fold.pdf`));
    if (!/Comes with MΞNU Pro/.test(await held.text())) throw new Error("The tri-fold is open to MΞNU Plus; it comes with Pro and Max");
  }
  const tv = await app(new Request(`${address}/tv`));
  const screen = await tv.text();
  if (tv.status !== 200 || !screen.includes(CHECK_ITEM)) throw new Error(`The TV menu screen doesn't show the menu (HTTP ${tv.status})`);
  return `all ${ALL_ITEMS.length} items and prices on the page, QR code points at it, ${pro ? "print PDF, tri-fold, table tent" : "print PDF (tri-fold held for Pro)"} and TV screen open`;
}

async function stageAwaitCancelled(env, app, test) {
  const run = runOf(test);
  const s = state(test);
  const sub = await env.DB.prepare(`SELECT status FROM subscriptions WHERE id = ?`).bind(s.subscription_id).first();
  if (sub?.status !== "CANCELLED") return null;
  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM entitlements WHERE subscription_id = ? AND status != 'EXPIRED'`).bind(s.subscription_id).first();
  if (Number(open?.n) !== 0) throw new Error(`${open.n} entitlements still open after cancel`);
  const jobs = await periodJobs(env, s.subscription_id);
  if (jobs.length !== run.jobs.length) throw new Error(`Expected ${run.jobs.length} period jobs in all, found ${jobs.length}`);
  // The plan hosts the menu (no free plan since Nov 19, 2026): online through the grace period, then offline.
  const now = await menuHostingState(env, s.business_id);
  if (!now.live) throw new Error(`The menu went offline the moment ${run.label} was cancelled (${now.reason})`);
  const later = await menuHostingState(env, s.business_id, new Date(Date.now() + GRACE_PLUS_DAYS * 86400000));
  if (later.live) throw new Error(`After the grace period the menu is still online (${later.reason}); it should go offline when the plan ends`);
  await cleanUp(env, test);
  return updateTest(env, test, { status: "PASSED", stage: "DONE",
    log: `Cancel synced: CANCELLED, entitlements EXPIRED${run.jobs.length ? "" : ", still no period work"}; menu stays online (${now.reason}) and goes offline after the grace period. Test clock deleted, preview removed` });
}

async function cleanUp(env, test) {
  const s = state(test);
  await cancelPeriodJobs(env, s.subscription_id).catch(() => null);
  if (s.clock_id) await stripeTest(env, `/v1/test_helpers/test_clocks/${s.clock_id}`, "DELETE").catch(() => null);
  await removePreview(env, s.token);
}

const STAGES = { START: stageStart, AWAIT_ACTIVE: stageAwaitActive, AWAIT_APPROVAL: stageAwaitApproval, AWAIT_DELIVERY: stageAwaitDelivery, AWAIT_CANCELLED: stageAwaitCancelled };

async function failTest(env, test, message) {
  test = (await env.DB.prepare(`SELECT * FROM self_tests WHERE id = ?`).bind(test.id).first()) || test;
  const detail = await diagnose(env, test).catch(() => "");
  const failed = await updateTest(env, test, { status: "FAILED", error: `${message}${detail ? ` | ${detail}` : ""}`.slice(0, 1000), log: `FAILED: ${message}` });
  await cancelTestOrder(env, failed).catch((error) => console.error("Menu plan self-test order cleanup failed:", error?.message || error));
  await cleanUp(env, failed).catch(() => null);
  const label = runOf(test)?.label || "Menu plan";
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `${label} self-test failed`,
    html: brandedEmailHtml({ preheader: `The automated test of ${label} failed.`, eyebrow: "SELF-TEST", heading: `The ${label} self-test failed`,
      paragraphs: ["The automated test order (Stripe test mode, test clock) stopped before it finished. Real orders may hit the same problem. Forward this email to Claude."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Test order", failed.order_id || "none"], ["Self-test", test.id]] }),
    text: `The ${label} self-test failed at ${test.stage || "START"}.\n${failed.error}\nTest order: ${failed.order_id || "none"}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceMenuPlanSelfTests(env, app) {
  if (!env.DB || !env.ASSETS) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const results = [];
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind IN (${KINDS.map(() => "?").join(", ")}) AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2`).bind(...KINDS).all()).results || [];
  for (let test of tests) {
    for (let guard = 0; guard < 5; guard++) {
      // A run cut off partway through START isn't started again (it may already have an order): it fails on its timeout.
      const stage = test.status === "REQUESTED" ? "START" : test.stage;
      const handler = stage === "START" && test.status === "RUNNING" ? async () => null : STAGES[stage];
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
        test = await failTest(env, error?.selfTest || test, error instanceof Error ? error.message : String(error));
        break;
      }
    }
    results.push({ id: test.id, status: test.status, stage: test.stage });
  }
  return results;
}

export { KINDS as MENU_PLAN_SELF_TEST_KINDS, RUNS as MENU_PLAN_RUNS, advanceMenuPlanSelfTests, maybeScheduleDaily };
