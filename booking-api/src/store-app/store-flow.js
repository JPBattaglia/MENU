// Stage 11 part 2: the Mobile App as a product, after checkout.
//
// STORE_APP_SETUP_V1 PRODUCE is the Guest App build (same intake form, same content: the native app reads it from
// <app>/api/content), approved by the owner like a Guest App. That step also opens a store_apps row (migration 0025),
// which the 5-minute tick then moves along:
//   WAITING_APP           the app content isn't approved yet
//   WAITING_STORE_ACCESS  buyer emailed the store-account checklist (enroll as an organization, invite Menu-made);
//                         reminders every 3 days (at most 5); the buyer presses a signed Done link
//   WAITING_OWNER_SETUP   owner emailed the hands-on checklist (accept the invites, app records, privacy forms) with
//                         the exact values; reminders every 2 days; the owner presses a signed Done link
//                         (the Done button refuses until the restaurant's keys are uploaded and checked:
//                         /api/store-keys/app/<id>, restaurant-keys.js)
//   READY_TO_BUILD        next: the per-restaurant build (not built yet, see handbook)
// STORE_APP_CARE_V1 (Mobile App Care) sends the same monthly email as the Guest App plan.
//
//   GET/POST /api/store-app/<id>/done?t=   the buyer's or the owner's Done button (the link kind says whose)
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { loadDeliveryContext } from "../approvals/release.js";
import { runGuestAppMonthStep, runGuestAppSetupStep } from "../producers/guest-app/app-step.js";
import { keysReady } from "./restaurant-keys.js";
import { OWNER, loadCredential } from "./keys.js";
import { ensureBundleId } from "./apple.js";
import { firebaseAndroidConfig, mergeGoogleServices, parseGoogleServices } from "./google.js";
import { loadGoogleServices, servicesKey } from "./google-keys.js";

const BUYER_KIND = "storeapp-buyer";
const OWNER_KIND = "storeapp-owner";
const BUYER_REMIND_DAYS = 3;
const OWNER_REMIND_DAYS = 2;
const MAX_REMINDERS = 5;
const DAY = 86400000;

// com.menumade.<slug letters and digits>: valid as an Apple bundle id and an Android package name.
function bundleIdFor(slug) {
  let name = String(slug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!name) name = "app";
  if (!/^[a-z]/.test(name)) name = `app${name}`;
  return `com.menumade.${name.slice(0, 40)}`;
}

async function runStoreAppSetupStep(targetStep, env, deps) {
  const result = await runGuestAppSetupStep(targetStep, env, deps);
  const app = await env.DB.prepare(`SELECT slug, business_id, customer_id FROM guest_apps WHERE project_id = ?`).bind(targetStep.project_id).first().catch(() => null);
  if (app?.slug) {
    const t = nowIso();
    let bundle = bundleIdFor(app.slug);
    const taken = await env.DB.prepare(`SELECT project_id FROM store_apps WHERE bundle_id = ?`).bind(bundle).first();
    if (taken && taken.project_id !== targetStep.project_id) bundle = `${bundle}${targetStep.project_id.replace(/[^0-9a-z]/g, "").slice(0, 6)}`;
    await env.DB.prepare(`INSERT OR IGNORE INTO store_apps (id, project_id, business_id, customer_id, bundle_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'WAITING_APP', ?, ?)`)
      .bind(crypto.randomUUID(), targetStep.project_id, app.business_id, app.customer_id, bundle, t, t).run();
  }
  return result;
}

const runStoreAppCareStep = (targetStep, env) => runGuestAppMonthStep(targetStep, env);

async function doneLink(env, storeApp, kind) {
  const token = await signLinkToken(env, { kind, id: storeApp.id, ttlDays: kind === BUYER_KIND ? 90 : 30 });
  return `${publicBaseUrl(env)}/api/store-app/${storeApp.id}/done?t=${encodeURIComponent(token)}`;
}

async function appInfo(env, storeApp) {
  const app = await env.DB.prepare(`SELECT id, slug, data_json FROM guest_apps WHERE project_id = ?`).bind(storeApp.project_id).first();
  let data = {};
  try { data = JSON.parse(app?.data_json || "{}"); } catch { data = {}; }
  return { appName: String(data.app_name || "Your app").slice(0, 30), slug: app?.slug || "" };
}

