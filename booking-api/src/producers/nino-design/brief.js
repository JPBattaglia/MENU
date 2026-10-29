// Nino design services brief (stage 10). Checkout asks only for the business name and email (least info before
// payment); after payment the buyer gets a signed link to one short form for their product: the wording, style and
// colours, plus a logo (and, for Menu Redesign, the menu file). Answers become project_inputs; files are checked by
// their bytes and stored as assets. When the required answers are in, the project is released to production.
//   GET/POST /api/design-brief/<projectId>?t=<token>     (token kind "designbrief")
// Reminders: 3 and 10 days after the first email; the owner is told at 21 days (hourly pass, see remindDesignBriefs).
import { ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, isCustomerEmail, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { sha256Hex } from "../../lib/util.js";
import { refreshOnboardingState } from "../../onboarding/onboarding.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { sniffImage } from "../website/intake.js";
import { NINO_WORKFLOWS, STYLES, productForWorkflow } from "./products.js";

const LINK_KIND = "designbrief";
const MAX_LOGO = 3_000_000;
const MAX_MENU = 15_000_000;
const HEX = /^#[0-9a-f]{6}$/i;
const NINO_SITE = "https://ninobattaglia.com";

async function briefLink(env, projectId) {
  const token = await signLinkToken(env, { kind: LINK_KIND, id: projectId, ttlDays: 60 });
  return `${publicBaseUrl(env)}/api/design-brief/${projectId}?t=${token}`;
}

function briefEmail(context, product, link, reminder = 0) {
  const first = escapeHtml(context.first_name || "there");
  const lead = reminder
    ? `Hi ${first}, your ${escapeHtml(product.name)} is waiting on a short form. Nino's studio starts as soon as it's in.`
    : `Hi ${first}, thanks for ordering a ${escapeHtml(product.name)} from Nino Battaglia's design studio. Fill in one short form and we start right away. You'll see the result before anything is final.`;
  return {
    subject: reminder ? `Reminder: your ${product.name} needs a few details` : `Your ${product.name}: one short form to start`,
    html: brandedEmailHtml({
      preheader: "A few details and we start designing.",
      eyebrow: "NINO BATTAGLIA · DESIGN",
      heading: reminder ? "We still need your details" : "Tell us what to design",
      paragraphs: [lead, `What you'll get: ${escapeHtml(product.deliverable)}.`],
      buttons: [{ label: "Fill in the brief", url: link, primary: true }],
      footnote: `You can come back to this link and change your answers until we start. Questions? Reply to this email. More of Nino's work: ${NINO_SITE}`
    }),
    text: `${reminder ? `Your ${product.name} is waiting on a short form.` : `Thanks for ordering a ${product.name} from Nino Battaglia's design studio. Fill in one short form and we start right away.`}\n\nFill in the brief: ${link}\n\nWhat you'll get: ${product.deliverable}.`
  };
}

// Called by the checkout webhook for a paid design service: create the input rows and email the brief link.
async function startDesignBrief(env, { projectId }) {
  const context = await loadDeliveryContext(projectId, env);
  if (!context) return { started: false };
  const product = productForWorkflow(context.workflow_key);
  if (!product) return { started: false };
  const t = nowIso();
  const rows = [...product.fields.map((f) => [f.key, f.required]), ...(product.menuFile ? [["menu_upload", true]] : [])];
  for (const [key, required] of rows) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO project_inputs (id, project_id, input_key, input_type, required, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'MISSING', ?, ?)
      `).bind(crypto.randomUUID(), projectId, key, key === "menu_upload" ? "FILE" : "TEXT", required ? 1 : 0, t, t).run();
  }
  // The business name is already known from checkout: fill it in so the form only asks for what's new.
  if (context.business_name) {
    await env.DB.prepare(`UPDATE project_inputs SET value_text = ? WHERE project_id = ? AND input_key = 'business_name' AND value_text IS NULL`)
      .bind(String(context.business_name).slice(0, 60), projectId).run();
  }
  const mail = briefEmail(context, product, await briefLink(env, projectId));
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email, ...mail,
    idempotencyKey: `design-brief/${projectId}`, purpose: "DESIGN_BRIEF", templateKey: "nino_design_brief_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId }
  });
  return { started: sent.ok };
}

