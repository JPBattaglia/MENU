// Stage 9 part 2: customer accounts. A buyer's account is their customers row, created at their first purchase, so
// there is no sign-up. Signing in: the buyer types their email on menu-made.com/account, we email a single-use link
// (20 minutes), opening it and pressing "Sign in" sets an HttpOnly session cookie (30 days, revocable). The account
// page then lists every plan, order, delivery and private link that would otherwise only live in their emails.
// No passwords exist anywhere. Responses never say whether an email has an account (no enumeration).
import { DELIVERABLE_LABELS, DELIVERY_LINK_TTL_DAYS, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, looksLikeEmail, sendTransactionalEmail } from "../lib/email.js";
import { normalizeEmail, nowIso, parseJsonOrNull, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { billingPortalLink } from "../subscriptions/portal.js";
import { settingsLink } from "../subscriptions/settings.js";
import { activeConnection, googleConnectUrl } from "../google/connect.js";
import { menuCareLink } from "../producers/menu-care/care-step.js";
import { menuHostingState, renewalLink } from "../producers/menu-qr/hosting-renewal.js";
import { siteCareLink } from "../producers/website-care/care-step.js";
import { appUrl, loadLiveApp, updateLink } from "../producers/guest-app/app-step.js";
import { intakeLink as appIntakeLink } from "../producers/guest-app/intake.js";
import { counterLink as appCounterLink, pushLink as appPushLink } from "../producers/guest-app/engage.js";
import { intakeLink as siteIntakeLink } from "../producers/website/intake.js";
import { photoLibraryLink } from "../producers/google-care/library.js";
import { hostedMenu, liveWebsite } from "../producers/google-visibility/sources.js";

const SIGN_IN_KIND = "account_signin";
const SESSION_KIND = "account_session";
const SIGN_IN_MINUTES = 20;
const SESSION_DAYS = 30;
const MAX_SIGN_INS_PER_HOUR = 5;
const COOKIE = "mm_account";
const BILLING_LOGIN_URL = "https://billing.stripe.com/p/login/bJe28rgRl2FGaL22yd9IQ00";
const GOOGLE_CODES = new Set(["REVIEW_REPLIES", "GOOGLE_PROFILE_CARE"]);

function privateJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders }
  });
}

function cookieHeader(value, maxAgeSeconds) {
  return `${COOKIE}=${value}; Path=/api/account; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function readCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=") || null;
  }
  return null;
}

async function findBuyer(env, email) {
  // A buyer is a customer with at least one paid order or any subscription.
  return env.DB.prepare(`
      SELECT c.id, c.email, c.first_name FROM customers c
      WHERE lower(c.email) = ?
        AND (EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED'))
             OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.customer_id = c.id))
      LIMIT 1
    `).bind(email).first();
}

// POST /api/account/sign-in {email}
async function handleSignIn(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body?.email);
  const answer = privateJson({ ok: true, message: "If that email has bought from Menu-Made, a sign-in link is on its way. It works once, for 20 minutes." });
  if (!email || !looksLikeEmail(email) || email.length > 150) {
    return privateJson({ ok: false, error: "Enter the email address you used at checkout." }, 400);
  }
  const buyer = await findBuyer(env, email);
  if (!buyer) return answer;
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM account_sign_ins WHERE email = ? AND created_at > ?`).bind(email, hourAgo).first();
  if (Number(recent?.n || 0) >= MAX_SIGN_INS_PER_HOUR) return answer;
  const sent = await sendSignInLink(env, buyer, email);
  return sent.ok ? answer : privateJson({ ok: false, error: "We couldn't send the email just now. Please try again in a minute." }, 502);
}