async function emailBuyer(env, storeApp, context, reminder) {
  const owner = ownerEmailAddress(env);
  const { appName } = await appInfo(env, storeApp);
  const link = await doneLink(env, storeApp, BUYER_KIND);
  const steps = [
    `Your app content for <strong>${escapeHtml(appName)}</strong> is approved. To publish it under your restaurant's name, Apple and Google need it in your own developer accounts. About 30 minutes, once.`,
    `<strong>Apple</strong>: 1. Enroll in the Apple Developer Program as an organization at developer.apple.com/programs/enroll ($99 a year, paid to Apple). Apple asks for a D-U-N-S number, which is free from Dun &amp; Bradstreet; getting one can take a few days. 2. In App Store Connect, Business, declare your trader status as <strong>a trader</strong> (your business) and enter the business address, phone and email; Apple shows these to customers in the EU. 3. In App Store Connect, Users and Access, invite <strong>${escapeHtml(owner)}</strong> with the Admin role.`,
    `<strong>Google</strong>: 1. Create a Google Play developer account as an organization at play.google.com/console/signup ($25 once, paid to Google). 2. When Play Console asks you to declare your trader status, choose <strong>This is a trader account</strong> and use the business address, phone and email; Google shows these to users in the EU. 3. In Play Console, Users and permissions, invite <strong>${escapeHtml(owner)}</strong> with Admin (all permissions).`,
    "Press the button once both invites are sent. We do the rest: app records, builds, store listings and submission. App Store and Google Play approval is decided by Apple and Google and isn't guaranteed."
  ];
  return sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: reminder ? `Reminder: set up your store accounts for ${appName}` : `Next step for ${appName}: your App Store and Google Play accounts`,
    html: brandedEmailHtml({ preheader: "Two developer accounts and two invites, then we take it from there.", eyebrow: "MOBILE APP", heading: "Set up your store accounts", paragraphs: steps, buttons: [{ label: "I've sent both invites", url: link, primary: true }] }),
    text: `${steps.map((p) => p.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")).join("\n\n")}\n\nWhen both invites are sent: ${link}`,
    idempotencyKey: `store-app-buyer/${storeApp.id}/${storeApp.reminders}`, purpose: "ONBOARDING", templateKey: "store_app_accounts_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
}

async function emailOwner(env, storeApp, context, reminder) {
  const { appName, slug } = await appInfo(env, storeApp);
  const link = await doneLink(env, storeApp, OWNER_KIND);
  const support = `${publicBaseUrl(env)}/contact.html`;
  const keysPage = `${publicBaseUrl(env)}/api/store-keys/app/${storeApp.id}`;
  const privacy = `${publicBaseUrl(env)}/privacy.html`;
  const terms = `${publicBaseUrl(env)}/terms.html#app-users`;
  const rows = [["Restaurant", context.business_name || "-"], ["App name", appName], ["Bundle id / package name", storeApp.bundle_id], ["Content", `${slug}.menu-made.com/app`], ["Support URL", support], ["Privacy policy URL", privacy], ["Terms of Service URL", terms]];
  const steps = [
    `${escapeHtml(context.business_name || "A restaurant")} sent the store invites for ${escapeHtml(appName)}. These are the steps Apple and Google only allow on their websites (the hands-on part of the Mobile App, about 30-60 minutes).`,
    "1. Accept both invites (App Store Connect email from Apple, Play Console email from Google).",
    `2. Make the restaurant's keys and hand them over on the key page (it lists every click and emails you a one-hour upload link): <a href="${keysPage}">${escapeHtml(keysPage)}</a>. Apple App ID <strong>${escapeHtml(storeApp.bundle_id)}</strong> with Push Notifications, a push key and an App Store Connect API key (Admin) in the restaurant's team; the Android app <strong>${escapeHtml(storeApp.bundle_id)}</strong> in Menu-made's Firebase project; Menu-made's Play account invited in the restaurant's Play Console.`,
    `3. App Store Connect: New App, name ${escapeHtml(appName)}, bundle id ${escapeHtml(storeApp.bundle_id)}, SKU ${escapeHtml(storeApp.bundle_id)}. App Privacy: the app collects no name, email or phone number; rewards use a random card number kept on the phone; notifications use Apple's device token. Age Rating: answer None / No throughout (a restaurant's menu; if the menu lists alcohol, answer the alcohol question as Infrequent/Mild). Pricing and Availability: Free, all countries.`,
    `4. Play Console: Create app ${escapeHtml(appName)}, App, Free. Data safety and content rating with the same facts (a restaurant's menu, hours and rewards; no user-generated content; no ads). App content: target audience 18+ (or 13+), no ads, app access: no sign-in needed; Trader status: confirm <strong>trader</strong> and enter the Terms of Service URL ${escapeHtml(terms)}.`,
    "Press Done when steps 1-4 are finished. Done checks the keys first and says what's missing, if anything."
  ];
  return sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: reminder ? `Reminder: store setup for ${appName}` : `Mobile App: hands-on setup for ${appName}`,
    html: brandedEmailHtml({ preheader: "The website-only steps for a new Mobile App.", eyebrow: "MOBILE APP", heading: `Set up ${appName} in the stores`, paragraphs: steps, rows, buttons: [{ label: "Done", url: link, primary: true }] }),
    text: `${steps.map((p) => p.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")).join("\n")}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nDone: ${link}`,
    idempotencyKey: `store-app-owner/${storeApp.id}/${storeApp.reminders}`, purpose: "OWNER_ACTION", templateKey: "store_app_owner_setup_v1"
  });
}

