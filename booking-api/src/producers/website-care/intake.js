// Website & App Care intake (stage 7): the signed page a customer uses to ask for a change to their website.
//   GET  /api/site-care/<subscriptionId>?t=<token>   the form
//   POST /api/site-care/<subscriptionId>             form body: t, change  -> creates one request and one production run
// Same model as Menu Care: the token (kind "sitecare") is the only credential, an active WEBSITE_CARE entitlement is
// required, the plan promises unlimited changes so ABUSE_LIMIT is only a safety valve, and the AI token cap bounds cost.
import { escapeHtml } from "../../lib/email.js";
import { nowIso, parseJsonOrNull, simplePage } from "../../lib/http.js";
import { verifyLinkToken } from "../../lib/links.js";
import { loadWorkflowDefinition } from "../../workflows/definitions.js";
import { PRODUCING, stableId } from "../../subscriptions/sync.js";
import { loadLiveSite } from "./live.js";
import { DomainError, emailInstructions, requestCustomDomain, saasConfig, dnsInstructions } from "../website/domains.js";

const LINK_KIND = "sitecare";
const ABUSE_LIMIT = 100;
const MAX_REQUEST_CHARS = 2000;

class IntakeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function createSiteChangeRequest(env, subscriptionId, text, { source = "FORM", now = new Date() } = {}) {
  const requestText = String(text ?? "").replace(/\s+/g, " ").trim();
  if (requestText.length < 5) throw new IntakeError("Please describe the change you want.");
  if (requestText.length > MAX_REQUEST_CHARS) throw new IntakeError(`Please keep the request under ${MAX_REQUEST_CHARS} characters.`);
  const subscription = await env.DB.prepare(`SELECT id, customer_id, business_id, status FROM subscriptions WHERE id = ?`).bind(subscriptionId).first();
  if (!subscription) throw new IntakeError("This link is not valid.", 404);
  if (!PRODUCING.has(subscription.status)) throw new IntakeError("Website & App Care is not active for this account. Reply to your last email and we'll help.", 403);
  const entitlement = await env.DB.prepare(`
      SELECT id, metadata_json FROM entitlements WHERE subscription_id = ? AND entitlement_type = 'WEBSITE_CARE' AND status = 'ACTIVE' LIMIT 1
    `).bind(subscriptionId).first();
  if (!entitlement) throw new IntakeError("Website & App Care is not included in this plan.", 403);
  const live = await loadLiveSite(env, subscription.business_id);
  if (!live) throw new IntakeError("Website & App Care covers websites built by Menu-made, and we can't find one for your account. Reply to your last email and we'll help.", 409);
  if (!live.build) throw new IntakeError("Your website isn't live yet. Once it is, you can send changes here.", 409);

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const used = await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_change_requests WHERE subscription_id = ? AND created_at >= ?`).bind(subscriptionId, monthStart).first();
  if (Number(used?.n || 0) >= ABUSE_LIMIT) throw new IntakeError("That's a lot of requests in one month, so we've paused new ones. Reply to your last email and we'll sort it out.", 429);

  const meta = parseJsonOrNull(entitlement.metadata_json) || {};
  const offer = await env.DB.prepare(`SELECT category FROM offers WHERE id = ?`).bind(meta.offer_id).first();
  if (!meta.workflow_key || !offer) throw new Error(`Entitlement ${entitlement.id} has no offer or workflow`);
  const definition = await loadWorkflowDefinition(meta.workflow_key, 1, env);

  const requestId = crypto.randomUUID();
  const orderId = await stableId("sitecare-order", requestId);
  const itemId = await stableId("sitecare-item", requestId);
  const projectId = await stableId("sitecare-project", requestId);
  const runId = await stableId("sitecare-run", requestId);
  const t = nowIso();
  const projectMeta = { source: "SITE_CARE_REQUEST", request_id: requestId, subscription_id: subscriptionId, entitlement_id: entitlement.id, site_slug: live.slug };
  await env.DB.prepare(`
      INSERT INTO site_change_requests (id, subscription_id, business_id, customer_id, site_slug, project_id, request_text, source, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?)
    `).bind(requestId, subscriptionId, subscription.business_id, subscription.customer_id, live.slug, projectId, requestText, source, t, t).run();
  await env.DB.prepare(`
      INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, placed_at, notes)
      VALUES (?, ?, ?, ?, ?, 'READY_FOR_PRODUCTION', 'USD', 0, 0, 0, 0, 'PAID', ?, ?)
    `).bind(orderId, t, t, subscription.customer_id, subscription.business_id, t, `Website & App Care change request ${requestId}`).run();
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
      VALUES (?, ?, ?, 1, 'QUEUED', 'SITE_CARE_REQUEST', ?, 1, ?)
    `).bind(runId, projectId, meta.workflow_key, requestId, t).run();
  for (const step of definition.steps) {
    await env.DB.prepare(`
        INSERT INTO workflow_steps (id, workflow_run_id, step_key, step_order, status, attempt_count, input_json)
        VALUES (?, ?, ?, ?, 'QUEUED', 0, ?)
      `).bind(await stableId("sitecare-step", runId, step.key), runId, step.key, step.order,
      JSON.stringify({ project_id: projectId, order_id: orderId, customer_id: subscription.customer_id, workflow_key: meta.workflow_key,
        workflow_version: 1, workflow_definition_id: definition.id, queued_at: t })).run();
  }
  return { requestId, projectId, runId, slug: live.slug };
}

