// Frees Apple signing-certificate slots before a signed iOS build (store-app-build.yml, ios-testflight).
//
// Why (Nov 9, 2026): every build runs on a fresh Mac, so Xcode's automatic signing makes a new "Apple Development"
// certificate through the App Store Connect API key each time and never removes the old ones. After enough builds
// Apple refuses: "Your account has reached the maximum number of certificates" (the Nino app's first build failed).
// Development certificates made through the API key are only used to archive on that runner, so this revokes them
// all; apps already uploaded or in the stores are not affected (revoking never pulls a released app). Certificates
// made by a person in Xcode or on developer.apple.com (not "Created via API") and distribution certificates are left.
//
// Usage: node booking-api/scripts/asc-free-cert-slot.mjs <AuthKey.p8> <key id> <issuer id>
// Prints counts only (public logs).
import { createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";

const API = "https://api.appstoreconnect.apple.com/v1";
const DEV_TYPES = new Set(["DEVELOPMENT", "IOS_DEVELOPMENT", "MAC_APP_DEVELOPMENT"]);

export { token };
export function isRevocable(cert) {
  const a = cert?.attributes || {};
  return DEV_TYPES.has(a.certificateType) && /created via api/i.test(`${a.name || ""} ${a.displayName || ""}`);
}

function b64url(data) {
  return Buffer.from(data).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function token(keyPath, keyId, issuerId) {
  const key = createPrivateKey(await readFile(keyPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
  const signature = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(signature)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [keyPath, keyId, issuerId] = process.argv.slice(2);
  if (!keyPath || !keyId || !issuerId) throw new Error("Usage: asc-free-cert-slot.mjs <AuthKey.p8> <key id> <issuer id>");
  const auth = { Authorization: `Bearer ${await token(keyPath, keyId, issuerId)}` };
  const res = await fetch(`${API}/certificates?limit=200&fields[certificates]=certificateType,name,displayName,expirationDate`, { headers: auth });
  if (!res.ok) { console.log(`Certificate list answered ${res.status}; leaving certificates as they are`); process.exit(0); }
  const certs = (await res.json()).data || [];
  const byType = {};
  for (const c of certs) byType[c.attributes?.certificateType || "?"] = (byType[c.attributes?.certificateType || "?"] || 0) + 1;
  console.log(`Certificates on the account: ${JSON.stringify(byType)}`);
  let revoked = 0, failed = 0;
  for (const c of certs.filter(isRevocable)) {
    const del = await fetch(`${API}/certificates/${encodeURIComponent(c.id)}`, { method: "DELETE", headers: auth });
    if (del.ok || del.status === 404) revoked++; else failed++;
  }
  console.log(`Revoked ${revoked} development certificate(s) made by earlier builds${failed ? `; ${failed} could not be revoked` : ""}`);
}
