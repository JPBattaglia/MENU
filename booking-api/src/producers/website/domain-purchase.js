// Domains bought at checkout with a hosted website (owner, Nov 7, 2026): customer is the registrant, Menu-made manages it,
// priced at Cloudflare's cost + $5 a year.
//   Checkout: domainForCheckout() checks the name live and prices it; the price rides on the Your Website line.
//   After payment: the site step queues a row here (queueDomain); runDomainPurchases() moves it along every cron tick:
//     QUEUED       -> price re-checked, then REGISTERING (the row is claimed before the one POST, so a domain is never
//                     paid for twice; a crash mid-call is resolved by polling, never by posting again)
//     IN_PROGRESS  -> Cloudflare is still registering; polled
//     REGISTERED   -> the zone is found; proxied DNS (apex + www) and two Workers routes to this worker are added,
//                     website_sites.custom_domain is set -> POINTED
//     POINTED      -> once https://<domain>/ answers, the buyer gets a "your domain is live" email -> ACTIVE
//     HELD         -> the price rose more than PRICE_SLACK_CENTS since checkout; the owner decides
//     FAILED       -> Cloudflare refused or the name was taken meanwhile; the owner is alerted (runbook R2)
//     TEST         -> a sandbox order: nothing is bought, unless the owner taps "Buy it for real" in the email he gets
//                     (owner, Nov 12, 2026: test the real domain path with the rest of the order in Stripe sandbox).
//                     That one tap moves the row to QUEUED with environment "live", and from there it is a real domain:
//                     registered on Menu-made's Cloudflare account, pointed, "is live" email, yearly renewal emails.
// Renewals: registered with auto-renew off (Cloudflare's default), so nothing renews unpaid. domain-renewal.js emails the
// buyer a pay link (cost + $5) from 45 days before expiry and switches auto-renew on only once paid.
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { nowIso, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { stripeRequest } from "../../lib/stripe.js";
import { CheckoutValidationError } from "../../checkout/quote.js";
import { DOMAIN_MARKUP_CENTS, asDomain, checkDomains, registrarConfig } from "./registrar.js";

const API = "https://api.cloudflare.com/client/v4";
const PRICE_SLACK_CENTS = 300;
const PER_TICK = 5;
const WORKER = "menu-checkout";
const WAIT_STATES = new Set(["pending", "in_progress", "blocked"]);
const LIVE_GIVE_UP_HOURS = 48;

// ---------- checkout ----------

// The plan in the cart hosts the site (Website Care on its own, or a bundle / own plan that includes it).
function hostsSite(plan) {
  if (!plan) return false;
  const includes = Array.isArray(plan.includes) ? plan.includes : [];
  return plan.offerCode === "WEBSITE_CARE" || includes.includes("WEBSITE_CARE");
}

async function domainForCheckout(env, input, { plan, fetchImpl = fetch } = {}) {
  if (!registrarConfig(env)) throw new CheckoutValidationError("Buying a domain isn't available right now. Remove it to continue; you can connect your own domain later.", 409);
  const name = asDomain(input);
  if (!name) throw new CheckoutValidationError("That domain doesn't look right. Search again and pick one from the list.");
  if (!hostsSite(plan)) throw new CheckoutValidationError("A domain comes with a hosted website. Add Website Care (or a plan with it) to buy one.");
  const taken = await env.DB.prepare(`SELECT status FROM domain_registrations WHERE domain = ? AND status NOT IN ('FAILED', 'TEST')`).bind(name).first().catch(() => null);
  if (taken) throw new CheckoutValidationError(`${name} is already taken. Search again for another name.`);
  const [checked] = await checkDomains(env, [name], { fetchImpl });
  if (!checked?.available) throw new CheckoutValidationError(`${name} can't be bought: ${checked?.reason || "not available"}. Search again for another name.`);
  return { name, price_cents: checked.price_cents, cost_cents: checked.price_cents - DOMAIN_MARKUP_CENTS, renewal_cents: checked.renewal_cents };
}

// ---------- after payment ----------

async function queueDomain(env, context, domain, slug, { test = false } = {}) {
  const name = asDomain(domain?.name);
  if (!name) return null;
  const t = nowIso();
  await env.DB.prepare(`
      INSERT OR IGNORE INTO domain_registrations (domain, order_id, project_id, business_id, customer_id, slug, environment, status,
        price_cents, cost_cents, renewal_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(name, context.order_id, context.id, context.business_id, context.customer_id, slug, test ? "sandbox" : "live", test ? "TEST" : "QUEUED",
    Number(domain.price_cents) || null, Number(domain.cost_cents) || null, Number(domain.renewal_cents) || null, t, t).run();
  if (test) await offerRealTestDomain(env, name).catch((error) => console.error("test domain offer", error?.message));
  return name;
}

// ---------- a sandbox order's domain, bought for real on the owner's say-so ----------

const TEST_BUY_KIND = "domaintest";
const testBuyUrl = async (env, domain) =>
  `${publicBaseUrl(env)}/api/domain-test-buy/${domain}?t=${await signLinkToken(env, { kind: TEST_BUY_KIND, id: domain, ttlDays: 14 })}`;

// Only the owner inbox gets this link, so someone who found the test-mode switch can't have domains bought on
// Menu-made's Cloudflare card.
async function offerRealTestDomain(env, domain) {
  if (!registrarConfig(env)) return;
  const row = await env.DB.prepare(`SELECT * FROM domain_registrations WHERE domain = ? AND status = 'TEST'`).bind(domain).first();
  if (!row) return;
  const url = await testBuyUrl(env, domain);
  const cost = row.cost_cents ? `about $${(Number(row.cost_cents) / 100).toFixed(2)}` : "Cloudflare's price";
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[TEST] Buy ${domain} for real?`,
    html: brandedEmailHtml({
      eyebrow: "TEST · DOMAIN", heading: `Buy ${escapeHtml(domain)} for real?`,
      paragraphs: [
        `A test-mode website order picked <strong>${escapeHtml(domain)}</strong>. Nothing has been bought.`,
        `If you tap the button, the domain is registered for real on Menu-made's Cloudflare account (${escapeHtml(cost)} charged to the card on that account), pointed at the test site, and the buyer gets the "your domain is live" email. Everything else on the order stays in Stripe test mode.`,
        "The registrant is the name, address and phone typed on the test checkout. If you don't tap, nothing happens."
      ],
      buttons: [{ label: "Buy it for real", url, primary: true }],
      footnote: "The link works for 14 days and only once."
    }),
    text: `A test-mode website order picked ${domain}. Nothing has been bought. To register it for real (${cost} on Menu-made's Cloudflare account), open: ${url}`,
    idempotencyKey: `domain-test-offer/${domain}/${row.order_id}`, purpose: "OWNER_ACTION", templateKey: "domain_test_buy_offer_v1"
  });
}