// ---------- The owner's own apps (own-apps.js, own_app = 1) ----------
// No buyer step: the app is published on the owner's own accounts with his keys. What the worker can do for him it does
// first: the Apple App ID with Push Notifications (App Store Connect API key) and the Android app in Firebase with its
// google-services.json (Firebase service account). Each is retried by the tick until it works or is done by hand.
async function ownAppPrep(env, storeApp, appName, { fetchImpl = fetch } = {}) {
  const out = { apple: null, firebase: null };
  try {
    const api = await loadCredential(env, OWNER, "APPLE_API_KEY");
    out.apple = api ? await ensureBundleId({ p8: api.p8, keyId: api.keyId, issuerId: api.issuerId }, storeApp.bundle_id, appName, { fetchImpl }) : { ok: false, note: "No App Store Connect key on file" };
  } catch (error) { out.apple = { ok: false, note: String(error?.message || error).slice(0, 160) }; }
  try {
    const current = env.ASSETS ? await loadGoogleServices(env, OWNER) : null;
    if (current && (parseGoogleServices(current)?.packages || []).includes(storeApp.bundle_id)) {
      out.firebase = { ok: true, note: "already in google-services.json" };
    } else {
      const cred = await loadCredential(env, OWNER, "FIREBASE_ACCOUNT");
      const sa = cred ? JSON.parse(cred.p8) : null;
      const projectId = cred?.teamId || sa?.project_id;
      if (!sa || !projectId) out.firebase = { ok: false, note: "No Firebase service account on file" };
      else {
        out.firebase = await firebaseAndroidConfig(sa, projectId, storeApp.bundle_id, appName, { fetchImpl });
        if (out.firebase.ok) {
          const merged = current ? mergeGoogleServices(current, out.firebase.text) : out.firebase.text;
          if (merged) await env.ASSETS.put(servicesKey(OWNER), merged, { httpMetadata: { contentType: "application/json" } });
          else out.firebase = { ok: false, note: "The new google-services.json is for another Firebase project" };
        }
      }
    }
  } catch (error) { out.firebase = { ok: false, note: String(error?.message || error).slice(0, 160) }; }
  const note = `Prep: Apple ${out.apple?.ok ? "done" : `not done (${out.apple?.note || "?"})`}; Firebase ${out.firebase?.ok ? "done" : `not done (${out.firebase?.note || "?"})`}`;
  await env.DB.prepare(`UPDATE store_apps SET note = ?, updated_at = ? WHERE id = ?`).bind(note.slice(0, 400), nowIso(), storeApp.id).run();
  return out;
}

