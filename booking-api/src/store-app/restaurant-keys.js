// Stage 11 part 2: each restaurant's keys for its Store App, handed over by the owner with nothing to remember.
// The restaurant has invited Menu-made (the owner inbox) as Admin in its App Store Connect and Play Console; the owner
// makes the restaurant's keys there and uploads them here. Same pattern as the owner's own pages (keys.js, google-keys.js).
//   GET  /api/store-keys/app/<store app id>        what's saved, what's missing, and "Email me the upload link"
//   POST /api/store-keys/app/<store app id>        (no form data) emails a one-hour signed link to the owner inbox
//   GET  /api/store-keys/app/<store app id>?t=     the upload form
//   POST /api/store-keys/app/<store app id>        (multipart, with t) checks each file live, then stores it
// Scope = the restaurant's business id (native-push.js looks keys up the same way, falling back to 'owner'); the
// owner's test app uses 'owner'.
// What a restaurant has of its own:
//   APPLE_API_KEY, APPLE_PUSH_KEY   made in the restaurant's Apple team (sealed, as for the owner)
//   google-services.json            the restaurant's Android app, added to Menu-made's own Firebase project
//                                   ("Menu-made apps"), so Android push uses the owner's FIREBASE_ACCOUNT
//   GOOGLE_PLAY_ACCOUNT             a copy of the owner's Play service account, checked against the restaurant's
//                                   Play app once the restaurant's Play Console has invited it ("Check again" re-copies
//                                   the owner's current key, so a replaced owner key reaches every restaurant)
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { OWNER, OWNER_BUNDLE_ID, loadCredential, mark, processAppleKeys, saveCredential, status } from "./keys.js";
import { loadGoogleServices, servicesKey } from "./google-keys.js";
import { checkPlay, parseGoogleServices, parseServiceAccount } from "./google.js";

const LINK_KIND = "storekeys-app";
const LINK_TTL_DAYS = 1 / 24;
const MAX_FILE_BYTES = 16384;

// The owner's own test app (Sample Cafe, com.menumade.samplecafe) is the test restaurant: a Store App with that bundle
// id uses the owner's keys, so the whole per-restaurant path can be proven on the owner's accounts.
const storeScope = (storeApp) => (storeApp?.bundle_id === OWNER_BUNDLE_ID ? OWNER : storeApp?.business_id || null);

