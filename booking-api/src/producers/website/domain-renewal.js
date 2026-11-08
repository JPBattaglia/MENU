// Domain renewal reminders (handbook NEXT, Nov 7, 2026; owner: the customer is the registrant, Menu-made manages it,
// cost + $5 every year, and nothing renews without the buyer's OK).
//
// Domains are registered with auto-renew OFF. The Registrar API can't renew directly yet, so a paid renewal works by
// switching auto-renew ON (Cloudflare then charges Menu-made's card up to 30 days before expiry) and OFF again once the
// new expiry date shows, so the following year needs a new payment.
//
// Once a day (DAILY_HOUR_UTC, first tick) runDomainRenewals() looks at live domains expiring within WINDOW_DAYS:
//   unpaid, EMAIL_DAYS_BEFORE[i] days left -> buyer email with a pay link (first = the request, then reminders)
//   unpaid, OWNER_ALERT_DAYS left           -> owner alert (runbook R3), once
//   unpaid, expired                         -> renewal_status LAPSED (the pay link keeps working PAY_GRACE_DAYS more)
//   PAID (auto-renew not yet on)            -> PATCH auto_renew true -> AUTO_RENEW_ON
//   AUTO_RENEW_ON                           -> new expiry seen -> PATCH auto_renew false, buyer told -> RENEWED
//                                              still not renewed STUCK_DAYS before expiry -> owner alert (R2), once
// Payment: GET /api/domain-renew/<domain>?t=<signed link> opens a Stripe Checkout (purpose domain_renewal); the webhook
// calls handleDomainRenewalPaid(). A payment after expiry can't be auto-renewed, so the owner is told to renew by hand.
// Sandbox rows (status TEST) never get here.
import { brandedEmailHtml, escapeHtml, looksLikeEmail, sendTransactionalEmail } from "../../lib/email.js";
import { ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { nowIso, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { stripeRequest } from "../../lib/stripe.js";
import { DOMAIN_MARKUP_CENTS, asDomain, registrarConfig } from "./registrar.js";

const API = "https://api.cloudflare.com/client/v4";
const DAY = 86400000;
const WINDOW_DAYS = 45;
const EMAIL_DAYS_BEFORE = [45, 31, 14, 7];
const OWNER_ALERT_DAYS = 7;
const STUCK_DAYS = 2;
const PAY_GRACE_DAYS = 25; // Cloudflare's grace period is 30 days; leave room to renew by hand.
const DAILY_HOUR_UTC = 20; // noon Pacific (PST), 1 pm (PDT)
const LIVE_STATUSES = ["REGISTERED", "POINTED", "ACTIVE"];

const dollars = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const dateText = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
const daysLeft = (row, now) => (Date.parse(row.expires_at) - now) / DAY;

// What the buyer pays to keep the domain a year: the renewal price saved at checkout (cost + $5).
function renewalCents(row) {
  if (Number(row.renewal_cents) > 0) return Number(row.renewal_cents);
  if (Number(row.cost_cents) > 0) return Number(row.cost_cents) + DOMAIN_MARKUP_CENTS;
  return Number(row.price_cents) || 0;
}

// This cycle's state. A row whose renewal_for is an older expiry date starts fresh.
function cycle(row) {
  if (row.renewal_for && row.renewal_for === row.expires_at) return row;
  return { ...row, renewal_for: row.expires_at, renewal_status: null, renewal_emails: 0, renewal_owner_alerted_at: null,
    renewal_checkout_url: null, renewal_checkout_expires_at: null, renewal_session_id: null, renewal_paid_at: null, renewal_paid_cents: null };
}

const CYCLE_FIELDS = ["renewal_for", "renewal_status", "renewal_emails", "renewal_owner_alerted_at", "renewal_checkout_url",
  "renewal_checkout_expires_at", "renewal_session_id", "renewal_paid_at", "renewal_paid_cents"];

async function save(env, row, fields = {}) {
  const next = { ...row, ...fields };
  const keys = [...CYCLE_FIELDS, ...Object.keys(fields).filter((k) => !CYCLE_FIELDS.includes(k))];
  await env.DB.prepare(`UPDATE domain_registrations SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE domain = ?`)
    .bind(...keys.map((k) => next[k] ?? null), nowIso(), row.domain).run();
  return next;
}

function cloudflare(config, path, { method = "GET", body, fetchImpl = fetch } = {}) {
  return fetchImpl(`${API}/accounts/${config.account}/registrar/registrations/${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (response) => {
    let data = null;
    try { data = await response.json(); } catch { /* not JSON */ }
    return { ok: response.ok && data?.success !== false, status: response.status, data, errors: data?.errors || [] };
  });
}

async function setAutoRenew(config, domain, on, fetchImpl) {
  const result = await cloudflare(config, domain, { method: "PATCH", body: { auto_renew: on }, fetchImpl });
  const state = String(result.data?.result?.state || "");
  if (!result.ok || state === "failed" || state === "action_required") {
    throw new Error(`auto-renew ${on ? "on" : "off"} refused: ${(result.errors || []).map((e) => e.message).join("; ") || result.data?.result?.error?.message || `HTTP ${result.status}`}`);
  }
}

async function buyer(env, row) {
  return env.DB.prepare(`SELECT c.email, c.first_name, b.name AS business FROM customers c LEFT JOIN businesses b ON b.id = ? WHERE c.id = ?`)
    .bind(row.business_id, row.customer_id).first();
}

async function payUrl(env, row) {
  const ttlDays = Math.max(1, (Date.parse(row.expires_at) + PAY_GRACE_DAYS * DAY - Date.now()) / DAY);
  const token = await signLinkToken(env, { kind: "domain_renew", id: row.domain, ttlDays });
  return `${publicBaseUrl(env)}/api/domain-renew/${row.domain}?t=${token}`;
}

// ---------- emails ----------

async function emailBuyerRenewal(env, row, number) {
  const who = await buyer(env, row);
  if (!looksLikeEmail(who?.email)) return { ok: false, error: "No buyer email" };
  const url = await payUrl(env, row);
  const amount = dollars(renewalCents(row));
  const expires = dateText(row.expires_at);
  const reminder = number > 1;
  const lines = [
    `${row.domain} is registered in your name until ${expires}. To keep it for another year, the renewal is ${amount}.`,
    "Nothing renews without your OK: without a checkout, the domain expires and your website goes back to its menu-made.com address only.",
    "Checkout any time before it expires; we take care of the rest."
  ];
  const sent = await sendTransactionalEmail(env, {
    to: String(who.email).trim(),
    subject: reminder ? `Reminder: ${row.domain} expires ${expires}` : `Keep ${row.domain} for another year`,
    html: brandedEmailHtml({
      preheader: `${amount} keeps ${row.domain} yours until ${dateText(new Date(Date.parse(row.expires_at) + 365 * DAY).toISOString())}.`,
      eyebrow: reminder ? "RENEWAL REMINDER" : "YOUR DOMAIN",
      heading: `Keep ${row.domain} for another year`,
      paragraphs: [`Hi ${escapeHtml(who.first_name || "there")},`, ...lines.map(escapeHtml)],
      rows: [["Domain", row.domain], ["Expires", expires], ["Renewal (1 year)", amount]],
      buttons: [{ label: `Renew for ${amount}`, url, primary: true }],
      footnote: "Don't want to keep it? Just ignore this email. Questions? Reply to it."
    }),
    text: [`Hi ${who.first_name || "there"},`, "", ...lines, "", `Renew for ${amount}: ${url}`, "", "Don't want to keep it? Ignore this email.", "", "The MENU-MADE team"].join("\n"),
    idempotencyKey: `domain-renewal/${row.domain}/${row.expires_at}/${number}`,
    purpose: "DOMAIN_RENEWAL",
    templateKey: reminder ? "domain_renewal_reminder_v1" : "domain_renewal_request_v1",
    context: { customerId: row.customer_id, businessId: row.business_id, orderId: row.order_id, projectId: row.project_id },
    bccInternal: true
  });
  return sent;
}

async function emailBuyerRenewed(env, row, newExpiry) {
  const who = await buyer(env, row);
  if (!looksLikeEmail(who?.email)) return;
  const until = dateText(newExpiry);
  await sendTransactionalEmail(env, {
    to: String(who.email).trim(),
    subject: `${row.domain} is renewed until ${until}`,
    html: brandedEmailHtml({
      preheader: `Your domain is yours for another year.`, eyebrow: "YOUR DOMAIN", heading: `${row.domain} is renewed`,
      paragraphs: [`Hi ${escapeHtml(who.first_name || "there")}, thanks for your payment. ${escapeHtml(row.domain)} is now registered in your name until <strong>${escapeHtml(until)}</strong>.`,
        "Before next year's renewal we'll email you again; nothing renews without your OK."],
      buttons: [{ label: "Open your website", url: `https://${row.domain}/`, primary: true }],
      footnote: "Questions about your domain? Reply to this email."
    }),
    text: `${row.domain} is renewed until ${until}. We'll email you before next year's renewal; nothing renews without your OK.`,
    idempotencyKey: `domain-renewed/${row.domain}/${newExpiry}`, purpose: "DOMAIN_RENEWAL", templateKey: "domain_renewed_v1",
    context: { customerId: row.customer_id, businessId: row.business_id, orderId: row.order_id, projectId: row.project_id }
  }).catch(() => null);
}

