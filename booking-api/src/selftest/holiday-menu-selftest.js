// Daily self-test for Holiday Menu (checkout/holiday.js), run by the worker's own 5-minute schedule.
// It goes the way a buyer does, in Stripe test mode, through the real routes:
//   START            a 2-page holiday menu uploaded as at checkout; a holiday preview of it in the generator (stored
//                    as the generator stores one, without the AI read or the public daily limits); the preview opens
//                    with the six holiday designs; "Make it live" on a design that isn't the first; the checkout
//                    handoff carries the holiday, the design and the menu file; test checkout at the holiday price
//                    ($59, or $30 once the test inbox already has one this season); paid with the test card
//   AWAIT_ORDER_PAID the webhook made a MENU_QR_V1 project carrying the holiday and its end day; menu attached
//   AWAIT_APPROVAL   menu and QR produced; owner approval requested and approved
//   AWAIT_DELIVERY   delivered; the menu is live at its own holiday address, in the chosen design, with the holiday
//                    line under the name; the business's regular address doesn't show it. Then what the buyer holds
//                    is checked, not only that the run finished (owner, Nov 12, 2026: "include quality check"): every
//                    item and price of the uploaded menu is on the page, the QR code points at this menu's own
//                    address, the print PDF, tri-fold and table tent are real PDFs, and the TV screen shows the menu
//   SECOND_MENU      (while the other holiday is still on sale) the order was for both holidays at $89: the "send your
//                    other menu" email went out; a preview of the other holiday says it is already paid; "Make it
//                    live" completes it with no Stripe page, as a paid $0 order
//   AWAIT_SECOND     that $0 order has its own project, marked with the other holiday, with its menu attached; it is
//                    then cancelled so the day's test makes one menu, not two
// Each run starts by retiring the test inbox's earlier holiday test orders (marked refunded), so it is a first-time
// buyer again: only a buyer with no holiday menu this season can buy both.
// Then the previews are removed, so they never count as real ones (daily limit, Friday numbers).
// Outside the season (after Dec 31) nothing is on sale: the run passes once checkout has refused a holiday menu.
// Start one by inserting a self_tests row with kind HOLIDAY_MENU_RUN and status REQUESTED. Only a failure emails the owner.
import { HOLIDAY_PRICING, OCCASION_NAMES, holidayEndsOn, holidayOnSale, otherOccasion, seasonYear } from "../checkout/holiday.js";
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { storeMenuDesigns } from "../marketing/public-preview.js";
import { hostedMenuSlug } from "../onboarding/menu-inputs.js";
import { HOLIDAY_DESIGNS, designsFor, menuDesignFor } from "../producers/menu-qr/menu-designs.js";
import { dailyClock } from "./daily-clock.js";
import { buildMenuPdf, cancelTestOrder, diagnose, payTestCheckout, updateTest } from "./menu-qr-selftest.js";

const KIND = "HOLIDAY_MENU_RUN";
const STAGE_TIMEOUT_MINUTES = 25;
const ATTACH_GRACE_MINUTES = 10; // a Stripe webhook retry can take minutes
const DAILY_HOUR_UTC = 19;       // 11:30am Pacific
const DAILY_MINUTE_FROM = 30;
const BUSINESS = "Holiday Self-Test Cafe";
const MENU_PAGES = [
  ["Holiday Dinner", [["Prime Rib", "$48"], ["Roast Turkey", "$36"], ["Butternut Ravioli", "$28"]]],
  ["Holiday Desserts", [["Gingerbread Cake", "$11"], ["Peppermint Sundae", "$9"], ["Eggnog Custard", "$10"]]]
];
const CHECK_ITEM = "Prime Rib";
const ALL_ITEMS = MENU_PAGES.flatMap(([, items]) => items);
const PREPAID_BUTTON = "already paid"; // public-preview.js PREPAID_LABEL: "Complete your order: already paid"
const PREVIEW_MENU = {
  sections: MENU_PAGES.map(([name, items]) => ({ name, items: items.map(([item, price]) => ({ name: item, description: "", price })) })),
  notes: "", unreadable: ""
};
const state = (test) => parseJsonOrNull(test.state_json) || {};
const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });
const dollars = (cents) => `$${cents / 100}`;

// The holiday on sale now: Christmas through Dec 25, then New Year's Eve through Dec 31, then none until next season.
const occasionOnSale = (now = Date.now()) => ["christmas", "newyear"].find((o) => holidayOnSale(o, now)) || null;

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < DAILY_MINUTE_FROM || now.getUTCMinutes() >= DAILY_MINUTE_FROM + 20) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

