// Custom domains for generated sites (stage 7), through Cloudflare for SaaS custom hostnames (the first 100 are free).
//   1. The customer asks for a domain they own (Website Care page). We create a custom hostname with the Cloudflare API and
//      email them the one DNS record to add: hostname CNAME -> the fallback host (default sites.<root>).
//   2. Once the CNAME resolves Cloudflare validates and issues the certificate by itself. A scheduled pass polls PENDING
//      domains and, when the hostname and certificate are both active, marks it ACTIVE and emails the customer.
//   3. The Worker serves any ACTIVE custom hostname from website_sites.custom_domain (see customHostSlug).
// Everything is OFF until the owner enables Cloudflare for SaaS and sets CF_ZONE_ID, CF_SAAS_TOKEN (Custom Hostnames edit
// permission) and optionally SITE_FALLBACK_HOST. Without them saasConfig() is null, the form is not shown and nothing runs.
// domain_status: PENDING (waiting for the customer's DNS) -> ACTIVE, or FAILED (blocked by Cloudflare or never validated).
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { publicBaseUrl } from "../../lib/config.js";
import { nowIso } from "../../lib/http.js";

const API = "https://api.cloudflare.com/client/v4";
const GIVE_UP_DAYS = 14;
const MIN_MINUTES_BETWEEN = 25;
const PER_TICK = 10;

class DomainError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function rootHost(env) {
  try { return new URL(publicBaseUrl(env)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "menu-made.com"; }
}

function saasConfig(env) {
  if (!env.CF_ZONE_ID || !env.CF_SAAS_TOKEN) return null;
  return { zone: env.CF_ZONE_ID, token: env.CF_SAAS_TOKEN, fallback: (env.SITE_FALLBACK_HOST || `sites.${rootHost(env)}`).toLowerCase() };
}

// A domain the customer owns, as a bare hostname. Refuses addresses, our own domain, and anything that is not a normal name.
function normalizeHostname(input, env = {}) {
  let value = String(input ?? "").trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (!value) throw new DomainError("Please enter the domain name, for example www.joespizza.com.");
  if (value.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(value)) throw new DomainError("That doesn't look like a domain name. Enter it like www.joespizza.com.");
  const root = rootHost(env);
  if (value === root || value.endsWith(`.${root}`)) throw new DomainError("Your site already has a menu-made.com address. Enter a domain you own.");
  return value;
}

async function cf(config, path, { method = "GET", body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${API}/zones/${config.zone}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await response.json(); } catch { /* not JSON */ }
  return { ok: response.ok && data?.success !== false, status: response.status, data, errors: data?.errors || [] };
}

async function findHostname(config, hostname, fetchImpl) {
  const result = await cf(config, `/custom_hostnames?hostname=${encodeURIComponent(hostname)}`, { fetchImpl });
  if (!result.ok) throw new Error(`Cloudflare lookup failed (${result.status}): ${result.errors.map((e) => e.message).join("; ")}`);
  return (result.data?.result || [])[0] || null;
}

function dnsInstructions(env, hostname) {
  const config = saasConfig(env);
  const apex = hostname.split(".").length <= 2;
  return {
    type: "CNAME", name: hostname, target: config?.fallback || `sites.${rootHost(env)}`,
    note: apex
      ? "Many registrars don't allow a CNAME on the bare domain. If yours doesn't, use www.<your domain> instead, or ask them for \"CNAME flattening\" or \"ALIAS\" support."
      : "If the name already has an A, AAAA or CNAME record, replace it with this one."
  };
}

// Ask for a custom domain for a site. Idempotent for the same site and hostname.
async function requestCustomDomain(env, slug, input, { fetchImpl = fetch } = {}) {
  const config = saasConfig(env);
  if (!config) throw new DomainError("Custom domains aren't switched on yet. Reply to your last email and we'll set it up for you.", 503);
  const hostname = normalizeHostname(input, env);
  const site = await env.DB.prepare(`SELECT slug, custom_domain, domain_status FROM website_sites WHERE slug = ?`).bind(slug).first();
  if (!site) throw new DomainError("We can't find your website.", 404);
  const taken = await env.DB.prepare(`SELECT slug FROM website_sites WHERE custom_domain = ? AND slug != ?`).bind(hostname, slug).first();
  if (taken) throw new DomainError("That domain is already connected to another website. Reply to your last email and we'll sort it out.", 409);
  if (site.custom_domain && site.custom_domain !== hostname && site.domain_status === "ACTIVE") throw new DomainError("Your website already has a custom domain. Reply to your last email to change it.", 409);

  let record = await findHostname(config, hostname, fetchImpl);
  if (!record) {
    const created = await cf(config, "/custom_hostnames", { method: "POST", fetchImpl, body: { hostname, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } } });
    if (!created.ok) throw new DomainError(`We couldn't register that domain: ${created.errors.map((e) => e.message).join("; ") || `error ${created.status}`}.`, 502);
    record = created.data?.result;
  }
  const now = nowIso();
  const active = record?.status === "active" && (record?.ssl?.status || "active") === "active";
  await env.DB.prepare(`UPDATE website_sites SET custom_domain = ?, domain_status = ?, domain_requested_at = CASE WHEN custom_domain = ? AND domain_requested_at IS NOT NULL THEN domain_requested_at ELSE ? END, updated_at = ? WHERE slug = ?`).bind(hostname, active ? "ACTIVE" : "PENDING", hostname, now, now, slug).run();
  return { hostname, status: active ? "ACTIVE" : "PENDING", dns: dnsInstructions(env, hostname) };
}