async function alertOwnerUnpaid(env, row) {
  const who = await buyer(env, row).catch(() => null);
  const business = who?.business || row.domain;
  return sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `Domain renewal unpaid: ${row.domain} expires ${dateText(row.expires_at)}`,
    html: brandedEmailHtml({
      eyebrow: "WAITING ON THE BUYER", heading: `${business} hasn't renewed ${row.domain}`,
      paragraphs: [`The domain expires on ${escapeHtml(dateText(row.expires_at))}. The buyer has had ${Number(row.renewal_emails || 0)} renewal emails with a pay link (${escapeHtml(dollars(renewalCents(row)))}).`,
        "If they don't pay, nothing is charged to Menu-made: the domain lapses and their website keeps working on its menu-made.com address. A nudge from you may help."],
      rows: [["Business", business], ["Buyer", who?.email || ""], ["Domain", row.domain], ["Order", row.order_id || ""]]
    }),
    text: `${row.domain} (${business}) expires ${dateText(row.expires_at)} and the renewal (${dollars(renewalCents(row))}) is unpaid. Buyer: ${who?.email || ""}. If they don't pay it lapses; their site stays on its menu-made.com address.`,
    idempotencyKey: `domain-renewal-owner/${row.domain}/${row.expires_at}`, purpose: "AUTOMATION_ALERT", templateKey: "domain_renewal_unpaid_owner_v1",
    context: { orderId: row.order_id, projectId: row.project_id, businessId: row.business_id }
  });
}

