// Website Package intake (stage 7): after payment the buyer gets a signed link to one page that collects everything the
// site is built from. Text fields become project_inputs; logo and photos are checked by their bytes (not their names)
// and stored as assets. When the required fields are in, the project is released to production.
//   GET/POST /api/site-intake/<projectId>?t=<token>     (token kind "siteintake")
import { publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { sha256Hex } from "../../lib/util.js";
import { refreshOnboardingState } from "../../onboarding/onboarding.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { STYLES, hexOk } from "./styles.js";

const LINK_KIND = "siteintake";
const MAX_IMAGE = 1_500_000;
const MAX_PHOTOS = 6;
const RESERVED = new Set(["www", "api", "app", "mail", "admin", "ftp", "smtp", "blog", "shop", "store", "static", "assets", "cdn", "dev", "test", "staging", "sites", "dashboard", "login", "menu", "pay", "billing", "support", "help", "status"]);
const FIELDS = [
  { key: "kind", label: "What kind of business?", type: "select", required: true, options: [["restaurant", "Restaurant, cafe or food business (we show a Menu page)"], ["services", "Services business (we show a Services page)"]] },
  { key: "about", label: "Tell us about your business", type: "textarea", required: true, max: 1500, help: "Your story, what makes you different, who you serve. We write the page from this and use no facts you don't give us." },
  { key: "offerings", label: "Your menu or services", type: "textarea", required: true, max: 4000, help: 'One per line: Name | short description | $price. Start a section with "# Section name". Example: # Pizza  then  Margherita | Mozzarella and basil | $15' },
  { key: "phone", label: "Phone number", type: "text", required: true, max: 30 },
  { key: "address", label: "Street address", type: "text", required: true, max: 160 },
  { key: "hours", label: "Opening hours", type: "textarea", required: true, max: 400, help: "One line per day or range. Example: Mon-Fri: 11am-9pm" },
  { key: "contact_email", label: "Public email address (optional)", type: "text", required: false, max: 120 },
  { key: "style", label: "Style", type: "select", required: true, options: Object.entries(STYLES).map(([key, st]) => [key, `${st.label} - ${st.blurb}`])},
  { key: "brand_color", label: "Brand colour (optional, like #b3261e)", type: "text", required: false, max: 7 },
  { key: "subdomain", label: "Your web address", type: "text", required: false, max: 30, help: "Letters, numbers and dashes. Your site will be at yourname.menu-made.com. Leave blank and we'll choose one." },
  { key: "domain", label: "Your own domain, if you have one (optional)", type: "text", required: false, max: 80, help: "Like www.yourrestaurant.com. We'll email the exact steps to point it at your site." },
  { key: "facebook", label: "Facebook page address (optional)", type: "text", required: false, max: 200 },
  { key: "instagram", label: "Instagram address (optional)", type: "text", required: false, max: 200 },
  { key: "photo_captions", label: "Photo descriptions (optional)", type: "textarea", required: false, max: 600, help: "One line per photo, in the order you upload them, e.g. 'Our wood-fired oven'. Used as the picture descriptions for visitors who can't see them." }
];

function slugify(name) {
  return String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "");
}
const validSlug = (s) => /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(s) && !RESERVED.has(s);

