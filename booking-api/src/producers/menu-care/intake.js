// Menu Care intake (stage 6): the signed page a customer uses to ask for a menu change.
//   GET  /api/menu-care/<subscriptionId>?t=<token>   the form
//   POST /api/menu-care/<subscriptionId>             form body: t, change  -> creates one request and one production run
// The token (signLinkToken, kind "menucare") is the only credential. A request needs an active Menu Care
// entitlement. The plan promises unlimited changes, so there is no allowance; ABUSE_LIMIT is only a safety valve
// against a stuck script, and the AI step's monthly token cap (src/ai/generate.js) bounds the cost.
import { escapeHtml } from "../../lib/email.js";
import { nowIso, parseJsonOrNull, simplePage } from "../../lib/http.js";
import { verifyLinkToken } from "../../lib/links.js";
import { loadWorkflowDefinition } from "../../workflows/definitions.js";
import { PRODUCING, stableId } from "../../subscriptions/sync.js";
import { LINK_KIND } from "./care-step.js";
import { loadSuggestion, requestText, validPrice } from "./seasonal.js";

const ABUSE_LIMIT = 100;
const MAX_REQUEST_CHARS = 2000;

class IntakeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function createMenuChangeRequest(env, subscriptionId, text, { source = "FORM", now = new Date() } = {}) {
  const requestText = String(text ?? "").replace(/\s+/g, " ").trim();
  if (requestText.length < 5) throw new IntakeError("Please describe the change you want.");
  if (requestText.length > MAX_REQUEST_CHARS) throw new IntakeError(`Please keep the request under ${MAX_REQUEST_CHARS} characters.`);
  const subscription = await env.DB.prepare(`SELECT id, customer_id, business_id, status FROM subscriptions WHERE id = ?`).bind(subscriptionId).first();
  if (!subscription) throw new IntakeError("This link is not valid.", 404);
  if (!PRODUCING.has(subscription.status)) throw new IntakeError("Menu Care is not active for this account. Reply to your last email and we'll help.", 403);
  const entitlement = await env.DB.prepare(`
      SELECT id, metadata_json FROM entitlements
      WHERE subscription_id = ? AND entitlement_type = 'MENU_CARE' AND status = 'ACTIVE' LIMIT 1
    `).bind(subscriptionId).first();
  if (!entitlement) throw new IntakeError("Menu Care is not included in this plan.", 403);

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const used = await env.DB.prepare(`SELECT COUNT(*) AS n FROM menu_change_requests WHERE subscription_id = ? AND created_at >= ?`).bind(subscriptionId, monthStart).first();
  if (Number(used?.n || 0) >= ABUSE_LIMIT) throw new IntakeError("That's a lot of requests in one month, so we've paused new ones. Reply to your last email and we'll sort it out.", 429);

  const meta = parseJsonOrNull(entitlement.metadata_json) || {};
  const offer = await env.DB.prepare(`SELECT category FROM offers WHERE id = ?`).bind(meta.offer_id).first();
  if (!meta.workflow_key || !offer) throw new Error(`Entitlement ${entitlement.id} has no offer or workflow`);
  const definition = await loadWorkflowDefinition(meta.workflow_key, 1, env);

  const requestId = crypto.randomUUID();
  const orderId = await stableId("care-order", requestId);
  const itemId = await stableId("care-item", requestId);
  const projectId = await stableId("care-project", requestId);
  const runId = await stableId("care-run", requestId);
  const t = nowIso();
  const projectMeta = { source: "MENU_CARE_REQUEST", request_id: requestId, subscription_id: subscriptionId, entitlement_id: entitlement.id };
  await env.DB.prepare(`
      INSERT INTO menu_change_requests (id, subscription_id, business_id, customer_id, project_id, request_text, source, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?)
    `).bind(requestId, subscriptionId, subscription.business_id, subscription.customer_id, projectId, requestText, source, t, t).run();
  await env.DB.prepare(`
      INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, placed_at, notes)
      VALUES (?, ?, ?, ?, ?, 'READY_FOR_PRODUCTION', 'USD', 0, 0, 0, 0, 'PAID', ?, ?)
    `).bind(orderId, t, t, subscription.customer_id, subscription.business_id, t, `Menu Care change request ${requestId}`).run();
  await env.DB.prepare(`
      INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status, metadata_json)
      VALUES (?, ?, ?, ?, 1, 0, 0, 'READY', ?)
    `).bind(itemId, orderId, meta.offer_id, meta.offer_version_id, JSON.stringify(projectMeta)).run();
  await env.DB.prepare(`
      INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version,
        priority, manual_review_required, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, 1, 'NORMAL', 0, ?, ?, ?)
    `).bind(projectId, orderId, itemId, subscription.business_id, subscription.customer_id, offer.category, meta.workflow_key, t, t, JSON.stringify(projectMeta)).run();
  await env.DB.prepare(`
      INSERT INTO workflow_runs (id, project_id, workflow_key, workflow_version, status, trigger_type, trigger_reference, attempt_number, created_at)
      VALUES (?, ?, ?, 1, 'QUEUED', 'MENU_CARE_REQUEST', ?, 1, ?)
    `).bind(runId, projectId, meta.workflow_key, requestId, t).run();
  for (const step of definition.steps) {
    await env.DB.prepare(`
        INSERT INTO workflow_steps (id, workflow_run_id, step_key, step_order, status, attempt_count, input_json)
        VALUES (?, ?, ?, ?, 'QUEUED', 0, ?)
      `).bind(await stableId("care-step", runId, step.key), runId, step.key, step.order,
      JSON.stringify({ project_id: projectId, order_id: orderId, customer_id: subscription.customer_id, workflow_key: meta.workflow_key,
        workflow_version: 1, workflow_definition_id: definition.id, queued_at: t })).run();
  }
  return { requestId, projectId, runId };
}

