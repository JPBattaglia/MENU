// Stage 11 part 2: what the Store App build (.github/workflows/store-app-build.yml) gets from the worker.
//   GET  /api/store-build/credentials?scope=owner                   the App Store Connect API key (iOS)
//   GET  /api/store-build/credentials?scope=owner&platform=android  google-services.json, the Google Play account and
//                                                                    the Android upload key (null until the first build)
//   POST /api/store-build/android-key?scope=owner                    { jks (base64), password }: the first signed build's
//                                                                    new upload key; kept once, the stored one is returned
//   POST /api/store-build/android-bundle?scope=owner&version=N      the signed .aab, when Google Play doesn't know the
//                                                                    app yet: stored and emailed to the owner to upload by hand
//   GET  /api/store-build/bundle/<N>?t=                              the owner's download (signed link, 7 days)
// All but the download need a GitHub Actions OIDC token (audience menu-made-store-build) from a manual run
// (workflow_dispatch) of that workflow on master; push-triggered builds are unsigned and never ask. The repo is public,
// so the workflow masks every secret line before writing it to a file and never prints it.
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { OWNER_BUNDLE_ID, loadCredential, seal, unseal } from "./keys.js";
import { loadGoogleServices } from "./google-keys.js";

const BUILD_AUDIENCE = "menu-made-store-build";
const BUILD_WORKFLOW = "JPBattaglia/MENU/.github/workflows/store-app-build.yml@refs/heads/master";
const BUNDLE_LINK_KIND = "storebundle";
const MAX_BUNDLE_BYTES = 90 * 1024 * 1024;
const bundleKey = (scope, version) => `store-app/${scope}/bundles/${version}.aab`;
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

async function authorize(request, env) {
  const auth = await verifyRenderer(request, env, { audience: BUILD_AUDIENCE, workflow: BUILD_WORKFLOW, events: ["workflow_dispatch"] });
  if (!auth.ok) return { error: json({ ok: false, error: auth.error }, auth.status) };
  const scope = new URL(request.url).searchParams.get("scope") || "owner";
  if (scope !== "owner") return { error: json({ ok: false, error: "Unknown scope" }, 404) }; // restaurants' scopes come with the producer
  return { scope };
}

async function loadUploadKey(env, scope) {
  const row = await env.DB.prepare(`SELECT sealed FROM android_upload_keys WHERE scope = ?`).bind(scope).first();
  return row ? JSON.parse(await unseal(env, row.sealed)) : null;
}

async function androidCredentials(env, scope) {
  const googleServices = await loadGoogleServices(env, scope);
  if (!googleServices) return json({ ok: false, error: "No google-services.json yet (Google files page)" }, 409);
  let play = null;
  try { play = await loadCredential(env, scope, "GOOGLE_PLAY_ACCOUNT"); } catch { play = null; }
  return json({
    ok: true,
    android: {
      package: OWNER_BUNDLE_ID,
      google_services: googleServices,
      play_account: play && play.status !== "FAILED" ? play.p8 : null,
      upload_key: await loadUploadKey(env, scope)
    }
  });
}

async function handleBuildCredentials(request, env) {
  const { scope, error } = await authorize(request, env);
  if (error) return error;
  if (new URL(request.url).searchParams.get("platform") === "android") return androidCredentials(env, scope);
  let api;
  try { api = await loadCredential(env, scope, "APPLE_API_KEY"); } catch { return json({ ok: false, error: "Stored key is not readable" }, 500); }
  if (!api || api.status !== "VERIFIED") return json({ ok: false, error: "No verified App Store Connect API key for this scope" }, 409);
  return json({ ok: true, apple: { key_id: api.keyId, issuer_id: api.issuerId, team_id: api.teamId, p8: api.p8 } });
}

async function handleAndroidKey(request, env) {
  const { scope, error } = await authorize(request, env);
  if (error) return error;
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json({ ok: false, error: "Bad request" }, 400); }
  const jks = String(body?.jks || ""); const password = String(body?.password || "");
  if (!/^[A-Za-z0-9+/=]{500,20000}$/.test(jks) || password.length < 16 || password.length > 128) return json({ ok: false, error: "That isn't an upload key" }, 400);
  // First one wins: a second build racing the first gets the stored key back and signs with it.
  await env.DB.prepare(`INSERT OR IGNORE INTO android_upload_keys (scope, sealed, created_at) VALUES (?, ?, ?)`)
    .bind(scope, await seal(env, JSON.stringify({ jks, password })), nowIso()).run();
  return json({ ok: true, upload_key: await loadUploadKey(env, scope) });
}

async function handleAndroidBundle(request, env) {
  const { scope, error } = await authorize(request, env);
  if (error) return error;
  const version = new URL(request.url).searchParams.get("version") || "";
  if (!/^\d{1,9}$/.test(version)) return json({ ok: false, error: "version must be the build number" }, 400);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BUNDLE_BYTES) return json({ ok: false, error: "Too large" }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BUNDLE_BYTES) return json({ ok: false, error: "Too large" }, 413);
  if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json({ ok: false, error: "That isn't an .aab file" }, 422);
  await env.ASSETS.put(bundleKey(scope, version), bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  const link = `${publicBaseUrl(env)}/api/store-build/bundle/${version}?t=${encodeURIComponent(await signLinkToken(env, { kind: BUNDLE_LINK_KIND, id: version, ttlDays: 7 }))}`;
  const steps = [
    "Google only accepts a new app's first file by hand. After this one, every build uploads itself.",
    "1. Download the file with the button below (on the Mac).",
    "2. Play Console, Sample Cafe test, Test and release, Testing, Internal testing, Create new release.",
    "3. If Google asks about app signing, keep \"Use Google-generated key\". Upload the file, give the release any name, Next, Save and publish.",
    "4. Internal testing, Testers tab: create an email list with your own Google account and save. Open the \"Join on Android\" link on an Android phone to install it.",
    "Then tell Claude it's uploaded."
  ];
  const sent = await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Upload the first Android build to Google Play",
    html: brandedEmailHtml({ preheader: "One manual upload, then builds upload themselves.", eyebrow: "STORE APP", heading: "First Android upload", paragraphs: steps,
      buttons: [{ label: `Download build ${version} (.aab)`, url: link, primary: true }], rows: [["App", OWNER_BUNDLE_ID], ["Build", version]] }),
    text: `${steps.join("\n")}\n\nDownload (7 days): ${link}`,
    idempotencyKey: `store-bundle/${scope}/${version}`, purpose: "OWNER_ACTION", templateKey: "store_bundle_first_upload_v1"
  }).catch(() => ({ ok: false }));
  return json({ ok: true, stored: bytes.length, emailed: sent?.ok !== false });
}

async function handleBundleDownload(request, env, version) {
  const payload = await verifyLinkToken(env, new URL(request.url).searchParams.get("t"), [BUNDLE_LINK_KIND], version);
  if (!payload || payload.expired) return simplePage(403, "This link has expired", "<p>Ask Claude to run the Android build again for a fresh link.</p>");
  const obj = await env.ASSETS.get(bundleKey("owner", version));
  if (!obj) return simplePage(404, "File not found", "<p>Ask Claude to run the Android build again.</p>");
  return new Response(obj.body, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="sample-cafe-${version}.aab"`, "Cache-Control": "no-store" } });
}

export { BUILD_AUDIENCE, BUILD_WORKFLOW, BUNDLE_LINK_KIND, handleAndroidBundle, handleAndroidKey, handleBuildCredentials, handleBundleDownload };