// The test inbox becomes a first-time holiday buyer again: its earlier holiday TEST orders (Stripe test mode only)
// stop counting as paid. Without this it could never buy both holidays, which needs a buyer with no holiday menu yet.
async function retireEarlierRuns(env, now) {
  await env.DB.prepare(`
      UPDATE orders SET payment_status = 'REFUNDED', updated_at = ?
      WHERE payment_status = 'PAID' AND stripe_checkout_session_id LIKE 'cs_test_%' AND created_at >= ?
        AND customer_id IN (SELECT id FROM customers WHERE lower(email) = ?)
        AND EXISTS (SELECT 1 FROM order_items oi JOIN offers f ON f.id = oi.offer_id WHERE oi.order_id = orders.id AND f.code = 'HOLIDAY_MENU')
    `).bind(nowIso(), `${seasonYear(now)}-07-01T00:00:00.000Z`, SELF_TEST_EMAIL).run();
}

// The upload and stored preview a buyer has when they tap "Make it live" (no AI read, no public daily limits).
async function makePreview(env, app, { occasion, now, label }) {
  const requestId = crypto.randomUUID();
  const stamp = nowIso().slice(0, 16).replace("T", " ");
  const upload = new FormData();
  upload.append("payload", JSON.stringify({ type: "inquiry", purpose: "checkout", service: "Other project", name: "Menu-Made Self-Test",
    business: BUSINESS, email: SELF_TEST_EMAIL, notes: `Automated holiday self-test ${stamp}${label ? ` (${label})` : ""}`, website: "", requestId }));
  upload.append("document", new File([buildMenuPdf(MENU_PAGES, BUSINESS)], "self-test-holiday-menu.pdf", { type: "application/pdf" }));
  const uploaded = await json(await app(new Request(`${publicBaseUrl(env)}/api/inquiry`, { method: "POST", body: upload, headers: { Origin: "https://menu-made.com", "CF-Connecting-IP": "self-test" } })));
  if (!uploaded.body?.ok) throw new Error(`Menu upload failed (HTTP ${uploaded.status})`);
  const token = `${crypto.randomUUID().replace(/-/g, "")}5e1f`; // 36 hex characters, like a real preview token
  const t = new Date(now).toISOString();
  await storeMenuDesigns(env, token, { business: BUSINESS, menu: PREVIEW_MENU, colors: "", custom: {}, customized: 0, occasion });
  await env.DB.prepare(`INSERT INTO menu_previews (token, request_id, email, business, ip_hash, campaign, status, item_count, created_at, expires_at, occasion) VALUES (?, ?, ?, ?, '', 'selftest', 'READY', 6, ?, ?, ?)`)
    .bind(token, requestId, SELF_TEST_EMAIL, BUSINESS, t, new Date(now + 86400000).toISOString(), occasion).run();
  return { token, requestId };
}

async function checkout(env, app, body) {
  return json(await app(new Request(`${publicBaseUrl(env)}/api/create-checkout-test`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://menu-made.com" }, body: JSON.stringify(body)
  })));
}

async function removePreview(env, token) {
  if (!/^[a-f0-9]{36}$/.test(String(token || ""))) return;
  await env.DB.prepare(`DELETE FROM menu_previews WHERE token = ? AND campaign = 'selftest'`).bind(token).run().catch(() => null);
  for (const key of [...HOLIDAY_DESIGNS.map((d) => `${d.key}.html`), "data.json"]) await env.ASSETS.delete(`menu-previews/${token}/${key}`).catch(() => null);
}

