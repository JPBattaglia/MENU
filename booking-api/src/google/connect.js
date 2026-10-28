// Stage 5: the customer connects their Google Business Profile.
//   GET  /api/google/connect/<subscriptionId>?t=<token>   explainer page with a "Connect Google" button
//   GET  /api/google/connect/owner                        owner's own profile (POST emails a one-hour link to the owner inbox)
//   GET  /api/google/callback?code&state                   Google returns here; stores the encrypted grant
//   POST /api/google/location/<connectionId>               the customer picks one profile when the account has several
// The signed link (kind "gconnect") is the customer's only credential; the OAuth state is signed separately.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { PRODUCING } from "../subscriptions/sync.js";
import { listProfiles } from "./api.js";
import { buildAuthUrl, encryptToken, exchangeCode, GoogleAuthError, googleConfig, readState } from "./oauth.js";

const CONNECT_KIND = "gconnect";
const LOCATION_KIND = "glocation";
const CONNECT_TTL_DAYS = 30;
const OWNER = "owner";

async function googleConnectUrl(env, subscriptionId) {
  const token = await signLinkToken(env, { kind: CONNECT_KIND, id: subscriptionId, ttlDays: CONNECT_TTL_DAYS });
  return `${publicBaseUrl(env)}/api/google/connect/${subscriptionId}?t=${encodeURIComponent(token)}`;
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

const unavailable = () => simplePage(503, "Google connection isn't ready", "<p>We're finishing setup on our side. Reply to your last email and we'll let you know when it's ready.</p>");
const expired = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest Menu-Made email and we'll send a fresh link.</p>");

// Who a connection belongs to: a subscription, the owner, or (Google Visibility, a one-time order with no subscription)
// the order's project, which counts as active until it is delivered or cancelled.
async function subscriptionFor(env, subscriptionId) {
  if (subscriptionId === OWNER) return { id: OWNER, business_id: null, customer_id: null, status: "ACTIVE" };
  const subscription = await env.DB.prepare(`SELECT id, business_id, customer_id, status FROM subscriptions WHERE id = ?`).bind(subscriptionId).first();
  if (subscription) return subscription;
  const project = await env.DB.prepare(`SELECT id, business_id, customer_id, status FROM projects WHERE id = ? AND workflow_key = 'GOOGLE_VISIBILITY_V1'`).bind(subscriptionId).first();
  if (!project) return null;
  return { id: project.id, business_id: project.business_id, customer_id: project.customer_id, status: ["DELIVERED", "COMPLETED", "CANCELLED"].includes(project.status) ? "ENDED" : "ACTIVE", visibility: true };
}

async function handleGoogleConnect(request, env, subscriptionId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  if (!googleConfig(env)) return unavailable();
  if (subscriptionId === OWNER) return handleOwnerConnect(request, env);
  const token = new URL(request.url).searchParams.get("t") || "";
  const payload = await verifyLinkToken(env, token, [CONNECT_KIND], subscriptionId);
  if (!payload || payload.expired) return expired();
  const subscription = await subscriptionFor(env, subscriptionId);
  if (!subscription || !PRODUCING.has(subscription.status)) return simplePage(403, "Your plan isn't active", "<p>Reply to your last email and we'll help.</p>");
  const existing = await env.DB.prepare(`SELECT status, location_title FROM google_connections WHERE subscription_id = ?`).bind(subscriptionId).first();
  const already = existing?.status === "ACTIVE"
    ? `<p><strong>Connected:</strong> ${escapeHtml(existing.location_title || "your profile")}. Connect again only to switch profiles or after a Google password change.</p>` : "";
  const why = subscription.visibility
    ? "We check every detail of your Google profile and fill in what's missing, so we need permission to manage it."
    : "We reply to your reviews and post updates on your Google profile, so we need permission to manage it.";
  return simplePage(200, "Connect your Google Business Profile", `${already}
<p>${why} Sign in with the Google account that manages your business listing.</p>
<p><a class="btn" href="${escapeHtml(await buildAuthUrl(env, subscriptionId))}">Connect Google</a></p>
<p style="font-size:13px">You can remove access at any time in your Google Account under Security, Third-party connections.</p>`);
}

// The owner's own profile: no token to remember. The page emails a one-hour signed link to the owner inbox
// (OWNER_EMAIL, else info@menu-made.com); opening that link goes straight to Google.
const OWNER_LINK_TTL_DAYS = 1 / 24;

async function handleOwnerConnect(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  if (request.method === "GET" && token) {
    const payload = await verifyLinkToken(env, token, [CONNECT_KIND], OWNER);
    if (!payload || payload.expired) return simplePage(403, "This link has expired", `<p>Open <a href="/api/google/connect/owner">the connect page</a> again to get a fresh one.</p>`);
    return redirect(await buildAuthUrl(env, OWNER));
  }
  const inbox = ownerEmailAddress(env);
  if (request.method === "GET") {
    return simplePage(200, "Connect the Menu-Made profile", `<p>This connects your own Google Business Profile, which the daily Google check uses.</p>
<p>We'll email a sign-in link to <strong>${escapeHtml(inbox)}</strong>. It works for one hour.</p>
<form method="post" action="/api/google/connect/owner"><button type="submit">Email me the link</button></form>`);
  }
  const link = `${publicBaseUrl(env)}/api/google/connect/owner?t=${encodeURIComponent(await signLinkToken(env, { kind: CONNECT_KIND, id: OWNER, ttlDays: OWNER_LINK_TTL_DAYS }))}`;
  const bucket = Math.floor(Date.now() / 600000); // at most one email per 10 minutes, whoever presses the button
  const sent = await sendTransactionalEmail(env, {
    to: inbox,
    subject: "Connect the Menu-Made Google profile",
    html: brandedEmailHtml({ preheader: "One-hour link to connect your Google Business Profile.", eyebrow: "GOOGLE", heading: "Connect your Google profile",
      paragraphs: ["Open this link and sign in with the Google account that manages the Menu-Made Business Profile. It works for one hour.",
        "If you didn't ask for this, ignore it; nothing changes until someone signs in with Google."],
      buttons: [{ label: "Connect Google", url: link, primary: true }] }),
    text: `Connect the Menu-Made Google profile (link works for one hour):\n${link}`,
    idempotencyKey: `google-owner-link/${bucket}`, purpose: "OWNER_ACTION", templateKey: "google_owner_link_v1"
  }).catch((error) => ({ ok: false, error }));
  if (!sent?.ok) return simplePage(502, "The email didn't send", "<p>Please try again in a minute.</p>");
  return simplePage(200, "Check your email", `<p>We sent the link to <strong>${escapeHtml(inbox)}</strong>. If you pressed the button a moment ago, the earlier email is the one to use.</p>`);
}

async function saveConnection(env, subscription, fields) {
  const t = nowIso();
  const id = crypto.randomUUID();
  await env.DB.prepare(`
      INSERT INTO google_connections (id, subscription_id, business_id, customer_id, status, refresh_token_enc, scope, account_name, location_name,
        location_title, candidates_json, last_error, connected_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(subscription_id) DO UPDATE SET status = excluded.status, refresh_token_enc = excluded.refresh_token_enc, scope = excluded.scope,
        account_name = excluded.account_name, location_name = excluded.location_name, location_title = excluded.location_title,
        candidates_json = excluded.candidates_json, last_error = NULL, connected_at = excluded.connected_at, updated_at = excluded.updated_at
    `).bind(id, subscription.id, subscription.business_id, subscription.customer_id, fields.status, fields.refreshTokenEnc, fields.scope,
    fields.account || null, fields.location || null, fields.title || null, fields.candidates ? JSON.stringify(fields.candidates) : null, t, t, t).run();
  return env.DB.prepare(`SELECT * FROM google_connections WHERE subscription_id = ?`).bind(subscription.id).first();
}

async function recordEvent(env, connection, eventType, payload) {
  await env.DB.prepare(`INSERT INTO business_events (id, event_type, entity_type, entity_id, actor_type, payload_json, created_at) VALUES (?, ?, 'GOOGLE_CONNECTION', ?, 'CUSTOMER', ?, ?)`)
    .bind(crypto.randomUUID(), eventType, connection.id, JSON.stringify(payload), nowIso()).run().catch(() => null);
}

const connectedPage = (title) => simplePage(200, "Google is connected", `<p><strong>${escapeHtml(title)}</strong> is connected to Menu-Made. You can close this page.</p>`);

async function choicePage(env, connection, { error = null } = {}) {
  const candidates = parseJsonOrNull(connection.candidates_json) || [];
  const token = await signLinkToken(env, { kind: LOCATION_KIND, id: connection.id, ttlDays: 1 });
  const options = candidates.map((c, i) => `<p><label><input type="radio" name="choice" value="${i}" ${i === 0 ? "checked" : ""}> <strong>${escapeHtml(c.title)}</strong>${c.address ? `<br><span style="font-size:13px">${escapeHtml(c.address)}</span>` : ""}</label></p>`).join("");
  return simplePage(error ? 400 : 200, "Which business is this for?", `${error ? `<p style="color:#9b1c1c"><strong>${escapeHtml(error)}</strong></p>` : ""}
<p>Your Google account manages more than one Business Profile. Pick the one this is for.</p>
<form method="post" action="/api/google/location/${escapeHtml(connection.id)}"><input type="hidden" name="t" value="${escapeHtml(token)}">${options}<button type="submit">Use this profile</button></form>`);
}

async function handleGoogleCallback(request, env, deps = {}) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  if (!googleConfig(env)) return unavailable();
  const fetchImpl = deps.fetch || fetch;
  const url = new URL(request.url);
  const subscriptionId = await readState(env, url.searchParams.get("state"));
  if (!subscriptionId) return simplePage(400, "This sign-in expired", "<p>Go back to the email we sent and tap the Connect Google link again.</p>");
  if (url.searchParams.get("error")) {
    return simplePage(200, "Google wasn't connected", "<p>No problem. Your link still works, so you can connect whenever you're ready.</p>");
  }
  const subscription = await subscriptionFor(env, subscriptionId);
  if (!subscription || !PRODUCING.has(subscription.status)) return simplePage(403, "Your plan isn't active", "<p>Reply to your last email and we'll help.</p>");
  let grant;
  let profiles;
  try {
    grant = await exchangeCode(env, url.searchParams.get("code") || "", fetchImpl);
    profiles = await listProfiles(grant.accessToken, fetchImpl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Google connect failed:", message);
    const hint = error instanceof GoogleAuthError && /permission/i.test(message)
      ? "<p>Google asks which permissions to give. Please connect again and leave <strong>See, edit, create and delete your Google business listings</strong> ticked.</p>"
      : "<p>Something went wrong talking to Google. Please try the link again in a few minutes.</p>";
    return simplePage(400, "Google wasn't connected", hint);
  }
  const base = { refreshTokenEnc: await encryptToken(env, grant.refreshToken), scope: grant.scope };
  if (profiles.length === 0) {
    const connection = await saveConnection(env, subscription, { ...base, status: "NO_PROFILE" });
    await recordEvent(env, connection, "GOOGLE_CONNECTED_NO_PROFILE", { subscription_id: subscription.id });
    return simplePage(200, "No Business Profile on that account", subscription.visibility
      ? `<p>That Google account doesn't manage a Business Profile yet. If you haven't made one, create it at <a href="https://business.google.com/create">business.google.com/create</a> and finish Google's verification, then use the link in our email again. If you already have one, sign in with the account that manages it.</p>`
      : "<p>That Google account doesn't manage a Business Profile. Use the link again and sign in with the account that manages your business on Google Maps.</p>");
  }
  if (profiles.length === 1) {
    const [p] = profiles;
    const connection = await saveConnection(env, subscription, { ...base, status: "ACTIVE", account: p.account, location: p.location, title: p.title });
    await recordEvent(env, connection, "GOOGLE_CONNECTED", { subscription_id: subscription.id, location: p.location });
    await releaseGoogleWaits(env, subscription.id).catch(() => 0);
    return connectedPage(p.title);
  }
  const connection = await saveConnection(env, subscription, { ...base, status: "PENDING_LOCATION", candidates: profiles.slice(0, 50) });
  return choicePage(env, connection);
}

async function handleGoogleLocation(request, env, connectionId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const payload = await verifyLinkToken(env, String(form.get("t") || ""), [LOCATION_KIND], connectionId);
  if (!payload || payload.expired) return simplePage(403, "This page expired", "<p>Use the Connect Google link in your email again.</p>");
  const connection = await env.DB.prepare(`SELECT * FROM google_connections WHERE id = ?`).bind(connectionId).first();
  if (!connection || connection.status !== "PENDING_LOCATION") return simplePage(409, "Already set", "<p>This connection is already set up.</p>");
  const candidates = parseJsonOrNull(connection.candidates_json) || [];
  const index = Number(form.get("choice"));
  const pick = Number.isInteger(index) ? candidates[index] : null;
  if (!pick) return choicePage(env, connection, { error: "Pick one of the profiles." });
  await env.DB.prepare(`UPDATE google_connections SET status = 'ACTIVE', account_name = ?, location_name = ?, location_title = ?, candidates_json = NULL, updated_at = ? WHERE id = ?`)
    .bind(pick.account, pick.location, pick.title, nowIso(), connectionId).run();
  await recordEvent(env, connection, "GOOGLE_CONNECTED", { subscription_id: connection.subscription_id, location: pick.location });
  await releaseGoogleWaits(env, connection.subscription_id).catch(() => 0);
  return connectedPage(pick.title);
}

// A producer step parked because the customer had not connected Google (or had to reconnect) continues on the next
// runner tick once the connection is ACTIVE again.
async function releaseGoogleWaits(env, subscriptionId) {
  const waiting = (await env.DB.prepare(`
      SELECT ws.id AS step_id, wr.id AS run_id FROM workflow_steps ws
      JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
      JOIN projects p ON p.id = wr.project_id
      WHERE ws.status = 'WAITING' AND json_extract(ws.output_json, '$.waiting_for') = 'GOOGLE_CONNECTION'
        AND (json_extract(p.metadata_json, '$.subscription_id') = ? OR json_extract(p.metadata_json, '$.google_subscription_id') = ?)
    `).bind(subscriptionId, subscriptionId).all()).results || [];
  for (const row of waiting) {
    await env.DB.prepare(`UPDATE workflow_steps SET status = 'QUEUED', error_message = NULL WHERE id = ? AND status = 'WAITING'`).bind(row.step_id).run();
    await env.DB.prepare(`UPDATE workflow_runs SET status = 'QUEUED', error_code = NULL, error_message = NULL WHERE id = ? AND status = 'WAITING'`).bind(row.run_id).run();
  }
  return waiting.length;
}

async function activeConnection(env, subscriptionId) {
  return env.DB.prepare(`SELECT * FROM google_connections WHERE subscription_id = ? AND status = 'ACTIVE'`).bind(subscriptionId).first();
}

export { OWNER, CONNECT_KIND, googleConnectUrl, handleGoogleConnect, handleGoogleCallback, handleGoogleLocation, activeConnection, releaseGoogleWaits };
