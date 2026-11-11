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
//                    line under the name; the business's regular address doesn't show it
// Then the preview is removed, so it never counts as a real one (daily limit, Friday numbers).
// Outside the season (after Dec 31) nothing is on sale: the run passes once checkout has refused a holiday menu.
// Start one by inserting a self_tests row with kind HOLIDAY_MENU_RUN and status REQUESTED. Only a failure emails the owner.
import { HOLIDAY_PRICING, OCCASION_NAMES, holidayEndsOn, holidayOnSale, seasonYear } from "../checkout/holiday.js";
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { storeMenuDesigns } from "../marketing/public-preview.js";
import { hostedMenuSlug } from "../onboarding/menu-inputs.js";
import { designsFor, menuDesignFor } from "../producers/menu-qr/menu-designs.js";
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

// What the test inbox should be charged: its own count of paid holiday orders this season, kept apart from
// holidayPriceCents so a pricing mistake there shows up here.
async function expectedPriceCents(env, now) {
  const row = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE lower(c.email) = ? AND o.payment_status = 'PAID' AND o.created_at >= ?
        AND EXISTS (SELECT 1 FROM order_items oi JOIN offers f ON f.id = oi.offer_id WHERE oi.order_id = o.id AND f.code = 'HOLIDAY_MENU')
    `).bind(SELF_TEST_EMAIL, `${seasonYear(now)}-07-01T00:00:00.000Z`).first();
  return Number(row?.n || 0) > 0 ? HOLIDAY_PRICING.secondCents : HOLIDAY_PRICING.firstCents;
}

async function checkout(env, app, body) {
  return json(await app(new Request(`${publicBaseUrl(env)}/api/create-checkout-test`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://menu-made.com" }, body: JSON.stringify(body)
  })));
}

async function removePreview(env, token) {
  if (!/^[a-f0-9]{36}$/.test(String(token || ""))) return;
  await env.DB.prepare(`DELETE FROM menu_previews WHERE token = ? AND campaign = 'selftest'`).bind(token).run().catch(() => null);
  for (const key of [...designsFor("christmas").map((d) => `${d.key}.html`), "data.json"]) await env.ASSETS.delete(`menu-previews/${token}/${key}`).catch(() => null);
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

  // The menu file, uploaded the way the holiday page does before it builds a preview.
  const requestId = crypto.randomUUID();
  const stamp = nowIso().slice(0, 16).replace("T", " ");
  const upload = new FormData();
  upload.append("payload", JSON.stringify({ type: "inquiry", purpose: "checkout", service: "Other project", name: "Menu-Made Self-Test",
    business: BUSINESS, email: SELF_TEST_EMAIL, notes: `Automated holiday self-test ${stamp}`, website: "", requestId }));
  upload.append("document", new File([buildMenuPdf(MENU_PAGES, BUSINESS)], "self-test-holiday-menu.pdf", { type: "application/pdf" }));
  const uploaded = await json(await app(new Request(`${base}/api/inquiry`, { method: "POST", body: upload, headers: { Origin: "https://menu-made.com", "CF-Connecting-IP": "self-test" } })));
  if (!uploaded.body?.ok) throw new Error(`Menu upload failed (HTTP ${uploaded.status})`);

  // Its holiday preview, stored as the generator stores one.
  const token = `${crypto.randomUUID().replace(/-/g, "")}5e1f`; // 36 hex characters, like a real preview token
  const t = new Date(now).toISOString();
  await storeMenuDesigns(env, token, { business: BUSINESS, menu: PREVIEW_MENU, colors: "", custom: {}, customized: 0, occasion });
  await env.DB.prepare(`INSERT INTO menu_previews (token, request_id, email, business, ip_hash, campaign, status, item_count, created_at, expires_at, occasion) VALUES (?, ?, ?, ?, '', 'selftest', 'READY', 6, ?, ?, ?)`)
    .bind(token, requestId, SELF_TEST_EMAIL, BUSINESS, t, new Date(now + 86400000).toISOString(), occasion).run();
  test = await updateTest(env, test, { status: "RUNNING", stage: "START", state: { token, occasion, design: design.key, request_id: requestId } });
  // From here a failure has a preview (and soon an order) to clean up: hand the saved row to failTest.
  try {
    return await buyAndPay(env, app, test, { base, now, occasion, name, list, design, token, requestId });
  } catch (error) {
    if (error && typeof error === "object") error.selfTest = test.current || test;
    throw error;
  }
}

async function buyAndPay(env, app, holder, { base, now, occasion, name, list, design, token, requestId }) {
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
  const expected = await expectedPriceCents(env, now);
  const opened = await checkout(env, app, { items: [{ code: "HOLIDAY_MENU" }], holiday_preview: token, customer });
  if (!opened.body?.ok || !opened.body.order_id) throw new Error(`Test checkout failed (HTTP ${opened.status}): ${JSON.stringify(opened.body).slice(0, 300)}`);
  const orderId = opened.body.order_id;
  test = await updateTest(env, test, { order_id: orderId });
  holder.current = test;
  const order = await env.DB.prepare(`SELECT stripe_checkout_session_id, total_cents FROM orders WHERE id = ?`).bind(orderId).first();
  if (order?.total_cents !== expected) throw new Error(`Expected a ${dollars(expected)} order, got ${order?.total_cents}`);
  const item = parseJsonOrNull((await env.DB.prepare(`SELECT metadata_json FROM order_items WHERE order_id = ? LIMIT 1`).bind(orderId).first())?.metadata_json)?.holiday_menu;
  if (item?.occasion !== occasion || item?.design !== design.key || item?.ends_on !== holidayEndsOn(occasion, now)) throw new Error(`The order doesn't carry the holiday: ${JSON.stringify(item)}`);
  const paid = await payTestCheckout(env, order.stripe_checkout_session_id);
  return updateTest(env, test, { stage: "AWAIT_ORDER_PAID", state: { session_id: order.stripe_checkout_session_id, ends_on: item.ends_on, price_cents: expected },
    log: `${name} preview opened with ${list.length} holiday designs; ${design.label} chosen; order ${orderId} placed at ${dollars(expected)}; paid with test card (${paid.amount})` });
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
  await removePreview(env, s.token);
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: `Delivered to the buyer; live at /api/menu/${slug} in ${design.label} through ${s.ends_on}; preview removed` });
}

const STAGES = { START: stageStart, AWAIT_ORDER_PAID: stageAwaitOrderPaid, AWAIT_APPROVAL: stageAwaitApproval, AWAIT_DELIVERY: stageAwaitDelivery };

async function failTest(env, test, message) {
  const detail = await diagnose(env, test).catch(() => "");
  const failed = await updateTest(env, test, { status: "FAILED", error: `${message}${detail ? ` | ${detail}` : ""}`.slice(0, 1000), log: `FAILED: ${message}` });
  await cancelTestOrder(env, failed).catch((error) => console.error("Holiday self-test order cleanup failed:", error?.message || error));
  await removePreview(env, state(failed).token).catch(() => null);
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
