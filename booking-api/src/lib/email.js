import { nowIso } from "./http.js";

var RESEND_ENDPOINT = "https://api.resend.com/emails";

// Buyer address used by the sandbox self-test: Resend accepts it and delivers nowhere.
var SELF_TEST_EMAIL = "delivered@resend.dev";

var FROM_ADDRESS = "Menu-Made <orders@updates.menu-made.com>";

var REPLY_TO_ADDRESS = "info@menu-made.com";

var INTERNAL_BCC = "menu.automate@gmail.com";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function logEmailEvent({
  eventType,
  projectId,
  orderId,
  customerId,
  payload
}, env) {
  await env.DB.prepare(`
      INSERT INTO business_events (
        id,
        created_at,
        event_type,
        entity_type,
        entity_id,
        actor_type,
        actor_id,
        correlation_id,
        payload_json
      )
      VALUES (
        ?,
        ?,
        ?,
        'PROJECT',
        ?,
        'SYSTEM',
        'MENU_MADE_EMAIL',
        ?,
        ?
      )
    `).bind(
    crypto.randomUUID(),
    nowIso(),
    eventType,
    projectId,
    orderId,
    JSON.stringify({
      customer_id: customerId,
      ...payload
    })
  ).run();
}

function looksLikeEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value.trim());
}

function brandedEmailHtml({ preheader, eyebrow, heading, paragraphs = [], buttons = [], rows = [], footnote = "" }) {
  const p = (html) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#26434f;">${html}</p>`;
  const button = (b) => `<tr><td style="padding:0 0 12px;"><a href="${escapeHtml(b.url)}" style="display:inline-block;background-color:${b.primary ? "#00a7b5" : "#071f2c"};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 22px;border-radius:6px;">${escapeHtml(b.label)}</a></td></tr>`;
  const row = (r) => `<tr><td style="padding:10px 14px;border-bottom:1px solid #dce8ec;font-size:12px;font-weight:bold;color:#45616c;width:120px;vertical-align:top;">${escapeHtml(r[0])}</td><td style="padding:10px 14px;border-bottom:1px solid #dce8ec;font-size:14px;color:#102f3d;overflow-wrap:anywhere;">${escapeHtml(r[1])}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background-color:#edf3f5;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;font-size:1px;color:#edf3f5;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#edf3f5;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dce8ec;">
<tr><td style="background-color:#071f2c;padding:28px 32px;border-bottom:4px solid #00d6e6;"><a href="https://menu-made.com" style="text-decoration:none;"><img src="https://menu-made.com/MENU1.png" width="220" alt="MENU-MADE" style="display:block;width:220px;max-width:100%;height:auto;border:0;"></a></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 12px;font-size:12px;font-weight:bold;letter-spacing:1px;color:#08747b;">${escapeHtml(eyebrow)}</p>
<h1 style="margin:0 0 24px;font-size:26px;line-height:1.25;color:#071f2c;">${escapeHtml(heading)}</h1>
${paragraphs.map(p).join("\n")}
${rows.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f8f9;border:1px solid #dce8ec;margin:0 0 24px;">${rows.map(row).join("")}</table>` : ""}
${buttons.length ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${buttons.map(button).join("")}</table>` : ""}
${footnote ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#5b7480;">${footnote}</p>` : ""}
</td></tr>
<tr><td style="padding:24px 32px;background-color:#071f2c;"><p style="margin:0;font-size:14px;line-height:1.6;color:#e8f6f7;"><a href="https://menu-made.com" style="color:#5ff2ff;">menu-made.com</a> &nbsp;·&nbsp; <a href="mailto:info@menu-made.com" style="color:#5ff2ff;">info@menu-made.com</a></p></td></tr>
</table></td></tr></table></body></html>`;
}

// Every email to a customer carries a "Your account" button (stage 9 part 2), so a buyer can always find their
// orders, deliveries and plan links again. Owner alerts, approval requests and the sign-in email itself don't.
const ACCOUNT_URL = "https://menu-made.com/account";
function isCustomerEmail(to, purpose, env) {
  const recipient = String(to || "").trim().toLowerCase();
  const owner = String(env?.OWNER_EMAIL || REPLY_TO_ADDRESS).trim().toLowerCase();
  if (!recipient || recipient === owner || recipient === String(REPLY_TO_ADDRESS).toLowerCase() || recipient === String(INTERNAL_BCC).toLowerCase()) return false;
  const kind = String(purpose || "");
  return !(kind === "AUTOMATION_ALERT" || kind === "ACCOUNT_SIGN_IN" || kind.startsWith("OWNER") || kind.endsWith("_OWNER"));
}
function withAccountLink(html, text) {
  const block = `<tr><td style="padding:20px 32px;border-top:1px solid #dce8ec;"><p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#26434f;">Your orders, deliveries and plan links are always in your account. Sign in with this email address; no password needed.</p><a href="${ACCOUNT_URL}" style="display:inline-block;background-color:#071f2c;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 18px;border-radius:6px;">Your account</a></td></tr>`;
  const marker = '<tr><td style="padding:24px 32px;background-color:#071f2c;">';
  const outHtml = typeof html !== "string" || html.includes(ACCOUNT_URL) ? html
    : html.includes(marker) ? html.replace(marker, block + marker)
    : html.includes("</body>") ? html.replace("</body>", `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;"><a href="${ACCOUNT_URL}">Your Menu-Made account</a>: orders, deliveries and plan links (sign in with this email).</p></body>`)
    : html + `<p><a href="${ACCOUNT_URL}">Your Menu-Made account</a></p>`;
  const outText = typeof text !== "string" || text.includes(ACCOUNT_URL) ? text
    : `${text}\n\nYour account (orders, deliveries and plan links; sign in with this email): ${ACCOUNT_URL}`;
  return { html: outHtml, text: outText };
}