async function alertOwnerStuck(env, row, why) {
  const steps = [
    "Go to https://dash.cloudflare.com and sign in (Menu-made's account).",
    "In the left menu click Domain Registration, then Manage Domains.",
    `Find ${row.domain} in the list and click Manage.`,
    "Click Renew (or Extend registration), choose 1 year and confirm. Cloudflare charges the card on file; the buyer has already paid Menu-made.",
    "You should then see the expiry date one year later. Claude checks once a day and tells the buyer when it sees the new date."
  ];
  return sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[Domain] ${row.domain}: renewal paid, renew it by hand`,
    html: brandedEmailHtml({
      eyebrow: "DOMAIN", heading: `${row.domain}: the buyer paid, Cloudflare hasn't renewed`,
      paragraphs: [`${escapeHtml(why)} The buyer paid ${escapeHtml(dollars(row.renewal_paid_cents || renewalCents(row)))} on ${escapeHtml(dateText(row.renewal_paid_at || nowIso()))}. It expires ${escapeHtml(dateText(row.expires_at))}.`,
        "Renew it by hand (about 2 minutes):", ...steps.map((s, i) => `${i + 1}. ${escapeHtml(s)}`)]
    }),
    text: [`${row.domain}: ${why} Expires ${dateText(row.expires_at)}. Renew it by hand:`, ...steps.map((s, i) => `${i + 1}. ${s}`)].join("\n"),
    idempotencyKey: `domain-renewal-stuck/${row.domain}/${row.expires_at}`, purpose: "AUTOMATION_ALERT", templateKey: "domain_renewal_stuck_v1",
    context: { orderId: row.order_id, projectId: row.project_id, businessId: row.business_id }
  });
}

