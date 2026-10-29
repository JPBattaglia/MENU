// Sandbox self-test for the Nino design services (stage 10), run by the worker's 5-minute schedule and once a day.
// One Stripe test-mode checkout buys all four services the way ninobattaglia.com does (return_to nino, Menu Redesign
// at 5 pages = $224, total $701), paid with a test card. The real webhook creates the four projects and emails the
// briefs; the briefs are filled in through the real form route (with a logo and a 2-page menu PDF). Production is
// real: the AI writes the social posts, Claude reads the menu, and the GitHub renderer draws every PNG and the
// preview pages. Each result is approved through the approve page and its delivery email is checked.
// Start one by inserting a self_tests row, kind NINO_DESIGN_RUN, status REQUESTED. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { LINK_KIND } from "../producers/nino-design/brief.js";
import { NINO_PRODUCTS, productForWorkflow } from "../producers/nino-design/products.js";
import { SAMPLE_LOGO_PNG } from "./sample-assets.js";
import { payTestCheckout, updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "NINO_DESIGN_RUN";
const STAGE_TIMEOUT_MINUTES = 45;
const DAILY_HOUR_UTC = 19; // 12pm Pacific
const EXPECTED_TOTAL = 14900 + 7900 + (19900 + 2500) + 24900;
const state = (test) => parseJsonOrNull(test.state_json) || {};
const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });

const BRIEFS = {
  NINO_SOCIAL_PACK: { business_name: "Sample Cafe", about: "A neighbourhood cafe and bakery serving espresso drinks, sourdough and seasonal pastries.", promote: "Our pumpkin spice latte, the sourdough loaf baked every morning, and the almond croissant.", voice: "warm and friendly", brand_colors: "#a3322a, #f6f1e7" },
  NINO_FLYER: { business_name: "Sample Cafe", headline: "Live Jazz Fridays", details: "Every Friday from 7 to 10 pm\nLocal trio, no cover charge\nHalf-price pastries after 8", call_to_action: "Bring a friend", contact: "123 Main Street", style: "elegant", brand_colors: "" },
  NINO_MENU_DESIGN: { business_name: "Sample Cafe", tagline: "Coffee and bakery", footer: "Ask us about allergens", style: "classic", brand_colors: "" },
  NINO_LOGO: { business_name: "Sample Cafe", tagline: "Coffee & Bakery", style: "modern", brand_colors: "" }
};