async function ownerOf(env, slug) {
  return env.DB.prepare(`
      SELECT s.slug, s.custom_domain, c.email, c.first_name, b.name AS business_name
      FROM website_sites s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN businesses b ON b.id = s.business_id WHERE s.slug = ?
    `).bind(slug).first();
}

async function emailInstructions(env, slug) {
  const owner = await ownerOf(env, slug);
  if (!owner?.email || !owner.custom_domain) return { sent: false };
  const dns = dnsInstructions(env, owner.custom_domain);
  return sendTransactionalEmail(env, {
    to: owner.email,
    subject: `One DNS record to connect ${owner.custom_domain}`,
    html: brandedEmailHtml({
      preheader: "Add one record at your domain registrar and your website goes live on your own domain.",
      eyebrow: "YOUR WEBSITE", heading: `Connect ${owner.custom_domain}`,
      paragraphs: [
        `Hi ${escapeHtml(owner.first_name || "there")}, to put your website on <strong>${escapeHtml(owner.custom_domain)}</strong>, sign in where you bought the domain and add this DNS record:`,
        `<p><strong>Type:</strong> ${dns.type}<br><strong>Name / Host:</strong> ${escapeHtml(owner.custom_domain)}<br><strong>Value / Target:</strong> ${escapeHtml(dns.target)}</p>`,
        escapeHtml(dns.note),
        "It can take from a few minutes to a day for the change to spread. We check automatically and email you the moment your website is live on the new address. Your current menu-made.com address keeps working."
      ],
      footnote: "Stuck? Reply to this email and tell us which registrar you use."
    }),
    idempotencyKey: `site-domain-instructions/${slug}/${owner.custom_domain}`, purpose: "WEBSITE_DOMAIN_INSTRUCTIONS", templateKey: "website_domain_instructions_v1"
  });
}

async function emailOutcome(env, slug, ok, detail = "") {
  const owner = await ownerOf(env, slug);
  if (!owner?.email || !owner.custom_domain) return;
  await sendTransactionalEmail(env, {
    to: owner.email,
    subject: ok ? `${owner.custom_domain} is live` : `We couldn't connect ${owner.custom_domain}`,
    html: brandedEmailHtml({
      preheader: ok ? "Your website now answers on your own domain." : "The domain still isn't pointing at your website.",
      eyebrow: "YOUR WEBSITE", heading: ok ? "Your website is live on your domain" : "We couldn't finish connecting your domain",
      paragraphs: ok
        ? [`Hi ${escapeHtml(owner.first_name || "there")}, <strong>https://${escapeHtml(owner.custom_domain)}/</strong> now shows your website, with a security certificate.`]
        : [`Hi ${escapeHtml(owner.first_name || "there")}, after ${GIVE_UP_DAYS} days <strong>${escapeHtml(owner.custom_domain)}</strong> is still not pointing at your website${detail ? ` (${escapeHtml(detail)})` : ""}.`,
          "Reply to this email with the name of your domain registrar and we'll help you add the record."],
      footnote: ok ? "Your menu-made.com address keeps working too." : ""
    }),
    idempotencyKey: `site-domain-${ok ? "active" : "failed"}/${slug}/${owner.custom_domain}`, purpose: ok ? "WEBSITE_DOMAIN_ACTIVE" : "WEBSITE_DOMAIN_FAILED", templateKey: ok ? "website_domain_active_v1" : "website_domain_failed_v1"
  });
}

