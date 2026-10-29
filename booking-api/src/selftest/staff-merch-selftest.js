// Sandbox self-test for staff merch (stage 10), run by the worker's 5-minute schedule and once a day.
// Real path end to end, in Stripe test mode: the Nino shop's live catalog gives two sizes of one shirt; the logo is
// uploaded on /api/merch/logo; /api/merch/products gives the logo products with their mockup templates; one of every
// logo product is added (so Printful checks every product's file, placement and embroidery threads);
// /api/merch/quote has the Nino shop re-check everything against Printful and quote real delivery (2 Nino shirts +
// 10 logo items = 12, so the 10% team discount, the $5 logo fee on the Nino shirts, Printful x 2 rounded to .99 on
// the logo items and the embroidery set-up apply); /api/merch/checkout opens a test
// session that is paid with a test card; the webhook starts production; the logo proof waits for owner approval and
// is approved through the approve page; delivery places the order in Printful as a DRAFT ONLY (sandbox orders are
// never confirmed, so nothing prints or ships); the draft is checked and then deleted.
// Start one by inserting a self_tests row, kind STAFF_MERCH_RUN, status REQUESTED. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { externalIdFor, merchService } from "../producers/staff-merch/order.js";
import { SAMPLE_LOGO_PNG } from "./sample-assets.js";
import { payTestCheckout, updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "STAFF_MERCH_RUN";
const LOGO_KEYS = ["tee", "hoodie", "polo", "apron", "cap", "beanie", "mug", "coaster", "tote", "stickers"];
const STAGE_TIMEOUT_MINUTES = 30;
const DAILY_HOUR_UTC = 19; // 12pm Pacific
const ADDRESS = { name: "Menu-Made Self-Test", address1: "1 Ferry Building", city: "San Francisco", state_code: "CA", country_code: "US", zip: "94111" };
const state = (test) => parseJsonOrNull(test.state_json) || {};
const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });

async function loadActiveTests(env) {
  return (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 1`).bind(KIND).all()).results || [];
}

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 30) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

async function stageStart(env, app, test) {
  if (!env.STRIPE_SECRET_KEY_TEST) throw new Error("STRIPE_SECRET_KEY_TEST is not configured");
  const base = publicBaseUrl(env);
  const sample = await merchService(env, "sample", {});
  if (!sample.ok) throw new Error(`The Nino catalog sample failed: ${sample.message || sample.error}`);
  const [a, b] = sample.variants;
  const upload = new FormData();
  upload.append("logo", new File([SAMPLE_LOGO_PNG], "logo.png", { type: "image/png" }));
  const logo = await json(await app(new Request(`${base}/api/merch/logo`, { method: "POST", body: upload })));
  if (!logo.body?.ok) throw new Error(`Logo upload failed (HTTP ${logo.status})`);
  if (!logo.body.width || !logo.body.height) throw new Error("The logo upload did not report the image size");
  const products = await json(await app(new Request(`${base}/api/merch/products`)));
  if (!products.body?.ok) throw new Error(`Merch products failed (HTTP ${products.status}): ${products.body?.error}`);
  const pick = (key) => products.body.products.find((x) => x.key === key);
  const mug = pick("mug");
  const missing = LOGO_KEYS.filter((key) => !pick(key)?.variants?.length || !pick(key)?.templates?.length);
  if (missing.length) throw new Error(`Merch products without stock or a mockup template: ${missing.join(", ")}`);
  const logoItems = LOGO_KEYS.map((key) => ({ key, variant_id: pick(key).variants[0].id, quantity: 1 }));
  const quote = await json(await app(new Request(`${base}/api/merch/quote`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment: "sandbox", logo_id: logo.body.logo_id, recipient: ADDRESS, logo_items: logoItems, items: [{ ...a, quantity: 1 }, { ...b, quantity: 1 }].map(({ product_id, variant_id, quantity }) => ({ product_id, variant_id, quantity })) })
  })));
  if (!quote.body?.ok) throw new Error(`Quote failed (HTTP ${quote.status}): ${quote.body?.error}`);
  const p = quote.body.pricing;
  if (p.items !== 12 || p.discount_percent !== 10 || p.logo_fee_cents !== 500) throw new Error(`Wrong pricing: ${JSON.stringify(p)}`);
  const expectedUnit = Math.round((quote.body.lines[0].unit_price_cents + 500) * 0.9);
  if (quote.body.lines[0].unit_cents !== expectedUnit) throw new Error(`Wrong unit price ${quote.body.lines[0].unit_cents}, expected ${expectedUnit}`);
  const mugLine = quote.body.lines.find((l) => l.key === "mug");
  const mugList = Math.floor(Math.round(mug.variants[0].base_cents * 2) / 100) * 100 + 99;
  if (!mugLine || mugLine.unit_cents !== Math.round(mugList * 0.9)) throw new Error(`Wrong mug price ${mugLine?.unit_cents}, expected ${Math.round(mugList * 0.9)}`);
  const rate = quote.body.rates[0];
  const checkout = await json(await app(new Request(`${base}/api/merch/checkout`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quote_id: quote.body.quote_id, rate_id: rate.id, customer: { name: "Menu-Made Self-Test", email: SELF_TEST_EMAIL, business: `Merch Self-Test ${test.id.slice(0, 6)}` } })
  })));
  if (!checkout.body?.ok) throw new Error(`Merch checkout failed (HTTP ${checkout.status}): ${checkout.body?.error}`);
  const reuse = await json(await app(new Request(`${base}/api/merch/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quote_id: quote.body.quote_id, rate_id: rate.id, customer: { email: SELF_TEST_EMAIL, business: "x" } }) })));
  if (reuse.status !== 409) throw new Error("A used quote could be checked out twice");
  const order = await env.DB.prepare(`SELECT stripe_checkout_session_id, total_cents FROM orders WHERE id = ?`).bind(checkout.body.order_id).first();
  if (order.total_cents !== p.subtotal_cents + rate.amount_cents) throw new Error(`Order total ${order.total_cents} != items ${p.subtotal_cents} + delivery ${rate.amount_cents}`);
  const paid = await payTestCheckout(env, order.stripe_checkout_session_id);
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_APPROVAL", order_id: checkout.body.order_id, state: { orderId: checkout.body.order_id },
    log: `12 items (Nino shirts ${a.color} ${a.size} + ${b.size}, one of each logo product${p.setup_cents ? ` + set-up $${(p.setup_cents / 100).toFixed(2)}` : ""}) quoted with logo and 10% discount; $${(order.total_cents / 100).toFixed(2)} incl. ${rate.name}; paid with a test card (${paid.amount}); used quote refused` });
}

