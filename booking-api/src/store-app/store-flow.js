// Stage 11 part 2: the Store App as a product, after checkout.
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
// STORE_APP_CARE_V1 (Website & App Care, app tier) sends the same monthly email as the Guest App plan.
//
//   GET/POST /api/store-app/<id>/done?t=   the buyer's or the owner's Done button (the link kind says whose)
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { loadDeliveryContext } from "../approvals/release.js";
import { runGuestAppMonthStep, runGuestAppSetupStep } from "../producers/guest-app/app-step.js";
import { keysReady } from "./restaurant-keys.js";

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
    `<strong>Apple</strong>: 1. Enroll in the Apple Developer Program as an organization at developer.apple.com/programs/enroll ($99 a year, paid to Apple). Apple asks for a D-U-N-S number, which is free from Dun &amp; Bradstreet; getting one can take a few days. 2. In App Store Connect, Users and Access, invite <strong>${escapeHtml(owner)}</strong> with the Admin role.`,
    `<strong>Google</strong>: 1. Create a Google Play developer account as an organization at play.google.com/console/signup ($25 once, paid to Google). 2. In Play Console, Users and permissions, invite <strong>${escapeHtml(owner)}</strong> with Admin (all permissions).`,
    "Press the button once both invites are sent. We do the rest: app records, builds, store listings and submission. App Store and Google Play approval is decided by Apple and Google and isn't guaranteed."
  ];
  return sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: reminder ? `Reminder: set up your store accounts for ${appName}` : `Next step for ${appName}: your App Store and Google Play accounts`,
    html: brandedEmailHtml({ preheader: "Two developer accounts and two invites, then we take it from there.", eyebrow: "STORE APP", heading: "Set up your store accounts", paragraphs: steps, buttons: [{ label: "I've sent both invites", url: link, primary: true }] }),
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
  const rows = [["Restaurant", context.business_name || "-"], ["App name", appName], ["Bundle id / package name", storeApp.bundle_id], ["Content", `${slug}.menu-made.com/app`], ["Support URL", support], ["Privacy policy URL", privacy]];
  const steps = [
    `${escapeHtml(context.business_name || "A restaurant")} sent the store invites for ${escapeHtml(appName)}. These are the steps Apple and Google only allow on their websites (the hands-on part of the Store App, about 30-60 minutes).`,
    "1. Accept both invites (App Store Connect email from Apple, Play Console email from Google).",
    `2. Make the restaurant's keys and hand them over on the key page (it lists every click and emails you a one-hour upload link): <a href="${keysPage}">${escapeHtml(keysPage)}</a>. Apple App ID <strong>${escapeHtml(storeApp.bundle_id)}</strong> with Push Notifications, a push key and an App Store Connect API key (Admin) in the restaurant's team; the Android app <strong>${escapeHtml(storeApp.bundle_id)}</strong> in Menu-made's Firebase project; Menu-made's Play account invited in the restaurant's Play Console.`,
    `3. App Store Connect: New App, name ${escapeHtml(appName)}, bundle id ${escapeHtml(storeApp.bundle_id)}, SKU ${escapeHtml(storeApp.bundle_id)}. App Privacy: the app collects no name, email or phone number; rewards use a random card number kept on the phone; notifications use Apple's device token. Age Rating: answer None / No throughout (a restaurant's menu; if the menu lists alcohol, answer the alcohol question as Infrequent/Mild). Pricing and Availability: Free, all countries.`,
    `4. Play Console: Create app ${escapeHtml(appName)}, App, Free. Data safety and content rating with the same facts (a restaurant's menu, hours and rewards; no user-generated content; no ads). App content: target audience 18+ (or 13+), no ads, app access: no sign-in needed.`,
    "Press Done when steps 1-4 are finished. Done checks the keys first and says what's missing, if anything."
  ];
  return sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: reminder ? `Reminder: store setup for ${appName}` : `Store App: hands-on setup for ${appName}`,
    html: brandedEmailHtml({ preheader: "The website-only steps for a new Store App.", eyebrow: "STORE APP", heading: `Set up ${appName} in the stores`, paragraphs: steps, rows, buttons: [{ label: "Done", url: link, primary: true }] }),
    text: `${steps.map((p) => p.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")).join("\n")}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nDone: ${link}`,
    idempotencyKey: `store-app-owner/${storeApp.id}/${storeApp.reminders}`, purpose: "OWNER_ACTION", templateKey: "store_app_owner_setup_v1"
  });
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
    if (row.status === "WAITING_APP") {
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

export { BUYER_KIND, OWNER_KIND, advanceStoreApps, bundleIdFor, handleStoreAppDone, runStoreAppCareStep, runStoreAppSetupStep };
