// Sandbox self-test for Online Menu + QR, run by the worker's own 5-minute schedule.
// It drives the real HTTP routes the way a buyer's browser and the owner do, in Stripe test mode:
//   upload a 5-page menu at checkout -> 3-page test checkout -> pay (Stripe test card, no browser) ->
//   skip extras -> page check asks for $40 -> pay the extra pages -> owner approval -> delivery -> hosted menu.
// Start one by inserting a self_tests row (status REQUESTED); results are written back to that row.
// A run also starts automatically once a day. Only a failure emails the owner.
import { hostedMenuSlug } from "../onboarding/menu-inputs.js";
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";

const KIND = "MENU_QR_EXTRA_PAGES";
const STAGE_TIMEOUT_MINUTES = 25;
const ATTACH_GRACE_MINUTES = 10; // a Stripe webhook retry can take minutes
const DAILY_HOUR_UTC = 15; // 8am Pacific
const PAID_PAGES = 3;
const MENU_PAGES = [
  ["Starters", [["Garlic Knots", "$7"], ["Burrata Plate", "$13"], ["Arancini", "$11"]]],
  ["Pizza", [["Margherita Pizza", "$15"], ["Pepperoni Pizza", "$17"], ["Funghi Pizza", "$16"]]],
  ["Pasta", [["Cacio e Pepe", "$18"], ["Rigatoni Vodka", "$19"], ["Lasagna Bolognese", "$21"]]],
  ["Desserts", [["Tiramisu", "$9"], ["Cannoli", "$8"], ["Affogato", "$7"]]],
  ["Drinks", [["Espresso", "$4"], ["Blood Orange Soda", "$5"], ["House Red Glass", "$12"]]]
];
const CHECK_ITEM = "Margherita Pizza";

// ---------- Fixture: a real 5-page text PDF ----------

