// Uploads a signed .aab to Google Play internal testing with the Play service account. Run by the android-play job in
// .github/workflows/store-app-build.yml. No packages: Node's own crypto and fetch. Public logs: prints only status.
// Usage: PLAY_ACCOUNT_FILE=<json> node play-upload.mjs <app.aab> <package> <versionCode>
// Exit 0 = uploaded; exit 3 = Google Play doesn't know the package yet (the first file must go up by hand); 1 = error.
import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const [aab, pkg, versionCode] = process.argv.slice(2);
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${pkg}`;
const b64u = (v) => Buffer.from(v).toString("base64url");

async function accessToken(sa) {
  const iat = Math.floor(Date.now() / 1000);
  const input = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: sa.token_uri || "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }))}`;
  const jwt = `${input}.${b64u(sign("sha256", Buffer.from(input), createPrivateKey(sa.private_key)))}`;
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google refused the Play account: ${data.error || res.status}`);
  console.log(`::add-mask::${data.access_token}`);
  return data.access_token;
}

async function call(token, method, url, body, type = "application/json") {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": type } : {}) }, body });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, message: String(data?.error?.message || "") };
}

async function attempt(token, status) {
  const edit = await call(token, "POST", `${API}/edits`, "{}");
  if (edit.status === 404) return { firstUpload: true };
  if (!edit.ok) throw new Error(`Opening an edit failed: ${edit.status} ${edit.message}`);
  const id = edit.data.id;
  const up = await call(token, "POST", `${UPLOAD}/edits/${id}/bundles?uploadType=media`, readFileSync(aab), "application/octet-stream");
  if (up.status === 404) return { firstUpload: true };
  if (!up.ok) throw new Error(`Bundle upload failed: ${up.status} ${up.message}`);
  if (String(up.data.versionCode) !== String(versionCode)) throw new Error(`Google read version ${up.data.versionCode}, expected ${versionCode}`);
  const track = await call(token, "PUT", `${API}/edits/${id}/tracks/internal`, JSON.stringify({ track: "internal", releases: [{ name: `Build ${versionCode}`, versionCodes: [String(versionCode)], status }] }));
  if (!track.ok) return { retryDraft: /draft/i.test(track.message), error: `Track update failed: ${track.status} ${track.message}` };
  const commit = await call(token, "POST", `${API}/edits/${id}:commit`);
  if (!commit.ok) return { retryDraft: /draft/i.test(commit.message), error: `Commit failed: ${commit.status} ${commit.message}` };
  return { done: true, status };
}

async function main() {
  const sa = JSON.parse(readFileSync(process.env.PLAY_ACCOUNT_FILE, "utf8"));
  const token = await accessToken(sa);
  let out = await attempt(token, "completed");
  // An app that has never been published only takes draft releases; the owner rolls the first one out in Play Console.
  if (out.retryDraft) { console.log("Google Play wants a draft release for this app; retrying as draft"); out = await attempt(token, "draft"); }
  if (out.firstUpload) { console.log(`Google Play doesn't know ${pkg} yet: the first file must be uploaded by hand`); process.exit(3); }
  if (out.error) throw new Error(out.error);
  console.log(`Uploaded build ${versionCode} to internal testing (${out.status})`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