// ---------- the daily pass ----------

async function stepPaid(env, row, config, now, fetchImpl) {
  if (row.renewal_status === "PAID") {
    if (now > Date.parse(row.expires_at)) {
      // Cloudflare makes no auto-renew attempts after expiry: the owner renews by hand.
      if (!row.renewal_owner_alerted_at && (await alertOwnerStuck(env, row, "It was paid after the expiry date, when Cloudflare no longer renews on its own.").catch(() => null))?.ok) {
        row = await save(env, row, { renewal_owner_alerted_at: nowIso() });
      }
    } else {
      await setAutoRenew(config, row.domain, true, fetchImpl);
      row = await save(env, row, { renewal_status: "AUTO_RENEW_ON" });
    }
  }
  const current = await cloudflare(config, row.domain, { fetchImpl });
  const newExpiry = current.ok ? current.data?.result?.expires_at : null;
  if (newExpiry && Date.parse(newExpiry) > Date.parse(row.renewal_for) + 30 * DAY) {
    // Renewed. Auto-renew off again so next year needs the buyer's OK; then the new cycle starts.
    if (current.data?.result?.auto_renew !== false) await setAutoRenew(config, row.domain, false, fetchImpl).catch((error) => console.error("domain renewal", row.domain, error.message));
    await emailBuyerRenewed(env, row, newExpiry);
    await save(env, row, { renewal_status: "RENEWED", expires_at: newExpiry, last_error: null });
    return "RENEWED";
  }
  if (daysLeft(row, now) <= STUCK_DAYS && !row.renewal_owner_alerted_at) {
    if ((await alertOwnerStuck(env, row, "Auto-renew is on but the new expiry date hasn't shown up yet.").catch(() => null))?.ok) {
      await save(env, row, { renewal_owner_alerted_at: nowIso() });
    }
    return "STUCK";
  }
  return row.renewal_status;
}

async function stepUnpaid(env, row, now) {
  const left = daysLeft(row, now);
  if (left <= 0) {
    if (row.renewal_status !== "LAPSED") await save(env, row, { renewal_status: "LAPSED" });
    return "LAPSED";
  }
  let outcome = row.renewal_status || "DUE";
  const due = EMAIL_DAYS_BEFORE.filter((d) => left <= d).length;
  if (due > Number(row.renewal_emails || 0)) {
    // Only the latest one when several are due at once (a missed day never sends a burst).
    const sent = await emailBuyerRenewal(env, row, Number(row.renewal_emails || 0) + 1);
    if (sent?.ok) { row = await save(env, row, { renewal_status: "DUE", renewal_emails: due }); outcome = due === 1 ? "REQUESTED" : "REMINDED"; }
  } else if (!row.renewal_status) {
    row = await save(env, row, { renewal_status: "DUE" });
  }
  if (left <= OWNER_ALERT_DAYS && !row.renewal_owner_alerted_at) {
    if ((await alertOwnerUnpaid(env, row).catch(() => null))?.ok) await save(env, row, { renewal_owner_alerted_at: nowIso() });
  }
  return outcome;
}