// ---------- The form ----------

const control = (f, v) => {
  const val = escapeHtml(v || "");
  const style = 'style="width:100%;box-sizing:border-box;font:inherit;padding:10px"';
  let box;
  if (f.type === "textarea") box = `<textarea id="${f.key}" name="${f.key}" rows="5" maxlength="${f.max}" ${f.required ? "required" : ""} ${style}>${val}</textarea>`;
  else if (f.type === "select") box = `<select id="${f.key}" name="${f.key}" ${f.required ? "required" : ""} ${style}>${f.options.map((o) => `<option value="${o}"${o === v ? " selected" : ""}>${o[0].toUpperCase()}${o.slice(1)}</option>`).join("")}</select>`;
  else box = `<input id="${f.key}" name="${f.key}" type="text" value="${val}" maxlength="${f.max}" ${f.required ? "required" : ""} ${style}>`;
  return `<p><label for="${f.key}"><strong>${escapeHtml(f.label)}</strong></label><br>${box}${f.help ? `<br><small>${escapeHtml(f.help)}</small>` : ""}</p>`;
};

function formPage(product, action, token, values, { error = null, hasMenu = false } = {}) {
  const logo = product.logo ? `<p><label for="logo"><strong>Logo (optional)</strong></label><br><input id="logo" name="logo" type="file" accept="image/png,image/jpeg"><br><small>PNG or JPG, under 3 MB. A PNG with a transparent background looks best.</small></p>` : "";
  const menu = product.menuFile ? `<p><label for="menu_file"><strong>Your current menu${hasMenu ? " (uploaded - choose a file only to replace it)" : ""}</strong></label><br><input id="menu_file" name="menu_file" type="file" accept="application/pdf,image/png,image/jpeg" ${hasMenu ? "" : "required"}><br><small>PDF or photo, under 15 MB. Every name, description and price is copied exactly as printed.</small></p>` : "";
  return simplePage(error ? 400 : 200, `Your ${product.name}`, `<p>Nino Battaglia's design studio. Fill this in once and we start designing; you'll see the result before it's final.</p>${error ? `<p style="color:#9b1c1c"><strong>${escapeHtml(error)}</strong></p>` : ""}
<form method="post" action="${escapeHtml(action)}" enctype="multipart/form-data"><input type="hidden" name="t" value="${escapeHtml(token)}">
${product.fields.map((f) => control(f, values[f.key])).join("")}${logo}${menu}
<button type="submit">Send</button></form>`);
}

function readValues(form, product) {
  const values = {};
  for (const f of product.fields) values[f.key] = String(form.get(f.key) ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).join("\n").trim().slice(0, f.max || 40);
  return values;
}

function validate(values, product) {
  for (const f of product.fields) {
    if (f.required && !values[f.key]) return `${f.label} is required.`;
    if (f.type === "select" && values[f.key] && !f.options.includes(values[f.key])) return `Choose a ${f.label.toLowerCase()} from the list.`;
  }
  if (values.brand_colors) {
    const colors = values.brand_colors.split(/[\s,]+/).filter(Boolean);
    if (colors.length > 2 || colors.some((c) => !HEX.test(c))) return "Colours must look like #b3261e (up to two, separated by a comma), or be left blank.";
  }
  if (values.details && values.details.split("\n").filter(Boolean).length > 5) return "Please keep the details to 5 lines or fewer.";
  return null;
}

