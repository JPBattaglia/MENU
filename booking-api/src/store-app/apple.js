// Stage 11 part 2: talking to Apple with the restaurant's (or Menu-made's) keys. Both keys are ES256 .p8 files.
//   App Store Connect API: a JWT (iss = issuer id, aud appstoreconnect-v1, at most 20 minutes) signed with the API key.
//   APNs (push): a JWT (iss = team id) signed with the push key, sent to api.push.apple.com over HTTP/2.
// The checks here are what the key upload page runs before it reports a key as working.
import { base64UrlEncode } from "../lib/links.js";

const ASC_API = "https://api.appstoreconnect.apple.com/v1";
const APNS_SANDBOX = "https://api.sandbox.push.apple.com";
const enc = new TextEncoder();
const b64json = (value) => base64UrlEncode(enc.encode(JSON.stringify(value)));

// A .p8 file's text -> a WebCrypto signing key, or null if it isn't an ES256 private key.
async function importP8(text) {
  const m = /-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----/.exec(String(text || ""));
  if (!m) return null;
  try {
    const der = Uint8Array.from(atob(m[1].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  } catch { return null; }
}

async function signJwt(key, header, payload) {
  const input = `${b64json(header)}.${b64json(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(input))); // raw r||s, as JWT wants
  return `${input}.${base64UrlEncode(sig)}`;
}

async function ascToken({ p8, keyId, issuerId }, now = Date.now()) {
  const key = await importP8(p8);
  if (!key) throw new Error("not an App Store Connect API key");
  const iat = Math.floor(now / 1000);
  return signJwt(key, { alg: "ES256", kid: keyId, typ: "JWT" }, { iss: issuerId, iat, exp: iat + 1200, aud: "appstoreconnect-v1" });
}

async function apnsToken({ p8, keyId, teamId }, now = Date.now()) {
  const key = await importP8(p8);
  if (!key) throw new Error("not an APNs key");
  return signJwt(key, { alg: "ES256", kid: keyId }, { iss: teamId, iat: Math.floor(now / 1000) });
}

// Checks the API key by reading the app's bundle id record. Returns { ok, teamId?, note }.
// The bundle id's seedId is the team id, so the owner never has to look it up.
async function checkApiKey(creds, bundleId, { fetchImpl = fetch } = {}) {
  let token;
  try { token = await ascToken(creds); } catch (error) { return { ok: false, note: String(error.message) }; }
  let res;
  try {
    res = await fetchImpl(`${ASC_API}/bundleIds?filter[identifier]=${encodeURIComponent(bundleId)}&fields[bundleIds]=identifier,seedId&limit=5`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) { return { ok: false, unreachable: true, note: `Apple couldn't be reached (${String(error?.message || error).slice(0, 80)})` }; }
  if (res.status === 401) return { ok: false, note: "Apple refused the key: check that the Issuer ID belongs to this key and the key wasn't revoked." };
  if (res.status === 403) return { ok: false, note: "Apple accepted the key but it can't read apps: give it Admin access, and accept any pending agreement in App Store Connect." };
  if (!res.ok) return { ok: false, note: `Apple answered ${res.status}.` };
  const data = await res.json().catch(() => ({}));
  const match = (data.data || []).find((b) => b.attributes?.identifier === bundleId);
  if (!match) return { ok: true, teamId: null, note: `The key works, but no App ID ${bundleId} was found. Register it under Identifiers.` };
  return { ok: true, teamId: match.attributes.seedId || null, note: `The key works and can see ${bundleId}.` };
}

// Checks the push key with a send to a device token that can't exist: Apple answers BadDeviceToken (400) when the
// key and team are right, InvalidProviderToken (403) when they aren't. Nothing reaches any phone.
async function checkPushKey(creds, bundleId, { fetchImpl = fetch } = {}) {
  let token;
  try { token = await apnsToken(creds); } catch (error) { return { ok: false, note: String(error.message) }; }
  let res;
  try {
    res = await fetchImpl(`${APNS_SANDBOX}/3/device/${"0".repeat(64)}`, {
      method: "POST",
      headers: { authorization: `bearer ${token}`, "apns-topic": bundleId, "apns-push-type": "alert", "apns-priority": "5", "content-type": "application/json" },
      body: JSON.stringify({ aps: { alert: { title: "Key check", body: "Key check" } } })
    });
  } catch (error) { return { ok: null, note: `Apple's push service couldn't be reached from the worker (${String(error?.message || error).slice(0, 80)}).` }; }
  const reason = (await res.json().catch(() => ({}))).reason || "";
  if (res.status === 400 && reason === "BadDeviceToken") return { ok: true, note: "The push key works." };
  if (res.status === 403) return { ok: false, note: `Apple refused the push key (${reason || 403}): check it was made with Apple Push Notifications ticked, on this team.` };
  if (reason === "TopicDisallowed" || reason === "BadTopic") return { ok: false, note: `The push key works, but not for ${bundleId} (${reason}).` };
  return { ok: null, note: `Apple's push service answered ${res.status}${reason ? ` (${reason})` : ""}; the key could not be confirmed.` };
}

export { apnsToken, ascToken, checkApiKey, checkPushKey, importP8 };
