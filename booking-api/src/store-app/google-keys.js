// Stage 11 part 2: the page where the owner hands over the Google files for Android builds and push, with nothing to
// remember (same pattern as the Apple page in keys.js).
//   GET  /api/store-keys/google          the checklist and "Email me the link"
//   POST /api/store-keys/google          (no form data) emails a one-hour signed link to the owner inbox
//   GET  /api/store-keys/google?t=       the upload form
//   POST /api/store-keys/google          (multipart, with t) checks each file live with Google, then stores it
// Files: the Firebase service account key (.json; sealed like the Apple keys, kinds FIREBASE_ACCOUNT and, unless a
// separate one is given, GOOGLE_PLAY_ACCOUNT) and google-services.json (the Android app's Firebase config; it ships
// inside the app, so it is not secret: kept in R2 at store-app/<scope>/google-services.json).
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { OWNER, OWNER_BUNDLE_ID, loadCredential, saveCredential } from "./keys.js";
import { checkFirebase, checkPlay, parseGoogleServices, parseServiceAccount } from "./google.js";

const LINK_KIND = "googlekeys";
const LINK_TTL_DAYS = 1 / 24;
const MAX_FILE_BYTES = 16384;
const servicesKey = (scope) => `store-app/${scope}/google-services.json`;
const status = (ok) => (ok === true ? "VERIFIED" : ok === false ? "FAILED" : "UNVERIFIED");
const mark = (ok) => (ok === true ? "✅" : ok === false ? "❌" : "⚠️");

async function loadGoogleServices(env, scope) {
  const obj = await env.ASSETS.get(servicesKey(scope));
  return obj ? obj.text() : null;
}

const CHECKLIST = `<ol>
<li><strong>Make a Firebase project.</strong> Open <a href="https://console.firebase.google.com">console.firebase.google.com</a>, click Create a project, name it <strong>Menu-made apps</strong>. Google Analytics can be off.</li>
<li><strong>Add the Android app.</strong> In the project, click Add app, then the Android icon. Package name: <strong>${OWNER_BUNDLE_ID}</strong>. Nickname: Sample Cafe. Leave SHA-1 empty. Click Register app, then <strong>Download google-services.json</strong>. Skip the remaining steps (Next, Next, Continue to console).</li>
<li><strong>Check push is on.</strong> Gear icon, Project settings, Cloud Messaging tab: "Firebase Cloud Messaging API (V1)" should say Enabled. If it says Disabled, use its menu to enable it.</li>
<li><strong>Turn on Google Play uploads.</strong> Open <a href="https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com">Google Play Android Developer API</a>, choose the <strong>Menu-made apps</strong> project at the top of the page, click Enable.</li>
<li><strong>Download the key.</strong> Back in Firebase: Project settings, Service accounts tab, <strong>Generate new private key</strong>, Generate key. A .json file lands in Downloads.</li>
<li><strong>Upload both files</strong> with the button below (the link works for one hour). The page then shows the account's email address.</li>
<li><strong>Create the Play app and invite the account.</strong> In <a href="https://play.google.com/console">Play Console</a>: Create app, name <strong>Sample Cafe test</strong>, App, Free, accept the declarations. Then Users and permissions, Invite new users, paste the email the upload page showed, App permissions: add Sample Cafe test with Admin (all permissions). Send the invite, then press <strong>Check saved files again</strong> on the upload page.</li>
<li><strong>Tell Claude.</strong> The first Android build then emails you the app file. Google only accepts a new app's first file by hand: Play Console, Test and release, Internal testing, Create new release, upload the file, accept Google's app signing. After that every build uploads itself.</li>
</ol>`;

function formPage(token, error) {
  return simplePage(error ? 400 : 200, "Google files for Android builds", `${error ? `<p style="color:#a11"><strong>${escapeHtml(error)}</strong></p>` : ""}
<p>Both files are in Downloads. Already uploaded? Leave the boxes empty and press <strong>Check and save</strong> to check the saved files again.</p>
<form method="post" action="/api/store-keys/google" enctype="multipart/form-data">
<input type="hidden" name="t" value="${escapeHtml(token)}">
<h2 style="font-size:18px">1. Firebase service account key</h2>
<p>The .json file from Project settings, Service accounts (named like <code>menu-made-apps-firebase-adminsdk-….json</code>).</p>
<p><input type="file" name="sa_file" accept=".json,application/json"></p>
<h2 style="font-size:18px">2. google-services.json</h2>
<p><input type="file" name="services_file" accept=".json,application/json"></p>
<details><summary style="font-size:14px">Made a separate account just for Google Play?</summary><p><input type="file" name="play_file" accept=".json,application/json"></p><p style="font-size:13px">Not needed: the Firebase account above is used for Google Play too.</p></details>
<p><button type="submit">Check and save</button></p>
</form>
<p style="font-size:13px">Files are checked with Google, then stored encrypted. They're never shown or emailed back.</p>`);
}

