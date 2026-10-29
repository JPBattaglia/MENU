// Stage 9 part 2: Online Menu + QR includes one year of hosting; after that, hosting continues with Menu Care
// (owner decision Oct 28, 2026). From the daily pass, each delivered Menu + QR menu gets a reminder 30 days and
// 7 days before its first year ends (first year = from the first approved delivery), unless the business already
// has Menu Care (alone or in a bundle). The email's button opens a signed page that starts a Menu Care checkout
// bound to the SAME business record, so the subscription edits and serves the same menu at the same address and
// QR (Menu Care reads and publishes "the newest approved menu of this business").
import { createCheckout } from "../../checkout/session.js";
import { publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, isCustomerEmail, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { hostedMenuUrl } from "../../onboarding/menu-inputs.js";

const KIND = "menu-hosting";
const LINK_TTL_DAYS = 60;
const PURPOSE = "MENU_HOSTING_RENEWAL";
const DAY = 86400000;
const YEAR_DAYS = 365;
const REMINDERS = [{ key: "d30", daysBefore: 30 }, { key: "d7", daysBefore: 7 }];

const formatDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

async function hasMenuCare(env, businessId) {
  return Boolean(await env.DB.prepare(`
      SELECT 1 FROM entitlements WHERE business_id = ? AND entitlement_type = 'MENU_CARE' AND status = 'ACTIVE' LIMIT 1
    `).bind(businessId).first());
}

async function menuCarePrices(env) {
  const rows = (await env.DB.prepare(`
      SELECT v.billing_interval, v.price_cents FROM offers o JOIN offer_versions v ON v.offer_id = o.id
      WHERE o.code = 'MENU_CARE' AND v.status = 'ACTIVE'
    `).all()).results || [];
  const price = (interval) => rows.find((r) => r.billing_interval === interval)?.price_cents;
  return { month: price("MONTH") ?? 2900, year: price("YEAR") ?? 29000 };
}

const dollars = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

async function loadMenuProject(env, projectId) {
  const row = await env.DB.prepare(`
      SELECT p.id, p.business_id, p.customer_id, p.order_id, b.name AS business_name,
             c.email, c.first_name, c.last_name, c.phone,
             (SELECT MIN(d.delivered_at) FROM deliverables d WHERE d.project_id = p.id AND d.deliverable_type = 'MENU_DRAFT'
                AND d.status = 'FINAL' AND d.customer_visible = 1) AS first_delivered_at,
             (SELECT i.metadata_json FROM order_items i WHERE i.order_id = p.order_id LIMIT 1) AS item_metadata
      FROM projects p JOIN businesses b ON b.id = p.business_id JOIN customers c ON c.id = p.customer_id
      WHERE p.id = ? AND p.workflow_key = 'MENU_QR_V1'
    `).bind(projectId).first();
  if (!row) return null;
  return { ...row, environment: parseJsonOrNull(row.item_metadata)?.environment === "sandbox" ? "sandbox" : "live" };
}

function yearEnd(project) {
  return new Date(Date.parse(project.first_delivered_at) + YEAR_DAYS * DAY).toISOString();
}

async function renewalLink(env, projectId) {
  const token = await signLinkToken(env, { kind: KIND, id: projectId, ttlDays: LINK_TTL_DAYS });
  return `${publicBaseUrl(env)}/api/menu-hosting/${projectId}?t=${encodeURIComponent(token)}`;
}

async function sendReminder(env, project, reminder) {
  const ends = yearEnd(project);
  const link = await renewalLink(env, project.id);
  const prices = await menuCarePrices(env);
  const menuUrl = hostedMenuUrl(project.id, project.business_name);
  const greeting = project.first_name ? `Hi ${project.first_name},` : "Hi,";
  const lead = `The first year of hosting for ${project.business_name}'s online menu ends on ${formatDate(ends)}.`;
  const offer = `Menu Care keeps it online at the same address and QR code, so nothing you've printed changes, and adds unlimited menu updates: ${dollars(prices.month)}/month or ${dollars(prices.year)}/year.`;
  return sendTransactionalEmail(env, {
    to: project.email,
    subject: reminder.key === "d7" ? `Your online menu's first year ends ${formatDate(ends)}` : `Keep ${project.business_name}'s online menu going`,
    html: brandedEmailHtml({
      preheader: "Same address, same QR code, unlimited updates.",
      eyebrow: "Your online menu",
      heading: "Keep your menu online",
      paragraphs: [escapeHtml(greeting), escapeHtml(lead), escapeHtml(offer)],
      rows: [["Your menu", menuUrl], ["First year ends", formatDate(ends)]],
      buttons: [{ label: "Add Menu Care", url: link, primary: true }],
      footnote: "Cancel any time from your account. Questions? Reply to this email."
    }),
    text: `${greeting}\n\n${lead}\n\n${offer}\n\nYour menu: ${menuUrl}\n\nAdd Menu Care: ${link}\n\nCancel any time from your account. Questions? Reply to this email.`,
    idempotencyKey: `menu-hosting/${project.id}/${reminder.key}`,
    purpose: PURPOSE,
    templateKey: `menu_hosting_renewal_${reminder.key}_v1`,
    context: { customerId: project.customer_id, businessId: project.business_id, orderId: project.order_id, projectId: project.id }
  }).then((result) => ({ ...result, link }));
}

async function alreadySent(env, projectId, key) {
  return Boolean(await env.DB.prepare(`
      SELECT 1 FROM communications WHERE project_id = ? AND purpose = ? AND template_key = ? AND status = 'SENT' LIMIT 1
    `).bind(projectId, PURPOSE, `menu_hosting_renewal_${key}_v1`).first());
}

// Daily. projectIds: the self-test names its own sandbox project; everyone else is live only.
async function remindMenuHostingRenewals(env, { now = new Date(), projectIds = null } = {}) {
  if (!env.DB) return { sent: 0 };
  // Projects with an approved menu page delivered 335-365 days ago (partial index, migration 0018). A project whose
  // FIRST delivery is in that window always has a row here; later revisions are filtered by loadMenuProject below.
  const ids = projectIds || [...new Set(((await env.DB.prepare(`
      SELECT d.project_id FROM deliverables d JOIN projects p ON p.id = d.project_id
      WHERE d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1
        AND d.delivered_at <= ? AND d.delivered_at >= ? AND p.workflow_key = 'MENU_QR_V1'
      LIMIT 200
    `).bind(new Date(now.getTime() - (YEAR_DAYS - 30) * DAY).toISOString(), new Date(now.getTime() - YEAR_DAYS * DAY).toISOString()).all()).results || []).map((r) => r.project_id))];
  const summary = { checked: 0, sent: 0, skipped: [], results: [] };
  for (const id of ids) {
    summary.checked += 1;
    const skip = (reason) => summary.skipped.push({ id, reason });
    try {
      const project = await loadMenuProject(env, id);
      if (!project?.first_delivered_at) { skip("not delivered"); continue; }
      if (!projectIds && project.environment !== "live") { skip("sandbox"); continue; }
      if (!isCustomerEmail(project.email, PURPOSE, env)) { skip("owner address"); continue; }
      if (await hasMenuCare(env, project.business_id)) { skip("has Menu Care"); continue; }
      const daysLeft = (Date.parse(yearEnd(project)) - now.getTime()) / DAY;
      if (daysLeft <= 0) { skip("first year over"); continue; }
      // The latest reminder that is due and not yet sent (a missed 30-day one is not sent late next to the 7-day one).
      const due = REMINDERS.filter((r) => daysLeft <= r.daysBefore).at(-1);
      if (!due) { skip("not yet due"); continue; }
      if (await alreadySent(env, id, due.key)) { skip(`${due.key} already sent`); continue; }
      const result = await sendReminder(env, project, due);
      if (result.ok) summary.sent += 1;
      summary.results.push({ id, reminder: due.key, ok: result.ok, error: result.error || null, link: result.link });
    } catch (error) {
      skip(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}

function page(status, title, body) {
  return simplePage(status, title, body);
}

// GET /api/menu-hosting/<project>?t=  shows Menu Care monthly or yearly (POST buttons, so link scanners open nothing);
// POST starts the Menu Care checkout for the same business and redirects to Stripe.
async function handleMenuHostingRenewal(request, env, projectId) {
  const url = new URL(request.url);
  const form = request.method === "POST" ? await request.formData().catch(() => null) : null;
  const token = String((form ? form.get("t") : url.searchParams.get("t")) || "");
  const payload = await verifyLinkToken(env, token, [KIND], projectId);
  if (!payload) return page(404, "Link not found", `<p>This link isn't valid.</p><p><a class="btn" href="/contact.html?plan=MENU_CARE">Menu Care</a></p>`);
  if (payload.expired) return page(410, "This link has expired", `<p>You can still add Menu Care from your account or the Start page.</p><p><a class="btn" href="/account.html">Your account</a></p>`);
  const project = await loadMenuProject(env, projectId);
  if (!project) return page(404, "Menu not found", "<p>We couldn't find this menu.</p>");
  if (await hasMenuCare(env, project.business_id)) {
    return page(200, "Your menu is covered", `<p>${escapeHtml(project.business_name)} already has Menu Care, so your menu stays online and you can send changes any time.</p><p><a class="btn" href="/account.html">Your account</a></p>`);
  }
  const prices = await menuCarePrices(env);
  if (request.method !== "POST") {
    const button = (interval, label) => `<form method="post" style="display:inline"><input type="hidden" name="t" value="${escapeHtml(token)}"><input type="hidden" name="interval" value="${interval}"><button type="submit">${escapeHtml(label)}</button></form>`;
    return page(200, "Keep your menu online",
      `<p>Menu Care keeps <strong>${escapeHtml(project.business_name)}</strong>'s menu online at the same address and QR code, with unlimited updates. Cancel any time.</p>
<dl><dt>Your menu</dt><dd>${escapeHtml(hostedMenuUrl(project.id, project.business_name))}</dd>${project.first_delivered_at ? `<dt>First year ends</dt><dd>${escapeHtml(formatDate(yearEnd(project)))}</dd>` : ""}</dl>
${button("month", `${dollars(prices.month)} a month`)}${button("year", `${dollars(prices.year)} a year (2 months free)`)}
<p>Payment is handled by Stripe.</p>`);
  }
  const interval = form?.get("interval") === "year" ? "year" : "month";
  const response = await createCheckout(new Request(`${publicBaseUrl(env)}/api/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ key: "MENU_CARE", interval }],
      interval,
      customer: {
        email: project.email,
        name: [project.first_name, project.last_name].filter(Boolean).join(" "),
        business: project.business_name,
        phone: project.phone || "",
        notes: `Menu hosting after the first year (Online Menu + QR project ${project.id})`
      },
      tracking: { source: "email", medium: "menu_hosting_renewal" }
    })
  }), env, project.environment);
  const result = await response.json().catch(() => null);
  if (!result?.ok || !result.url) {
    return page(200, "Checkout couldn't open", "<p>Stripe didn't open a checkout just now. Please try again in a minute, or reply to our email.</p>");
  }
  // Bind the subscription to the business that owns the menu, whatever other business shares its name.
  await env.DB.prepare(`UPDATE orders SET business_id = ?, updated_at = ? WHERE id = ?`).bind(project.business_id, nowIso(), result.order_id).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO customer_businesses (customer_id, business_id, role, is_primary, created_at) VALUES (?, ?, 'CUSTOMER', 1, ?)`)
    .bind(project.customer_id, project.business_id, nowIso()).run();
  return new Response(null, { status: 303, headers: { Location: result.url, "Cache-Control": "no-store" } });
}

export { PURPOSE as MENU_HOSTING_PURPOSE, remindMenuHostingRenewals, handleMenuHostingRenewal, renewalLink };