function buildMenuPdf() {
  const escape = (text) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add("");
  const pagesId = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];
  MENU_PAGES.forEach(([section, items], index) => {
    const lines = [`BT /F1 22 Tf 72 720 Td (${escape(`Self-Test Cafe - ${section}`)}) Tj ET`];
    items.forEach(([name, price], row) => {
      lines.push(`BT /F1 14 Tf 72 ${670 - row * 30} Td (${escape(`${name} ........ ${price}`)}) Tj ET`);
    });
    lines.push(`BT /F1 9 Tf 72 60 Td (Page ${index + 1} of ${MENU_PAGES.length}) Tj ET`);
    const stream = lines.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// ---------- Stripe test mode: pay a Checkout Session without a browser (as the Stripe CLI does) ----------

async function stripeTest(env, path, method = "GET", params = null) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY_TEST}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
    },
    ...(params ? { body: new URLSearchParams(params).toString() } : {})
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Stripe ${method} ${path.split("/").slice(0, 3).join("/")}: ${body?.error?.message || response.status}`);
  return body;
}

async function payTestCheckout(env, sessionId) {
  if (!String(sessionId).startsWith("cs_test_")) throw new Error(`Refusing to pay a non-test session ${sessionId}`);
  const session = await stripeTest(env, `/v1/checkout/sessions/${sessionId}`);
  if (session.livemode) throw new Error("Refusing to pay a live-mode session");
  if (session.payment_status === "paid") return { already: true, amount: session.amount_total };
  const page = await stripeTest(env, `/v1/payment_pages/${sessionId}`).catch(() => null);
  const method = await stripeTest(env, "/v1/payment_methods", "POST", {
    type: "card",
    "card[token]": "tok_visa",
    "billing_details[email]": SELF_TEST_EMAIL,
    "billing_details[name]": "Menu-Made Self-Test"
  });
  const expected = page?.total_summary?.due ?? session.amount_total;
  const confirmed = await stripeTest(env, `/v1/payment_pages/${sessionId}/confirm`, "POST", {
    payment_method: method.id,
    expected_amount: String(expected)
  });
  return { amount: expected, status: confirmed?.status || null };
}

// ---------- Rows ----------

async function loadActiveTests(env) {
  return (await env.DB.prepare(`
      SELECT * FROM self_tests WHERE status IN ('REQUESTED', 'RUNNING') AND kind = ? ORDER BY created_at ASC LIMIT 3
    `).bind(KIND).all()).results || [];
}

async function updateTest(env, test, patch) {
  const state = { ...(parseJsonOrNull(test.state_json) || {}), ...(patch.state || {}) };
  const log = [...(parseJsonOrNull(test.log_json) || []), ...(patch.log ? [{ at: nowIso(), stage: patch.stage || test.stage, note: patch.log }] : [])];
  const stageChanged = patch.stage && patch.stage !== test.stage;
  const now = nowIso();
  const next = {
    ...test,
    status: patch.status || test.status,
    stage: patch.stage || test.stage,
    stage_started_at: stageChanged ? now : test.stage_started_at || now,
    order_id: patch.order_id ?? test.order_id,
    project_id: patch.project_id ?? test.project_id,
    error: patch.error ?? test.error,
    finished_at: ["PASSED", "FAILED"].includes(patch.status) ? now : test.finished_at,
    state_json: JSON.stringify(state),
    log_json: JSON.stringify(log.slice(-40)),
    updated_at: now
  };
  await env.DB.prepare(`
      UPDATE self_tests SET status = ?, stage = ?, stage_started_at = ?, order_id = ?, project_id = ?, error = ?,
        finished_at = ?, state_json = ?, log_json = ?, updated_at = ?
      WHERE id = ?
    `).bind(next.status, next.stage, next.stage_started_at, next.order_id, next.project_id, next.error,
    next.finished_at, next.state_json, next.log_json, next.updated_at, test.id).run();
  return next;
}

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC) return;
  const recent = await env.DB.prepare(`
      SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1
    `).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`
      INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)
    `).bind(crypto.randomUUID(), KIND, t, t).run();
}

// ---------- Stages ----------

const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });

async function stageStart(env, app, test) {
  if (!env.STRIPE_SECRET_KEY_TEST) throw new Error("STRIPE_SECRET_KEY_TEST is not configured");
  const base = publicBaseUrl(env);
  const requestId = crypto.randomUUID();
  const stamp = nowIso().slice(0, 16).replace("T", " ");
  const upload = new FormData();
  upload.append("payload", JSON.stringify({
    type: "inquiry", purpose: "checkout", service: "Other project", name: "Menu-Made Self-Test",
    business: "Self-Test Cafe", email: SELF_TEST_EMAIL, notes: `Automated self-test ${stamp}`, website: "", requestId
  }));
  upload.append("document", new File([buildMenuPdf()], "self-test-menu.pdf", { type: "application/pdf" }));
  const uploaded = await json(await app(new Request(`${base}/api/inquiry`, {
    method: "POST", body: upload, headers: { Origin: "https://menu-made.com", "CF-Connecting-IP": "self-test" }
  })));
  if (!uploaded.body?.ok) throw new Error(`Menu upload at checkout failed (HTTP ${uploaded.status})`);

  const checkout = await json(await app(new Request(`${base}/api/create-checkout-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://menu-made.com" },
    body: JSON.stringify({
      items: [{ key: "online_menu_qr", qty: 1 }],
      menu_pages: PAID_PAGES,
      customer: { name: "Menu-Made Self-Test", business: "Self-Test Cafe", email: SELF_TEST_EMAIL, phone: "",
        notes: `Menu: ${PAID_PAGES} pages (self-test)\nDocument ref: ${requestId}` }
    })
  })));
  if (!checkout.body?.ok || !checkout.body.order_id) throw new Error(`Test checkout failed (HTTP ${checkout.status}): ${JSON.stringify(checkout.body).slice(0, 300)}`);
  const orderId = checkout.body.order_id;
  const order = await env.DB.prepare(`SELECT stripe_checkout_session_id, total_cents FROM orders WHERE id = ?`).bind(orderId).first();
  if (order?.total_cents !== 14400) throw new Error(`Expected a $144 order for ${PAID_PAGES} pages, got ${order?.total_cents}`);
  const paid = await payTestCheckout(env, order.stripe_checkout_session_id);
  return updateTest(env, test, {
    status: "RUNNING", stage: "AWAIT_ORDER_PAID", order_id: orderId,
    state: { request_id: requestId, session_id: order.stripe_checkout_session_id },
    log: `Order ${orderId} placed for ${PAID_PAGES} pages ($144) with a ${MENU_PAGES.length}-page menu; paid with test card (${paid.amount})`
  });
}