async function storeFile(env, context, file, { kind, max, allowPdf }) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return { skip: true };
  if (bytes.length > max) return { error: `The ${kind === "LOGO" ? "logo" : "menu file"} is too large.` };
  const pdf = allowPdf && bytes.length > 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  const type = pdf ? { mime: "application/pdf", ext: "pdf" } : sniffImage(bytes);
  if (!type || type.mime === "image/webp") return { error: kind === "LOGO" ? "The logo must be a PNG or JPG image." : "The menu must be a PDF, PNG or JPG file." };
  const id = crypto.randomUUID();
  const key = ["customers", context.customer_id, "projects", context.id, "design-brief", `${kind.toLowerCase()}-${id}.${type.ext}`].join("/");
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: type.mime } });
  const t = nowIso();
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, ?, 'R2', ?, ?, ?, ?, ?, 'VALID', ?, ?, 1, 1, 1, ?)
    `).bind(id, context.business_id || null, context.customer_id, context.id, kind === "LOGO" ? "LOGO" : "MENU_SOURCE", key, String(file.name || kind).slice(0, 100), type.mime, bytes.length, await sha256Hex(bytes), t, t, JSON.stringify({ design_brief: kind.toLowerCase() })).run();
  await env.DB.prepare(`UPDATE assets SET status = 'ARCHIVED' WHERE project_id = ? AND json_extract(metadata_json, '$.design_brief') = ? AND id != ?`).bind(context.id, kind.toLowerCase(), id).run();
  return { id };
}

async function saved(env, projectId) {
  const rows = (await env.DB.prepare(`SELECT input_key, value_text FROM project_inputs WHERE project_id = ? AND value_text IS NOT NULL`).bind(projectId).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.input_key, r.value_text]));
}

// Saves a validated brief (also used by the self-tests, which have no browser). files: { logo?: File, menu_file?: File }
async function saveBrief(env, context, product, values, files = {}) {
  if (files.logo && product.logo) {
    const stored = await storeFile(env, context, files.logo, { kind: "LOGO", max: MAX_LOGO, allowPdf: false });
    if (stored.error) return { error: stored.error };
  }
  let menuAsset = null;
  if (files.menu_file && product.menuFile) {
    const stored = await storeFile(env, context, files.menu_file, { kind: "MENU", max: MAX_MENU, allowPdf: true });
    if (stored.error) return { error: stored.error };
    if (stored.id) menuAsset = stored.id;
  }
  const t = nowIso();
  for (const f of product.fields) {
    await env.DB.prepare(`UPDATE project_inputs SET value_text = ?, status = ?, submitted_at = ?, validated_at = ?, updated_at = ? WHERE project_id = ? AND input_key = ?`)
      .bind(values[f.key] || null, values[f.key] ? "VALID" : "MISSING", t, t, t, context.id, f.key).run();
  }
  if (menuAsset) {
    await env.DB.prepare(`UPDATE project_inputs SET value_text = ?, status = 'VALID', submitted_at = ?, validated_at = ?, updated_at = ? WHERE project_id = ? AND input_key = 'menu_upload'`)
      .bind(menuAsset, t, t, t, context.id).run();
  }
  await refreshOnboardingState(context.id, context.order_id, context.customer_id, product.workflow, env);
  return { ok: true };
}

async function handleDesignBrief(request, env, projectId) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest email and we'll send a fresh one.</p>");
  const context = await loadDeliveryContext(projectId, env);
  const product = context && productForWorkflow(context.workflow_key);
  if (!product) return denied();
  const lockedPage = () => simplePage(200, "We're designing", `<p>Thank you - we have everything we need and your ${escapeHtml(product.name)} is being designed. You'll get an email when it's ready.</p>`);
  const locked = context.status !== "AWAITING_INPUTS";
  const action = `/api/design-brief/${projectId}`;
  const values0 = await saved(env, projectId);
  if (request.method === "GET") {
    const token = new URL(request.url).searchParams.get("t") || "";
    const payload = await verifyLinkToken(env, token, [LINK_KIND], projectId);
    if (!payload || payload.expired) return denied();
    return locked ? lockedPage() : formPage(product, action, token, { style: STYLES[0], ...values0 }, { hasMenu: Boolean(values0.menu_upload) });
  }
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], projectId);
  if (!payload || payload.expired) return denied();
  if (locked) return lockedPage();
  const values = readValues(form, product);
  const problem = validate(values, product);
  const hasMenu = Boolean(values0.menu_upload);
  if (problem) return formPage(product, action, token, values, { error: problem, hasMenu });
  const file = (name) => { const v = form.get(name); return v && typeof v !== "string" ? v : null; };
  if (product.menuFile && !hasMenu && !(file("menu_file")?.size > 0)) return formPage(product, action, token, values, { error: "Please upload your current menu.", hasMenu });
  const result = await saveBrief(env, context, product, values, { logo: file("logo"), menu_file: file("menu_file") });
  if (result.error) return formPage(product, action, token, values, { error: result.error, hasMenu });
  return simplePage(200, "Thank you", `<p>We have what we need and Nino's studio is designing your ${escapeHtml(product.name)} now. You'll get an email when it's ready.</p><p><a class="btn" href="${NINO_SITE}">Back to ninobattaglia.com</a></p>`);
}