async function stageAwaitApproval(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT id FROM projects WHERE order_id = ? AND workflow_key = 'STAFF_MERCH_V1'`).bind(s.orderId).first();
  if (!project) return null;
  const approval = await env.DB.prepare(`SELECT id, json_extract(metadata_json, '$.owner_notified_at') AS notified FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1`).bind(project.id).first();
  if (!approval?.notified) return null;
  const proof = await env.DB.prepare(`SELECT a.storage_key FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ? AND d.deliverable_type = 'MERCH_PROOF'`).bind(project.id).first();
  const html = proof && await (await env.ASSETS.get(proof.storage_key))?.text();
  if (!html || !html.includes("data:image/png;base64,") || !html.includes("10% team discount")) throw new Error("The proof is missing the logo or the discount");
  const merch = parseJsonOrNull((await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(project.id).first())?.metadata_json)?.merch;
  if (merch?.printful_order_id) throw new Error("A Printful order was placed before the owner approved the logo");
  const form = new FormData();
  form.append("t", await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 }));
  const res = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (res.status !== 200) throw new Error(`Approving failed (HTTP ${res.status})`);
  return updateTest(env, test, { stage: "AWAIT_DELIVERED", project_id: project.id, state: { projectId: project.id }, log: "Logo proof produced; nothing ordered before approval; approved through the approve page" });
}

async function stageAwaitDelivered(env, app, test) {
  const s = state(test);
  const project = await env.DB.prepare(`SELECT status, metadata_json FROM projects WHERE id = ?`).bind(s.projectId).first();
  if (project?.status !== "DELIVERED") return null;
  const merch = parseJsonOrNull(project.metadata_json)?.merch;
  if (!merch?.printful_order_id || merch.printful_status !== "draft") throw new Error(`Expected a Printful draft, got ${merch?.printful_status || "no order"}`);
  const status = await merchService(env, "orderStatus", { external_id: externalIdFor(s.orderId) });
  if (!status.ok || !status.found || status.status !== "draft") throw new Error(`Printful does not show the draft (${status.error || status.status})`);
  const mail = await env.DB.prepare(`SELECT 1 FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1`).bind(s.projectId).first();
  if (!mail) throw new Error("The buyer was not emailed");
  const removed = await merchService(env, "deleteDraft", { external_id: externalIdFor(s.orderId) });
  if (!removed.ok || !removed.deleted) throw new Error(`The Printful draft could not be deleted (${removed.reason || removed.error})`);
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: `Printful draft ${merch.printful_order_id} created through the Nino shop (cost $${(merch.printful_cost_cents / 100).toFixed(2)}), buyer emailed, draft deleted` });
}

const STAGES = { START: stageStart, AWAIT_APPROVAL: stageAwaitApproval, AWAIT_DELIVERED: stageAwaitDelivered };

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  const s = state(test);
  if (s.orderId) await merchService(env, "deleteDraft", { external_id: externalIdFor(s.orderId) }).catch(() => null);
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject: "Staff merch self-test failed",
    html: brandedEmailHtml({ eyebrow: "SELF-TEST", heading: "The staff merch self-test failed", paragraphs: ["A test staff merch order did not come out as expected. Nothing was printed (test orders are Printful drafts)."], rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The staff merch self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceStaffMerchSelfTests(env, app) {
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

export { advanceStaffMerchSelfTests };