async function runDomainRenewals(env, { now = Date.now(), fetchImpl = fetch, force = false } = {}) {
  const config = registrarConfig(env);
  if (!config || !env.DB) return [];
  const at = new Date(now);
  if (!force && (at.getUTCHours() !== DAILY_HOUR_UTC || at.getUTCMinutes() >= 5)) return [];
  const { results = [] } = await env.DB.prepare(`
      SELECT * FROM domain_registrations
      WHERE environment = 'live' AND status IN (${LIVE_STATUSES.map(() => "?").join(", ")}) AND expires_at IS NOT NULL
        AND ((expires_at <= ? AND expires_at >= ?) OR renewal_status IN ('PAID', 'AUTO_RENEW_ON'))
      ORDER BY expires_at ASC LIMIT 40
    `).bind(...LIVE_STATUSES, new Date(now + WINDOW_DAYS * DAY + DAY).toISOString(), new Date(now - (PAY_GRACE_DAYS + 5) * DAY).toISOString()).all();
  const done = [];
  for (const raw of results) {
    const row = cycle(raw);
    try {
      const outcome = ["PAID", "AUTO_RENEW_ON"].includes(row.renewal_status)
        ? await stepPaid(env, row, config, now, fetchImpl)
        : await stepUnpaid(env, row, now);
      done.push({ domain: row.domain, outcome });
    } catch (error) {
      console.error("domain renewal", row.domain, error?.message);
      await env.DB.prepare(`UPDATE domain_registrations SET last_error = ?, updated_at = ? WHERE domain = ?`).bind(String(error?.message || error).slice(0, 500), nowIso(), row.domain).run().catch(() => null);
      done.push({ domain: row.domain, outcome: "ERROR" });
    }
  }
  return done;
}

// ---------- pay link and Stripe ----------

async function loadRow(env, domain) {
  const row = await env.DB.prepare(`SELECT * FROM domain_registrations WHERE domain = ?`).bind(domain).first();
  return row ? cycle(row) : null;
}

// GET /api/domain-renew/<domain>?t=<token>: sends the buyer to Stripe for one year.
async function handleDomainRenewPay(request, env, rawDomain) {
  const domain = asDomain(rawDomain);
  const url = new URL(request.url);
  const token = domain ? await verifyLinkToken(env, url.searchParams.get("t"), ["domain_renew"], domain) : null;
  if (!token) return simplePage(403, "Link not valid", "<p>This renewal link isn't valid. Reply to your email from MENU-MADE and we'll send a new one.</p>");
  const row = await loadRow(env, domain);
  if (!row || row.environment !== "live" || !row.expires_at) return simplePage(404, "Domain not found", "<p>We couldn't find this domain. Reply to your email from MENU-MADE.</p>");
  if (["PAID", "AUTO_RENEW_ON", "RENEWED"].includes(row.renewal_status)) {
    return simplePage(200, "Already paid", `<p>Thanks, the renewal for ${escapeHtml(domain)} is paid. We'll email you when the new expiry date is confirmed.</p>`);
  }
  if (token.expired || Date.now() > Date.parse(row.expires_at) + PAY_GRACE_DAYS * DAY) {
    return simplePage(410, "Link expired", `<p>This renewal link has expired. Reply to your email from MENU-MADE and we'll see whether ${escapeHtml(domain)} can still be saved.</p>`);
  }
  if (row.renewal_checkout_url && Date.parse(row.renewal_checkout_expires_at || 0) - Date.now() > 10 * 60000) {
    return Response.redirect(row.renewal_checkout_url, 303);
  }
  const who = await buyer(env, row).catch(() => null);
  const base = publicBaseUrl(env);
  const cents = renewalCents(row);
  const params = {
    mode: "payment",
    success_url: `${base}/api/domain-renew/${domain}/done`,
    cancel_url: `${base}/api/domain-renew/${domain}/done?cancelled=1`,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(cents),
    "line_items[0][price_data][product_data][name]": `${domain} domain renewal (1 year)`,
    "line_items[0][price_data][product_data][description]": `Keeps ${domain} registered in your name until ${dateText(new Date(Date.parse(row.expires_at) + 365 * DAY).toISOString())}.`,
    "line_items[0][quantity]": "1",
    "metadata[purpose]": "domain_renewal",
    "metadata[domain]": domain,
    "metadata[renewal_for]": row.expires_at,
    "metadata[original_order]": row.order_id || "",
    "metadata[environment]": "live",
    ...(looksLikeEmail(who?.email) ? { customer_email: String(who.email).trim() } : {})
  };
  let session;
  try {
    session = await stripeRequest(env, "live", "/v1/checkout/sessions", { method: "POST", params,
      idempotencyKey: `domain-renew/${domain}/${row.expires_at}/${Date.now() - (Date.now() % 3600000)}` });
  } catch (error) {
    console.error("Domain renewal checkout failed:", error?.message);
    return simplePage(502, "Payment page unavailable", "<p>We couldn't open the payment page just now. Please try the link again in a few minutes.</p>");
  }
  if (!session?.url) return simplePage(502, "Payment page unavailable", "<p>We couldn't open the payment page just now. Please try the link again in a few minutes.</p>");
  await save(env, row, { renewal_status: row.renewal_status || "DUE", renewal_checkout_url: session.url,
    renewal_checkout_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null });
  return Response.redirect(session.url, 303);
}

