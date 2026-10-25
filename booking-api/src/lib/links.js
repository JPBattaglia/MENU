function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("Invalid base64url");
  const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function linkSigningKey(env) {
  if (!env.PRODUCTION_RUNNER_SECRET) throw new Error("Link signing secret is not configured");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`menu-made-links-v1:${env.PRODUCTION_RUNNER_SECRET}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signLinkToken(env, { kind, id, ttlDays }) {
  const payload = { k: kind, i: id, e: Math.floor(Date.now() / 1e3) + Math.round(ttlDays * 86400) };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await linkSigningKey(env), new TextEncoder().encode(body)));
  return `${body}.${base64UrlEncode(signature)}`;
}

// Returns the payload, { expired: true, ... } for a genuine but expired token, or null when invalid.
async function verifyLinkToken(env, token, kinds, id) {
  if (typeof token !== "string" || token.length < 10 || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await linkSigningKey(env),
      base64UrlDecode(parts[1]),
      new TextEncoder().encode(parts[0])
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    if (!payload || !kinds.includes(payload.k) || payload.i !== id || !Number.isFinite(payload.e)) return null;
    if (payload.e < Math.floor(Date.now() / 1e3)) return { ...payload, expired: true };
    return payload;
  } catch {
    return null;
  }
}

export {
  base64UrlEncode,
  base64UrlDecode,
  linkSigningKey,
  signLinkToken,
  verifyLinkToken
};