async function emailLink(env) {
  const inbox = ownerEmailAddress(env);
  const link = `${publicBaseUrl(env)}/api/store-keys/google?t=${encodeURIComponent(await signLinkToken(env, { kind: LINK_KIND, id: OWNER, ttlDays: LINK_TTL_DAYS }))}`;
  const bucket = Math.floor(Date.now() / 600000);
  const sent = await sendTransactionalEmail(env, {
    to: inbox,
    subject: "Upload your Google files for Android builds",
    html: brandedEmailHtml({ preheader: "One-hour link to hand over the Firebase files.", eyebrow: "STORE APP", heading: "Upload your Google files",
      paragraphs: ["Open this link on the Mac that has the two .json files in Downloads. It works for one hour.", "If you didn't ask for this, ignore it."],
      buttons: [{ label: "Upload files", url: link, primary: true }] }),
    text: `Upload your Google files (link works for one hour):\n${link}`,
    idempotencyKey: `google-keys-link/${bucket}`, purpose: "OWNER_ACTION", templateKey: "google_keys_link_v1"
  }).catch((error) => ({ ok: false, error }));
  if (!sent?.ok) return simplePage(502, "The email didn't send", "<p>Please try again in a minute.</p>");
  return simplePage(200, "Check your email", `<p>We sent the link to <strong>${escapeHtml(inbox)}</strong>. If you pressed the button a moment ago, the earlier email is the one to use.</p>`);
}

async function readJsonFile(file) {
  if (!file || typeof file === "string" || !file.size) return null;
  if (file.size > MAX_FILE_BYTES) return { error: "too big" };
  return { text: await file.text() };
}

