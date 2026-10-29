// Guest App production (stage 8).
//   Setup (GUEST_APP_SETUP_V1) PRODUCE: the intake answers -> app files -> checks -> icon render job. The step waits
//     while the GitHub renderer draws the icons (Workers' free-plan CPU is too small for PNGs, see
//     social-posts/render-jobs.js); finishGuestAppRender stores them and drafts the APP_BUILD. The owner approves it
//     in the shared DELIVER step and only then is it live.
//   Monthly (GUEST_APP_V1) PRODUCE: emails the owner of the business their update link. Nothing is rebuilt.
//   Updates: the update form (update.js) rebuilds straight away with the approved icons and publishes it.
// An app that fails its checks is never shown to the buyer: the owner is told what failed.
import QRCode from "qrcode/lib/browser.js";
import { ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { signLinkToken } from "../../lib/links.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { finishRun } from "../menu-care/care-step.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { queueRender } from "../social-posts/render-jobs.js";
import { ICONS, buildApp, iconSpecs } from "./build.js";
import { checkApp } from "./check.js";

const UPDATE_LINK_KIND = "appupdate";
const UPDATE_LINK_TTL_DAYS = 400;
const placeholderIcons = () => Object.fromEntries(ICONS.map((i) => [i.path, 0]));

function appUrl(env, slug) {
  return String(env.SITE_WILDCARD) === "1" ? `https://${slug}.menu-made.com/app/` : `${publicBaseUrl(env)}/api/site/${slug}/app/`;
}

async function updateLink(env, appId) {
  const token = await signLinkToken(env, { kind: UPDATE_LINK_KIND, id: appId, ttlDays: UPDATE_LINK_TTL_DAYS });
  return `${publicBaseUrl(env)}/api/app-update/${appId}?t=${token}`;
}

async function tellOwner(env, context, subject, reasons) {
  const business = context.business_name || "A customer";
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[Guest App] ${subject} for ${business}`,
    html: brandedEmailHtml({ eyebrow: "GUEST APP", heading: `${escapeHtml(business)}: ${escapeHtml(subject)}`, paragraphs: [`<ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`, "Nothing was shown to the customer."] }),
    text: `${business}: ${subject}\n- ${reasons.join("\n- ")}\nNothing was shown to the customer.`,
    idempotencyKey: `guest-app-blocked/${context.id}/${reasons.join("|").length}`, purpose: "AUTOMATION_ALERT", templateKey: "guest_app_blocked_v1"
  }).catch(() => null);
}

// The app row and its newest approved build (from any project of the business).
async function loadLiveApp(env, { slug = null, businessId = null } = {}) {
  const app = slug
    ? await env.DB.prepare(`SELECT * FROM guest_apps WHERE slug = ?`).bind(slug).first()
    : await env.DB.prepare(`SELECT * FROM guest_apps WHERE business_id = ? ORDER BY created_at ASC LIMIT 1`).bind(businessId).first();
  if (!app) return null;
  const row = await env.DB.prepare(`
      SELECT a.storage_key FROM projects p
      JOIN deliverables d ON d.project_id = p.id AND d.deliverable_type = 'APP_BUILD' AND d.status = 'FINAL' AND d.customer_visible = 1
      JOIN assets a ON a.id = d.asset_id
      WHERE p.business_id = ? AND json_extract(a.metadata_json, '$.app.slug') = ?
      ORDER BY d.delivered_at DESC, d.created_at DESC, d.version DESC LIMIT 1
    `).bind(app.business_id, app.slug).first();
  let build = null;
  if (row) {
    const object = await env.ASSETS.get(row.storage_key);
    try { build = object ? JSON.parse(await object.text()) : null; } catch { build = null; }
  }
  return { ...app, data: parseJsonOrNull(app.data_json) || {}, build };
}

function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

async function runGuestAppSetupStep(targetStep, env) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const blocked = async (subject, reasons) => {
    await tellOwner(env, context, subject, reasons);
    await finishRun(targetStep, context, { outcome: "NOT_PRODUCED", reasons }, env);
    return { outcome: "NOT_PRODUCED", reasons };
  };
  const row = await env.DB.prepare(`SELECT id, slug, data_json FROM guest_apps WHERE project_id = ?`).bind(context.id).first();
  const app = parseJsonOrNull(row?.data_json);
  if (!row || !app?.app_name || !app.menu || !app.phone || !app.address || !app.hours) return blocked("the app details are incomplete", ["The intake form is missing required answers."]);

  // The logo uploaded on the app form, else the business's website logo, else the logo uploaded with its Online Menu
  // + QR (owner decision Oct 28, 2026). PNG or JPG only: the renderer can't draw WebP or SVG.
  const logo = await env.DB.prepare(`SELECT storage_key, mime_type FROM assets WHERE project_id = ? AND status = 'VALID' AND json_extract(metadata_json, '$.app_image') = 'logo' ORDER BY uploaded_at DESC LIMIT 1`).bind(context.id).first()
    || await env.DB.prepare(`SELECT storage_key, mime_type FROM assets WHERE business_id = ? AND status = 'VALID' AND json_extract(metadata_json, '$.site_image') = 'logo' AND mime_type IN ('image/png', 'image/jpeg') ORDER BY uploaded_at DESC LIMIT 1`).bind(context.business_id).first()
    || (context.business_id ? await env.DB.prepare(`
        SELECT a.storage_key, a.mime_type FROM assets a JOIN projects p ON p.id = a.project_id
        WHERE a.business_id = ? AND a.asset_type = 'LOGO' AND a.status = 'VALID' AND p.workflow_key = 'MENU_QR_V1'
          AND a.mime_type IN ('image/png', 'image/jpeg') ORDER BY a.uploaded_at DESC LIMIT 1
      `).bind(context.business_id).first() : null);
  const logoObject = logo ? await env.ASSETS.get(logo.storage_key) : null;
  const hasLogo = Boolean(logoObject);
  const version = String(targetStep.workflow_step_id || crypto.randomUUID()).slice(0, 8);
  const built = buildApp(app, { version, hasLogo });
  const problems = checkApp({ files: built.files, icons: placeholderIcons(), app });
  if (problems.length) return blocked("the built app failed its checks", problems);

  const assets = hasLogo ? { logo: `data:${logo.mime_type};base64,${toBase64(new Uint8Array(await logoObject.arrayBuffer()))}` } : {};
  return queueRender(env, targetStep, {
    kind: "GUEST_APP",
    files: iconSpecs(app, { hasLogo }),
    assets,
    finish: { kind: "GUEST_APP", pack_filename: `${row.slug}-icons.zip`, slug: row.slug, app_id: row.id, version, has_logo: hasLogo, files: built.files }
  });
}

// Called by the render-jobs route once the GitHub renderer has posted the icons (already checked against the spec).
async function finishGuestAppRender(env, context, entries, finish) {
  const icons = [];
  const sizes = {};
  for (const icon of ICONS) {
    const entry = entries.find((e) => e.name === icon.path.replace(/^icons\//, ""));
    const key = ["customers", context.customer_id, "projects", context.id, "app-icons", finish.version, icon.path.replace(/^icons\//, "")].join("/");
    await env.ASSETS.put(key, entry.data, { httpMetadata: { contentType: "image/png" } });
    icons.push({ path: icon.path, storage_key: key, mime: "image/png", size: entry.data.length });
    sizes[icon.path] = entry.data.length;
  }
  const row = await env.DB.prepare(`SELECT data_json FROM guest_apps WHERE id = ?`).bind(finish.app_id).first();
  const app = parseJsonOrNull(row?.data_json) || {};
  const problems = checkApp({ files: finish.files, icons: sizes, app });
  if (problems.length) {
    await tellOwner(env, context, "the built app failed its checks", problems);
    throw new Error(`The app failed its checks: ${problems.slice(0, 3).join("; ")}`);
  }
  // A QR code for table tents and the window, pointing at the live app address.
  const qr = await QRCode.toString(appUrl(env, finish.slug), { type: "svg", errorCorrectionLevel: "H", margin: 4, width: 1024 });
  const build = { version: 1, slug: finish.slug, built_at: nowIso(), has_logo: Boolean(finish.has_logo), files: { ...finish.files, "qr.svg": qr }, icons, app };
  const stored = await storeDeliverable(env, context, {
    type: "APP_BUILD", filename: `${finish.slug}-app.json`, mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify(build)), folder: "app-build",
    metadata: { app: { slug: finish.slug, app_id: finish.app_id, name: app.app_name, short_name: JSON.parse(finish.files["manifest.webmanifest"]).short_name, has_logo: finish.has_logo } }
  });
  return { outcome: "PRODUCED", slug: finish.slug, build_deliverable: stored.deliverableId, version: stored.version, icons: icons.length, rendered_by: "github-actions" };
}

async function runGuestAppMonthStep(targetStep, env) {
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(context.id).first();
  const metadata = parseJsonOrNull(project?.metadata_json) || {};
  const live = await loadLiveApp(env, { businessId: context.business_id });
  if (!live?.build) {
    // The setup has not been approved yet; its own emails cover this month.
    await finishRun(targetStep, context, { outcome: "NO_APP_YET" }, env);
    return { outcome: "NO_APP_YET" };
  }
  const link = await updateLink(env, live.id);
  const url = appUrl(env, live.slug);
  const business = context.business_name || "your business";
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `Guest App: update ${business}'s app for the month`,
    html: brandedEmailHtml({
      preheader: "Change your specials, menu or hours in a minute.",
      eyebrow: "GUEST APP",
      heading: "Keep your app up to date",
      paragraphs: [
        `Hi ${escapeHtml(context.first_name || "there")}, your Guest App is live at <strong>${escapeHtml(url)}</strong>.`,
        "New specials, a price change or holiday hours? Use the button below. Your changes go live in the app within a few minutes, and guests who installed it see them next time they open it."
      ],
      buttons: [{ label: "Update my app", url: link, primary: true }, { label: "Open my app", url }],
      footnote: "Keep this email: the update button works every month while your Guest App plan is active."
    }),
    text: `Your Guest App is live at ${url}.\n\nNew specials, a price change or holiday hours? Update your app here (changes go live within minutes): ${link}`,
    idempotencyKey: `guest-app-month/${metadata.subscription_id || context.id}/${metadata.period_start || ""}`,
    purpose: "GUEST_APP_MONTH", templateKey: "guest_app_month_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
  if (!sent.ok) throw new Error(`Guest App monthly email failed: ${sent.error}`);
  await finishRun(targetStep, context, { outcome: "MONTH_OPENED", email_id: sent.id }, env);
  return { outcome: "MONTH_OPENED" };
}

export { UPDATE_LINK_KIND, appUrl, finishGuestAppRender, loadLiveApp, runGuestAppMonthStep, runGuestAppSetupStep, updateLink };