// What each own (hybrid) app collects, for Apple's App Privacy and Play's Data safety. The hybrid apps open
// forms, checkout, ideas and rewards, so "we do not collect data" is wrong for them. Payment card details stay
// on Stripe's page and are never declared. Unknown bundle ids get the Menu-made list (forms + checkout).
const OWN_APP_DATA = {
  "com.menumade.menumade": {
    apple: ["Contact Info > Name", "Contact Info > Email Address", "User Content > Photos or Videos (menu and logo uploads)", "User Content > Other User Content (notes and business details)", "Purchases > Purchase History"],
    play: ["Personal info > Name", "Personal info > Email address", "Photos and videos > Photos", "App activity > Other user-generated content", "Financial info > Purchase history", "Device or other IDs (notification token)"]
  },
  "com.menumade.ninobattaglia": {
    apple: ["Contact Info > Name", "Contact Info > Email Address", "Contact Info > Physical Address (shipping)", "User Content > Other User Content (design ideas)", "Purchases > Purchase History (orders and rewards)", "Identifiers > User ID (the app's member key)"],
    play: ["Personal info > Name", "Personal info > Email address", "Personal info > Address", "App activity > Other user-generated content", "Financial info > Purchase history", "Device or other IDs (member key and notification token)"]
  }
};

function ownAppData(bundleId) {
  return OWN_APP_DATA[bundleId] || OWN_APP_DATA["com.menumade.menumade"];
}

function listHtml(items) {
  return items.map((item) => `<strong>${escapeHtml(item)}</strong>`).join("; ");
}

