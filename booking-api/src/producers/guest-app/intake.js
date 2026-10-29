// Guest App intake (stage 8): after payment the buyer gets a signed link to one form with everything the app is built
// from. The form is pre-filled with what Menu-made already holds for the business (its website order's menu, phone,
// address, hours and colour; its name), and the owner checks and corrects it. A logo from the website is used unless
// a new one is uploaded, else the logo uploaded with the business's Online Menu + QR. Answers become project_inputs and guest_apps.data_json; the logo is checked by its bytes and
// stored as an asset. When the required answers are in, the project is released to production.
//   GET/POST /api/app-intake/<projectId>?t=<token>     (token kind "appintake")
// Address: a business that already has a Menu-made website keeps its slug (site at /, app at /app/); otherwise the
// app reserves a slug of its own in the same namespace.
import { publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { sha256Hex } from "../../lib/util.js";
import { refreshOnboardingState } from "../../onboarding/onboarding.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { hexOk } from "../website/styles.js";
import { slugify, sniffImage, validSlug } from "../website/intake.js";

const LINK_KIND = "appintake";
const WORKFLOW = "GUEST_APP_SETUP_V1";
const MAX_LOGO = 1_500_000;
const FIELDS = [
  { key: "app_name", label: "App name", type: "text", required: true, max: 45, help: "Usually your business name. Shown at the top of the app." },
  { key: "short_name", label: "Name under the icon (optional, up to 12 characters)", type: "text", required: false, max: 12, help: "Phones cut long names under home-screen icons. Leave blank and we'll shorten the app name." },
  { key: "menu", label: "Your menu", type: "textarea", required: true, max: 4000, help: 'One per line: Name | short description | $price. Start a section with "# Section name". Example: # Pizza  then  Margherita | Mozzarella and basil | $15' },
  { key: "specials", label: "Specials or news (optional)", type: "textarea", required: false, max: 600, help: "Shown near the top. You can change this every month." },
  { key: "phone", label: "Phone number", type: "text", required: true, max: 30 },
  { key: "address", label: "Street address", type: "text", required: true, max: 160 },
  { key: "hours", label: "Opening hours", type: "textarea", required: true, max: 400, help: "One line per day or range. Example: Mon-Fri: 11am-9pm" },
  { key: "order_url", label: "Online ordering link (optional)", type: "text", required: false, max: 300, help: "Starts with https://" },
  { key: "reserve_url", label: "Reservations link (optional)", type: "text", required: false, max: 300, help: "Starts with https://" },
  { key: "brand_color", label: "Brand colour (optional, like #b3261e)", type: "text", required: false, max: 7 },
  { key: "subdomain", label: "App address (optional)", type: "text", required: false, max: 30, help: "Letters, numbers and dashes: yourname.menu-made.com/app. If we built your website, the app goes on the same address." }
];

async function intakeLink(env, projectId) {
  const token = await signLinkToken(env, { kind: LINK_KIND, id: projectId, ttlDays: 60 });
  return `${publicBaseUrl(env)}/api/app-intake/${projectId}?t=${token}`;
}

// Called by the checkout webhook for a paid Guest App Setup: create the input rows and email the buyer the link.
async function startGuestAppIntake(env, { projectId }) {
  const context = await loadDeliveryContext(projectId, env);
  if (!context) return { started: false };
  const t = nowIso();
  for (const f of FIELDS) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO project_inputs (id, project_id, input_key, input_type, required, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'MISSING', ?, ?)
      `).bind(crypto.randomUUID(), projectId, f.key, f.key.endsWith("_url") ? "URL" : "TEXT", f.required ? 1 : 0, t, t).run();
  }
  const link = await intakeLink(env, projectId);
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `Let's build ${context.business_name || "your"} Guest App: one short form`,
    html: brandedEmailHtml({
      preheader: "One form and your guests can add you to their home screen.",
      eyebrow: "GUEST APP",
      heading: "Tell us what goes in your app",
      paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, thanks for your order. Fill in one form - your menu, hours, phone, links and logo - and we'll build your Guest App. You'll see it before it goes live.`],
      buttons: [{ label: "Start my app", url: link, primary: true }],
      footnote: "You can come back to this link and edit your answers until we start building."
    }),
    text: `Thanks for your order. Fill in one form - your menu, hours, phone, links and logo - and we'll build your Guest App. You'll see it before it goes live.\n\nStart my app: ${link}`,
    idempotencyKey: `app-intake/${projectId}`, purpose: "GUEST_APP_INTAKE", templateKey: "guest_app_intake_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId }
  });
  return { started: sent.ok };
}

const control = (f, v) => {
  const val = escapeHtml(v || "");
  const style = 'style="width:100%;box-sizing:border-box;font:inherit;padding:10px"';
  const box = f.type === "textarea"
    ? `<textarea id="${f.key}" name="${f.key}" rows="5" maxlength="${f.max}" ${f.required ? "required" : ""} ${style}>${val}</textarea>`
    : `<input id="${f.key}" name="${f.key}" type="text" value="${val}" maxlength="${f.max}" ${f.required ? "required" : ""} ${style}>`;
  return `<p><label for="${f.key}"><strong>${escapeHtml(f.label)}</strong></label><br>${box}${f.help ? `<br><small>${escapeHtml(f.help)}</small>` : ""}</p>`;
};

function formPage(action, token, values, { error = null, fields = FIELDS, logo = true, heading = "Your Guest App", intro = "" } = {}) {
  return simplePage(error ? 400 : 200, heading, `${intro}${error ? `<p style="color:#9b1c1c"><strong>${escapeHtml(error)}</strong></p>` : ""}
<form method="post" action="${escapeHtml(action)}" enctype="multipart/form-data"><input type="hidden" name="t" value="${escapeHtml(token)}">
${fields.map((f) => control(f, values[f.key])).join("")}
${logo ? `<p><label for="logo"><strong>Logo (optional)</strong></label><br><input id="logo" name="logo" type="file" accept="image/png,image/jpeg"><br><small>PNG or JPG, under 1.5 MB. A square logo looks best as a home-screen icon. Without one we use the logo from your Menu-Made website or online menu if you gave us one, otherwise your initials.</small></p>` : ""}
<button type="submit">Send</button></form>`);
}

function readValues(form, fields) {
  const values = {};
  for (const f of fields) values[f.key] = String(form.get(f.key) ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).join("\n").trim().slice(0, f.max);
  return values;
}

function validate(values, fields = FIELDS) {
  for (const f of fields) if (f.required && !values[f.key]) return `${f.label} is required.`;
  if (values.brand_color && !hexOk(values.brand_color)) return "Brand colour must look like #b3261e, or be left blank.";
  if (values.subdomain && !validSlug(values.subdomain.toLowerCase())) return "The app address can use letters, numbers and dashes (3-30 characters) and can't be a reserved word.";
  for (const [k, label] of [["order_url", "Online ordering link"], ["reserve_url", "Reservations link"]]) {
    if (values[k] && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(values[k])) return `${label} must start with https://`;
  }
  if (!/\d{7}/.test(String(values.phone || "").replace(/\D/g, ""))) return "Phone number needs at least 7 digits.";
  if (!/\d{3,}/.test(String(values.hours || "").replace(/\D/g, "")) && !/closed|daily|open/i.test(values.hours || "")) return "Please write your opening hours, for example Mon-Fri: 11am-9pm.";
  return null;
}

const taken = async (env, slug, projectId, businessId) => {
  const site = await env.DB.prepare(`SELECT business_id FROM website_sites WHERE slug = ?`).bind(slug).first();
  if (site && (!businessId || site.business_id !== businessId)) return true;
  const app = await env.DB.prepare(`SELECT project_id FROM guest_apps WHERE slug = ?`).bind(slug).first();
  return Boolean(app && app.project_id !== projectId);
};

// Returns { slug } or { error }. Writes the guest_apps row with the answers.
async function saveApp(env, context, values) {
  const t = nowIso();
  const data = JSON.stringify(Object.fromEntries(FIELDS.filter((f) => f.key !== "subdomain").map((f) => [f.key, values[f.key] || ""])));
  const existing = await env.DB.prepare(`SELECT id, slug FROM guest_apps WHERE project_id = ?`).bind(context.id).first();
  const site = context.business_id ? await env.DB.prepare(`SELECT slug FROM website_sites WHERE business_id = ? ORDER BY created_at ASC LIMIT 1`).bind(context.business_id).first() : null;
  let slug = site?.slug || existing?.slug || null;
  if (!site) {
    const wanted = (values.subdomain || "").toLowerCase();
    if (wanted && wanted !== slug) {
      if (await taken(env, wanted, context.id, context.business_id)) return { error: `${wanted}.menu-made.com is already taken - please choose another address.` };
      slug = wanted;
    }
    if (!slug) {
      let base = slugify(values.app_name || context.business_name);
      if (!validSlug(base)) base = validSlug(`${base}-app`) ? `${base}-app` : `app-${context.id.replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
      for (let n = 0; n < 6 && !slug; n++) {
        const candidate = n === 0 ? base : `${base.slice(0, 24)}-${Math.random().toString(36).slice(2, 6)}`;
        if (!(await taken(env, candidate, context.id, context.business_id))) slug = candidate;
      }
      if (!slug) return { error: "Please choose an app address." };
    }
  }
  if (existing) {
    await env.DB.prepare(`UPDATE guest_apps SET slug = ?, data_json = ?, updated_at = ? WHERE id = ?`).bind(slug, data, t, existing.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), slug, context.id, context.business_id || null, context.customer_id, data, t, t).run();
  }
  return { slug };
}

async function storeLogo(env, context, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return { skip: true };
  if (bytes.length > MAX_LOGO) return { error: "The logo is over 1.5 MB. Please upload a smaller one." };
  const type = sniffImage(bytes);
  if (!type || type.mime === "image/webp") return { error: "The logo must be a PNG or JPG image." };
  const id = crypto.randomUUID();
  const key = ["customers", context.customer_id, "projects", context.id, "app-images", `logo-${id}.${type.ext}`].join("/");
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: type.mime } });
  const t = nowIso();
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, 'LOGO', 'R2', ?, ?, ?, ?, ?, 'VALID', ?, ?, 1, 1, 1, ?)
    `).bind(id, context.business_id || null, context.customer_id, context.id, key, String(file.name || "logo").slice(0, 100), type.mime, bytes.length, await sha256Hex(bytes), t, t, JSON.stringify({ app_image: "logo" })).run();
  await env.DB.prepare(`UPDATE assets SET status = 'ARCHIVED' WHERE project_id = ? AND json_extract(metadata_json, '$.app_image') = 'logo' AND id != ?`).bind(context.id, id).run();
  return { id };
}

// What Menu-made already knows: answers saved on this form, else the business's newest website order, else its name.
async function prefill(env, context) {
  const saved = (await env.DB.prepare(`SELECT input_key, value_text FROM project_inputs WHERE project_id = ? AND value_text IS NOT NULL`).bind(context.id).all()).results || [];
  if (saved.length) return Object.fromEntries(saved.map((r) => [r.input_key, r.value_text]));
  const values = { app_name: context.business_name || "" };
  const site = await env.DB.prepare(`
      SELECT p.id FROM projects p WHERE p.business_id = ? AND p.workflow_key = 'WEBSITE_PACKAGE_V1' ORDER BY p.created_at DESC LIMIT 1
    `).bind(context.business_id).first();
  if (site) {
    const rows = (await env.DB.prepare(`SELECT input_key, value_text FROM project_inputs WHERE project_id = ? AND status = 'VALID'`).bind(site.id).all()).results || [];
    const v = Object.fromEntries(rows.map((r) => [r.input_key, r.value_text || ""]));
    Object.assign(values, { menu: v.offerings || "", phone: v.phone || "", address: v.address || "", hours: v.hours || "", brand_color: v.brand_color || "" });
  }
  return values;
}

async function handleAppIntake(request, env, projectId) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest email and we'll send a fresh one.</p>");
  const context = await loadDeliveryContext(projectId, env);
  if (!context || context.workflow_key !== WORKFLOW) return denied();
  const lockedPage = () => simplePage(200, "We're building your app", "<p>Thank you - we have everything we need and your Guest App is being built. You'll get an email with a preview link soon.</p>");
  const locked = context.status !== "AWAITING_INPUTS";
  const action = `/api/app-intake/${projectId}`;
  if (request.method === "GET") {
    const token = new URL(request.url).searchParams.get("t") || "";
    const payload = await verifyLinkToken(env, token, [LINK_KIND], projectId);
    if (!payload || payload.expired) return denied();
    return locked ? lockedPage() : formPage(action, token, await prefill(env, context), { intro: "<p>We've filled in what we already have for your business. Please check every answer and fix anything that's out of date.</p>" });
  }
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], projectId);
  if (!payload || payload.expired) return denied();
  if (locked) return lockedPage();
  const values = readValues(form, FIELDS);
  const problem = validate(values);
  if (problem) return formPage(action, token, values, { error: problem });
  const logo = form.get("logo");
  if (logo && typeof logo !== "string") {
    const stored = await storeLogo(env, context, logo);
    if (stored.error) return formPage(action, token, values, { error: stored.error });
  }
  const saved = await saveApp(env, context, values);
  if (saved.error) return formPage(action, token, values, { error: saved.error });
  const t = nowIso();
  for (const f of FIELDS) {
    await env.DB.prepare(`UPDATE project_inputs SET value_text = ?, status = ?, submitted_at = ?, validated_at = ?, updated_at = ? WHERE project_id = ? AND input_key = ?`)
      .bind(values[f.key] || null, values[f.key] ? "VALID" : "MISSING", t, t, t, projectId, f.key).run();
  }
  await refreshOnboardingState(projectId, context.order_id, context.customer_id, WORKFLOW, env);
  return simplePage(200, "Thank you", `<p>We have what we need and we're building your Guest App now. You'll get an email with a preview link; the app will be at <strong>${escapeHtml(saved.slug)}.menu-made.com/app</strong>.</p>`);
}

export { FIELDS, LINK_KIND, formPage, handleAppIntake, intakeLink, readValues, startGuestAppIntake, validate };