// ---------- Reminders (hourly, minute 0-4) ----------

async function remindDesignBriefs(env, now = new Date()) {
  if (!env.DB || now.getUTCMinutes() >= 5) return null;
  const keys = Object.keys(NINO_WORKFLOWS);
  const waiting = (await env.DB.prepare(`
      SELECT id, created_at FROM projects WHERE status = 'AWAITING_INPUTS' AND workflow_key IN (${keys.map(() => "?").join(", ")}) LIMIT 20
    `).bind(...keys).all()).results || [];
  let sent = 0;
  for (const project of waiting) {
    const days = (now.getTime() - Date.parse(project.created_at)) / 864e5;
    const step = days >= 21 ? 3 : days >= 10 ? 2 : days >= 3 ? 1 : 0;
    if (!step) continue;
    const context = await loadDeliveryContext(project.id, env);
    const product = context && productForWorkflow(context.workflow_key);
    if (!product) continue;
    if (step === 3) {
      const r = await sendTransactionalEmail(env, {
        to: ownerEmailAddress(env), subject: `[Nino design] ${context.business_name || "A buyer"} hasn't sent their ${product.name} brief`,
        html: brandedEmailHtml({ eyebrow: "AUTOMATION ALERT", heading: "A design order is waiting on its brief", paragraphs: [`${escapeHtml(context.business_name || "A buyer")} paid for a ${escapeHtml(product.name)} 3 weeks ago and hasn't filled in the brief after two reminders. Nothing has been produced.`], rows: [["Buyer", context.customer_email], ["Order", context.order_id]] }),
        text: `${context.business_name || "A buyer"} paid for a ${product.name} 3 weeks ago and hasn't filled in the brief. Buyer: ${context.customer_email}. Order: ${context.order_id}.`,
        idempotencyKey: `design-brief-owner/${project.id}`, purpose: "AUTOMATION_ALERT", templateKey: "nino_design_brief_owner_v1"
      }).catch(() => null);
      if (r?.ok) sent++;
      continue;
    }
    if (!isCustomerEmail(context.customer_email, "DESIGN_BRIEF", env)) continue;
    const mail = briefEmail(context, product, await briefLink(env, project.id), step);
    const r = await sendTransactionalEmail(env, {
      to: context.customer_email, ...mail,
      idempotencyKey: `design-brief/${project.id}/reminder-${step}`, purpose: "DESIGN_BRIEF", templateKey: "nino_design_brief_reminder_v1",
      context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: project.id }
    }).catch(() => null);
    if (r?.ok) sent++;
  }
  return { sent };
}

export { LINK_KIND, briefLink, handleDesignBrief, readValues, remindDesignBriefs, saveBrief, startDesignBrief, validate };
