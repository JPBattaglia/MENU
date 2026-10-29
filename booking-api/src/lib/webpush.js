// Web Push with no outside service and no npm package (stage 11 part 1): RFC 8291 message encryption (aes128gcm) and
// RFC 8292 VAPID, both on WebCrypto. Phones subscribe through their own push service (Google FCM for Chrome/Android,
// Apple for iPhone home-screen apps, Mozilla for Firefox); we POST the encrypted message to the subscription endpoint.
//
// The VAPID key pair is made once by the worker and kept in worker_settings, encrypted with a key derived from
// PRODUCTION_RUNNER_SECRET (like the Google tokens), so there is no secret for the owner to install. Rotating
// PRODUCTION_RUNNER_SECRET makes the stored key unreadable: a new one is made and every phone must subscribe again.
import { base64UrlDecode, base64UrlEncode } from "./links.js";
import { nowIso } from "./http.js";

const SETTING_KEY = "vapid_keypair_v1";
const RECORD_SIZE = 4096;
const enc = new TextEncoder();
// Push services we send to. Anything else is refused, so a subscription can't make the worker call an arbitrary URL.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^[a-z0-9.-]+\.notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function pushEndpointAllowed(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((re) => re.test(url.hostname)) && endpoint.length <= 1000;
}

async function settingKey(env) {
  if (!env.PRODUCTION_RUNNER_SECRET) throw new Error("PRODUCTION_RUNNER_SECRET is not configured");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`menu-made-worker-settings-v1:${env.PRODUCTION_RUNNER_SECRET}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await settingKey(env), enc.encode(text)));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(sealed)}`;
}

async function unseal(env, value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlDecode(parts[1]) }, await settingKey(env), base64UrlDecode(parts[2]));
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

// { publicKey: base64url of the 65-byte point, jwk } - made on first use; a concurrent first use keeps the first one stored.
async function vapidKeys(env) {
  const read = async () => {
    const row = await env.DB.prepare(`SELECT value FROM worker_settings WHERE key = ?`).bind(SETTING_KEY).first();
    const text = row ? await unseal(env, row.value) : null;
    return text ? JSON.parse(text) : null;
  };
  const stored = await read();
  if (stored) return stored;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const value = await seal(env, JSON.stringify({ publicKey, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } }));
  const t = nowIso();
  // A row that can't be read any more (PRODUCTION_RUNNER_SECRET rotated) is replaced.
  const existing = await env.DB.prepare(`SELECT value FROM worker_settings WHERE key = ?`).bind(SETTING_KEY).first();
  if (existing) await env.DB.prepare(`UPDATE worker_settings SET value = ?, updated_at = ? WHERE key = ? AND value = ?`).bind(value, t, SETTING_KEY, existing.value).run();
  else await env.DB.prepare(`INSERT OR IGNORE INTO worker_settings (key, value, updated_at) VALUES (?, ?, ?)`).bind(SETTING_KEY, value, t).run();
  return (await read()) || { publicKey, jwk };
}

// RFC 8292: a JWT signed with the VAPID key, for the push service's origin. ES256 in WebCrypto is already r||s.
async function vapidAuthorization(keys, endpoint, { subject = "mailto:info@menu-made.com", now = Date.now() } = {}) {
  const audience = new URL(endpoint).origin;
  const header = base64UrlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { ...keys.jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// RFC 8291 section 3 and RFC 8188: one record. `ephemeral` (an ECDH key pair) and `salt` are only passed by tests.
async function encryptPushPayload({ p256dh, auth }, payload, { ephemeral = null, salt = null } = {}) {
  const uaPublic = base64UrlDecode(p256dh);
  const authSecret = base64UrlDecode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error("The subscription keys are not valid");
  const plaintext = typeof payload === "string" ? enc.encode(payload) : payload;
  if (plaintext.length > RECORD_SIZE - 17 - 86) throw new Error("The push message is too long");
  const pair = ephemeral || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const recordSalt = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(recordSalt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(recordSalt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(recordSalt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

// The receiving side, for the self-test and tests: decrypts a message body with the subscriber's private key.
async function decryptPushPayload({ privateKey, p256dh, auth }, body) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const salt = bytes.slice(0, 16);
  const idlen = bytes[20];
  const asPublic = bytes.slice(21, 21 + idlen);
  const ciphertext = bytes.slice(21 + idlen);
  const uaPublic = base64UrlDecode(p256dh);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, privateKey, 256));
  const ikm = await hkdf(base64UrlDecode(auth), ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error("The push record has no final delimiter");
  return new TextDecoder().decode(plain.slice(0, end));
}

// Checks a VAPID Authorization header the way a push service does: signature by k, audience, expiry.
async function verifyVapidHeader(header, endpoint, now = Date.now()) {
  const match = /^vapid t=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(String(header || ""));
  if (!match) return { ok: false, error: "malformed header" };
  const key = await crypto.subtle.importKey("raw", base64UrlDecode(match[4]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64UrlDecode(match[3]), enc.encode(`${match[1]}.${match[2]}`));
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(match[2])));
  if (!valid) return { ok: false, error: "bad signature" };
  if (claims.aud !== new URL(endpoint).origin) return { ok: false, error: "wrong audience" };
  if (!(claims.exp > now / 1000 && claims.exp <= now / 1000 + 86400)) return { ok: false, error: "bad expiry" };
  return { ok: true, publicKey: match[4], claims };
}

// Sends one message. Returns { ok, status, gone } - gone means the phone unsubscribed or the app was removed (404/410),
// so the subscription should be dropped. fetchImpl lets the self-test catch the request instead of sending it.
async function sendWebPush(keys, subscription, payload, { fetchImpl = fetch, ttl = 86400, urgency = "normal" } = {}) {
  if (!pushEndpointAllowed(subscription.endpoint)) return { ok: false, status: 0, gone: true, error: "endpoint not allowed" };
  const body = await encryptPushPayload(subscription, payload);
  const response = await fetchImpl(subscription.endpoint, {
    method: "POST",
    headers: { Authorization: await vapidAuthorization(keys, subscription.endpoint), TTL: String(ttl), Urgency: urgency, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" },
    body
  });
  const status = response.status;
  let error = null;
  if (status < 200 || status > 299) error = (await response.text().catch(() => "")).slice(0, 200) || `HTTP ${status}`;
  return { ok: status >= 200 && status <= 299, status, gone: status === 404 || status === 410, error };
}

export { PUSH_HOSTS, decryptPushPayload, encryptPushPayload, verifyVapidHeader, pushEndpointAllowed, sendWebPush, vapidAuthorization, vapidKeys };