// Real image bytes only: PNG, JPEG or WebP. SVG is refused because it can carry script.
function sniffImage(bytes) {
  if (bytes.length > 12 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

async function intakeLink(env, projectId) {
  const token = await signLinkToken(env, { kind: LINK_KIND, id: projectId, ttlDays: 60 });
  return `${publicBaseUrl(env)}/api/site-intake/${projectId}?t=${token}`;
}

// Called by the checkout webhook for a paid Website Package: create the input rows and email the buyer the link.
async function startWebsiteIntake(env, { projectId }) {
  const context = await loadDeliveryContext(projectId, env);
  if (!context) return { started: false };
  const t = nowIso();
  for (const f of FIELDS) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO project_inputs (id, project_id, input_key, input_type, required, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'MISSING', ?, ?)
      `).bind(crypto.randomUUID(), projectId, f.key, f.key === "domain" || f.key === "facebook" || f.key === "instagram" ? "URL" : "TEXT", f.required ? 1 : 0, t, t).run();
  }
  const link = await intakeLink(env, projectId);
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `Let's build ${context.business_name || "your"} website: tell us about your business`,
    html: brandedEmailHtml({
      preheader: "One short form and your website is on its way.",
      eyebrow: "WEBSITE PACKAGE",
      heading: "Tell us about your business",
      paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, thanks for your order. Fill in one short form - your story, menu or services, hours and a few photos - and we'll build your website. You'll see it before it goes live.`],
      buttons: [{ label: "Start my website", url: link, primary: true }],
      footnote: "You can come back to this link and edit your answers until we start building."
    }),
    text: `Thanks for your order. Fill in one short form - your story, menu or services, hours and a few photos - and we'll build your website. You'll see it before it goes live.\n\nStart my website: ${link}`,
    idempotencyKey: `site-intake/${projectId}`, purpose: "WEBSITE_INTAKE", templateKey: "website_intake_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId }
  });
  return { started: sent.ok };
}

const input = (f, v) => {
  const val = escapeHtml(v || "");
  const label = `<label for="${f.key}"><strong>${escapeHtml(f.label)}</strong>${f.required ? "" : ""}</label><br>`;
  const style = 'style="width:100%;box-sizing:border-box;font:inherit;padding:10px"';
  let control;
  if (f.type === "textarea") control = `<textarea id="${f.key}" name="${f.key}" rows="5" maxlength="${f.max}" ${f.required ? "required" : ""} ${style}>${val}</textarea>`;
  else if (f.type === "select") control = `<select id="${f.key}" name="${f.key}" ${f.required ? "required" : ""} ${style}>${f.options.map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select>`;
  else control = `<input id="${f.key}" name="${f.key}" type="text" value="${val}" maxlength="${f.max}" ${f.required ? "required" : ""} ${style}>`;
  return `<p>${label}${control}${f.help ? `<br><small>${escapeHtml(f.help)}</small>` : ""}</p>`;
};

function formPage(projectId, token, values, { error = null, locked = false } = {}) {
  if (locked) return simplePage(200, "We're building your website", "<p>Thank you - we have everything we need and your website is being built. You'll get an email with a preview link soon.</p>");
  return simplePage(error ? 400 : 200, "Tell us about your business", `${error ? `<p style="color:#9b1c1c"><strong>${escapeHtml(error)}</strong></p>` : ""}
<form method="post" action="/api/site-intake/${escapeHtml(projectId)}" enctype="multipart/form-data"><input type="hidden" name="t" value="${escapeHtml(token)}">
${FIELDS.map((f) => input(f, values[f.key] ?? (f.key === "kind" ? "restaurant" : f.key === "style" ? "modern" : ""))).join("")}
<p><label for="logo"><strong>Logo (optional)</strong></label><br><input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp"><br><small>PNG, JPG or WebP, under 1.5 MB.</small></p>
<p><label for="photos"><strong>Photos (optional, up to ${MAX_PHOTOS})</strong></label><br><input id="photos" name="photos" type="file" accept="image/png,image/jpeg,image/webp" multiple><br><small>Your food, your space, your team. Each under 1.5 MB. Please only upload photos you own or have the right to use.</small></p>
<button type="submit">Send</button></form>`);
}

async function savedValues(env, projectId) {
  const rows = (await env.DB.prepare(`SELECT input_key, value_text FROM project_inputs WHERE project_id = ?`).bind(projectId).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.input_key, r.value_text || ""]));
}

function validate(values) {
  for (const f of FIELDS) {
    const v = values[f.key] || "";
    if (f.required && !v) return `${f.label} is required.`;
    if (f.type === "select" && v && !f.options.some(([k]) => k === v)) return `Choose a valid option for ${f.label}.`;
  }
  if (values.brand_color && !hexOk(values.brand_color)) return "Brand colour must look like #b3261e, or be left blank.";
  if (values.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact_email)) return "That email address doesn't look right.";
  if (values.subdomain && !validSlug(values.subdomain.toLowerCase())) return "Your web address can use letters, numbers and dashes (3-30 characters) and can't be a reserved word.";
  for (const k of ["facebook", "instagram"]) if (values[k] && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(values[k])) return `${k === "facebook" ? "Facebook" : "Instagram"} address must start with https://`;
  if (values.domain && !/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/?$/i.test(values.domain)) return "Your own domain should look like www.yourrestaurant.com.";
  if (!/\d{7}/.test(values.phone.replace(/\D/g, ""))) return "Phone number needs at least 7 digits.";
  if (!/\d{3,}/.test(values.hours.replace(/\D/g, "")) && !/closed|daily|open/i.test(values.hours)) return "Please write your opening hours, for example Mon-Fri: 11am-9pm.";
  return null;
}

async function reserveSlug(env, context, values) {
  const wanted = (values.subdomain || "").toLowerCase() || slugify(context.business_name) || "site";
  const existing = await env.DB.prepare(`SELECT id, slug FROM website_sites WHERE project_id = ?`).bind(context.id).first();
  if (existing) {
    if (values.subdomain && existing.slug !== wanted && validSlug(wanted)) {
      const clash = await env.DB.prepare(`SELECT id FROM website_sites WHERE slug = ?`).bind(wanted).first();
      if (clash) return { error: `${wanted}.menu-made.com is already taken - please choose another address.` };
      await env.DB.prepare(`UPDATE website_sites SET slug = ?, updated_at = ? WHERE id = ?`).bind(wanted, nowIso(), existing.id).run();
      return { slug: wanted };
    }
    return { slug: existing.slug };
  }
  let slug = validSlug(wanted) ? wanted : `${slugify(wanted) || "site"}-site`;
  if (!validSlug(slug)) slug = `site-${context.id.slice(0, 6)}`;
  for (let n = 0; n < 6; n++) {
    const candidate = n === 0 ? slug : `${slug.slice(0, 24)}-${Math.random().toString(36).slice(2, 6)}`;
    const clash = await env.DB.prepare(`SELECT id FROM website_sites WHERE slug = ?`).bind(candidate).first();
    if (clash) { if (values.subdomain && n === 0) return { error: `${candidate}.menu-made.com is already taken - please choose another address.` }; continue; }
    const t = nowIso();
    await env.DB.prepare(`INSERT INTO website_sites (id, slug, project_id, business_id, customer_id, style, custom_domain, domain_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), candidate, context.id, context.business_id, context.customer_id, values.style, values.domain ? values.domain.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase() : null, values.domain ? "PENDING" : null, t, t).run();
    return { slug: candidate };
  }
  return { error: "Please choose a different web address." };
}

async function storeImage(env, context, file, kind, index) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return { skip: true };
  if (bytes.length > MAX_IMAGE) return { error: `${file.name || "An image"} is over 1.5 MB. Please upload a smaller one.` };
  const type = sniffImage(bytes);
  if (!type) return { error: `${file.name || "A file"} is not a PNG, JPG or WebP image.` };
  const id = crypto.randomUUID();
  const key = ["customers", context.customer_id, "projects", context.id, "site-images", `${kind}-${index}-${id}.${type.ext}`].join("/");
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: type.mime } });
  const t = nowIso();
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, ?, 'R2', ?, ?, ?, ?, ?, 'VALID', ?, ?, 1, 1, 1, ?)
    `).bind(id, context.business_id, context.customer_id, context.id, kind === "logo" ? "LOGO" : "PHOTO", key, String(file.name || kind).slice(0, 100), type.mime, bytes.length, await sha256Hex(bytes), t, t, JSON.stringify({ site_image: kind, order: index })).run();
  return { id };
}

async function handleSiteIntake(request, env, projectId) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest email and we'll send a fresh one.</p>");
  const context = await loadDeliveryContext(projectId, env);
  if (!context || context.workflow_key !== "WEBSITE_PACKAGE_V1") return denied();
  const locked = context.status !== "AWAITING_INPUTS";
  if (request.method === "GET") {
    const token = new URL(request.url).searchParams.get("t") || "";
    const payload = await verifyLinkToken(env, token, [LINK_KIND], projectId);
    if (!payload || payload.expired) return denied();
    return formPage(projectId, token, await savedValues(env, projectId), { locked });
  }
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], projectId);
  if (!payload || payload.expired) return denied();
  if (locked) return formPage(projectId, token, {}, { locked: true });
  const values = {};
  for (const f of FIELDS) values[f.key] = String(form.get(f.key) ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).join("\n").trim().slice(0, f.max);
  const problem = validate(values);
  if (problem) return formPage(projectId, token, values, { error: problem });
  const slug = await reserveSlug(env, context, values);
  if (slug.error) return formPage(projectId, token, values, { error: slug.error });
  const files = [["logo", [form.get("logo")]], ["photo", form.getAll("photos")]];
  const stored = [];
  for (const [kind, list] of files) {
    let index = 0;
    for (const file of list.filter((f) => f && typeof f !== "string").slice(0, kind === "logo" ? 1 : MAX_PHOTOS)) {
      const result = await storeImage(env, context, file, kind, index);
      if (result.error) return formPage(projectId, token, values, { error: result.error });
      if (!result.skip) { stored.push(result.id); index += 1; }
    }
  }
  // Newly uploaded images replace earlier ones of the same kind; no upload keeps what was there.
  if (stored.length) {
    const kinds = [form.get("logo") && typeof form.get("logo") !== "string" && form.get("logo").size ? "logo" : null, form.getAll("photos").some((f) => f && typeof f !== "string" && f.size) ? "photo" : null].filter(Boolean);
    for (const k of kinds) await env.DB.prepare(`UPDATE assets SET status = 'ARCHIVED' WHERE project_id = ? AND json_extract(metadata_json, '$.site_image') = ? AND id NOT IN (${stored.map(() => "?").join(",")})`).bind(projectId, k, ...stored).run();
  }
  const t = nowIso();
  for (const f of FIELDS) {
    await env.DB.prepare(`UPDATE project_inputs SET value_text = ?, status = ?, submitted_at = ?, validated_at = ?, updated_at = ? WHERE project_id = ? AND input_key = ?`)
      .bind(values[f.key] || null, values[f.key] ? "VALID" : "MISSING", t, t, t, projectId, f.key).run();
  }
  await refreshOnboardingState(projectId, context.order_id, context.customer_id, "WEBSITE_PACKAGE_V1", env);
  return simplePage(200, "Thank you", `<p>We have what we need and we're building your website now. You'll get an email with a preview link${slug.slug ? `; your address will be <strong>${escapeHtml(slug.slug)}.menu-made.com</strong>` : ""}.</p>`);
}

export { FIELDS, LINK_KIND, handleSiteIntake, intakeLink, slugify, sniffImage, startWebsiteIntake, validSlug };