// Scheduled: poll PENDING domains. At most PER_TICK per run, each at most every MIN_MINUTES_BETWEEN minutes.
async function runDomainWatch(env, { now = new Date(), fetchImpl = fetch } = {}) {
  const config = saasConfig(env);
  if (!config || !env.DB) return null;
  const cutoff = new Date(now.getTime() - MIN_MINUTES_BETWEEN * 60000).toISOString();
  const due = (await env.DB.prepare(`
      SELECT slug, custom_domain, updated_at, domain_requested_at FROM website_sites
      WHERE domain_status = 'PENDING' AND custom_domain IS NOT NULL AND updated_at < ? ORDER BY updated_at LIMIT ?
    `).bind(cutoff, PER_TICK).all()).results || [];
  const summary = { checked: 0, activated: 0, failed: 0 };
  for (const site of due) {
    summary.checked += 1;
    let record = null;
    try { record = await findHostname(config, site.custom_domain, fetchImpl); } catch (error) { console.error("Domain check failed:", error instanceof Error ? error.message : String(error)); }
    const t = nowIso();
    const ready = record && record.status === "active" && (record.ssl?.status || "active") === "active";
    if (ready) {
      await env.DB.prepare(`UPDATE website_sites SET domain_status = 'ACTIVE', updated_at = ? WHERE slug = ?`).bind(t, site.slug).run();
      await emailOutcome(env, site.slug, true).catch((e) => console.error("Domain email failed:", e instanceof Error ? e.message : String(e)));
      summary.activated += 1;
    } else if ((record && ["blocked", "deleted"].includes(record.status)) || overdue(site, now)) {
      await env.DB.prepare(`UPDATE website_sites SET domain_status = 'FAILED', updated_at = ? WHERE slug = ?`).bind(t, site.slug).run();
      await emailOutcome(env, site.slug, false, record?.verification_errors?.[0] || record?.ssl?.validation_errors?.[0]?.message || "").catch((e) => console.error("Domain email failed:", e instanceof Error ? e.message : String(e)));
      summary.failed += 1;
    } else {
      await env.DB.prepare(`UPDATE website_sites SET updated_at = ? WHERE slug = ?`).bind(t, site.slug).run();
    }
  }
  return summary;
}

function overdue(site, now) {
  const since = new Date(site.domain_requested_at || "").getTime();
  return Number.isFinite(since) && now.getTime() - since > GIVE_UP_DAYS * 86400000;
}

// Which site answers for this hostname (only ACTIVE custom domains). Never asks the database about our own hostnames.
async function customHostSlug(env, hostname) {
  const root = rootHost(env);
  const host = String(hostname || "").toLowerCase();
  if (!host || host === root || host.endsWith(`.${root}`) || !saasConfig(env) || !env.DB) return null;
  const row = await env.DB.prepare(`SELECT slug FROM website_sites WHERE custom_domain = ? AND domain_status = 'ACTIVE' LIMIT 1`).bind(host).first();
  return row?.slug || null;
}

// Read-only check that custom domains can work: the settings exist, the token can read Custom Hostnames on the zone,
// and the fallback origin is the expected host and active. Changes nothing at Cloudflare. Used by the
// CUSTOM_DOMAIN_SETUP self-test, which also runs daily so an expired token or broken fallback is noticed.
async function checkSaasSetup(env, { fetchImpl = fetch } = {}) {
  const config = saasConfig(env);
  if (!config) return { ok: false, problems: ["CF_ZONE_ID or CF_SAAS_TOKEN is not set on the worker"] };
  // Oct 27, 2026: the DCV delegation target (<id>.dcv.cloudflare.com) was pasted here once; the Zone ID is 32 hex characters.
  if (!/^[0-9a-f]{32}$/i.test(config.zone)) return { ok: false, problems: [`CF_ZONE_ID is not a Zone ID (32 letters and digits, on the zone's Overview page under API); it looks like ${/\.dcv\.cloudflare\.com$/i.test(config.zone) ? "the DCV delegation target" : "something else"}`] };
  const problems = [];
  const fallback = await cf(config, "/custom_hostnames/fallback_origin", { fetchImpl });
  const origin = fallback.data?.result?.origin || null;
  const status = fallback.data?.result?.status || null;
  if (!fallback.ok) problems.push(`Reading the fallback origin failed (HTTP ${fallback.status}): ${fallback.errors.map((e) => e.message).join("; ") || "no detail"}`);
  else {
    if (origin !== config.fallback) problems.push(`The fallback origin is ${origin || "not set"}, expected ${config.fallback}`);
    if (status !== "active") problems.push(`The fallback origin is ${status || "unknown"}, not active`);
  }
  const list = await cf(config, "/custom_hostnames?per_page=1", { fetchImpl });
  if (!list.ok) problems.push(`Listing custom hostnames failed (HTTP ${list.status}): ${list.errors.map((e) => e.message).join("; ") || "no detail"}`);
  return { ok: problems.length === 0, problems, fallback: origin, fallback_status: status, hostnames: list.data?.result_info?.total_count ?? null };
}

export { DomainError, checkSaasSetup, customHostSlug, dnsInstructions, emailInstructions, normalizeHostname, requestCustomDomain, runDomainWatch, saasConfig };