async function emailOwnerOwnApp(env, storeApp, reminder, prep) {
  const { appName } = await appInfo(env, storeApp);
  const link = await doneLink(env, storeApp, OWNER_KIND);
  const b = escapeHtml(storeApp.bundle_id);
  const n = escapeHtml(appName);
  const privacy = `${publicBaseUrl(env)}/privacy.html`;
  const terms = `${publicBaseUrl(env)}/terms.html#app-users`;
  const appleDone = prep?.apple?.ok;
  const firebaseDone = prep?.firebase?.ok;
  const data = ownAppData(storeApp.bundle_id);
  const steps = [
    `${n} is your own app, published on your Apple developer account and Menu-made's Google Play account. Apple and Google only allow these steps on their websites. Everything else (builds, icons, screenshots, store text, submission) is automatic. About 20 minutes per app.`,
    appleDone ? "Already done for you: the Apple App ID <strong>" + b + "</strong> with Push Notifications." : `<strong>First, the Apple App ID</strong> (couldn't be done automatically: ${escapeHtml(prep?.apple?.note || "unknown")}). Go to <a href="https://developer.apple.com/account/resources/identifiers/add/bundleId">developer.apple.com/account/resources/identifiers/add/bundleId</a>. Choose <strong>App IDs</strong>, Continue, <strong>App</strong>, Continue. Description: ${n}. Bundle ID: Explicit, <strong>${b}</strong>. Scroll to Capabilities and tick <strong>Push Notifications</strong>. Continue, Register.`,
    `<strong>1. App Store Connect: make the app.</strong> Go to <a href="https://appstoreconnect.apple.com/apps">appstoreconnect.apple.com/apps</a>. Click the blue <strong>+</strong> next to "Apps" at the top left, then <strong>New App</strong>. Tick <strong>iOS</strong>. Name: <strong>${n}</strong> (if Apple says the name is taken, add " App" to the end). Primary Language: English (U.S.). Bundle ID: pick <strong>${b}</strong> from the list. SKU: <strong>${b}</strong>. User Access: Full Access. Click <strong>Create</strong>.`,
    `<strong>2. App Store Connect: the three forms.</strong> Still in the app: (a) left menu <strong>App Privacy</strong>, Get Started, answer <strong>Yes, we collect data from this app</strong>, Next. Tick only these: ${listHtml(data.apple)}. Leave Payment Info unticked (cards are typed on Stripe's page). Save. Then for each ticked item click <strong>Set Up</strong>: purpose <strong>App Functionality</strong> only, Next; linked to the user's identity: <strong>Yes</strong>, Next; used for tracking: <strong>No</strong>, Save. When every item shows set up, click <strong>Publish</strong> at the top right. (b) left menu <strong>App Information</strong>, Age Rating, Set Up Age Rating, answer <strong>None</strong> or <strong>No</strong> to every question, Done, then <strong>Save</strong>. (c) left menu <strong>Pricing and Availability</strong>, Price: <strong>Free</strong>, Availability: all countries, <strong>Save</strong>.`,
    `<strong>3. Google Play Console: make the app.</strong> Go to <a href="https://play.google.com/console">play.google.com/console</a> (signed in as menu.automate@gmail.com). Click <strong>Create app</strong> at the top right. App name: <strong>${n}</strong>. Default language: English (United States). App or game: <strong>App</strong>. Free or paid: <strong>Free</strong>. Tick both declarations, click <strong>Create app</strong>. The package name ${b} is set by the first upload.`,
    `<strong>4. Play Console: the app content forms.</strong> In the new app, left menu <strong>Policy and programs</strong>, <strong>App content</strong>, and complete each card: Privacy policy: <strong>${escapeHtml(privacy)}</strong>. App access: <strong>All functionality is available without any special access</strong>. Ads: <strong>No</strong>. Content rating: Start questionnaire, email info@menu-made.com, category <strong>All other app types</strong>, answer <strong>No</strong> to every question, Save, Submit. Target audience: <strong>18 and over</strong> only. Data safety: Start, "Does your app collect or share any of the required user data types?" <strong>Yes</strong>; "Is all of the user data collected by your app encrypted in transit?" <strong>Yes</strong>; account creation: <strong>My app does not allow users to create an account</strong>; Next. Tick only these data types: ${listHtml(data.play)}. Next. For each one click the arrow: <strong>Collected</strong> (not Shared), not processed ephemerally, <strong>Users can choose whether this data is collected</strong>, purpose <strong>App functionality</strong>, Save. Then Next, <strong>Save</strong>. Government apps, Financial features, Health apps: <strong>No</strong> / <strong>none</strong>. If asked for trader status: <strong>trader</strong>, Terms of Service URL <strong>${escapeHtml(terms)}</strong>.`,
    `<strong>5. Play Console: let Menu-made's builder upload.</strong> Left menu (all apps view) <strong>Users and permissions</strong>. Click <strong>firebase-adminsdk-fbsvc@menu-made-apps.iam.gserviceaccount.com</strong>, tab <strong>App permissions</strong>, <strong>Add app</strong>, tick <strong>${n}</strong>, Apply, tick <strong>Admin (all permissions)</strong>, Apply, then <strong>Save changes</strong> at the bottom.`,
    firebaseDone ? "Already done for you: the Android app " + b + " in Firebase (for notifications)." : `<strong>6. Firebase</strong> (couldn't be done automatically: ${escapeHtml(prep?.firebase?.note || "unknown")}). Go to <a href="https://console.firebase.google.com">console.firebase.google.com</a>, open <strong>Menu-made apps</strong>, click <strong>Add app</strong>, the Android icon. Package name: <strong>${b}</strong>. Nickname: ${n}. Click Register app, then <strong>Download google-services.json</strong>, and upload it on <a href="${escapeHtml(publicBaseUrl(env))}/api/store-keys/google">menu-made.com/api/store-keys/google</a> (it emails you the upload link).`,
    "Press Done when the steps above are finished. The builds start by themselves. Google only takes a new app's first file by hand: you'll get an email with that file and where to drop it, and then a preview of the store listing to approve before anything is submitted."
  ];
  return sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: reminder ? `Reminder: store setup for ${appName}` : `Your own Mobile App: store setup for ${appName}`,
    html: brandedEmailHtml({ preheader: "The website-only steps for your own app.", eyebrow: "MOBILE APP", heading: `Set up ${appName} in the stores`, paragraphs: steps, rows: [["App name", appName], ["Bundle id / package name", storeApp.bundle_id]], buttons: [{ label: "Done", url: link, primary: true }] }),
    text: `${steps.map((p) => p.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")).join("\n\n")}\n\nDone: ${link}`,
    idempotencyKey: `store-app-owner-own/${storeApp.id}/${storeApp.reminders}/${appleDone ? 1 : 0}${firebaseDone ? 1 : 0}`, purpose: "OWNER_ACTION", templateKey: "store_app_owner_own_v1"
  });
}