// Stage 10 cross-sell: every Menu-made delivery email offers staff merch and Nino's design services (except the
// merch and Nino design deliveries themselves, which already do).
const MERCH_URL = "https://menu-made.com/staff-merch.html";
function withCrossSell(html, text) {
  const block = `<tr><td style="padding:16px 32px;border-top:1px solid #dce8ec;"><p style="margin:0;font-size:14px;line-height:1.6;color:#26434f;">Shirts for your team in Nino Battaglia's designs, with your logo if you like: <a href="${MERCH_URL}" style="color:#00727c;">staff merch</a>. Need a logo, flyer or printed menu? <a href="https://ninobattaglia.com/services.html#design-services" style="color:#00727c;">Design by Nino</a>.</p></td></tr>`;
  const marker = '<tr><td style="padding:24px 32px;background-color:#071f2c;">';
  const outHtml = typeof html === "string" && !html.includes(MERCH_URL) && html.includes(marker) ? html.replace(marker, block + marker) : html;
  const outText = typeof text === "string" && !text.includes(MERCH_URL) ? `${text}\n\nStaff shirts in Nino Battaglia's designs: ${MERCH_URL}\nDesign by Nino (logos, flyers, menus): https://ninobattaglia.com/services.html` : text;
  return { html: outHtml, text: outText };
}

async function sendTransactionalEmail(env, { to, subject, html, text, idempotencyKey, purpose, templateKey, context = {}, bccInternal = false }) {
  if (purpose === "ORDER_DELIVERY" && isCustomerEmail(to, purpose, env) && !/^delivery_(merch|nino_design)_/.test(String(templateKey || ""))) ({ html, text } = withCrossSell(html, text));
  if (isCustomerEmail(to, purpose, env)) ({ html, text } = withAccountLink(html, text));
  let ok = false;
  let providerId = null;
  let error = null;
  if (!env.RESEND_API_KEY) {
    error = "RESEND_API_KEY is not configured";
  } else {
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [to],
          ...bccInternal && to !== SELF_TEST_EMAIL ? { bcc: [INTERNAL_BCC] } : {},
          reply_to: REPLY_TO_ADDRESS,
          subject,
          html,
          text
        })
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (response.ok) {
        ok = true;
        providerId = data?.id || null;
      } else {
        error = data?.message || data?.error || `Resend returned HTTP ${response.status}`;
      }
    } catch (sendError) {
      error = sendError instanceof Error ? sendError.message : String(sendError);
    }
  }
  try {
    const timestamp = nowIso();
    await env.DB.prepare(`
        INSERT INTO communications (
          id, created_at, customer_id, business_id, order_id, project_id,
          channel, direction, purpose, template_key, subject, recipient,
          status, provider_message_id, sent_at, error_message, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, 'EMAIL', 'OUTBOUND', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
      crypto.randomUUID(),
      timestamp,
      context.customerId || null,
      context.businessId || null,
      context.orderId || null,
      context.projectId || null,
      purpose,
      templateKey,
      subject,
      to,
      ok ? "SENT" : "FAILED",
      providerId,
      ok ? timestamp : null,
      ok ? null : String(error).slice(0, 500),
      JSON.stringify({ idempotency_key: idempotencyKey })
    ).run();
  } catch (logError) {
    console.error("Communication log failed:", logError instanceof Error ? logError.message : String(logError));
  }
  return { ok, id: providerId, error };
}

export {
  isCustomerEmail,
  withAccountLink,
  SELF_TEST_EMAIL,
  RESEND_ENDPOINT,
  FROM_ADDRESS,
  REPLY_TO_ADDRESS,
  INTERNAL_BCC,
  escapeHtml,
  logEmailEvent,
  looksLikeEmail,
  brandedEmailHtml,
  sendTransactionalEmail
};