async function handleDomainTestBuy(request, env, domain) {
  const url = new URL(request.url);
  const token = request.method === "POST" ? String((await request.formData().catch(() => null))?.get("t") || "") : url.searchParams.get("t") || "";
  const ok = await verifyLinkToken(env, token, [TEST_BUY_KIND], domain).catch(() => null);
  if (!ok || ok.expired) return simplePage(403, "Link not valid", "<p>This link is not valid or has expired.</p>");
  const row = await env.DB.prepare(`SELECT * FROM domain_registrations WHERE domain = ?`).bind(domain).first();
  if (!row) return simplePage(404, "Domain not found", "<p>No order has this domain.</p>");
  if (row.status !== "TEST") return simplePage(200, "Already on its way", `<p>${escapeHtml(domain)} is already being bought (status: ${escapeHtml(row.status)}). You'll get the "is live" email when it answers.</p>`);
  // GET only shows the button: mail apps open links on their own, and that must never buy anything.
  if (request.method !== "POST") {
    return simplePage(200, `Buy ${domain} for real?`, `<p>This registers <strong>${escapeHtml(domain)}</strong> for one year on Menu-made's Cloudflare account and points it at the test site. The rest of the order stays in test mode.</p>
<form method="post"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">Buy it for real</button></form>`);
  }
  const moved = await env.DB.prepare(`UPDATE domain_registrations SET status = 'QUEUED', environment = 'live', next_check_at = NULL, last_error = NULL, updated_at = ? WHERE domain = ? AND status = 'TEST'`)
    .bind(nowIso(), domain).run();
  if (!moved?.meta?.changes) return simplePage(200, "Already on its way", `<p>${escapeHtml(domain)} is already being bought.</p>`);
  return simplePage(200, "Buying it now", `<p>${escapeHtml(domain)} goes to Cloudflare within a minute or two. When the domain answers (usually 5 to 30 minutes), the buyer address on the order gets the "${escapeHtml(domain)} is live" email.</p>`);
}

