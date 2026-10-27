// Plan settings (stage 6): the few things a subscriber tells us once, through a signed page linked from our emails.
//   GET/POST /api/plan-settings/<subscriptionId>?t=<token>
// Which fields appear depends on the plans the subscription includes (bundles show every field their plans need).
import { escapeHtml } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { publicBaseUrl } from "../lib/config.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";

const LINK_KIND = "settings";
const FIELDS = {
  ACCESSIBILITY_MONITORING: [
    { key: "website_url", label: "Your website address", type: "url", required: true, placeholder: "https://www.yourrestaurant.com", help: "We scan this page and the pages it links to, once a month." }
  ],
  SOCIAL_POSTS: [
    { key: "voice", label: "How should your posts sound?", type: "text", max: 300, placeholder: "Warm and playful, family-run, a little humor", help: "Optional." },
    { key: "specials", label: "Specials, events or dates to feature this month", type: "textarea", max: 800, placeholder: "Live jazz every Friday. New autumn soup, $9.", help: "Optional. Any prices you write here may appear in your posts." }
  ]
};

async function settingsLink(env, subscriptionId) {
  const token = await signLinkToken(env, { kind: LINK_KIND, id: subscriptionId, ttlDays: 400 });
  return `${publicBaseUrl(env)}/api/plan-settings/${subscriptionId}?t=${token}`;
}

async function getSettings(env, subscriptionId) {
  const rows = (await env.DB.prepare(`SELECT setting_key, value_text FROM subscription_settings WHERE subscription_id = ?`).bind(subscriptionId).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.setting_key, r.value_text]));
}

async function fieldsFor(env, subscriptionId) {
  const plans = (await env.DB.prepare(`SELECT entitlement_type FROM entitlements WHERE subscription_id = ? AND status = 'ACTIVE'`).bind(subscriptionId).all()).results || [];
  const seen = new Set();
  return plans.flatMap((p) => FIELDS[p.entitlement_type] || []).filter((f) => !seen.has(f.key) && seen.add(f.key));
}

function validUrl(value) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") && !/^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname); } catch { return false; }
}

// Called after settings are saved so a run that was waiting for them continues on the next runner tick.
async function releaseWaitingRuns(env, subscriptionId) {
  const waiting = (await env.DB.prepare(`
      SELECT ws.id AS step_id, wr.id AS run_id FROM workflow_steps ws
      JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
      JOIN projects p ON p.id = wr.project_id
      WHERE ws.status = 'WAITING' AND ws.step_key = 'PRODUCE' AND json_extract(p.metadata_json, '$.subscription_id') = ?
    `).bind(subscriptionId).all()).results || [];
  for (const row of waiting) {
    await env.DB.prepare(`UPDATE workflow_steps SET status = 'QUEUED', error_message = NULL WHERE id = ?`).bind(row.step_id).run();
    await env.DB.prepare(`UPDATE workflow_runs SET status = 'QUEUED', error_code = NULL, error_message = NULL WHERE id = ? AND status = 'WAITING'`).bind(row.run_id).run();
  }
  return waiting.length;
}

function formPage(subscriptionId, token, fields, values, { error = null, notice = null } = {}) {
  const inputs = fields.map((f) => {
    const value = escapeHtml(values[f.key] || "");
    const control = f.type === "textarea"
      ? `<textarea id="${f.key}" name="${f.key}" rows="4" maxlength="${f.max || 800}" placeholder="${escapeHtml(f.placeholder || "")}" style="width:100%;box-sizing:border-box;font:inherit;padding:10px">${value}</textarea>`
      : `<input id="${f.key}" name="${f.key}" type="${f.type === "url" ? "url" : "text"}" value="${value}" ${f.required ? "required" : ""} maxlength="${f.max || 300}" placeholder="${escapeHtml(f.placeholder || "")}" style="width:100%;box-sizing:border-box;font:inherit;padding:10px">`;
    return `<p><label for="${f.key}"><strong>${escapeHtml(f.label)}</strong></label><br>${control}<br><small>${escapeHtml(f.help || "")}</small></p>`;
  }).join("");
  return simplePage(error ? 400 : 200, "Your plan settings", `${notice ? `<p><strong>${escapeHtml(notice)}</strong></p>` : ""}${error ? `<p style="color:#9b1c1c"><strong>${escapeHtml(error)}</strong></p>` : ""}
<form method="post" action="/api/plan-settings/${escapeHtml(subscriptionId)}"><input type="hidden" name="t" value="${escapeHtml(token)}">${inputs}<button type="submit">Save</button></form>`);
}

async function handlePlanSettings(request, env, subscriptionId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest email and we'll send a fresh one.</p>");
  const fields = await fieldsFor(env, subscriptionId);
  if (request.method === "GET") {
    const token = new URL(request.url).searchParams.get("t") || "";
    const payload = await verifyLinkToken(env, token, [LINK_KIND], subscriptionId);
    if (!payload || payload.expired) return denied();
    return fields.length ? formPage(subscriptionId, token, fields, await getSettings(env, subscriptionId)) : simplePage(200, "Nothing to set up", "<p>Your plan doesn't need any settings.</p>");
  }
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], subscriptionId);
  if (!payload || payload.expired) return denied();
  const values = {};
  for (const f of fields) {
    const raw = String(form.get(f.key) ?? "").replace(/\s+/g, " ").trim().slice(0, f.max || 300);
    values[f.key] = raw;
    if (f.required && !raw) return formPage(subscriptionId, token, fields, values, { error: `${f.label} is required.` });
    if (f.type === "url" && raw && !validUrl(raw)) return formPage(subscriptionId, token, fields, values, { error: "That doesn't look like a website address. Start with https://" });
  }
  const t = nowIso();
  for (const [key, value] of Object.entries(values)) {
    await env.DB.prepare(`INSERT INTO subscription_settings (subscription_id, setting_key, value_text, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (subscription_id, setting_key) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at`).bind(subscriptionId, key, value, t).run();
  }
  const released = await releaseWaitingRuns(env, subscriptionId);
  return simplePage(200, "Saved", `<p>Thank you. ${released ? "We're getting your report ready now." : "Your settings are saved."}</p>`);
}

export { FIELDS, getSettings, handlePlanSettings, releaseWaitingRuns, settingsLink, validUrl };