async function sendSignInLink(env, buyer, email) {
  const id = crypto.randomUUID();
  const now = nowIso();
  const expires = new Date(Date.now() + SIGN_IN_MINUTES * 60e3).toISOString();
  await env.DB.prepare(`INSERT INTO account_sign_ins (id, customer_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, buyer.id, email, now, expires).run();
  const token = await signLinkToken(env, { kind: SIGN_IN_KIND, id, ttlDays: SIGN_IN_MINUTES / 1440 });
  const link = `${publicBaseUrl(env)}/api/account/open/${id}?t=${encodeURIComponent(token)}`;
  const result = await sendTransactionalEmail(env, {
    to: email,
    subject: "Your Menu-Made sign-in link",
    html: brandedEmailHtml({
      preheader: "Sign in to see your plans, orders and deliveries.",
      eyebrow: "Your account",
      heading: "Sign in to Menu-Made",
      paragraphs: [
        "Use the button below to open your account: your plans, orders, deliveries and the links to make changes.",
        `It works once and expires in ${SIGN_IN_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`
      ],
      buttons: [{ label: "Sign in", url: link, primary: true }]
    }),
    text: `Sign in to your Menu-Made account (works once, expires in ${SIGN_IN_MINUTES} minutes):\n${link}\n\nIf you didn't ask for this, ignore this email.`,
    idempotencyKey: `account-sign-in/${id}`,
    purpose: "ACCOUNT_SIGN_IN",
    templateKey: "account_sign_in_v1",
    context: { customerId: buyer.id }
  }).catch((error) => ({ ok: false, error: error.message }));
  return { ...result, id, link };
}

function expiredPage() {
  return simplePage(410, "This sign-in link has expired",
    `<p>Sign-in links work once, for ${SIGN_IN_MINUTES} minutes.</p><p><a class="btn" href="/account.html">Send a new link</a></p>`);
}

// GET shows a button (so email scanners that open links can't use it up); POST signs in.
async function handleOpen(request, env, signInId) {
  const url = new URL(request.url);
  const form = request.method === "POST" ? await request.formData().catch(() => null) : null;
  const token = form ? form.get("t") : url.searchParams.get("t");
  const payload = await verifyLinkToken(env, String(token || ""), [SIGN_IN_KIND], signInId);
  if (!payload || payload.expired) return expiredPage();
  const row = await env.DB.prepare(`SELECT * FROM account_sign_ins WHERE id = ?`).bind(signInId).first();
  if (!row || row.used_at || row.expires_at <= nowIso()) return expiredPage();
  if (request.method !== "POST") {
    return simplePage(200, "Sign in to Menu-Made",
      `<p>Signing in as <strong>${escapeHtml(row.email)}</strong>.</p><form method="post"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">Sign in</button></form>`);
  }
  const used = await env.DB.prepare(`UPDATE account_sign_ins SET used_at = ? WHERE id = ? AND used_at IS NULL`).bind(nowIso(), signInId).run();
  if (!used.meta?.changes) return expiredPage();
  const session = await createSession(env, row.customer_id);
  return new Response(null, {
    status: 303,
    headers: { Location: `${publicBaseUrl(env)}/account.html`, "Set-Cookie": cookieHeader(session.cookie, SESSION_DAYS * 86400), "Cache-Control": "no-store" }
  });
}