function api(config, path, { method = "GET", body, headers = {}, fetchImpl = fetch } = {}) {
  return fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (response) => {
    let data = null;
    try { data = await response.json(); } catch { /* not JSON */ }
    return { ok: response.ok && data?.success !== false, status: response.status, data, errors: data?.errors || [] };
  });
}
const errorText = (r) => (r.errors || []).map((e) => e.message).join("; ") || `HTTP ${r.status}`;

// "+1 (415) 555-0100" -> "+1.4155550100" (the registry format). US/Canada numbers only; anything else -> null, and the
// registration falls back to Cloudflare's default contact rather than guess a country code.
function registryPhone(raw) {
  const text = String(raw || "").trim();
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10 && !text.startsWith("+")) return `+1.${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+1.${digits.slice(1)}`;
  return null;
}

// The buyer as registrant, from the Stripe checkout (address and phone are collected there when a domain is bought).
// Anything missing -> null, and Cloudflare's default contact (Menu-made) is used instead.
async function buyerContact(env, row) {
  const order = await env.DB.prepare(`
      SELECT o.stripe_checkout_session_id AS session, c.email, c.first_name, c.last_name, c.phone, b.name AS business
      FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN businesses b ON b.id = o.business_id WHERE o.id = ?
    `).bind(row.order_id).first();
  if (!order?.session) return null;
  // The session's own mode, not the row's: a test order's domain bought for real is "live" but its checkout was sandbox.
  const mode = String(order.session).startsWith("cs_test_") ? "sandbox" : "live";
  const session = await stripeRequest(env, mode, `/v1/checkout/sessions/${order.session}`).catch(() => null);
  const details = session?.customer_details || {};
  const address = details.address || {};
  const name = String(details.name || [order.first_name, order.last_name].filter(Boolean).join(" ")).trim();
  const phone = registryPhone(details.phone || order.phone);
  const email = String(details.email || order.email || "").trim();
  if (!name || !phone || !email || !address.line1 || !address.city || !address.postal_code || !address.country) return null;
  return {
    email, phone,
    postal_info: {
      name, ...(order.business ? { organization: order.business } : {}),
      address: { street: [address.line1, address.line2].filter(Boolean).join(", "), city: address.city, ...(address.state ? { state: address.state } : {}), postal_code: address.postal_code, country_code: address.country }
    }
  };
}

async function setRow(env, domain, fields) {
  const keys = Object.keys(fields);
  await env.DB.prepare(`UPDATE domain_registrations SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE domain = ?`)
    .bind(...keys.map((k) => fields[k]), nowIso(), domain).run();
}
const later = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();