async function stageStart(env, app, test) {
  if (!env.STRIPE_SECRET_KEY_TEST) throw new Error("STRIPE_SECRET_KEY_TEST is not configured");
  const base = publicBaseUrl(env);
  const now = Date.now();
  const occasion = occasionOnSale(now);
  if (!occasion) {
    // Out of season: the only thing to prove is that nobody can buy one.
    const refused = await checkout(env, app, { items: [{ code: "HOLIDAY_MENU" }], holiday_preview: "0".repeat(36), customer: { name: "Menu-Made Self-Test", business: BUSINESS, email: SELF_TEST_EMAIL } });
    if (refused.body?.ok) throw new Error("Out of season, but checkout opened for a holiday menu");
    return updateTest(env, test, { status: "PASSED", stage: "DONE", log: `Holiday menus are finished for this season; checkout refuses one (HTTP ${refused.status})` });
  }
  const name = OCCASION_NAMES[occasion];
  const list = designsFor(occasion);
  const design = list[2]; // not the first, so a lost choice shows

  // Yesterday's test orders stop counting, then the menu file is uploaded the way the holiday page does and its
  // holiday preview stored as the generator stores one. Both holidays are bought while the other is still on sale.
  await retireEarlierRuns(env, now);
  const other = otherOccasion(occasion);
  const both = holidayOnSale(other, now);
  const { token, requestId } = await makePreview(env, app, { occasion, now });
  test = await updateTest(env, test, { status: "RUNNING", stage: "START", state: { token, occasion, design: design.key, request_id: requestId, ...(both ? { both_other: other } : {}) } });
  // From here a failure has a preview (and soon an order) to clean up: hand the saved row to failTest.
  try {
    return await buyAndPay(env, app, test, { base, now, occasion, name, list, design, token, requestId, both, other });
  } catch (error) {
    if (error && typeof error === "object") error.selfTest = test.current || test;
    throw error;
  }
}

async function buyAndPay(env, app, holder, { base, now, occasion, name, list, design, token, requestId, both, other }) {
  let test = holder;

  // The generator: six holiday designs, this holiday's first, the holiday price on the button.
  const first = await app(new Request(`${base}/api/menu-preview/view/${token}`, { headers: { "User-Agent": "MenuMadeSelfTest (preview check)" } }));
  const firstHtml = await first.text();
  if (first.status !== 200 || !firstHtml.includes(`Design 1 of ${list.length}: ${list[0].label}`) || !firstHtml.includes(CHECK_ITEM)) throw new Error(`The holiday preview didn't open on ${list[0].label} with the menu (HTTP ${first.status})`);
  const generator = await json(await app(new Request(`${base}/api/menu-preview/state/${token}`)));
  const keys = (generator.body?.designs || []).map((d) => d.key).join(",");
  if (keys !== list.map((d) => d.key).join(",")) throw new Error(`The holiday generator shows ${keys || "no designs"}`);
  if (!String(generator.body?.choose_label || "").includes(dollars(HOLIDAY_PRICING.firstCents))) throw new Error(`The Make it live button says "${generator.body?.choose_label}"`);
  if ((await app(new Request(`${base}/api/menu-preview/view/${token}/classic`))).status === 200) throw new Error("A regular design opened in a holiday preview");

  // "Make it live" on the chosen design, then the checkout prefill.
  const chose = await app(new Request(`${base}/api/menu-preview/choose/${token}/${design.key}`));
  const to = chose.headers.get("location") || "";
  if (chose.status !== 303 || !to.includes("service=holiday") || !to.includes(token)) throw new Error(`Make it live didn't go to the holiday checkout (HTTP ${chose.status} ${to})`);
  const handoff = await json(await app(new Request(`${base}/api/menu-preview/handoff/${token}`)));
  if (handoff.body?.occasion !== occasion || handoff.body?.design !== design.label || handoff.body?.request_id !== requestId) throw new Error(`Checkout prefill is wrong: ${JSON.stringify(handoff.body).slice(0, 200)}`);

  // Checkout needs a holiday preview, takes one holiday menu, and charges the holiday price.
  const customer = { name: "Menu-Made Self-Test", business: BUSINESS, email: SELF_TEST_EMAIL, phone: "", notes: `Holiday menu (self-test)\nDocument ref: ${requestId}` };
  if ((await checkout(env, app, { items: [{ code: "HOLIDAY_MENU" }], customer })).body?.ok) throw new Error("Checkout opened for a holiday menu with no holiday preview");
  // A first-time buyer: $59 for one holiday, $89 for both while the other holiday is still on sale.
  const expected = both ? HOLIDAY_PRICING.firstCents + HOLIDAY_PRICING.secondCents : HOLIDAY_PRICING.firstCents;
  const opened = await checkout(env, app, { items: [{ code: "HOLIDAY_MENU" }], holiday_preview: token, ...(both ? { holiday_both: true } : {}), customer });
  if (!opened.body?.ok || !opened.body.order_id) throw new Error(`Test checkout failed (HTTP ${opened.status}): ${JSON.stringify(opened.body).slice(0, 300)}`);
  const orderId = opened.body.order_id;
  test = await updateTest(env, test, { order_id: orderId });
  holder.current = test;
  const order = await env.DB.prepare(`SELECT stripe_checkout_session_id, total_cents FROM orders WHERE id = ?`).bind(orderId).first();
  if (order?.total_cents !== expected) throw new Error(`Expected a ${dollars(expected)} order, got ${order?.total_cents}`);
  const item = parseJsonOrNull((await env.DB.prepare(`SELECT metadata_json FROM order_items WHERE order_id = ? LIMIT 1`).bind(orderId).first())?.metadata_json)?.holiday_menu;
  if (item?.occasion !== occasion || item?.design !== design.key || item?.ends_on !== holidayEndsOn(occasion, now)) throw new Error(`The order doesn't carry the holiday: ${JSON.stringify(item)}`);
  if ((item.both_other || null) !== (both ? other : null)) throw new Error(`The order ${both ? `doesn't record the ${OCCASION_NAMES[other]} menu still owed` : "records a second holiday nobody bought"}: ${JSON.stringify(item)}`);
  const paid = await payTestCheckout(env, order.stripe_checkout_session_id);
  return updateTest(env, test, { stage: "AWAIT_ORDER_PAID", state: { session_id: order.stripe_checkout_session_id, ends_on: item.ends_on, price_cents: expected },
    log: `${name} preview opened with ${list.length} holiday designs; ${design.label} chosen; order ${orderId} placed at ${dollars(expected)}${both ? " for both holidays" : ""}; paid with test card (${paid.amount})` });
}

async function stageAwaitOrderPaid(env, app, test) {
  const s = state(test);
  const order = await env.DB.prepare(`SELECT payment_status FROM orders WHERE id = ?`).bind(test.order_id).first();
  const project = await env.DB.prepare(`SELECT id, metadata_json FROM projects WHERE order_id = ? AND workflow_key = 'MENU_QR_V1' LIMIT 1`).bind(test.order_id).first();
  if (order?.payment_status !== "PAID" || !project) return null;
  // The webhook creates the project, then marks its holiday and attaches the menu: wait for all of it.
  const meta = parseJsonOrNull(project.metadata_json) || {};
  const menuFile = await env.DB.prepare(`SELECT status FROM project_inputs WHERE project_id = ? AND input_key = 'menu_file'`).bind(project.id).first();
  if (meta.holiday_menu?.occasion !== s.occasion || menuFile?.status !== "VALID" || !meta.extras_until) {
    if (Date.now() - Date.parse(test.stage_started_at || test.created_at) < ATTACH_GRACE_MINUTES * 60000) return null;
    if (meta.holiday_menu?.occasion !== s.occasion) throw new Error("The project wasn't marked as a holiday menu");
    if (menuFile?.status !== "VALID") throw new Error("The menu uploaded at checkout was not attached to the project");
    throw new Error("The optional extras window did not open");
  }
  if (meta.holiday_menu.ends_on !== s.ends_on) throw new Error(`The project's holiday ends ${meta.holiday_menu.ends_on}, expected ${s.ends_on}`);
  const skip = await json(await app(new Request(`${publicBaseUrl(env)}/api/onboarding/start`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: test.order_id, session_id: s.session_id })
  })));
  if (!skip.body?.ok) throw new Error(`Skipping extras failed (HTTP ${skip.status})`);
  return updateTest(env, test, { stage: "AWAIT_APPROVAL", project_id: project.id, log: `Stripe webhook marked the order paid; project carries the holiday (ends ${s.ends_on}); menu attached; extras skipped` });
}

