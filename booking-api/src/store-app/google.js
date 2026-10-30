// Stage 11 part 2: talking to Google with a service account (the JSON key file Firebase or Google Cloud gives out).
//   OAuth: a JWT (RS256, iss = the account's email) traded at Google's token endpoint for a one-hour access token.
//   Firebase Cloud Messaging (FCM HTTP v1): Android push. Plain HTTPS, so the worker sends it itself (unlike Apple).
//   Google Play Developer API: the checks here only open and discard an "edit"; uploads run in the GitHub build.
// The checks are what the Google upload page runs before it reports a file as working.
import { base64UrlEncode } from "../lib/links.js";

const enc = new TextEncoder();
const b64json = (value) => base64UrlEncode(enc.encode(JSON.stringify(value)));
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const PLAY_API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

// A service account key file's text -> { client_email, private_key, project_id, token_uri } or null.
function parseServiceAccount(text) {
  let data;
  try { data = JSON.parse(String(text || "")); } catch { return null; }
  if (!data || data.type !== "service_account") return null;
  const email = String(data.client_email || "");
  if (!/^[^@\s]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/i.test(email) || !/-----BEGIN PRIVATE KEY-----/.test(data.private_key || "")) return null;
  const tokenUri = data.token_uri || "https://oauth2.googleapis.com/token";
  if (!/^https:\/\/oauth2\.googleapis\.com\//.test(tokenUri)) return null;
  return { client_email: email, private_key: data.private_key, project_id: String(data.project_id || ""), token_uri: tokenUri };
}

// google-services.json (the Firebase Android app config; it ships inside the app, so it is not secret) -> summary or null.
function parseGoogleServices(text) {
  let data;
  try { data = JSON.parse(String(text || "")); } catch { return null; }
  const projectId = data?.project_info?.project_id;
  const packages = (data?.client || []).map((c) => c?.client_info?.android_client_info?.package_name).filter(Boolean);
  if (!projectId || !packages.length) return null;
  return { projectId: String(projectId), packages };
}

async function importRsa(pem) {
  const m = /-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s\\n]+)-----END PRIVATE KEY-----/.exec(String(pem || ""));
  if (!m) throw new Error("not a service account key");
  const der = Uint8Array.from(atob(m[1].replace(/\\n/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

// Access tokens last an hour; one per account and scope is reused for 50 minutes in this isolate.
const tokenCache = new Map();
async function accessToken(sa, scope, { fetchImpl = fetch, now = Date.now() } = {}) {
  const cacheKey = `${sa.client_email} ${scope}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.until > now) return hit.token;
  const iat = Math.floor(now / 1000);
  const input = `${b64json({ alg: "RS256", typ: "JWT" })}.${b64json({ iss: sa.client_email, scope, aud: sa.token_uri, iat, exp: iat + 3600 })}`;
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importRsa(sa.private_key), enc.encode(input)));
  const response = await fetchImpl(sa.token_uri, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${input}.${base64UrlEncode(sig)}`
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error(`Google refused the key: ${data.error_description || data.error || response.status}`);
    error.auth = true;
    throw error;
  }
  tokenCache.set(cacheKey, { token: data.access_token, until: now + 50 * 60000 });
  return data.access_token;
}

const errorOf = (data) => ({ status: data?.error?.status || "", message: String(data?.error?.message || ""), code: (data?.error?.details || []).map((d) => d.errorCode).find(Boolean) || "" });

// One Android notification. -> { ok, status, gone, keyProblem, reason }
async function fcmSend(sa, projectId, token, { title, body, tag }, { fetchImpl = fetch, validateOnly = false } = {}) {
  const bearer = await accessToken(sa, FCM_SCOPE, { fetchImpl });
  const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(validateOnly ? { validate_only: true } : {}),
      message: { token, notification: { title, body }, data: { tag: String(tag || "") }, android: { priority: "HIGH", ...(tag ? { collapse_key: String(tag).slice(0, 64) } : {}) } }
    })
  });
  if (response.ok) return { ok: true, status: 200, gone: false, keyProblem: false, reason: "" };
  const err = errorOf(await response.json().catch(() => ({})));
  const reason = err.code || err.status || String(response.status);
  // UNREGISTERED (404) or a token from another Firebase project: this phone will never get it. A malformed token is
  // INVALID_ARGUMENT with the token named in the message.
  const gone = response.status === 404 || err.code === "UNREGISTERED" || err.code === "SENDER_ID_MISMATCH" || (err.code === "INVALID_ARGUMENT" && /token/i.test(err.message));
  const keyProblem = response.status === 401 || (response.status === 403 && err.code !== "SENDER_ID_MISMATCH");
  return { ok: false, status: response.status, gone, keyProblem, reason, message: err.message.slice(0, 160) };
}

// Upload page check: a dry-run send to a token that can't exist. INVALID_ARGUMENT about the token = the key works.
async function checkFirebase(sa, projectId, { fetchImpl = fetch } = {}) {
  try {
    const out = await fcmSend(sa, projectId, "menu-made-key-check", { title: "Check", body: "Check" }, { fetchImpl, validateOnly: true });
    if (out.ok || out.gone || out.reason === "INVALID_ARGUMENT") return { ok: true, note: "The key works and can send notifications for this Firebase project." };
    if (/has not been used|is disabled/i.test(out.message || "")) return { ok: false, note: "Firebase Cloud Messaging API is turned off for this project. Turn it on (step 3 of the checklist), wait a minute, then check again." };
    return { ok: false, note: `Google answered ${out.status} (${out.reason}). Check that the file is this Firebase project's service account key.` };
  } catch (error) {
    return error.auth ? { ok: false, note: error.message } : { ok: null, note: "Google couldn't be reached to check it. It was saved; check again in a minute." };
  }
}

// Upload page check: open an edit for the app and throw it away.
async function checkPlay(sa, packageName, { fetchImpl = fetch } = {}) {
  try {
    const bearer = await accessToken(sa, PLAY_SCOPE, { fetchImpl });
    const response = await fetchImpl(`${PLAY_API}/${packageName}/edits`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: "{}" });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      if (data.id) await fetchImpl(`${PLAY_API}/${packageName}/edits/${data.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${bearer}` } }).catch(() => null);
      return { ok: true, firstUpload: false, note: `Google Play access works for ${packageName}.` };
    }
    const err = errorOf(data);
    if (response.status === 404) return { ok: null, firstUpload: true, note: `Saved. Google Play doesn't know ${packageName} yet: that's expected until the first build is uploaded by hand (the build emails it to you).` };
    if (/has not been used|is disabled/i.test(err.message)) return { ok: false, firstUpload: false, note: "Google Play Android Developer API is turned off for this project. Turn it on (step 4 of the checklist), wait a minute, then check again." };
    if (response.status === 403) return { ok: false, firstUpload: false, note: "Google Play refused this account. Invite its email in Play Console, Users and permissions (step 5 of the checklist), then check again." };
    return { ok: false, firstUpload: false, note: `Google Play answered ${response.status} (${err.status || "error"}).` };
  } catch (error) {
    return error.auth ? { ok: false, firstUpload: false, note: error.message } : { ok: null, firstUpload: false, note: "Google couldn't be reached to check it. It was saved; check again in a minute." };
  }
}

export { FCM_SCOPE, PLAY_SCOPE, accessToken, checkFirebase, checkPlay, fcmSend, parseGoogleServices, parseServiceAccount, tokenCache };