async function alertOwner(env, row, problem) {
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[Domain] ${row.domain}: ${problem}`,
    html: brandedEmailHtml({ eyebrow: "DOMAIN", heading: `${escapeHtml(row.domain)}: ${escapeHtml(problem)}`, paragraphs: [
      `Bought at checkout on order ${escapeHtml(row.order_id)} (customer paid ${(Number(row.price_cents || 0) / 100).toFixed(2)} USD for the first year).`,
      "The website itself is live on its menu-made.com address; only the domain is waiting. Nothing was sent to the buyer about this."] }),
    text: `${row.domain}: ${problem}. Order ${row.order_id}. The website is live on its menu-made.com address; only the domain is waiting.`,
    idempotencyKey: `domain-alert/${row.domain}/${problem}`, purpose: "AUTOMATION_ALERT", templateKey: "domain_purchase_blocked_v1"
  }).catch(() => null);
}

async function fail(env, row, problem) {
  await setRow(env, row.domain, { status: "FAILED", last_error: problem.slice(0, 500), next_check_at: null });
  await alertOwner(env, row, problem);
  return "FAILED";
}

function registrationOutcome(result) {
  const r = result.data?.result || {};
  const state = String(r.state || "");
  if (state === "succeeded" || r.completed === true && !r.error) return { done: true, expires: r.context?.registration?.expires_at || null };
  if (state === "failed" || state === "action_required") return { failed: `Cloudflare ${state.replace("_", " ")}: ${r.error?.message || r.context?.action || "no reason given"}` };
  if (WAIT_STATES.has(state)) return { wait: true };
  return null;
}

async function stepQueued(env, row, config, fetchImpl) {
  const [checked] = await checkDomains(env, [row.domain], { fetchImpl });
  if (!checked?.available) return fail(env, row, `can't be registered now (${checked?.reason || "not available"})`);
  const cost = checked.price_cents - DOMAIN_MARKUP_CENTS;
  if (row.cost_cents && cost > Number(row.cost_cents) + PRICE_SLACK_CENTS) {
    await setRow(env, row.domain, { status: "HELD", last_error: `Cloudflare's price rose from ${row.cost_cents} to ${cost} cents`, next_check_at: null });
    await alertOwner(env, row, "price rose since checkout, held");
    return "HELD";
  }
  // Claim the row: only one tick ever sends the registration.
  const claimed = await env.DB.prepare(`UPDATE domain_registrations SET status = 'REGISTERING', attempts = attempts + 1, cost_cents = ?, updated_at = ? WHERE domain = ? AND status = 'QUEUED'`)
    .bind(cost, nowIso(), row.domain).run();
  if (!claimed?.meta?.changes) return "SKIPPED";
  const contact = await buyerContact(env, row).catch(() => null);
  let result = await api(config, `/accounts/${config.account}/registrar/registrations`, { method: "POST", fetchImpl, body: { domain_name: row.domain, ...(contact ? { contacts: { registrant: contact } } : {}) } });
  let registrant = contact ? "CUSTOMER" : "DEFAULT";
  // A contact the registry won't take is a 4xx before anything is bought: retry once with the default contact.
  if (!result.ok && contact && result.status >= 400 && result.status < 500 && result.status !== 409) {
    result = await api(config, `/accounts/${config.account}/registrar/registrations`, { method: "POST", fetchImpl, body: { domain_name: row.domain } });
    registrant = "DEFAULT";
  }
  if (result.ok) {
    const outcome = registrationOutcome(result);
    if (outcome?.done) { await setRow(env, row.domain, { status: "REGISTERED", registrant, expires_at: outcome.expires, last_error: null, next_check_at: null }); return "REGISTERED"; }
    if (outcome?.failed) return fail(env, { ...row }, outcome.failed);
    await setRow(env, row.domain, { status: "IN_PROGRESS", registrant, next_check_at: later(2) });
    return "IN_PROGRESS";
  }
  if (result.status >= 400 && result.status < 500) return fail(env, row, `Cloudflare refused the registration: ${errorText(result)}`);
  // 5xx or no answer: it may or may not have gone through. Poll; never post again.
  await setRow(env, row.domain, { status: "IN_PROGRESS", registrant, last_error: errorText(result).slice(0, 500), next_check_at: later(5) });
  return "IN_PROGRESS";
}