async function stageAwaitApproval(env, app, test) {
  const billing = parseJsonOrNull((await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(test.project_id).first())?.metadata_json)?.page_billing;
  if (billing?.status === "PAYMENT_REQUIRED") throw new Error(`A ${MENU_PAGES.length}-page holiday menu was asked to pay for extra pages (counted ${billing.counted_pages})`);
  const approval = await env.DB.prepare(`SELECT id FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1`).bind(test.project_id).first();
  if (!approval) return null;
  const notified = await env.DB.prepare(`SELECT 1 AS ok FROM approvals WHERE id = ? AND json_extract(metadata_json, '$.owner_notified_at') IS NOT NULL`).bind(approval.id).first();
  if (!notified) return null; // the approval email goes out at the end of the runner tick
  const form = new FormData();
  form.append("t", await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 }));
  const approved = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_DELIVERY", log: "Holiday menu and QR produced; owner approval requested and approved" });
}

async function stageAwaitDelivery(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT p.status, b.name AS business_name FROM projects p JOIN businesses b ON b.id = p.business_id WHERE p.id = ?`).bind(test.project_id).first();
  if (project?.status !== "DELIVERED") return null;
  const delivery = await env.DB.prepare(`SELECT 1 AS ok FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(test.project_id).first();
  if (!delivery) throw new Error("Project delivered but no delivery email was logged");
  const base = publicBaseUrl(env);
  const slug = hostedMenuSlug(test.project_id, project.business_name, s.occasion);
  const page = await app(new Request(`${base}/api/menu/${slug}`));
  const html = await page.text();
  if (page.status !== 200 || !html.includes(CHECK_ITEM)) throw new Error(`The holiday menu page is missing "${CHECK_ITEM}" (HTTP ${page.status})`);
  const design = menuDesignFor(s.design);
  if (!html.toLowerCase().includes(design.style.paper)) throw new Error(`The holiday menu isn't in the chosen design (${design.label})`);
  if (!html.replace(/&(#0?39|apos);/g, "'").includes(`<p>${OCCASION_NAMES[s.occasion]} Menu</p>`)) throw new Error("The holiday line under the name is missing");
  // The business's regular address is not this menu's.
  const regular = await app(new Request(`${base}/api/menu/${hostedMenuSlug(test.project_id, project.business_name)}`));
  if (regular.status === 200 && (await regular.text()).includes(CHECK_ITEM)) throw new Error("The holiday menu also shows at the regular menu address");
  const quality = await checkWhatTheBuyerGot(env, app, test, { base, slug, html });
  await removePreview(env, s.token);
  const delivered = `Delivered to the buyer; live at /api/menu/${slug} in ${design.label} through ${s.ends_on}; ${quality}; preview removed`;
  if (!s.both_other) return updateTest(env, test, { status: "PASSED", stage: "DONE", log: delivered });
  return updateTest(env, test, { stage: "SECOND_MENU", log: delivered });
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
  for (const format of ["print.pdf", "tri-fold.pdf", "table-tent.pdf"]) {
    const file = await app(new Request(`${address}/${format}`));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = bytes.length > 1000 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
    if (file.status !== 200 || !/application\/pdf/.test(file.headers.get("content-type") || "") || !isPdf) throw new Error(`The buyer's ${format} is not a PDF (HTTP ${file.status}, ${file.headers.get("content-type") || "no type"}, ${bytes.length} bytes)`);
  }
  const tv = await app(new Request(`${address}/tv`));
  const screen = await tv.text();
  if (tv.status !== 200 || !screen.includes(CHECK_ITEM)) throw new Error(`The TV menu screen doesn't show the menu (HTTP ${tv.status})`);
  return `all ${ALL_ITEMS.length} items and prices on the page, QR code points at it, print PDF, tri-fold, table tent and TV screen open`;
}

// The other holiday of an order for both: already paid, so "Make it live" finishes with no Stripe page.
async function stageSecondMenu(env, app, test) {
  const s = state(test);
  const other = s.both_other;
  const now = Date.now();
  const base = publicBaseUrl(env);
  // Matched on the key itself: D1 refuses a LIKE pattern over 50 bytes, and "%holiday-both/<order id>%" is 52 (Nov 13, 2026).
  const linked = await env.DB.prepare(`SELECT 1 AS ok FROM communications WHERE purpose = 'HOLIDAY_BOTH' AND status = 'SENT' AND json_extract(metadata_json, '$.idempotency_key') = ? LIMIT 1`).bind(`holiday-both/${test.order_id}`).first();
  if (!linked) throw new Error(`The buyer was not emailed the link to send their ${OCCASION_NAMES[other]} menu`);
  const { token, requestId } = await makePreview(env, app, { occasion: other, now, label: "second menu" });
  test = await updateTest(env, test, { state: { second_token: token } });
  try {
    const generator = await json(await app(new Request(`${base}/api/menu-preview/state/${token}`)));
    if (!String(generator.body?.choose_label || "").includes(PREPAID_BUTTON)) throw new Error(`The ${OCCASION_NAMES[other]} preview's button says "${generator.body?.choose_label}", not that it is already paid`);
    const handoff = await json(await app(new Request(`${base}/api/menu-preview/handoff/${token}`)));
    if (handoff.body?.holiday_prepaid !== true || handoff.body?.holiday_price_cents !== 0) throw new Error(`Checkout prefill doesn't show the ${OCCASION_NAMES[other]} menu as paid: ${JSON.stringify(handoff.body).slice(0, 200)}`);
    const customer = { name: "Menu-Made Self-Test", business: BUSINESS, email: SELF_TEST_EMAIL, phone: "", notes: `Holiday menu (self-test, second menu)\nDocument ref: ${requestId}` };
    const done = await checkout(env, app, { items: [{ code: "HOLIDAY_MENU" }], holiday_preview: token, customer });
    if (!done.body?.ok || done.body.prepaid !== true || !/checkoutsuccess\.html\?session_id=cs_test_prepaid/.test(String(done.body.url || ""))) throw new Error(`The prepaid ${OCCASION_NAMES[other]} menu didn't go straight to the Success page (HTTP ${done.status}): ${JSON.stringify(done.body).slice(0, 300)}`);
    test = await updateTest(env, test, { state: { second_order_id: done.body.order_id } });
    const order = await env.DB.prepare(`SELECT payment_status, total_cents FROM orders WHERE id = ?`).bind(done.body.order_id).first();
    if (order?.payment_status !== "PAID" || order.total_cents !== 0) throw new Error(`The prepaid order is ${order?.payment_status} at ${order?.total_cents} cents, expected PAID at 0`);
    return updateTest(env, test, { stage: "AWAIT_SECOND", log: `"Send your ${OCCASION_NAMES[other]} menu" email sent; its preview says already paid; order ${done.body.order_id} completed at $0 with no Stripe page` });
  } catch (error) {
    if (error && typeof error === "object") error.selfTest = test;
    throw error;
  }
}

async function stageAwaitSecond(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT id, metadata_json FROM projects WHERE order_id = ? AND workflow_key = 'MENU_QR_V1' LIMIT 1`).bind(s.second_order_id).first();
  const meta = parseJsonOrNull(project?.metadata_json) || {};
  const menuFile = project ? await env.DB.prepare(`SELECT status FROM project_inputs WHERE project_id = ? AND input_key = 'menu_file'`).bind(project.id).first() : null;
  if (!project || meta.holiday_menu?.occasion !== s.both_other || menuFile?.status !== "VALID") {
    if (Date.now() - Date.parse(test.stage_started_at || test.created_at) < ATTACH_GRACE_MINUTES * 60000) return null;
    if (!project) throw new Error("The prepaid order never got a project");
    if (meta.holiday_menu?.occasion !== s.both_other) throw new Error(`The prepaid project isn't marked as the ${OCCASION_NAMES[s.both_other]} menu`);
    throw new Error("The second menu's file was not attached to its project");
  }
  // Proven up to production starting; the day's test makes one menu, not two.
  await cancelTestOrder(env, { order_id: s.second_order_id });
  await removePreview(env, s.second_token);
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: `${OCCASION_NAMES[s.both_other]} project started with its menu attached, then cancelled; second preview removed` });
}

