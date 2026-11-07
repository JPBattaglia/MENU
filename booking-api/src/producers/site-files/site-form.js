// Contact form on generated websites (owner, Nov 6, 2026: "add a contact form into that page"). Every bought site's
// Contact page posts here (the zip a buyer hosts anywhere, and sites Menu-made hosts): a signed token names the
// project, and the message is emailed to the buyer's checkout address with the visitor's email to reply to.
// Limits: a hidden honeypot field, 5 messages an hour per network, 40 a day per site.
//   POST /api/site-form/<token>   name, email, phone, message (+ website, the honeypot)
import { brandedEmailHtml, escapeHtml, looksLikeEmail, sendTransactionalEmail } from "../../lib/email.js";
import { simplePage } from "../../lib/http.js";
import { base64UrlDecode, signLinkToken, verifyLinkToken } from "../../lib/links.js";

const KIND = "site-form";
const TTL_DAYS = 3650;
const PER_NETWORK_HOUR = 5;
const PER_SITE_DAY = 40;

const formToken = (env, projectId) => signLinkToken(env, { kind: KIND, id: projectId, ttlDays: TTL_DAYS });
const formAction = async (env, projectId) => `https://menu-made.com/api/site-form/${encodeURIComponent(await formToken(env, projectId))}`;
const clean = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\s+/g, " ");

async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Back to the page the visitor came from, only when it's a web address.
function backLink(request) {
  const ref = request.headers.get("Referer") || "";
  return /^https?:\/\/[^\s"<>]+$/.test(ref) && ref.length < 500 ? ref : "";
}
function answer(request, status, title, text, business = "") {
  const back = backLink(request);
  return simplePage(status, title, `<p>${text}</p>${back ? `<a class="btn" href="${escapeHtml(back)}">Back to ${escapeHtml(business || "the site")}</a>` : ""}`);
}

async function handleSiteForm(request, env, token, { now = Date.now() } = {}) {
  if (request.method !== "POST") return answer(request, 405, "Use the form", "Please send your message with the form on the Contact page.");
  const raw = decodeURIComponent(String(token));
  let claimed = null;
  try { claimed = JSON.parse(new TextDecoder().decode(base64UrlDecode(raw.split(".")[0]))).i; } catch { claimed = null; }
  const payload = typeof claimed === "string" ? await verifyLinkToken(env, raw, [KIND], claimed).catch(() => null) : null;
  if (!payload || payload.expired || !payload.i) return answer(request, 404, "Form not found", "This form isn't connected any more. Please call or email the business instead.");
  const site = await env.DB.prepare(`
      SELECT p.id AS project_id, b.name AS business, c.email AS email
      FROM projects p JOIN customers c ON c.id = p.customer_id JOIN businesses b ON b.id = p.business_id
      WHERE p.id = ?`).bind(String(payload.i)).first().catch(() => null);
  if (!site?.email) return answer(request, 404, "Form not found", "This form isn't connected any more. Please call or email the business instead.");

  const form = await request.formData().catch(() => null);
  if (!form) return answer(request, 400, "Message not sent", "We couldn't read the form. Please try again.", site.business);
  // Bots fill every field; people never see this one. Answer as if it went.
  if (clean(form.get("website"), 200)) return answer(request, 200, "Message sent", `Thanks. Your message is on its way to ${escapeHtml(site.business)}.`, site.business);
  const name = oneLine(form.get("name"), 100), email = oneLine(form.get("email"), 150).toLowerCase(), phone = oneLine(form.get("phone"), 40), message = clean(form.get("message"), 3000);
  if (!name || message.length < 2) return answer(request, 400, "Message not sent", "Add your name and a message, then send it again.", site.business);
  if (email && !looksLikeEmail(email)) return answer(request, 400, "Message not sent", "That email address doesn't look right. Check it and send again.", site.business);
  if (!email && !phone) return answer(request, 400, "Message not sent", "Add an email or a phone number so they can get back to you.", site.business);

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = await sha256(`${env.BOOKING_RATE_SALT || "site-form"}:${ip}`);
  const t = new Date(now);
  const hourAgo = new Date(now - 3600e3).toISOString(), dayAgo = new Date(now - 86400e3).toISOString();
  const recent = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM site_form_messages WHERE ip_hash = ? AND created_at > ?) AS network,
      (SELECT COUNT(*) FROM site_form_messages WHERE project_id = ? AND created_at > ?) AS site`).bind(ipHash, hourAgo, site.project_id, dayAgo).first();
  if (Number(recent?.network || 0) >= PER_NETWORK_HOUR || Number(recent?.site || 0) >= PER_SITE_DAY) {
    return answer(request, 429, "Message not sent", "Too many messages were sent just now. Please try again later, or call instead.", site.business);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO site_form_messages (id, project_id, ip_hash, created_at) VALUES (?, ?, ?, ?)`).bind(id, site.project_id, ipHash, t.toISOString()).run();

  const rows = [["Name", name], email && ["Email", email], phone && ["Phone", phone]].filter(Boolean);
  const sent = await sendTransactionalEmail(env, {
    to: site.email,
    replyTo: email || undefined,
    subject: `New message from your website: ${name}`,
    html: brandedEmailHtml({
      preheader: message.slice(0, 90),
      eyebrow: "Your website",
      heading: `A message from ${escapeHtml(name)}`,
      paragraphs: [
        rows.map(([k, v]) => `<strong>${k}:</strong> ${escapeHtml(v)}`).join("<br>"),
        escapeHtml(message).replace(/\n/g, "<br>"),
        email ? "Reply to this email to answer them." : "They left a phone number, not an email."
      ]
    }),
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${message}\n\n${email ? "Reply to this email to answer them." : "They left a phone number, not an email."}`,
    idempotencyKey: `site-form/${id}`,
    purpose: "SITE_FORM",
    templateKey: "site_form_message_v1",
    context: { projectId: site.project_id }
  }).catch(() => ({ ok: false }));
  if (!sent?.ok) return answer(request, 502, "Message not sent", "We couldn't send it just now. Please try again in a minute, or call instead.", site.business);
  return answer(request, 200, "Message sent", `Thanks, ${escapeHtml(name)}. Your message is on its way to ${escapeHtml(site.business)}.`, site.business);
}

export { formAction, formToken, handleSiteForm };