function acceptPage(subscriptionId, token, month, suggestion, { error = null } = {}) {
  const body = `${error ? `<p style="color:#9b1c1c"><strong>${escapeHtml(error)}</strong></p>` : ""}
<p>This month's idea: <strong>${escapeHtml(suggestion.name)}</strong> - ${escapeHtml(suggestion.description)}</p>
<form method="post" action="/api/menu-care/${escapeHtml(subscriptionId)}"><input type="hidden" name="t" value="${escapeHtml(token)}"><input type="hidden" name="s" value="${escapeHtml(month)}">
<p><label for="price"><strong>Price</strong></label><br><input id="price" name="price" required inputmode="decimal" placeholder="14" style="font:inherit;padding:10px"></p>
<button type="submit">Add it to my menu</button></form><p style="font-size:13px">We check the update before it goes live.</p>`;
  return simplePage(error ? 400 : 200, "Add this month's special", body);
}

function formPage(subscriptionId, token, { error = null, notice = null } = {}) {
  const body = `${notice ? `<p><strong>${escapeHtml(notice)}</strong></p>` : ""}${error ? `<p style="color:#9b1c1c"><strong>${escapeHtml(error)}</strong></p>` : ""}
<p>Tell us what should change on your online menu - prices, dishes added or removed, descriptions. Include the exact new prices.</p>
<form method="post" action="/api/menu-care/${escapeHtml(subscriptionId)}">
<input type="hidden" name="t" value="${escapeHtml(token)}">
<p><textarea name="change" rows="6" maxlength="${MAX_REQUEST_CHARS}" required style="width:100%;box-sizing:border-box;font:inherit;padding:10px" placeholder="Example: Raise the Margherita pizza to $16 and add a Caesar Salad, $11, under Starters."></textarea></p>
<button type="submit">Send menu change</button></form>
<p style="font-size:13px">We check each update before it goes live. It appears at the same address and QR code.</p>`;
  return simplePage(error ? 400 : 200, "Update your menu", body);
}

async function handleMenuCareRequest(request, env, subscriptionId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest Menu Care email and we'll send a fresh one.</p>");
  const url = new URL(request.url);
  if (request.method === "GET") {
    const token = url.searchParams.get("t") || "";
    const payload = await verifyLinkToken(env, token, [LINK_KIND], subscriptionId);
    if (!payload || payload.expired) return denied();
    const month = url.searchParams.get("s");
    if (month) {
      const idea = await loadSuggestion(env, subscriptionId, month).catch(() => null);
      return idea ? acceptPage(subscriptionId, token, month, idea) : formPage(subscriptionId, token);
    }
    return formPage(subscriptionId, token);
  }
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], subscriptionId);
  if (!payload || payload.expired) return denied();
  const month = String(form.get("s") || "");
  if (month) {
    const idea = await loadSuggestion(env, subscriptionId, month).catch(() => null);
    if (!idea) return formPage(subscriptionId, token);
    if (!validPrice(form.get("price"))) return acceptPage(subscriptionId, token, month, idea, { error: "Enter the price as a number, like 14 or 14.50." });
    try { await createMenuChangeRequest(env, subscriptionId, requestText(idea, form.get("price")), { source: "SUGGESTION" }); }
    catch (error) { if (error instanceof IntakeError) return simplePage(error.status, "We can't take this change", `<p>${escapeHtml(error.message)}</p>`); throw error; }
    return simplePage(200, "Got it", "<p>We're adding it to your menu. You'll get an email when it's live, usually within a few hours.</p>");
  }
  try {
    await createMenuChangeRequest(env, subscriptionId, form.get("change"));
  } catch (error) {
    if (error instanceof IntakeError) return error.status === 400 ? formPage(subscriptionId, token, { error: error.message }) : simplePage(error.status, "We can't take this change", `<p>${escapeHtml(error.message)}</p>`);
    throw error;
  }
  return simplePage(200, "Got it", "<p>We're updating your menu. You'll get an email when it's live, usually within a few hours.</p>");
}

export { IntakeError, ABUSE_LIMIT, createMenuChangeRequest, handleMenuCareRequest };