const STAGES = { START: stageStart, AWAIT_ORDER_PAID: stageAwaitOrderPaid, AWAIT_APPROVAL: stageAwaitApproval, AWAIT_DELIVERY: stageAwaitDelivery, SECOND_MENU: stageSecondMenu, AWAIT_SECOND: stageAwaitSecond };

async function failTest(env, test, message) {
  const detail = await diagnose(env, test).catch(() => "");
  const failed = await updateTest(env, test, { status: "FAILED", error: `${message}${detail ? ` | ${detail}` : ""}`.slice(0, 1000), log: `FAILED: ${message}` });
  await cancelTestOrder(env, failed).catch((error) => console.error("Holiday self-test order cleanup failed:", error?.message || error));
  await removePreview(env, state(failed).token).catch(() => null);
  await removePreview(env, state(failed).second_token).catch(() => null);
  if (state(failed).second_order_id) await cancelTestOrder(env, { order_id: state(failed).second_order_id }).catch(() => null);
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Holiday Menu self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of Holiday Menu failed.", eyebrow: "SELF-TEST", heading: "The Holiday Menu self-test failed",
      paragraphs: ["The automated test order (Stripe test mode) stopped before delivery. Real orders may hit the same problem. Forward this email to Claude."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Test order", failed.order_id || "none"], ["Self-test", test.id]] }),
    text: `The Holiday Menu self-test failed at ${test.stage || "START"}.\n${failed.error}\nTest order: ${failed.order_id || "none"}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceHolidayMenuSelfTests(env, app) {
  if (!env.DB || !env.ASSETS) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const results = [];
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 2`).bind(KIND).all()).results || [];
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

export { KIND as HOLIDAY_MENU_KIND, advanceHolidayMenuSelfTests, maybeScheduleDaily, occasionOnSale };
