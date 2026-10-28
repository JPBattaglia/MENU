// Stage 5: the customer connects their Google Business Profile.
//   GET  /api/google/connect/<subscriptionId>?t=<token>   explainer page with a "Connect Google" button
//   GET  /api/google/connect/owner                        owner's own profile (admin token form, POST redirects)
//   GET  /api/google/callback?code&state                   Google returns here; stores the encrypted grant
//   POST /api/google/location/<connectionId>               the customer picks one profile when the account has several
// The signed link (kind "gconnect") is the customer's only credential; the OAuth state is signed separately.
import { constantTimeEqual } from "../admin/queue.js";
import { publicBaseUrl } from "../lib/config.js";
import { escapeHtml } from "../lib/email.js";
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

async function subscriptionFor(env, subscriptionId) {
  if (subscriptionId === OWNER) return { id: OWNER, business_id: null, customer_id: null, status: "ACTIVE" };
  return env.DB.prepare(`SELECT id, business_id, customer_id, status FROM subscriptions WHERE id = ?`).bind(subscriptionId).first();
}

async function handleGoogleConnect(request, env, subscriptionId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  if (!googleConfig(env)) return unavailable();
  if (subscriptionId === OWNER) {
    if (!env.ADMIN_API_TOKEN) return simplePage(503, "Not set up", "<p>ADMIN_API_TOKEN is missing on the worker.</p>");
    if (request.method === "GET") {
      return simplePage(200, "Connect the Menu-Made profile", `<p>This connects your own Google Business Profile, which the daily Google check uses.</p>
<form method="post" action="/api/google/connect/owner"><label for="token">Admin token</label><br><input id="token" name="token" type="password" autocomplete="current-password" required style="width:100%;margin:8px 0"><br><button type="submit">Continue to Google</button></form>`);
    }
    let supplied = "";
    try { supplied = String((await request.formData()).get("token") || "").trim(); } catch { supplied = ""; }
    if (!supplied || !constantTimeEqual(supplied, env.ADMIN_API_TOKEN)) return simplePage(401, "Not authorized", "<p>That admin token isn't right.</p>");
    return redirect(await buildAuthUrl(env, OWNER));
  }
  const token = new URL(request.url).searchParams.get("t") || "";
  const payload = await verifyLinkToken(env, token, [CONNECT_KIND], subscriptionId);
  if (!payload || payload.expired) return expired();
  const subscription = await subscriptionFor(env, subscriptionId);
  if (!subscription || !PRODUCING.has(subscription.status)) return simplePage(403, "Your plan isn't active", "<p>Reply to your last email and we'll help.</p>");
  const existing = await env.DB.prepare(`SELECT status, location_title FROM google_connections WHERE subscription_id = ?`).bind(subscriptionId).first();
  const already = existing?.status === "ACTIVE"
    ? `<p><strong>Connected:</strong> ${escapeHtml(existing.location_title || "your profile")}. Connect again only to switch profiles or after a Google password change.</p>` : "";
  return simplePage(200, "Connect your Google Business Profile", `${already}
<p>We reply to your reviews and post updates on your Google profile, so we need permission to manage it. Sign in with the Google account that manages your business listing.</p>
<p><a class="btn" href="${escapeHtml(await buildAuthUrl(env, subscriptionId))}">Connect Google</a></p>
<p style="font-size:13px">You can remove access at any time in your Google Account under Security, Third-party connections.</p>`);
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
<p>Your Google account manages more than one Business Profile. Pick the one this plan is for.</p>
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
    return simplePage(200, "No Business Profile on that account", "<p>That Google account doesn't manage a Business Profile. Use the link again and sign in with the account that manages your business on Google Maps.</p>");
  }
  if (profiles.length === 1) {
    const [p] = profiles;
    const connection = await saveConnection(env, subscription, { ...base, status: "ACTIVE", account: p.account, location: p.location, title: p.title });
    await recordEvent(env, connection, "GOOGLE_CONNECTED", { subscription_id: subscription.id, location: p.location });
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
  return connectedPage(pick.title);
}

async function activeConnection(env, subscriptionId) {
  return env.DB.prepare(`SELECT * FROM google_connections WHERE subscription_id = ? AND status = 'ACTIVE'`).bind(subscriptionId).first();
}

export { OWNER, CONNECT_KIND, googleConnectUrl, handleGoogleConnect, handleGoogleCallback, handleGoogleLocation, activeConnection };