function handleDomainRenewDone(request, rawDomain) {
  const domain = escapeHtml(asDomain(rawDomain) || "your domain");
  return new URL(request.url).searchParams.has("cancelled")
    ? simplePage(200, "Payment not completed", `<p>No payment was taken. Use the link in your email whenever you're ready to keep ${domain}.</p>`)
    : simplePage(200, "Payment received", `<p>Thanks! ${domain} will be renewed for another year. We'll email you when the new expiry date is confirmed.</p>`);
}

// checkout.session.completed with metadata.purpose = domain_renewal.
async function handleDomainRenewalPaid(session, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const domain = asDomain(session?.metadata?.domain);
  if (!domain) throw new Error("Domain renewal payment has no domain");
  if (session.payment_status !== "paid") return { ok: true, ignored: "not_paid" };
  const raw = await env.DB.prepare(`SELECT * FROM domain_registrations WHERE domain = ?`).bind(domain).first();
  if (!raw) throw new Error(`Domain renewal payment references unknown domain ${domain}`);
  let row = cycle(raw);
  if (row.renewal_session_id === session.id) return { ok: true, duplicate: true };
  if (["PAID", "AUTO_RENEW_ON"].includes(row.renewal_status)) {
    // Paid twice for the same year (two tabs): keep the first; the owner refunds the second by hand if asked.
    console.error("domain renewal paid twice", domain, session.id);
    return { ok: true, duplicate: true };
  }
  row = await save(env, row, { renewal_status: "PAID", renewal_session_id: session.id, renewal_paid_at: nowIso(),
    renewal_paid_cents: session.amount_total ?? renewalCents(row), renewal_checkout_url: null, renewal_checkout_expires_at: null, renewal_owner_alerted_at: null });
  const config = registrarConfig(env);
  if (!config) return { ok: true, status: "PAID" };
  if (now > Date.parse(row.expires_at)) {
    if ((await alertOwnerStuck(env, row, "It was paid after the expiry date, when Cloudflare no longer renews on its own.").catch(() => null))?.ok) {
      await save(env, row, { renewal_owner_alerted_at: nowIso() });
    }
    return { ok: true, status: "PAID" };
  }
  try {
    await setAutoRenew(config, domain, true, fetchImpl);
    await save(env, row, { renewal_status: "AUTO_RENEW_ON" });
    return { ok: true, status: "AUTO_RENEW_ON" };
  } catch (error) {
    // Stays PAID; the daily pass tries again.
    console.error("domain renewal auto-renew", domain, error?.message);
    return { ok: true, status: "PAID" };
  }
}

export { EMAIL_DAYS_BEFORE, handleDomainRenewDone, handleDomainRenewPay, handleDomainRenewalPaid, renewalCents, runDomainRenewals };