async function stageAwaitOrderPaid(env, app, test) {
  const order = await env.DB.prepare(`SELECT payment_status FROM orders WHERE id = ?`).bind(test.order_id).first();
  const project = await env.DB.prepare(`SELECT id, metadata_json FROM projects WHERE order_id = ? AND workflow_key = 'MENU_QR_V1' LIMIT 1`).bind(test.order_id).first();
  if (order?.payment_status !== "PAID" || !project) return null;
  // The webhook marks the order paid and creates the project before it attaches the menu, so a tick can
  // land in between (self-test menuqr-fix-9492dbb failed 1 s early). Wait; fail only if it never arrives.
  const menuFile = await env.DB.prepare(`SELECT status FROM project_inputs WHERE project_id = ? AND input_key = 'menu_file'`).bind(project.id).first();
  const extrasOpen = Boolean(parseJsonOrNull(project.metadata_json)?.extras_until);
  if (menuFile?.status !== "VALID" || !extrasOpen) {
    const waited = Date.now() - Date.parse(test.stage_started_at || test.created_at);
    if (waited < ATTACH_GRACE_MINUTES * 60000) return null;
    if (menuFile?.status !== "VALID") throw new Error("The menu uploaded at checkout was not attached to the project");
    throw new Error("The optional extras window did not open");
  }
  const state = parseJsonOrNull(test.state_json) || {};
  const skip = await json(await app(new Request(`${publicBaseUrl(env)}/api/onboarding/start`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: test.order_id, session_id: state.session_id })
  })));
  if (!skip.body?.ok) throw new Error(`Skipping extras failed (HTTP ${skip.status})`);
  return updateTest(env, test, { stage: "AWAIT_PAYMENT_REQUEST", project_id: project.id,
    log: "Stripe webhook marked the order paid; menu attached; extras skipped" });
}

async function stageAwaitPaymentRequest(env, app, test) {
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(test.project_id).first();
  const billing = parseJsonOrNull(project?.metadata_json)?.page_billing;
  if (billing?.status !== "PAYMENT_REQUIRED") {
    if (billing && billing.status !== "PAYMENT_REQUIRED") throw new Error(`Expected a payment request, page billing is ${billing.status} (counted ${billing.counted_pages})`);
    return null;
  }
  const expectedExtra = MENU_PAGES.length - PAID_PAGES;
  if (billing.counted_pages !== MENU_PAGES.length || billing.extra_pages !== expectedExtra || billing.amount_cents !== expectedExtra * 2000) {
    throw new Error(`Wrong page billing: counted ${billing.counted_pages}, extra ${billing.extra_pages}, amount ${billing.amount_cents}`);
  }
  const email = await env.DB.prepare(`
      SELECT status FROM communications WHERE project_id = ? AND purpose = 'EXTRA_PAGES_PAYMENT' AND status = 'SENT' LIMIT 1
    `).bind(test.project_id).first();
  if (!email) return null; // the request email is retried on the next tick
  const token = await signLinkToken(env, { kind: "extra_pages", id: test.project_id, ttlDays: 1 });
  const pay = await app(new Request(`${publicBaseUrl(env)}/api/extra-pages/${test.project_id}?t=${token}`));
  const location = pay.headers.get("location") || "";
  if (pay.status !== 303 || !location.startsWith("https://checkout.stripe.com/")) throw new Error(`Pay link did not open Stripe (HTTP ${pay.status})`);
  const after = parseJsonOrNull((await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(test.project_id).first())?.metadata_json)?.page_billing;
  const paid = await payTestCheckout(env, after?.checkout_session_id);
  return updateTest(env, test, { stage: "AWAIT_EXTRA_PAID", state: { extra_session_id: after?.checkout_session_id },
    log: `Page check found ${billing.counted_pages} pages; buyer emailed for $${billing.amount_cents / 100}; paid through the pay link (${paid.amount})` });
}

async function stageAwaitExtraPaid(env, app, test) {
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(test.project_id).first();
  const billing = parseJsonOrNull(project?.metadata_json)?.page_billing;
  if (billing?.status !== "PAID") return null;
  return updateTest(env, test, { stage: "AWAIT_APPROVAL", log: `Stripe webhook recorded ${billing.paid_extra_pages} extra pages paid; production released` });
}

