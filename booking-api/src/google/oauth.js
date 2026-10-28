// Stage 5: Google OAuth for Business Profile access (scope business.manage).
// Client: Google Cloud project menu-made-gbp, web client "menu-checkout worker", redirect /api/google/callback.
// Worker secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Refresh tokens are stored AES-GCM encrypted with a key
// derived from PRODUCTION_RUNNER_SECRET, so a database leak alone does not expose them.
import { publicBaseUrl } from "../lib/config.js";
import { base64UrlDecode, base64UrlEncode, signLinkToken, verifyLinkToken } from "../lib/links.js";

const SCOPE = "https://www.googleapis.com/auth/business.manage";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const STATE_KIND = "gstate";
const STATE_TTL_DAYS = 1 / 24; // the Google consent screen has an hour to come back

class GoogleAuthError extends Error {
  constructor(message, { reconnect = false, status = 0 } = {}) { super(message); this.reconnect = reconnect; this.status = status; }
}

function googleConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: `${publicBaseUrl(env)}/api/google/callback` };
}

// The state carries the subscription id (or "owner") and is signed, so the callback knows whose profile it is.
async function buildAuthUrl(env, subscriptionId, { loginHint } = {}) {
  const config = googleConfig(env);
  if (!config) throw new GoogleAuthError("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set on the worker");
  const state = await signLinkToken(env, { kind: STATE_KIND, id: subscriptionId, ttlDays: STATE_TTL_DAYS });
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // always returns a refresh token, even when the account approved before
    include_granted_scopes: "true",
    state
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${AUTH_ENDPOINT}?${params}`;
}

// Returns the subscription id the state was signed for, or null.
async function readState(env, state) {
  if (typeof state !== "string" || !state.includes(".")) return null;
  let claimed;
  try { claimed = JSON.parse(new TextDecoder().decode(base64UrlDecode(state.split(".")[0]))).i; } catch { return null; }
  if (typeof claimed !== "string") return null;
  const payload = await verifyLinkToken(env, state, [STATE_KIND], claimed);
  return payload && !payload.expired ? claimed : null;
}

async function tokenRequest(env, body, fetchImpl) {
  const config = googleConfig(env);
  if (!config) throw new GoogleAuthError("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set on the worker");
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...body })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data.error_description || data.error || `HTTP ${response.status}`;
    // invalid_grant: the customer revoked access, changed their password, or the token expired. Only reconnecting fixes it.
    throw new GoogleAuthError(`Google token request failed: ${reason}`, { reconnect: data.error === "invalid_grant", status: response.status });
  }
  return data;
}

async function exchangeCode(env, code, fetchImpl = fetch) {
  const config = googleConfig(env);
  const data = await tokenRequest(env, { code, grant_type: "authorization_code", redirect_uri: config?.redirectUri || "" }, fetchImpl);
  const scopes = String(data.scope || "").split(/\s+/);
  if (!scopes.includes(SCOPE)) throw new GoogleAuthError("Google did not grant permission to manage the Business Profile");
  if (!data.refresh_token) throw new GoogleAuthError("Google did not return a refresh token");
  return { accessToken: data.access_token, refreshToken: data.refresh_token, scope: data.scope };
}

async function refreshAccessToken(env, refreshToken, fetchImpl = fetch) {
  const data = await tokenRequest(env, { refresh_token: refreshToken, grant_type: "refresh_token" }, fetchImpl);
  if (!data.access_token) throw new GoogleAuthError("Google returned no access token");
  return data.access_token;
}

async function tokenKey(env) {
  if (!env.PRODUCTION_RUNNER_SECRET) throw new Error("PRODUCTION_RUNNER_SECRET is not configured");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`menu-made-google-token-v1:${env.PRODUCTION_RUNNER_SECRET}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptToken(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), new TextEncoder().encode(plain)));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(sealed)}`;
}

async function decryptToken(env, sealed) {
  const parts = String(sealed || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Stored Google token is not readable");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlDecode(parts[1]) }, await tokenKey(env), base64UrlDecode(parts[2]));
  return new TextDecoder().decode(plain);
}

export {
  SCOPE,
  GoogleAuthError,
  googleConfig,
  buildAuthUrl,
  readState,
  exchangeCode,
  refreshAccessToken,
  encryptToken,
  decryptToken
};