async function createSession(env, customerId) {
  const id = crypto.randomUUID();
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare(`INSERT INTO account_sessions (id, customer_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, customerId, now, expires, now).run();
  const token = await signLinkToken(env, { kind: SESSION_KIND, id, ttlDays: SESSION_DAYS });
  return { id, cookie: `${id}.${token}` };
}

async function currentSession(request, env) {
  const raw = readCookie(request);
  if (!raw) return null;
  const dot = raw.indexOf(".");
  const id = dot > 0 ? raw.slice(0, dot) : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const payload = await verifyLinkToken(env, raw.slice(dot + 1), [SESSION_KIND], id);
  if (!payload || payload.expired) return null;
  const session = await env.DB.prepare(`SELECT * FROM account_sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`).bind(id, nowIso()).first();
  return session || null;
}

// POST /api/account/sign-out
async function handleSignOut(request, env) {
  const session = await currentSession(request, env);
  if (session) await env.DB.prepare(`UPDATE account_sessions SET revoked_at = ? WHERE id = ?`).bind(nowIso(), session.id).run();
  return privateJson({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
}

// GET /api/account/me
async function handleMe(request, env) {
  const session = await currentSession(request, env);
  if (!session) return privateJson({ ok: false, signed_in: false }, 401);
  await env.DB.prepare(`UPDATE account_sessions SET last_seen_at = ? WHERE id = ?`).bind(nowIso(), session.id).run();
  return privateJson({ ok: true, signed_in: true, ...(await accountSummary(env, session.customer_id)) });
}

const link = (label, url) => ({ label, url });

async function planSummary(env, sub) {
  const includes = ((await env.DB.prepare(`SELECT DISTINCT entitlement_type AS code FROM entitlements WHERE subscription_id = ?`).bind(sub.id).all()).results || [])
    .map((row) => row.code);
  const codes = includes.length ? includes : [sub.offer_code].filter(Boolean);
  const live = ["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status);
  const links = [link("Manage billing or switch plan", await billingPortalLink(env, sub.id))];
  let google = null;
  if (live) {
    links.push(link("Plan settings", await settingsLink(env, sub.id)));
    if (codes.includes("MENU_CARE")) links.push(link("Request menu changes", await menuCareLink(env, sub.id)));
    if (codes.includes("WEBSITE_CARE")) links.push(link("Request website changes", await siteCareLink(env, sub.id)));
    if (codes.includes("GOOGLE_PROFILE_CARE")) links.push(link("Add photos to your library", await photoLibraryLink(env, sub.id)));
    if (codes.includes("GUEST_APP") && sub.business_id) {
      const app = await loadLiveApp(env, { businessId: sub.business_id }).catch(() => null);
      if (app?.id) {
        links.push(link("Update your Guest App", await updateLink(env, app.id)));
        links.push(link("Send a notification to your guests", await appPushLink(env, app.id)));
        links.push(link("Rewards counter screen", await appCounterLink(env, app.id)));
      }
    }
    if (codes.some((code) => GOOGLE_CODES.has(code))) {
      const connection = await activeConnection(env, sub.id);
      google = connection ? { connected: true, profile: connection.location_title || null } : { connected: false };
      links.push(link(connection ? "Reconnect or change Google profile" : "Connect your Google profile", await googleConnectUrl(env, sub.id)));
    }
  }
  return {
    id: sub.id,
    name: sub.offer_name || "Plan",
    status: sub.status,
    interval: sub.billing_interval,
    amount_cents: sub.amount_cents === null ? null : Number(sub.amount_cents),
    currency: sub.currency || "USD",
    renews_at: sub.current_period_end,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    trial_ends_at: sub.trial_ends_at,
    includes: codes,
    google,
    links
  };
}

async function orderActions(env, orderId) {
  const projects = (await env.DB.prepare(`
      SELECT p.id, p.status, p.metadata_json, o.code AS offer_code
      FROM projects p LEFT JOIN order_items oi ON oi.id = p.order_item_id LEFT JOIN offers o ON o.id = oi.offer_id
      WHERE p.order_id = ?
    `).bind(orderId).all()).results || [];
  const actions = [];
  for (const project of projects) {
    const done = ["DELIVERED", "COMPLETED", "CANCELLED", "FAILED"].includes(project.status);
    if (done) continue;
    const meta = parseJsonOrNull(project.metadata_json) || {};
    if (meta.page_billing?.status === "PAYMENT_REQUIRED") {
      const token = await signLinkToken(env, { kind: "extra_pages", id: project.id, ttlDays: 30 });
      actions.push(link("Pay for the extra menu pages", `${publicBaseUrl(env)}/api/extra-pages/${project.id}?t=${encodeURIComponent(token)}`));
    }
    if (project.offer_code === "WEBSITE_PACKAGE" && project.status === "AWAITING_INPUTS") {
      actions.push(link("Tell us about your website", await siteIntakeLink(env, project.id)));
    }
    if (project.offer_code === "GUEST_APP_SETUP" && project.status === "AWAITING_INPUTS") {
      actions.push(link("Fill in your Guest App details", await appIntakeLink(env, project.id)));
    }
    if (project.offer_code === "GOOGLE_VISIBILITY" && !(await activeConnection(env, project.id))) {
      actions.push(link("Connect your Google profile", await googleConnectUrl(env, project.id)));
    }
  }
  return actions;
}

async function accountSummary(env, customerId) {
  const customer = await env.DB.prepare(`SELECT id, email, first_name, last_name FROM customers WHERE id = ?`).bind(customerId).first();
  const businesses = (await env.DB.prepare(`
      SELECT DISTINCT b.id, b.name FROM businesses b
      WHERE b.id IN (SELECT business_id FROM customer_businesses WHERE customer_id = ?)
         OR b.id IN (SELECT business_id FROM orders WHERE customer_id = ? AND business_id IS NOT NULL)
         OR b.id IN (SELECT business_id FROM subscriptions WHERE customer_id = ?)
      ORDER BY b.name
    `).bind(customerId, customerId, customerId).all()).results || [];
  const businessList = [];
  for (const business of businesses) {
    const menu = await hostedMenu(env, business.id).catch(() => null);
    const website = await liveWebsite(env, business.id).catch(() => null);
    const app = await loadLiveApp(env, { businessId: business.id }).catch(() => null);
    // Online Menu + QR without Menu Care: say when the menu goes (or went) offline and offer the Menu Care link.
    let menuHosting = null;
    if (menu) {
      const state = await menuHostingState(env, business.id).catch(() => null);
      const soon = state?.coveredUntil && Date.parse(state.coveredUntil) - Date.now() < 45 * 864e5;
      if (state?.menuQrProjectId && ["covered", "grace", "offline"].includes(state.reason) && (soon || state.reason !== "covered")) {
        menuHosting = { status: state.reason === "offline" ? "OFFLINE" : "ENDING", offline_at: state.offlineAt, renew_url: await renewalLink(env, state.menuQrProjectId) };
      }
    }
    businessList.push({ id: business.id, name: business.name, menu: menu || null, menu_hosting: menuHosting, website: website || null, app: app?.slug ? appUrl(env, app.slug) : null });
  }

  const subs = (await env.DB.prepare(`
      SELECT s.*, o.name AS offer_name, o.code AS offer_code FROM subscriptions s LEFT JOIN offers o ON o.id = s.offer_id
      WHERE s.customer_id = ? ORDER BY s.created_at DESC
    `).bind(customerId).all()).results || [];
  const plans = [];
  for (const sub of subs) plans.push(await planSummary(env, sub));

  const orderRows = (await env.DB.prepare(`
      SELECT o.id, o.created_at, o.placed_at, o.status, o.total_cents, o.currency, o.stripe_checkout_session_id,
             (SELECT group_concat(of.name, ', ') FROM order_items oi JOIN offers of ON of.id = oi.offer_id WHERE oi.order_id = o.id) AS items
      FROM orders o
      WHERE o.customer_id = ?
        AND o.payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
        AND COALESCE(o.notes, '') NOT LIKE 'Subscription % period %'
      ORDER BY o.created_at DESC LIMIT 50
    `).bind(customerId).all()).results || [];
  const orders = [];
  for (const order of orderRows) {
    orders.push({
      id: order.id,
      date: order.placed_at || order.created_at,
      items: order.items || "",
      total_cents: Number(order.total_cents || 0),
      currency: order.currency || "USD",
      status: order.status,
      test: String(order.stripe_checkout_session_id || "").startsWith("cs_test_"),
      actions: await orderActions(env, order.id)
    });
  }

  const deliverableRows = (await env.DB.prepare(`
      SELECT d.id, d.deliverable_type, d.delivered_at, d.created_at, d.expires_at, of.name AS product
      FROM deliverables d JOIN projects p ON p.id = d.project_id
      LEFT JOIN order_items oi ON oi.id = p.order_item_id LEFT JOIN offers of ON of.id = oi.offer_id
      WHERE p.customer_id = ? AND d.status = 'FINAL' AND d.customer_visible = 1
        AND (d.expires_at IS NULL OR d.expires_at > ?)
      ORDER BY COALESCE(d.delivered_at, d.created_at) DESC LIMIT 40
    `).bind(customerId, nowIso()).all()).results || [];
  const deliveries = [];
  for (const row of deliverableRows) {
    const token = await signLinkToken(env, { kind: "deliver", id: row.id, ttlDays: DELIVERY_LINK_TTL_DAYS });
    deliveries.push({
      id: row.id,
      label: DELIVERABLE_LABELS[row.deliverable_type] || row.deliverable_type,
      product: row.product || null,
      date: row.delivered_at || row.created_at,
      url: `${publicBaseUrl(env)}/api/delivery/${row.id}?t=${encodeURIComponent(token)}`
    });
  }
  return {
    email: customer?.email || null,
    name: [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || null,
    businesses: businessList,
    plans,
    orders,
    deliveries,
    billing_login: BILLING_LOGIN_URL
  };
}

export { COOKIE, accountSummary, createSession, handleMe, handleOpen, handleSignIn, handleSignOut, sendSignInLink };