// A 2-page text menu PDF (Claude reads it for the Menu Redesign).
function menuPdf() {
  const pages = [["Coffee", [["Espresso", "$3.50", "Double shot"], ["Cappuccino", "$4.75", "With whole or oat milk"], ["Pumpkin Spice Latte", "$5.50", "Seasonal"]]],
    ["Bakery", [["Sourdough Loaf", "$9", "Baked every morning"], ["Almond Croissant", "$4.25", "Twice-baked"], ["Banana Bread", "$3.75", ""]]]];
  const esc = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects = []; const add = (b) => { objects.push(b); return objects.length; };
  const catalog = add(""); const pagesId = add(""); const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = pages.map(([section, items]) => {
    const lines = [`BT /F1 22 Tf 72 720 Td (${esc(`Sample Cafe - ${section}`)}) Tj ET`];
    items.forEach(([n, p, d], r) => lines.push(`BT /F1 14 Tf 72 ${670 - r * 40} Td (${esc(`${n} ........ ${p}`)}) Tj ET`, ...(d ? [`BT /F1 10 Tf 90 ${655 - r * 40} Td (${esc(d)}) Tj ET`] : [])));
    const stream = lines.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n"; const offsets = [];
  objects.forEach((b, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function loadActiveTests(env) {
  return (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 1`).bind(KIND).all()).results || [];
}

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < 10) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

async function stageStart(env, app, test) {
  if (!env.STRIPE_SECRET_KEY_TEST) throw new Error("STRIPE_SECRET_KEY_TEST is not configured");
  const checkout = await json(await app(new Request(`${publicBaseUrl(env)}/api/create-checkout-test`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://ninobattaglia.com" },
    body: JSON.stringify({ items: Object.keys(NINO_PRODUCTS).map((key) => ({ key })), design_pages: 5, return_to: "nino",
      customer: { name: "Menu-Made Self-Test", business: `Sample Cafe ${test.id.slice(0, 6)}`, email: SELF_TEST_EMAIL } })
  })));
  if (!checkout.body?.ok || !checkout.body.order_id) throw new Error(`Test checkout failed (HTTP ${checkout.status}): ${JSON.stringify(checkout.body).slice(0, 300)}`);
  const order = await env.DB.prepare(`SELECT stripe_checkout_session_id, total_cents FROM orders WHERE id = ?`).bind(checkout.body.order_id).first();
  if (order?.total_cents !== EXPECTED_TOTAL) throw new Error(`Expected a $${EXPECTED_TOTAL / 100} order, got ${order?.total_cents}`);
  const session = await fetch(`https://api.stripe.com/v1/checkout/sessions/${order.stripe_checkout_session_id}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY_TEST}` } }).then((r) => r.json());
  if (!String(session.success_url || "").startsWith("https://ninobattaglia.com/design-thanks.html")) throw new Error("The checkout does not return the buyer to ninobattaglia.com");
  const paid = await payTestCheckout(env, order.stripe_checkout_session_id);
  return updateTest(env, test, { status: "RUNNING", stage: "AWAIT_BRIEFS", order_id: checkout.body.order_id, state: { orderId: checkout.body.order_id },
    log: `All four services bought in one sandbox checkout ($${EXPECTED_TOTAL / 100}, Menu Redesign at 5 pages), returning to ninobattaglia.com; paid (${paid.amount})` });
}

async function stageAwaitBriefs(env, app, test) {
  const s = state(test);
  const projects = (await env.DB.prepare(`SELECT id, workflow_key FROM projects WHERE order_id = ?`).bind(s.orderId).all()).results || [];
  if (projects.length < 4) return null;
  const mails = await env.DB.prepare(`SELECT COUNT(*) AS n FROM communications WHERE order_id = ? AND purpose = 'DESIGN_BRIEF' AND status = 'SENT'`).bind(s.orderId).first();
  if (Number(mails?.n) < 4) return null;
  for (const project of projects) {
    const product = productForWorkflow(project.workflow_key);
    if (!product) throw new Error(`Unexpected project ${project.workflow_key}`);
    const form = new FormData();
    form.append("t", await signLinkToken(env, { kind: LINK_KIND, id: project.id, ttlDays: 1 }));
    for (const [k, v] of Object.entries(BRIEFS[product.code])) form.append(k, v);
    if (product.logo) form.append("logo", new File([SAMPLE_LOGO_PNG], "logo.png", { type: "image/png" }));
    if (product.menuFile) form.append("menu_file", new File([menuPdf()], "menu.pdf", { type: "application/pdf" }));
    const res = await app(new Request(`${publicBaseUrl(env)}/api/design-brief/${project.id}`, { method: "POST", body: form }));
    const text = await res.text();
    if (res.status !== 200 || !text.includes("Thank you")) throw new Error(`The ${product.name} brief was refused (HTTP ${res.status}): ${text.replace(/<[^>]+>/g, " ").slice(0, 200)}`);
  }
  return updateTest(env, test, { stage: "AWAIT_APPROVALS", state: { projects: projects.map((p) => p.id) }, log: "Four brief emails sent; all four briefs filled in through the form route" });
}

async function stageAwaitApprovals(env, app, test) {
  const s = state(test);
  const approved = new Set(s.approved || []);
  for (const projectId of s.projects) {
    if (approved.has(projectId)) continue;
    const out = parseJsonOrNull((await env.DB.prepare(`SELECT ws.output_json FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id WHERE wr.project_id = ? AND ws.step_key = 'PRODUCE' AND ws.status = 'SUCCEEDED'`).bind(projectId).first())?.output_json);
    if (out?.outcome === "NOT_PRODUCED") throw new Error(`A design was not produced: ${(out.reasons || []).join("; ")}`);
    const approval = await env.DB.prepare(`SELECT id, json_extract(metadata_json, '$.owner_notified_at') AS notified FROM approvals WHERE project_id = ? AND approval_type = 'OWNER_RELEASE' AND status = 'PENDING' LIMIT 1`).bind(projectId).first();
    if (!approval?.notified) continue;
    const files = (await env.DB.prepare(`SELECT d.deliverable_type, a.storage_key, a.size_bytes FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ? AND d.status != 'SUPERSEDED'`).bind(projectId).all()).results || [];
    const preview = files.find((f) => f.deliverable_type === "NINO_DESIGN_PREVIEW");
    const pack = files.find((f) => f.deliverable_type === "NINO_DESIGN_PACK");
    if (!preview || !pack) throw new Error("A design is missing its preview page or its ZIP");
    const html = await (await env.ASSETS.get(preview.storage_key))?.text();
    if (!html || !html.includes("data:image/png;base64,")) throw new Error("A preview page holds no drawn images");
    const form = new FormData();
    form.append("t", await signLinkToken(env, { kind: "approve", id: approval.id, ttlDays: 1 }));
    const res = await app(new Request(`${publicBaseUrl(env)}/api/approvals/${approval.id}`, { method: "POST", body: form }));
    if (res.status !== 200) throw new Error(`Approving failed (HTTP ${res.status})`);
    approved.add(projectId);
  }
  if (approved.size === (s.approved || []).length) return null;
  const done = approved.size === s.projects.length;
  return updateTest(env, test, { stage: done ? "AWAIT_DELIVERED" : "AWAIT_APPROVALS", state: { approved: [...approved] }, log: `${approved.size} of 4 designs drawn by the GitHub renderer and approved through the approve page` });
}

async function stageAwaitDelivered(env, app, test) {
  const s = state(test);
  const rows = (await env.DB.prepare(`SELECT status FROM projects WHERE order_id = ?`).bind(s.orderId).all()).results || [];
  if (rows.some((r) => r.status !== "DELIVERED")) return null;
  const mail = await env.DB.prepare(`SELECT COUNT(*) AS n FROM communications WHERE order_id = ? AND purpose = 'ORDER_DELIVERY' AND status = 'SENT'`).bind(s.orderId).first();
  if (Number(mail?.n) < 4) throw new Error(`Expected 4 delivery emails, found ${mail?.n}`);
  const usage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE' AND entity_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(s.projects)).first();
  if (Number(usage?.n) < 1) throw new Error("The social posts logged no AI usage");
  return updateTest(env, test, { status: "PASSED", stage: "DONE", log: "All four designs delivered to the buyer after approval" });
}

const STAGES = { START: stageStart, AWAIT_BRIEFS: stageAwaitBriefs, AWAIT_APPROVALS: stageAwaitApprovals, AWAIT_DELIVERED: stageAwaitDelivered };

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject: "Nino design services self-test failed",
    html: brandedEmailHtml({ eyebrow: "SELF-TEST", heading: "The Nino design self-test failed", paragraphs: ["A test order for the four design services did not come out as expected. Real orders may hit the same problem."], rows: [["Stage", test.stage || "START"], ["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Nino design self-test failed at ${test.stage || "START"}.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceNinoDesignSelfTests(env, app) {
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

export { advanceNinoDesignSelfTests, menuPdf };
