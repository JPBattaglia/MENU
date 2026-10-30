// Stage 11 part 2: what the Store App build (.github/workflows/store-app-build.yml) gets from the worker.
// Every route takes ?store_app=<id> (a restaurant's Store App, or the owner's test app; keys by its scope, see
// restaurant-keys.js) or ?scope=owner (the sample build config in the repo). Examples with scope=owner:
//   GET  /api/store-build/credentials?scope=owner                   the App Store Connect API key (iOS)
//   GET  /api/store-build/credentials?scope=owner&platform=android  google-services.json, the Google Play account and
//                                                                    the Android upload key (null until the first build)
//   POST /api/store-build/android-key?scope=owner                    { jks (base64), password }: the first signed build's
//                                                                    new upload key; kept once, the stored one is returned
//   POST /api/store-build/android-bundle?scope=owner&version=N      the signed .aab, when Google Play doesn't know the
//                                                                    app yet: stored and emailed to the owner to upload by hand
//   GET  /api/store-build/bundle/<N>?a=<store app id>&t=             the owner's download (signed link, 7 days; no a = owner)
// All but the download need a GitHub Actions OIDC token (audience menu-made-store-build) from a manual run
// (workflow_dispatch) of that workflow on master; push-triggered builds are unsigned and never ask. The repo is public,
// so the workflow masks every secret line before writing it to a file and never prints it.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { loadCredential, seal, unseal } from "./keys.js";
import { loadGoogleServices } from "./google-keys.js";
import { buildTarget } from "./store-build.js";
import { storeScope } from "./restaurant-keys.js";

const BUNDLE_LINK_KIND = "storebundle";
const MAX_BUNDLE_BYTES = 90 * 1024 * 1024;
const bundleKey = (scope, version) => `store-app/${scope}/bundles/${version}.aab`;
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

const authorize = buildTarget;

async function loadUploadKey(env, scope) {
  const row = await env.DB.prepare(`SELECT sealed FROM android_upload_keys WHERE scope = ?`).bind(scope).first();
  return row ? JSON.parse(await unseal(env, row.sealed)) : null;
}

async function androidCredentials(env, scope, packageId) {
  const googleServices = await loadGoogleServices(env, scope);
  if (!googleServices) return json({ ok: false, error: "No google-services.json yet (Google files page)" }, 409);
  let play = null;
  try { play = await loadCredential(env, scope, "GOOGLE_PLAY_ACCOUNT"); } catch { play = null; }
  return json({
    ok: true,
    android: {
      package: packageId,
      google_services: googleServices,
      play_account: play && play.status !== "FAILED" ? play.p8 : null,
      upload_key: await loadUploadKey(env, scope)
    }
  });
}

async function handleBuildCredentials(request, env) {
  const { scope, packageId, error } = await authorize(request, env);
  if (error) return error;
  if (new URL(request.url).searchParams.get("platform") === "android") return androidCredentials(env, scope, packageId);
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

async function appLabel(env, storeApp) {
  if (!storeApp) return { name: "Sample Cafe test", file: "sample-cafe" };
  const row = await env.DB.prepare(`SELECT slug, data_json FROM guest_apps WHERE project_id = ?`).bind(storeApp.project_id).first().catch(() => null);
  let data = {};
  try { data = JSON.parse(row?.data_json || "{}"); } catch { data = {}; }
  return { name: String(data.app_name || storeApp.bundle_id).slice(0, 30), file: String(row?.slug || "app").replace(/[^a-z0-9-]/gi, "") || "app" };
}

async function handleAndroidBundle(request, env) {
  const { scope, packageId, storeApp, error } = await authorize(request, env);
  if (error) return error;
  const version = new URL(request.url).searchParams.get("version") || "";
  if (!/^\d{1,9}$/.test(version)) return json({ ok: false, error: "version must be the build number" }, 400);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BUNDLE_BYTES) return json({ ok: false, error: "Too large" }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BUNDLE_BYTES) return json({ ok: false, error: "Too large" }, 413);
  if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json({ ok: false, error: "That isn't an .aab file" }, 422);
  await env.ASSETS.put(bundleKey(scope, version), bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  const owner = !storeApp;
  const token = await signLinkToken(env, { kind: BUNDLE_LINK_KIND, id: owner ? version : `${storeApp.id}/${version}`, ttlDays: 7 });
  const link = `${publicBaseUrl(env)}/api/store-build/bundle/${version}?${owner ? "" : `a=${storeApp.id}&`}t=${encodeURIComponent(token)}`;
  const label = await appLabel(env, storeApp);
  const steps = [
    "Google only accepts a new app's first file by hand. After this one, every build uploads itself.",
    "1. Download the file with the button below (on the Mac).",
    `2. Play Console${owner ? "" : " (the restaurant's account)"}, ${label.name}, Test and release, Testing, Internal testing, Create new release.`,
    "3. If Google asks about app signing, keep \"Use Google-generated key\". Upload the file, give the release any name, Next, Save and publish.",
    "4. Internal testing, Testers tab: create an email list with your own Google account and save. Open the \"Join on Android\" link on an Android phone to install it.",
    "Then tell Claude it's uploaded."
  ];
  const sent = await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: owner ? "Upload the first Android build to Google Play" : `Upload the first Android build of ${label.name} to Google Play`,
    html: brandedEmailHtml({ preheader: "One manual upload, then builds upload themselves.", eyebrow: "STORE APP", heading: "First Android upload", paragraphs: steps,
      buttons: [{ label: `Download build ${version} (.aab)`, url: link, primary: true }], rows: [["App", packageId], ["Build", version]] }),
    text: `${steps.join("\n")}\n\nDownload (7 days): ${link}`,
    idempotencyKey: `store-bundle/${scope}/${version}`, purpose: "OWNER_ACTION", templateKey: "store_bundle_first_upload_v1"
  }).catch(() => ({ ok: false }));
  return json({ ok: true, stored: bytes.length, emailed: sent?.ok !== false });
}

async function handleBundleDownload(request, env, version) {
  const url = new URL(request.url);
  const appId = String(url.searchParams.get("a") || "").toLowerCase();
  const payload = await verifyLinkToken(env, url.searchParams.get("t"), [BUNDLE_LINK_KIND], appId ? `${appId}/${version}` : version);
  if (!payload || payload.expired) return simplePage(403, "This link has expired", "<p>Ask Claude to run the Android build again for a fresh link.</p>");
  let scope = "owner"; let storeApp = null;
  if (appId) {
    storeApp = await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ?`).bind(appId).first();
    scope = storeScope(storeApp);
    if (!scope) return simplePage(404, "File not found", "<p>Ask Claude to run the Android build again.</p>");
  }
  const obj = await env.ASSETS.get(bundleKey(scope, version));
  if (!obj) return simplePage(404, "File not found", "<p>Ask Claude to run the Android build again.</p>");
  const label = await appLabel(env, storeApp);
  return new Response(obj.body, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${label.file}-${version}.aab"`, "Cache-Control": "no-store" } });
}

export { BUNDLE_LINK_KIND, handleAndroidBundle, handleAndroidKey, handleBuildCredentials, handleBundleDownload };
