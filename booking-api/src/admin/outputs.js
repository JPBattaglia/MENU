// Owner "Latest outputs" page (owner, Nov 7, 2026): the newest file every service has made (real customers or the
// daily self-tests, which use the real AI and renderers), one tap to open each, so the owner can judge what buyers get.
// No token to remember: the link is emailed to the owner inbox. Request one by inserting a self_tests row,
// kind OWNER_OUTPUTS_LINK, status REQUESTED; the next cron tick emails the link (good for 7 days).
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";

const KIND = "owner_outputs";
const LINK_DAYS = 7;
const REQUEST_KIND = "OWNER_OUTPUTS_LINK";

const label = (key) => String(key || "").replace(/_V\d+$/, "").toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

async function outputsLink(env) {
  return `${publicBaseUrl(env)}/api/owner/outputs?t=${encodeURIComponent(await signLinkToken(env, { kind: KIND, id: "all", ttlDays: LINK_DAYS }))}`;
}

async function handleOwnerOutputs(request, env) {
  const url = new URL(request.url);
  const payload = await verifyLinkToken(env, url.searchParams.get("t") || "", [KIND], "all");
  if (!payload || payload.expired) return simplePage(403, "This link has expired or isn't valid", "<p>Ask Claude for a fresh outputs link.</p>");
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const { results = [] } = await env.DB.prepare(`
      SELECT * FROM (
        SELECT p.workflow_key, d.deliverable_type, d.id, d.status, d.created_at, a.original_filename, a.mime_type, c.email,
          ROW_NUMBER() OVER (PARTITION BY p.workflow_key, d.deliverable_type ORDER BY d.created_at DESC) AS rn
        FROM deliverables d JOIN projects p ON p.id = d.project_id JOIN assets a ON a.id = d.asset_id JOIN customers c ON c.id = p.customer_id
        WHERE p.workflow_key NOT LIKE 'ROUTING_SELFTEST%'
      ) WHERE rn = 1 ORDER BY workflow_key, deliverable_type
    `).all();
  const base = publicBaseUrl(env);
  const rows = [];
  for (const r of results) {
    const t = await signLinkToken(env, { kind: "preview", id: r.id, ttlDays: 1 });
    const open = `${base}/api/delivery/${r.id}?t=${encodeURIComponent(t)}`;
    const when = new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
    const who = /@resend\.dev$/i.test(String(r.email || "")) ? "self-test" : "customer";
    rows.push(`<tr><td><strong>${escapeHtml(label(r.workflow_key))}</strong><br><small>${escapeHtml(r.deliverable_type)} · ${escapeHtml(r.original_filename || "")}</small></td><td><small>${escapeHtml(when)}<br>${who}, ${escapeHtml(String(r.status).toLowerCase())}</small></td><td><a href="${escapeHtml(open)}">Open</a></td></tr>`);
  }
  const body = `<p>The newest file each service has made. Self-test files come from the daily test orders, made with the real AI. Each Open link works for a day; this page works until its email link expires.</p>
<style>table{border-collapse:collapse;width:100%}td{padding:10px 8px;border-top:1px solid #dce8ec;vertical-align:top}small{color:#45616c}</style>
<table>${rows.join("") || "<tr><td>No files yet.</td></tr>"}</table>`;
  return simplePage(200, "Latest outputs", body);
}

// Cron: email the owner a fresh link for each request row.
async function runOwnerOutputsLink(env) {
  if (!env.DB) return 0;
  const { results = [] } = await env.DB.prepare(`SELECT id FROM self_tests WHERE kind = ? AND status = 'REQUESTED' LIMIT 1`).bind(REQUEST_KIND).all();
  if (!results.length) return 0;
  const row = results[0];
  const url = await outputsLink(env);
  const result = await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Latest outputs from every service",
    html: brandedEmailHtml({
      preheader: "One tap to open the newest file each service has made.",
      eyebrow: "OWNER",
      heading: "Latest outputs",
      paragraphs: [`The newest file each Menu-made service has made, from customers or the daily self-tests. The link works for ${LINK_DAYS} days.`],
      buttons: [{ label: "See the latest outputs", url, primary: true }]
    }),
    text: `Latest outputs from every service (link works ${LINK_DAYS} days): ${url}`,
    idempotencyKey: `owner-outputs/${row.id}`, purpose: "OWNER_ACTION", templateKey: "owner_outputs_link_v1"
  }).catch((error) => ({ ok: false, error }));
  // The link is also kept on the request row, so Claude can open it from the database when the owner inbox is out of
  // reach (whoever can read D1 can already do far more than this read-only page).
  await env.DB.prepare(`UPDATE self_tests SET status = ?, error = ?, state_json = ?, updated_at = ? WHERE id = ?`)
    .bind(result?.ok ? "PASSED" : "FAILED", result?.ok ? null : String(result?.error?.message || result?.error || "send failed").slice(0, 300), JSON.stringify({ url }), nowIso(), row.id).run();
  return result?.ok ? 1 : 0;
}

export { handleOwnerOutputs, runOwnerOutputsLink, outputsLink };