async function stepInProgress(env, row, config, fetchImpl) {
  const status = await api(config, `/accounts/${config.account}/registrar/registrations/${row.domain}/registration-status`, { fetchImpl });
  if (status.ok) {
    const outcome = registrationOutcome(status);
    if (outcome?.done) {
      const reg = await api(config, `/accounts/${config.account}/registrar/registrations/${row.domain}`, { fetchImpl });
      await setRow(env, row.domain, { status: "REGISTERED", expires_at: outcome.expires || reg.data?.result?.expires_at || null, last_error: null, next_check_at: null });
      return "REGISTERED";
    }
    if (outcome?.failed) return fail(env, row, outcome.failed);
  }
  // Not known to Cloudflare an hour after the attempt: the POST never landed.
  if (status.status === 404 && Date.parse(row.updated_at) < Date.now() - 60 * 60000) return fail(env, row, "registration never reached Cloudflare");
  await setRow(env, row.domain, { next_check_at: later(5) });
  return "IN_PROGRESS";
}

async function ensure(config, path, body, fetchImpl) {
  const r = await api(config, path, { method: "POST", body, fetchImpl });
  // 81057/81058: the DNS record exists; 10020: the route exists. Both mean "already done".
  if (r.ok || r.errors.some((e) => [81057, 81058, 10020].includes(Number(e.code)) || /already exists/i.test(e.message || ""))) return true;
  throw new Error(`${path}: ${errorText(r)}`);
}

async function stepRegistered(env, row, config, fetchImpl) {
  const zones = await api(config, `/zones?name=${encodeURIComponent(row.domain)}&account.id=${config.account}`, { fetchImpl });
  const zone = zones.ok ? (zones.data?.result || [])[0] : null;
  if (!zone?.id) {
    if (Date.parse(row.updated_at) < Date.now() - 6 * 60 * 60000) return fail(env, row, "registered, but its Cloudflare zone never appeared");
    await setRow(env, row.domain, { next_check_at: later(5) });
    return "REGISTERED";
  }
  try {
    for (const name of [row.domain, `www.${row.domain}`]) {
      await ensure(config, `/zones/${zone.id}/dns_records`, { type: "AAAA", name, content: "100::", proxied: true, ttl: 1, comment: "Menu-made website" }, fetchImpl);
      await ensure(config, `/zones/${zone.id}/workers/routes`, { pattern: `${name}/*`, script: WORKER }, fetchImpl);
    }
  } catch (error) {
    await setRow(env, row.domain, { zone_id: zone.id, last_error: String(error.message).slice(0, 500), attempts: Number(row.attempts || 0) + 1, next_check_at: later(15) });
    if (Number(row.attempts || 0) >= 6) return fail(env, row, `registered, but pointing it failed: ${error.message}`);
    return "REGISTERED";
  }
  await env.DB.prepare(`UPDATE website_sites SET custom_domain = ?, domain_status = 'ACTIVE', updated_at = ? WHERE slug = ?`).bind(row.domain, nowIso(), row.slug).run();
  await setRow(env, row.domain, { status: "POINTED", zone_id: zone.id, last_error: null, next_check_at: later(5) });
  return "POINTED";
}