async function handleGoogleKeys(request, env, { fetchImpl = fetch } = {}) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const expired = () => simplePage(403, "This link has expired", `<p>Open <a href="/api/store-keys/google">the Google files page</a> again to get a fresh one.</p>`);
  const url = new URL(request.url);
  const isUpload = request.method === "POST" && /multipart\/form-data/i.test(request.headers.get("Content-Type") || "");
  if (request.method === "GET" && !url.searchParams.get("t")) {
    return simplePage(200, "Android setup: Firebase and Google Play", `<p>About 15 minutes on the Mac, once. These let Menu-made build the Android app, send its notifications and upload builds to Google Play internal testing.</p>
${CHECKLIST}
<p>We'll email a one-hour upload link to <strong>${escapeHtml(ownerEmailAddress(env))}</strong>.</p>
<form method="post" action="/api/store-keys/google"><button type="submit">Email me the upload link</button></form>`);
  }
  if (request.method === "POST" && !isUpload) return emailLink(env);
  if (request.method === "GET") {
    const token = url.searchParams.get("t");
    const payload = await verifyLinkToken(env, token, [LINK_KIND], OWNER);
    return !payload || payload.expired ? expired() : formPage(token, null);
  }
  if (!isUpload) return simplePage(405, "Not allowed", "<p>Use the form.</p>");
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], OWNER);
  if (!payload || payload.expired) return expired();

  const saFile = await readJsonFile(form.get("sa_file"));
  const servicesFile = await readJsonFile(form.get("services_file"));
  const playFile = await readJsonFile(form.get("play_file"));
  for (const [file, label] of [[saFile, "service account key"], [servicesFile, "google-services.json"], [playFile, "Google Play key"]]) if (file?.error) return formPage(token, `The ${label} file is too big to be the right file.`);
  // People mix the two files up: sort them by what they are, not which box they went in.
  const uploads = [saFile, servicesFile].filter(Boolean).map((f) => f.text);
  const saText = uploads.find((t) => parseServiceAccount(t));
  const servicesText = uploads.find((t) => parseGoogleServices(t));
  if (uploads.length && !saText && !servicesText) return formPage(token, "Those files aren't the Firebase service account key or google-services.json.");
  if (saFile && !saText && !servicesFile) return formPage(token, "That file isn't a service account key. Use Project settings, Service accounts, Generate new private key.");
  // Two files sent but one isn't recognised: say so rather than saving only the other (Oct 30, 2026: a second file was
  // dropped without a word).
  if (uploads.length === 2 && !(saText && servicesText)) return formPage(token, saText
    ? "One file is the key, but the other isn't google-services.json (Firebase, Project settings, General, your Android app, google-services.json)."
    : "One file is google-services.json, but the other isn't the Firebase key. Use Project settings, Service accounts, Generate new private key: the file is named like menu-made-apps-firebase-adminsdk-….json.");
  if (playFile && !parseServiceAccount(playFile.text)) return formPage(token, "The Google Play file isn't a service account key.");
  let services = null;
  if (servicesText) {
    services = parseGoogleServices(servicesText);
    if (!services.packages.includes(OWNER_BUNDLE_ID)) return formPage(token, `That google-services.json is for ${services.packages.join(", ")}, not ${OWNER_BUNDLE_ID}. Add an Android app with package name ${OWNER_BUNDLE_ID} (step 2) and download its file.`);
    await env.ASSETS.put(servicesKey(OWNER), servicesText, { httpMetadata: { contentType: "application/json" } });
  } else {
    const saved = await loadGoogleServices(env, OWNER);
    services = saved ? parseGoogleServices(saved) : null;
  }

  const savedFirebase = saText ? null : await loadCredential(env, OWNER, "FIREBASE_ACCOUNT");
  const firebaseText = saText || savedFirebase?.p8 || null;
  const savedPlay = playFile || saText ? null : await loadCredential(env, OWNER, "GOOGLE_PLAY_ACCOUNT");
  const playText = playFile?.text || saText || savedPlay?.p8 || null;
  if (!firebaseText && !services) return formPage(token, "Choose at least one file.");

  const lines = [];
  if (services) lines.push(`✅ <strong>google-services.json</strong>: Firebase project ${escapeHtml(services.projectId)}, app ${OWNER_BUNDLE_ID}.`);
  else lines.push("⚠️ <strong>google-services.json</strong>: not uploaded yet (step 2).");
  let inviteEmail = null;
  if (firebaseText) {
    const sa = parseServiceAccount(firebaseText);
    const projectId = services?.projectId || sa.project_id;
    const check = services && sa.project_id && sa.project_id !== services.projectId
      ? { ok: false, note: `This key is for project ${sa.project_id}, but google-services.json is for ${services.projectId}. Both must come from the same Firebase project.` }
      : await checkFirebase(sa, projectId, { fetchImpl });
    await saveCredential(env, OWNER, "FIREBASE_ACCOUNT", { keyId: sa.client_email, teamId: projectId, p8: firebaseText, status: status(check.ok), note: check.note });
    lines.push(`${mark(check.ok)} <strong>Push (Firebase)</strong>: ${escapeHtml(check.note)}`);
  }
  if (playText) {
    const sa = parseServiceAccount(playText);
    inviteEmail = sa.client_email;
    const check = await checkPlay(sa, OWNER_BUNDLE_ID, { fetchImpl });
    await saveCredential(env, OWNER, "GOOGLE_PLAY_ACCOUNT", { keyId: sa.client_email, teamId: sa.project_id, p8: playText, status: status(check.ok), note: check.note });
    lines.push(`${mark(check.ok)} <strong>Google Play</strong>: ${escapeHtml(check.note)}`);
  }
  const allGood = !lines.some((l) => l.startsWith("❌"));
  return simplePage(200, allGood ? "Google files saved" : "Google files saved, something to fix", `<p>${lines.join("</p><p>")}</p>
${inviteEmail ? `<p>The email to invite in Play Console (step 7):<br><input readonly value="${escapeHtml(inviteEmail)}" size="60" style="font:inherit;padding:8px;width:100%;box-sizing:border-box"></p>` : ""}
<form method="post" action="/api/store-keys/google" enctype="multipart/form-data"><input type="hidden" name="t" value="${escapeHtml(token)}">
<p><button type="submit">Check saved files again</button></p></form>
<p style="font-size:13px">You can delete the two .json files from Downloads once everything shows ✅ (or ⚠️ only for the first upload).</p>`);
}

export { CHECKLIST, LINK_KIND, handleGoogleKeys, loadGoogleServices, servicesKey };