async function isSiteApp(env, projectId) {
  const row = await env.DB.prepare(`SELECT json_extract(data_json, '$.site_url') AS site FROM guest_apps WHERE project_id = ?`).bind(projectId).first();
  return /^https:\/\//.test(String(row?.site || ""));
}

async function appApproved(env, projectId) {
  return Boolean(await env.DB.prepare(`SELECT 1 AS ok FROM deliverables WHERE project_id = ? AND deliverable_type = 'APP_BUILD' AND status = 'FINAL' AND customer_visible = 1 LIMIT 1`).bind(projectId).first());
}

// From the 5-minute tick. Reads only the open rows (partial index).
// only = one store app id (the self-test runs its own scaffold without touching anyone else's).
async function advanceStoreApps(env, now = Date.now(), { only = null } = {}) {
  if (!env.DB) return { moved: 0 };
  const rows = (only
    ? await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ? AND status IN ('WAITING_APP', 'WAITING_STORE_ACCESS', 'WAITING_OWNER_SETUP')`).bind(only).all()
    : await env.DB.prepare(`SELECT * FROM store_apps WHERE status IN ('WAITING_APP', 'WAITING_STORE_ACCESS', 'WAITING_OWNER_SETUP') ORDER BY updated_at LIMIT 10`).all()).results || [];
  let moved = 0;
  for (const row of rows) {
    const since = row.last_email_at ? now - Date.parse(row.last_email_at) : Infinity;
    if (row.status === "WAITING_APP" && Number(row.own_app) === 1) {
      // A site app shows the business's own website, so there are no app screens to approve.
      if (!(await isSiteApp(env, row.project_id)) && !(await appApproved(env, row.project_id))) continue;
      const { appName } = await appInfo(env, row);
      const prep = await ownAppPrep(env, row, appName);
      const sent = await emailOwnerOwnApp(env, { ...row, reminders: 0 }, false, prep).catch(() => ({ ok: false }));
      if (!sent?.ok) continue;
      await env.DB.prepare(`UPDATE store_apps SET status = 'WAITING_OWNER_SETUP', last_email_at = ?, reminders = 0, updated_at = ? WHERE id = ? AND status = 'WAITING_APP'`).bind(nowIso(), nowIso(), row.id).run();
      moved++;
    } else if (row.status === "WAITING_OWNER_SETUP" && Number(row.own_app) === 1) {
      // Keep trying what the worker can do itself (until both are done), and remind every 2 days.
      // At most once an hour (each try is a few Apple and Google calls and one write).
      if (!/Apple done; Firebase done/.test(row.note || "") && now - Date.parse(row.updated_at || 0) > 3600000) await ownAppPrep(env, row, (await appInfo(env, row)).appName).catch(() => null);
      if (since > OWNER_REMIND_DAYS * DAY && row.reminders < MAX_REMINDERS) {
        const fresh = await env.DB.prepare(`SELECT note FROM store_apps WHERE id = ?`).bind(row.id).first();
        const done = (what) => new RegExp(`${what} done`).test(fresh?.note || "");
        const sent = await emailOwnerOwnApp(env, { ...row, reminders: row.reminders + 1 }, true, { apple: { ok: done("Apple") }, firebase: { ok: done("Firebase") } }).catch(() => ({ ok: false }));
        if (sent?.ok) await env.DB.prepare(`UPDATE store_apps SET last_email_at = ?, reminders = reminders + 1, updated_at = ? WHERE id = ?`).bind(nowIso(), nowIso(), row.id).run();
      }
    } else if (row.status === "WAITING_APP") {
      if (!(await appApproved(env, row.project_id))) continue;
      const context = await loadDeliveryContext(row.project_id, env);
      if (!context?.customer_email) continue;
      const sent = await emailBuyer(env, { ...row, reminders: 0 }, context, false).catch(() => ({ ok: false }));
      if (!sent?.ok) continue;
      await env.DB.prepare(`UPDATE store_apps SET status = 'WAITING_STORE_ACCESS', last_email_at = ?, reminders = 0, updated_at = ? WHERE id = ? AND status = 'WAITING_APP'`).bind(nowIso(), nowIso(), row.id).run();
      moved++;
    } else if (row.status === "WAITING_STORE_ACCESS" && since > BUYER_REMIND_DAYS * DAY && row.reminders < MAX_REMINDERS) {
      const context = await loadDeliveryContext(row.project_id, env);
      if (!context?.customer_email) continue;
      const sent = await emailBuyer(env, { ...row, reminders: row.reminders + 1 }, context, true).catch(() => ({ ok: false }));
      if (sent?.ok) await env.DB.prepare(`UPDATE store_apps SET last_email_at = ?, reminders = reminders + 1, updated_at = ? WHERE id = ?`).bind(nowIso(), nowIso(), row.id).run();
    } else if (row.status === "WAITING_OWNER_SETUP" && since > OWNER_REMIND_DAYS * DAY && row.reminders < MAX_REMINDERS) {
      const context = await loadDeliveryContext(row.project_id, env);
      if (!context) continue;
      const sent = await emailOwner(env, { ...row, reminders: row.reminders + 1 }, context, true).catch(() => ({ ok: false }));
      if (sent?.ok) await env.DB.prepare(`UPDATE store_apps SET last_email_at = ?, reminders = reminders + 1, updated_at = ? WHERE id = ?`).bind(nowIso(), nowIso(), row.id).run();
    }
  }
  return { moved };
}

async function handleStoreAppDone(request, env, id) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const url = new URL(request.url);
  let token = url.searchParams.get("t") || "";
  if (request.method === "POST") { try { token = String((await request.formData()).get("t") || token); } catch { /* keep the query token */ } }
  const payload = await verifyLinkToken(env, token, [BUYER_KIND, OWNER_KIND], id);
  if (!payload || payload.expired) return simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest email and we'll send a fresh one.</p>");
  const row = await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ?`).bind(id).first();
  if (!row) return simplePage(404, "Not found", "<p>Reply to your latest email and we'll help.</p>");
  const buyer = payload.k === BUYER_KIND;
  const expected = buyer ? "WAITING_STORE_ACCESS" : "WAITING_OWNER_SETUP";
  if (row.status !== expected) {
    return simplePage(200, "Already done", buyer ? "<p>Thank you, we have it. We'll email you as your app moves through the stores.</p>" : "<p>This step is already marked done.</p>");
  }
  const keys = buyer ? null : await keysReady(env, row);
  if (keys && !keys.ready) {
    return simplePage(409, "Keys still needed", `<p>Before the build can start, upload ${escapeHtml(keys.missing.join(", "))} on the <a href="/api/store-keys/app/${escapeHtml(id)}">key page</a>, then press Done again.</p>`);
  }
  if (request.method === "GET") {
    return simplePage(200, buyer ? "Both invites sent?" : "Store setup finished?", `<p>${buyer ? "Press the button once you've invited Menu-made in both App Store Connect and Play Console." : "Press the button once steps 1-4 of the checklist are finished for this app."}</p>
<form method="post" action="/api/store-app/${escapeHtml(id)}/done"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">${buyer ? "Yes, both invites are sent" : "Yes, it's done"}</button></form>`);
  }
  const t = nowIso();
  const next = buyer ? "WAITING_OWNER_SETUP" : "READY_TO_BUILD";
  const changed = await env.DB.prepare(`UPDATE store_apps SET status = ?, ${buyer ? "buyer_done_at" : "owner_done_at"} = ?, reminders = 0, last_email_at = ?, updated_at = ? WHERE id = ? AND status = ?`)
    .bind(next, t, t, t, id, expected).run();
  if (Number(changed.meta?.changes || 0) && buyer) {
    const context = await loadDeliveryContext(row.project_id, env);
    if (context) await emailOwner(env, { ...row, status: next, reminders: 0 }, context, false).catch(() => null);
  }
  return simplePage(200, "Thank you", buyer ? "<p>We'll accept the invites and set up your app in both stores. You'll get an email when it's submitted to Apple and Google.</p>" : "<p>Marked done. The build step picks it up next.</p>");
}

export { ownAppPrep, emailOwnerOwnApp, BUYER_KIND, OWNER_KIND, advanceStoreApps, bundleIdFor, handleStoreAppDone, runStoreAppCareStep, runStoreAppSetupStep };
