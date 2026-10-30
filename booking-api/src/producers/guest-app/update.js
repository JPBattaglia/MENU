// Guest App updates (stage 8): the link in the monthly and delivery emails opens the app's current answers. Saving
// rebuilds the app with its approved icons, runs every check, and publishes it straight away (the owner already approved
// the app and its icons; only the text changes here). The address, logo and brand colour are fixed after setup because
// the icons are drawn from them; those changes go through a reply to the email.
//   GET/POST /api/app-update/<appId>?t=<token>     (token kind "appupdate")
import { escapeHtml } from "../../lib/email.js";
import { nowIso, simplePage } from "../../lib/http.js";
import { verifyLinkToken } from "../../lib/links.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { UPDATE_LINK_KIND, appUrl, loadLiveApp } from "./app-step.js";
import { buildApp } from "./build.js";
import { checkApp } from "./check.js";
import { FIELDS, formPage, readValues, validate } from "./intake.js";
import { engagementSettings, queuePush } from "./engage.js";

const UPDATE_FIELDS = FIELDS.filter((f) => !["subdomain", "brand_color"].includes(f.key));

async function planActive(env, businessId) {
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM entitlements WHERE business_id = ? AND entitlement_type IN ('GUEST_APP', 'STORE_APP_CARE') AND status = 'ACTIVE' LIMIT 1`).bind(businessId).first();
  return Boolean(row);
}

async function publishUpdate(env, live, values) {
  const app = { ...live.data, ...values, brand_color: live.data.brand_color || "" };
  const version = crypto.randomUUID().slice(0, 8);
  const built = buildApp(app, { version, hasLogo: Boolean(live.build.has_logo) });
  const sizes = Object.fromEntries((live.build.icons || []).map((i) => [i.path, i.size]));
  const problems = checkApp({ files: built.files, icons: sizes, app });
  if (problems.length) return { problems };
  const context = await loadDeliveryContext(live.project_id, env);
  if (!context) return { problems: ["The app's project could not be loaded"] };
  const build = { version: 1, slug: live.slug, built_at: nowIso(), has_logo: Boolean(live.build.has_logo), files: { ...built.files, ...(live.build.files["qr.svg"] ? { "qr.svg": live.build.files["qr.svg"] } : {}) }, icons: live.build.icons, app };
  const stored = await storeDeliverable(env, context, {
    type: "APP_BUILD", filename: `${live.slug}-app-update.json`, mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify(build)), folder: "app-build",
    metadata: { app: { slug: live.slug, app_id: live.id, name: app.app_name, short_name: JSON.parse(built.files["manifest.webmanifest"]).short_name, update: true } }
  });
  const t = nowIso();
  await env.DB.prepare(`UPDATE deliverables SET status = 'FINAL', customer_visible = 1, delivered_at = ? WHERE id = ?`).bind(t, stored.deliverableId).run();
  await env.DB.prepare(`UPDATE guest_apps SET data_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(app), t, live.id).run();
  // A new special goes out as a notification when the owner chose that (the daily limit still applies).
  let notified = null;
  const special = String(values.specials || "").trim();
  if (special && special !== String(live.data.specials || "").trim() && engagementSettings(app).pushSpecials) {
    notified = await queuePush(env, live.id, { title: app.app_name, body: special, source: "SPECIAL" }).catch(() => null);
  }
  return { problems: [], deliverableId: stored.deliverableId, notified };
}

async function handleAppUpdate(request, env, appId) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest email and we'll send a fresh one.</p>");
  const token = request.method === "GET" ? new URL(request.url).searchParams.get("t") || "" : null;
  let form = null;
  if (request.method === "POST") {
    try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  }
  const t = token ?? String(form.get("t") || "");
  const payload = await verifyLinkToken(env, t, [UPDATE_LINK_KIND], appId);
  if (!payload || payload.expired) return denied();
  const row = await env.DB.prepare(`SELECT slug FROM guest_apps WHERE id = ?`).bind(appId).first();
  const live = row ? await loadLiveApp(env, { slug: row.slug }) : null;
  if (!live?.build) return simplePage(404, "App not found", "<p>We couldn't find a live app for this link. Reply to your latest email and we'll help.</p>");
  if (!(await planActive(env, live.business_id))) return simplePage(403, "Your Guest App plan isn't active", "<p>Updates are part of an active Guest App plan. Reply to your latest email and we'll help.</p>");
  const action = `/api/app-update/${appId}`;
  const intro = `<p>Change what you need and press Send. Your app at <strong>${escapeHtml(appUrl(env, live.slug))}</strong> updates within a few minutes. To change the logo, colour or address, reply to your latest email.</p>`;
  const page = (values, error) => formPage(action, t, values, { error, fields: UPDATE_FIELDS, logo: false, heading: "Update your Guest App", intro });
  if (request.method === "GET") return page(live.data, null);
  const values = readValues(form, UPDATE_FIELDS);
  const problem = validate(values, UPDATE_FIELDS);
  if (problem) return page(values, problem);
  const result = await publishUpdate(env, live, values);
  if (result.problems.length) return page(values, `We couldn't publish this update: ${result.problems[0]}`);
  const pushNote = result.notified?.ok ? " Guests who turned on notifications are being told about your new special."
    : result.notified?.reason === "limit" ? " Your new special was not sent as a notification because you've already sent 2 today." : "";
  return simplePage(200, "Your app is updated", `<p>Thank you - your changes are live at <a href="${escapeHtml(appUrl(env, live.slug))}">${escapeHtml(appUrl(env, live.slug))}</a>. Guests who installed the app see them next time they open it.${pushNote}</p>`);
}

export { UPDATE_FIELDS, handleAppUpdate, publishUpdate };