async function loadStoreApp(env, id) {
  const row = await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ?`).bind(id).first();
  if (!row) return null;
  const app = await env.DB.prepare(`SELECT data_json FROM guest_apps WHERE project_id = ?`).bind(row.project_id).first().catch(() => null);
  let data = {};
  try { data = JSON.parse(app?.data_json || "{}"); } catch { data = {}; }
  return { ...row, appName: String(data.app_name || "Your app").slice(0, 30) };
}

async function credentialRow(env, scope, kind) {
  return env.DB.prepare(`SELECT key_id, check_status, check_note FROM store_credentials WHERE scope = ? AND kind = ?`).bind(scope, kind).first();
}

// What the build needs before the owner's Done can move the app to READY_TO_BUILD. Google Play access isn't required:
// Google only takes a new app's first file by hand, and that file comes from the first build.
async function keysReady(env, storeApp) {
  const scope = storeScope(storeApp);
  if (!scope) return { ready: false, missing: ["the restaurant's business record"] };
  const missing = [];
  const api = await credentialRow(env, scope, "APPLE_API_KEY");
  if (api?.check_status !== "VERIFIED") missing.push("a working App Store Connect API key");
  const push = await credentialRow(env, scope, "APPLE_PUSH_KEY");
  if (!push || push.check_status === "FAILED") missing.push("the Apple push key");
  if (!(env.ASSETS && await loadGoogleServices(env, scope))) missing.push("google-services.json");
  return { ready: missing.length === 0, missing };
}

async function statusLines(env, storeApp) {
  const scope = storeScope(storeApp);
  const line = (row, label, missingText) => row ? `${mark(row.check_status === "VERIFIED" ? true : row.check_status === "FAILED" ? false : null)} <strong>${label}</strong>: ${escapeHtml(row.check_note || row.check_status)}` : `⬜ <strong>${label}</strong>: ${missingText}`;
  const services = await loadGoogleServices(env, scope);
  const parsed = services ? parseGoogleServices(services) : null;
  return [
    line(await credentialRow(env, scope, "APPLE_API_KEY"), "App Store Connect API key", "not uploaded yet"),
    line(await credentialRow(env, scope, "APPLE_PUSH_KEY"), "Apple push key", "not uploaded yet"),
    parsed ? `✅ <strong>google-services.json</strong>: Firebase project ${escapeHtml(parsed.projectId)}, app ${escapeHtml(storeApp.bundle_id)}.` : "⬜ <strong>google-services.json</strong>: not uploaded yet",
    line(await credentialRow(env, scope, "GOOGLE_PLAY_ACCOUNT"), "Google Play access", "checked when you press Check and save")
  ];
}

async function playInviteEmail(env) {
  try { return (await loadCredential(env, OWNER, "GOOGLE_PLAY_ACCOUNT"))?.keyId || null; } catch { return null; }
}

function checklist(storeApp, inviteEmail, firebaseProject) {
  const b = escapeHtml(storeApp.bundle_id);
  return `<ol>
<li><strong>Apple, in the restaurant's team</strong> (switch teams at the top right of developer.apple.com): Certificates, Identifiers &amp; Profiles, Identifiers, register the App ID <strong>${b}</strong> with Push Notifications on. Keys: make a key with Apple Push Notifications service (Sandbox &amp; Production, Team Scoped). App Store Connect, Users and Access, Integrations: make a Team Key with the Admin role, and copy the Issuer ID shown above the list. Apple key names allow no hyphens.</li>
<li><strong>Firebase</strong>: in the <strong>${escapeHtml(firebaseProject || "Menu-made apps")}</strong> project, Add app, Android, package name <strong>${b}</strong>, Register app, Download google-services.json.</li>
<li><strong>Google Play</strong>: in the restaurant's Play Console, Users and permissions, Invite new users: <strong>${escapeHtml(inviteEmail || "the service account email from the Android setup page")}</strong>, App permissions: this app with Admin (all permissions).</li>
<li><strong>Upload</strong> the two Apple .p8 files and google-services.json with the link below, then press Done in the setup email.</li>
</ol>`;
}

function formPage(storeApp, token, error, lines) {
  const id = escapeHtml(storeApp.id);
  return simplePage(error ? 400 : 200, `Keys for ${storeApp.appName}`, `${error ? `<p style="color:#a11"><strong>${escapeHtml(error)}</strong></p>` : ""}
${lines?.length ? `<p>${lines.join("</p><p>")}</p>` : ""}
<p>App: <strong>${escapeHtml(storeApp.bundle_id)}</strong>. Already uploaded? Leave the boxes empty and press <strong>Check and save</strong> to check everything again.</p>
<form method="post" action="/api/store-keys/app/${id}" enctype="multipart/form-data">
<input type="hidden" name="t" value="${escapeHtml(token)}">
<h2 style="font-size:18px">1. App Store Connect API key (restaurant's team)</h2>
<p><label>Key file<br><input type="file" name="api_file" accept=".p8"></label></p>
<p><label>Issuer ID<br><input name="issuer_id" size="40" placeholder="69a6de70-…" autocomplete="off"></label></p>
<h2 style="font-size:18px">2. Apple push key (restaurant's team)</h2>
<p><label>Key file<br><input type="file" name="push_file" accept=".p8"></label></p>
<details><summary style="font-size:14px">A file was renamed?</summary><p><label>API key ID <input name="api_key_id" size="12"></label><br><label>Push key ID <input name="push_key_id" size="12"></label></p></details>
<h2 style="font-size:18px">3. google-services.json (Android app ${escapeHtml(storeApp.bundle_id)})</h2>
<p><input type="file" name="services_file" accept=".json,application/json"></p>
<p><button type="submit">Check and save</button></p>
</form>
<p style="font-size:13px">Keys are checked with Apple and Google, then stored encrypted. They're never shown or emailed back.</p>`);
}

async function emailLink(env, storeApp) {
  const inbox = ownerEmailAddress(env);
  const link = `${publicBaseUrl(env)}/api/store-keys/app/${storeApp.id}?t=${encodeURIComponent(await signLinkToken(env, { kind: LINK_KIND, id: storeApp.id, ttlDays: LINK_TTL_DAYS }))}`;
  const bucket = Math.floor(Date.now() / 600000);
  const sent = await sendTransactionalEmail(env, {
    to: inbox,
    subject: `Upload the store keys for ${storeApp.appName}`,
    html: brandedEmailHtml({ preheader: "One-hour link to hand over the restaurant's keys.", eyebrow: "STORE APP", heading: `Keys for ${storeApp.appName}`,
      paragraphs: ["Open this link on the Mac that has the two AuthKey .p8 files and google-services.json in Downloads. It works for one hour.", "If you didn't ask for this, ignore it."],
      buttons: [{ label: "Upload keys", url: link, primary: true }], rows: [["App", storeApp.bundle_id]] }),
    text: `Upload the keys for ${storeApp.appName} (link works for one hour):\n${link}`,
    idempotencyKey: `store-keys-app-link/${storeApp.id}/${bucket}`, purpose: "OWNER_ACTION", templateKey: "store_keys_app_link_v1"
  }).catch((error) => ({ ok: false, error }));
  if (!sent?.ok) return simplePage(502, "The email didn't send", "<p>Please try again in a minute.</p>");
  return simplePage(200, "Check your email", `<p>We sent the link to <strong>${escapeHtml(inbox)}</strong>. If you pressed the button a moment ago, the earlier email is the one to use.</p>`);
}

async function readJsonFile(file) {
  if (!file || typeof file === "string" || !file.size) return null;
  if (file.size > MAX_FILE_BYTES) return { error: "too big" };
  return { text: await file.text() };
}

// Copies the owner's Play service account to the restaurant's scope and checks it against the restaurant's app.
async function checkPlayAccess(env, storeApp, scope, fetchImpl) {
  let owner = null;
  try { owner = await loadCredential(env, OWNER, "GOOGLE_PLAY_ACCOUNT"); } catch { owner = null; }
  if (!owner?.p8) return "⚠️ <strong>Google Play</strong>: Menu-made's own Google files aren't uploaded yet (menu-made.com/api/store-keys/google).";
  const sa = parseServiceAccount(owner.p8);
  if (!sa) return "❌ <strong>Google Play</strong>: Menu-made's Play key on file isn't readable; upload it again on the Android setup page.";
  const check = await checkPlay(sa, storeApp.bundle_id, { fetchImpl });
  await saveCredential(env, scope, "GOOGLE_PLAY_ACCOUNT", { keyId: sa.client_email, teamId: sa.project_id, p8: owner.p8, status: status(check.ok), note: check.note });
  return `${mark(check.ok)} <strong>Google Play</strong>: ${escapeHtml(check.note)}`;
}

async function handleRestaurantKeys(request, env, id, { fetchImpl = fetch } = {}) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const storeApp = await loadStoreApp(env, id);
  if (!storeApp) return simplePage(404, "Not found", "<p>This Store App doesn't exist.</p>");
  const scope = storeScope(storeApp);
  if (!scope) return simplePage(409, "Can't take keys yet", "<p>This Store App has no restaurant record. Reply to the setup email and Claude will look.</p>");
  const expired = () => simplePage(403, "This link has expired", `<p>Open <a href="/api/store-keys/app/${escapeHtml(id)}">the key page</a> again to get a fresh one.</p>`);
  const url = new URL(request.url);
  const isUpload = request.method === "POST" && /multipart\/form-data/i.test(request.headers.get("Content-Type") || "");
  if (request.method === "GET" && !url.searchParams.get("t")) {
    let firebaseProject = null;
    try { firebaseProject = (await loadCredential(env, OWNER, "FIREBASE_ACCOUNT"))?.teamId || null; } catch { firebaseProject = null; }
    return simplePage(200, `Store keys for ${storeApp.appName}`, `<p>${(await statusLines(env, storeApp)).join("<br>")}</p>
${checklist(storeApp, await playInviteEmail(env), firebaseProject)}
<p>We'll email a one-hour upload link to <strong>${escapeHtml(ownerEmailAddress(env))}</strong>.</p>
<form method="post" action="/api/store-keys/app/${escapeHtml(id)}"><button type="submit">Email me the upload link</button></form>`);
  }
  if (request.method === "POST" && !isUpload) return emailLink(env, storeApp);
  if (request.method === "GET") {
    const token = url.searchParams.get("t");
    const payload = await verifyLinkToken(env, token, [LINK_KIND], id);
    return !payload || payload.expired ? expired() : formPage(storeApp, token, null, await statusLines(env, storeApp));
  }
  if (!isUpload) return simplePage(405, "Not allowed", "<p>Use the form.</p>");
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], id);
  if (!payload || payload.expired) return expired();

  // google-services.json first: it is checked without calling anyone, so a wrong file stops before Apple is asked.
  const servicesFile = await readJsonFile(form.get("services_file"));
  if (servicesFile?.error) return formPage(storeApp, token, "The google-services.json file is too big to be the right file.");
  let servicesLine = null;
  if (servicesFile) {
    const parsed = parseGoogleServices(servicesFile.text);
    if (!parsed) return formPage(storeApp, token, "That isn't a google-services.json file (Firebase, Project settings, the Android app, google-services.json).");
    if (!parsed.packages.includes(storeApp.bundle_id)) return formPage(storeApp, token, `That google-services.json is for ${parsed.packages.join(", ")}, not ${storeApp.bundle_id}. Add an Android app with package name ${storeApp.bundle_id} in Firebase and download its file.`);
    let ownerProject = null;
    try { ownerProject = (await loadCredential(env, OWNER, "FIREBASE_ACCOUNT"))?.teamId || null; } catch { ownerProject = null; }
    if (ownerProject && parsed.projectId !== ownerProject) return formPage(storeApp, token, `That file is from Firebase project ${parsed.projectId}. Add the app to ${ownerProject} (Menu-made's project, which sends the notifications) instead.`);
    await env.ASSETS.put(servicesKey(scope), servicesFile.text, { httpMetadata: { contentType: "application/json" } });
    servicesLine = `✅ <strong>google-services.json</strong>: Firebase project ${escapeHtml(parsed.projectId)}, app ${escapeHtml(storeApp.bundle_id)}.`;
  }

  const apple = await processAppleKeys(env, form, { scope, bundleId: storeApp.bundle_id, fetchImpl, requireOne: false });
  if (apple.error) return formPage(storeApp, token, apple.error);
  const lines = [...apple.lines];
  if (servicesLine) lines.push(servicesLine);
  lines.push(await checkPlayAccess(env, storeApp, scope, fetchImpl));
  const { ready, missing } = await keysReady(env, storeApp);
  return simplePage(200, ready ? "Keys saved" : "Saved so far", `<p>${lines.join("</p><p>")}</p>
<p>${ready ? "Everything the build needs is here. Press Done in the setup email when the rest of the checklist is finished." : `Still needed: ${escapeHtml(missing.join(", "))}.`}</p>
<form method="post" action="/api/store-keys/app/${escapeHtml(id)}" enctype="multipart/form-data"><input type="hidden" name="t" value="${escapeHtml(token)}">
<p><label>Issuer ID (only if it changed)<br><input name="issuer_id" size="40" autocomplete="off"></label></p><p><button type="submit">Check saved keys again</button></p></form>
<p><a href="/api/store-keys/app/${escapeHtml(id)}?t=${encodeURIComponent(token)}">Upload more files</a></p>`);
}

export { LINK_KIND, handleRestaurantKeys, keysReady, storeScope };