async function emailBuyerLive(env, row) {
  const owner = await env.DB.prepare(`SELECT c.email, c.first_name, b.name AS business FROM customers c LEFT JOIN businesses b ON b.id = ? WHERE c.id = ?`).bind(row.business_id, row.customer_id).first();
  if (!owner?.email) return;
  const url = `https://${row.domain}/`;
  const renew = row.renewal_cents ? `$${(Number(row.renewal_cents) / 100).toFixed(2)}` : "the yearly price";
  await sendTransactionalEmail(env, {
    to: owner.email,
    subject: `${row.domain} is live`,
    html: brandedEmailHtml({
      preheader: "Your website now answers on your own domain.", eyebrow: "YOUR DOMAIN", heading: `${escapeHtml(row.domain)} is yours and live`,
      paragraphs: [
        `Hi ${escapeHtml(owner.first_name || "there")}, <strong>${escapeHtml(url)}</strong> now shows your website, with a security certificate. www.${escapeHtml(row.domain)} works too.`,
        `The domain is registered for one year in your name, and we manage it for you. Before it renews we'll email you a link to keep it for another year (${escapeHtml(renew)}); nothing renews without your OK.`,
        "Your menu-made.com address keeps working as well."
      ],
      buttons: [{ label: "Open your website", url, primary: true }],
      footnote: "Questions about your domain? Reply to this email."
    }),
    text: `${url} now shows your website. Registered for one year in your name, managed by Menu-made. We'll email before it renews (${renew}).`,
    idempotencyKey: `domain-live/${row.domain}`, purpose: "WEBSITE_DOMAIN_ACTIVE", templateKey: "domain_live_v1"
  });
}

async function stepPointed(env, row, fetchImpl) {
  const answer = await fetchImpl(`https://${row.domain}/`, { method: "HEAD", redirect: "manual" }).catch(() => null);
  if (answer && answer.status < 500) {
    await emailBuyerLive(env, row).catch(() => null);
    await setRow(env, row.domain, { status: "ACTIVE", next_check_at: null });
    return "ACTIVE";
  }
  if (Date.parse(row.created_at) < Date.now() - LIVE_GIVE_UP_HOURS * 60 * 60000) {
    await setRow(env, row.domain, { next_check_at: later(60) });
    await alertOwner(env, row, `pointed, but still not answering after ${LIVE_GIVE_UP_HOURS} hours`);
    return "POINTED";
  }
  await setRow(env, row.domain, { next_check_at: later(10) });
  return "POINTED";
}

async function runDomainPurchases(env, { fetchImpl = fetch, limit = PER_TICK } = {}) {
  const config = registrarConfig(env);
  if (!config || !env.DB) return [];
  const { results = [] } = await env.DB.prepare(`
      SELECT * FROM domain_registrations
      WHERE status IN ('QUEUED', 'REGISTERING', 'IN_PROGRESS', 'REGISTERED', 'POINTED') AND (next_check_at IS NULL OR next_check_at <= ?)
      ORDER BY updated_at ASC LIMIT ?
    `).bind(nowIso(), limit).all();
  const done = [];
  for (const row of results) {
    try {
      let outcome;
      if (row.status === "QUEUED") outcome = await stepQueued(env, row, config, fetchImpl);
      else if (row.status === "REGISTERING" || row.status === "IN_PROGRESS") outcome = await stepInProgress(env, row, config, fetchImpl);
      else if (row.status === "REGISTERED") outcome = await stepRegistered(env, row, config, fetchImpl);
      else outcome = await stepPointed(env, row, fetchImpl);
      done.push({ domain: row.domain, outcome });
    } catch (error) {
      console.error("domain purchase", row.domain, error?.message);
      await setRow(env, row.domain, { last_error: String(error?.message || error).slice(0, 500), next_check_at: later(15) }).catch(() => null);
      done.push({ domain: row.domain, outcome: "ERROR" });
    }
  }
  return done;
}

async function domainForOrder(env, orderId) {
  return env.DB.prepare(`SELECT domain, status FROM domain_registrations WHERE order_id = ? LIMIT 1`).bind(orderId).first().catch(() => null);
}

export { domainForCheckout, domainForOrder, handleDomainTestBuy, hostsSite, queueDomain, registryPhone, runDomainPurchases, testBuyUrl };