function formPage(subscriptionId, token, { error = null, domain = null, notice = null } = {}) {
  const body = `${error ? `<p style="color:#9b1c1c"><strong>${escapeHtml(error)}</strong></p>` : ""}
<p>Tell us what should change on your website - your menu or services and prices, opening hours, phone, address, links, the About text, or the style and colour. Include the exact new details.</p>
<form method="post" action="/api/site-care/${escapeHtml(subscriptionId)}">
<input type="hidden" name="t" value="${escapeHtml(token)}">
<p><textarea name="change" rows="6" maxlength="${MAX_REQUEST_CHARS}" required style="width:100%;box-sizing:border-box;font:inherit;padding:10px" placeholder="Example: We're now open until 10pm on Fridays and Saturdays, and please add Garlic Bread, $6, under Starters."></textarea></p>
<button type="submit">Send website change</button></form>
${domain ? domainSection(subscriptionId, token, domain) : ""}
<p style="font-size:13px">New photos or new pages? Reply to your Website &amp; App Care email and we'll take care of it. We check each update before it goes live.</p>`;
  return simplePage(error ? 400 : 200, "Update your website", `${notice ? `<p style="color:#14532d"><strong>${escapeHtml(notice)}</strong></p>` : ""}${body}`);
}

// Own-domain section: only offered when Cloudflare for SaaS is switched on (saasConfig).
function domainSection(subscriptionId, token, domain) {
  const heading = "<h2 style=\"font-size:1.1rem;margin-top:28px\">Use your own domain</h2>";
  if (domain.status === "ACTIVE") return `${heading}<p>Your website is live on <strong>https://${escapeHtml(domain.hostname)}/</strong>.</p>`;
  if (domain.status === "PENDING") return `${heading}<p>We're waiting for <strong>${escapeHtml(domain.hostname)}</strong> to point at your website. Add this DNS record where you bought the domain: <strong>${escapeHtml(domain.dns.type)}</strong> record, name <strong>${escapeHtml(domain.hostname)}</strong>, value <strong>${escapeHtml(domain.dns.target)}</strong>. We email you as soon as it works.</p>`;
  return `${heading}<p>Already own a domain like joespizza.com? Enter it and we'll tell you the one DNS record to add.</p>
<form method="post" action="/api/site-care/${escapeHtml(subscriptionId)}"><input type="hidden" name="t" value="${escapeHtml(token)}">
<p><input name="domain" required maxlength="253" placeholder="www.joespizza.com" style="width:100%;box-sizing:border-box;font:inherit;padding:10px"></p>
<button type="submit">Connect my domain</button></form>`;
}

async function loadDomainState(env, subscriptionId) {
  if (!saasConfig(env)) return null;
  const subscription = await env.DB.prepare(`SELECT business_id FROM subscriptions WHERE id = ?`).bind(subscriptionId).first();
  const live = subscription ? await loadLiveSite(env, subscription.business_id) : null;
  if (!live?.build) return null;
  const row = await env.DB.prepare(`SELECT custom_domain, domain_status FROM website_sites WHERE slug = ?`).bind(live.slug).first();
  if (row?.custom_domain && ["PENDING", "ACTIVE"].includes(row.domain_status)) return { slug: live.slug, hostname: row.custom_domain, status: row.domain_status, dns: dnsInstructions(env, row.custom_domain) };
  return { slug: live.slug, hostname: null, status: "NONE" };
}

async function handleSiteCareRequest(request, env, subscriptionId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest Website &amp; App Care email and we'll send a fresh one.</p>");
  if (request.method === "GET") {
    const token = new URL(request.url).searchParams.get("t") || "";
    const payload = await verifyLinkToken(env, token, [LINK_KIND], subscriptionId);
    if (!payload || payload.expired) return denied();
    return formPage(subscriptionId, token, { domain: await loadDomainState(env, subscriptionId).catch(() => null) });
  }
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], subscriptionId);
  if (!payload || payload.expired) return denied();
  if (form.get("domain") !== null) {
    const state = await loadDomainState(env, subscriptionId).catch(() => null);
    try {
      if (!state) throw new DomainError("Custom domains aren't available for your account yet. Reply to your last email and we'll set it up.", 503);
      const requested = await requestCustomDomain(env, state.slug, form.get("domain"));
      await emailInstructions(env, state.slug).catch((e) => console.error("Domain instructions email failed:", e instanceof Error ? e.message : String(e)));
      return formPage(subscriptionId, token, { domain: { slug: state.slug, hostname: requested.hostname, status: requested.status, dns: requested.dns }, notice: "Thanks. We've emailed you the DNS record to add." });
    } catch (error) {
      if (error instanceof DomainError) return formPage(subscriptionId, token, { error: error.message, domain: state });
      throw error;
    }
  }
  try {
    await createSiteChangeRequest(env, subscriptionId, form.get("change"));
  } catch (error) {
    if (error instanceof IntakeError) return error.status === 400 ? formPage(subscriptionId, token, { error: error.message }) : simplePage(error.status, "We can't take this change", `<p>${escapeHtml(error.message)}</p>`);
    throw error;
  }
  return simplePage(200, "Got it", "<p>We're updating your website. You'll get an email when it's live, usually within a few hours.</p>");
}

export { ABUSE_LIMIT, IntakeError, LINK_KIND, createSiteChangeRequest, handleSiteCareRequest };