async function stageAwaitApproval(env, app, test) {
  const approval = await env.DB.prepare(`
      SELECT id FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1
    `).bind(test.project_id).first();
  if (!approval) return null;
  const notified = await env.DB.prepare(`
      SELECT 1 AS ok FROM approvals WHERE id = ? AND json_extract(metadata_json, '$.owner_notified_at') IS NOT NULL
    `).bind(approval.id).first();
  if (!notified) return null; // the owner's email (single or digest) goes out at the end of the runner tick
  const token = await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 });
  const form = new FormData();
  form.append("t", token);
  const approved = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
  if (approved.status !== 200) throw new Error(`Approving failed (HTTP ${approved.status})`);
  return updateTest(env, test, { stage: "AWAIT_DELIVERY", log: "Menu and QR produced; owner approval requested and approved" });
}

async function stageAwaitDelivery(env, app, test) {
  const project = await env.DB.prepare(`
      SELECT p.status, b.name AS business_name FROM projects p JOIN businesses b ON b.id = p.business_id WHERE p.id = ?
    `).bind(test.project_id).first();
  if (project?.status !== "DELIVERED") return null;
  const delivery = await env.DB.prepare(`
      SELECT recipient FROM communications WHERE project_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT' LIMIT 1
    `).bind(test.project_id).first();
  if (!delivery) throw new Error("Project delivered but no delivery email was logged");
  const page = await app(new Request(`${publicBaseUrl(env)}/api/menu/${hostedMenuSlug(test.project_id, project.business_name)}`));
  const html = await page.text();
  if (page.status !== 200 || !html.includes(CHECK_ITEM)) throw new Error(`Hosted menu page is missing "${CHECK_ITEM}" (HTTP ${page.status})`);
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: "Delivered to the buyer; hosted menu page is live and shows the menu" });
}

const STAGES = {
  START: stageStart,
  AWAIT_ORDER_PAID: stageAwaitOrderPaid,
  AWAIT_PAYMENT_REQUEST: stageAwaitPaymentRequest,
  AWAIT_EXTRA_PAID: stageAwaitExtraPaid,
  AWAIT_APPROVAL: stageAwaitApproval,
  AWAIT_DELIVERY: stageAwaitDelivery
};

async function diagnose(env, test) {
  if (!test.project_id) return "";
  const run = await env.DB.prepare(`SELECT id, status, error_code, error_message FROM workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`).bind(test.project_id).first();
  if (!run) return "no workflow run";
  const steps = (await env.DB.prepare(`SELECT step_key, status FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_order`).bind(run.id).all()).results || [];
  return `run ${run.status}${run.error_code ? ` (${run.error_code}: ${run.error_message || ""})` : ""}; steps ${steps.map((s) => `${s.step_key}=${s.status}`).join(", ")}`;
}

async function failTest(env, test, message) {
  const detail = await diagnose(env, test).catch(() => "");
  const failed = await updateTest(env, test, { status: "FAILED", error: `${message}${detail ? ` | ${detail}` : ""}`.slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Menu + QR self-test failed",
    html: brandedEmailHtml({
      preheader: "The automated sandbox test of Online Menu + QR failed.",
      eyebrow: "SELF-TEST",
      heading: "The Menu + QR self-test failed",
      paragraphs: ["The automated test order (Stripe test mode) stopped before delivery. Real orders may hit the same problem."],
      rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Test order", test.order_id || "none"], ["Self-test", test.id]]
    }),
    text: `The Menu + QR self-test failed at ${test.stage || "START"}.\n${failed.error}\nTest order: ${test.order_id || "none"}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`,
    purpose: "AUTOMATION_ALERT",
    templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

// Advances every active self-test as far as it can go right now. Safe to call before and after production.
async function advanceSelfTests(env, app) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const results = [];
  for (let test of await loadActiveTests(env)) {
    for (let guard = 0; guard < 6; guard++) {
      const stage = test.status === "REQUESTED" ? "START" : test.stage;
      const handler = STAGES[stage];
      if (!handler) break;
      try {
        const next = await handler(env, app, test);
        if (!next) {
          const startedAt = Date.parse(test.stage_started_at || test.created_at);
          if (Date.now() - startedAt > STAGE_TIMEOUT_MINUTES * 60000) {
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

export {
  stripeTest,
  updateTest,
  buildMenuPdf,
  payTestCheckout,
  advanceSelfTests,
  maybeScheduleDaily
};
