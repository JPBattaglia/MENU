// Google Visibility intake (stage 5). The Start page puts the buyer's brief in the order notes as
//   "Google: existing profile[; <link>]"  or  "Google: new profile"
// A paid order is released straight to production: PRODUCE emails the buyer their connect link (with Google's
// create-and-verify steps for a new profile) and waits for the connection. A missing brief counts as "existing".
// Once a day, buyers who still haven't connected get a reminder at 5 and 14 days (a fresh link: the first one lasts
// 30 days), and at 30 days the owner is told, because nothing else will happen on its own.
import { ownerEmailAddress } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { refreshOnboardingState } from "../../onboarding/onboarding.js";
import { sendConnectEmail } from "./visibility-step.js";

const DAY = 864e5;
const REMINDERS = [5, 14];
const OWNER_ALERT_DAYS = 30;

function parseGoogleBrief(notes) {
  const match = /(?:^|\n)Google:\s*(new profile|existing profile)(?:;\s*(https?:\/\/\S+))?/i.exec(String(notes ?? ""));
  return { mode: /new/i.test(match?.[1] || "") ? "new" : "existing", profileUrl: match?.[2] || "" };
}

async function startGoogleVisibility(env, { projectId, orderId, customerId, notes }) {
  const { mode, profileUrl } = parseGoogleBrief(notes);
  const t = nowIso();
  const inputs = [["google_mode", "TEXT", mode], ...(profileUrl ? [["google_profile_url", "URL", profileUrl]] : [])];
  for (const [key, type, value] of inputs) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO project_inputs (id, project_id, input_key, input_type, value_text, required, status, submitted_at, validated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'VALID', ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), projectId, key, type, value, key === "google_mode" ? 1 : 0, t, t, t, t).run();
  }
  await env.DB.prepare(`UPDATE projects SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.source', 'GOOGLE_VISIBILITY', '$.google_subscription_id', ?) WHERE id = ?`)
    .bind(projectId, projectId).run();
  await refreshOnboardingState(projectId, orderId, customerId, "GOOGLE_VISIBILITY_V1", env);
  return { started: true, mode };
}

async function alreadySent(env, projectId, templateKey) {
  return Boolean(await env.DB.prepare(`SELECT 1 FROM communications WHERE project_id = ? AND template_key = ? AND status IN ('SENT', 'DELIVERED') LIMIT 1`).bind(projectId, templateKey).first());
}

// Daily: reminders and the 30-day owner alert for paid orders still waiting for the buyer to connect Google.
async function remindGoogleVisibilityConnects(env, now = new Date()) {
  const waiting = (await env.DB.prepare(`
      SELECT p.id, p.created_at, p.metadata_json FROM workflow_steps ws
      JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
      JOIN projects p ON p.id = wr.project_id
      WHERE ws.status = 'WAITING' AND ws.step_key = 'PRODUCE' AND wr.error_code = 'GOOGLE_CONNECTION_REQUIRED'
        AND p.workflow_key = 'GOOGLE_VISIBILITY_V1' AND p.status = 'AWAITING_INPUTS'
      LIMIT 50
    `).all()).results || [];
  let sent = 0;
  for (const row of waiting) {
    if (parseJsonOrNull(row.metadata_json)?.source !== "GOOGLE_VISIBILITY") continue;
    const days = (now.getTime() - Date.parse(row.created_at)) / DAY;
    const context = await loadDeliveryContext(row.id, env);
    if (!context) continue;
    if (days >= OWNER_ALERT_DAYS) {
      if (await alreadySent(env, row.id, "gv_not_connected_v1")) continue;
      const business = context.business_name || "A customer";
      await sendTransactionalEmail(env, {
        to: ownerEmailAddress(env), subject: `${business} paid for Google Visibility 30 days ago and hasn't connected Google`,
        html: brandedEmailHtml({ eyebrow: "GOOGLE VISIBILITY", heading: `${escapeHtml(business)} hasn't connected Google`,
          paragraphs: [`Order ${escapeHtml(context.order_id)} (${escapeHtml(context.customer_email)}) has had two reminders. Nothing more is sent automatically; reach out, or refund in Stripe if they've changed their mind.`] }),
        text: `${business} (${context.customer_email}), order ${context.order_id}, paid 30 days ago and still hasn't connected Google after two reminders.`,
        idempotencyKey: `gv-not-connected/${row.id}`, purpose: "AUTOMATION_ALERT", templateKey: "gv_not_connected_v1",
        context: { projectId: row.id, businessId: context.business_id, orderId: context.order_id }
      }).catch(() => null);
      sent += 1;
      continue;
    }
    for (let i = REMINDERS.length; i >= 1; i--) {
      if (days < REMINDERS[i - 1]) continue;
      if (await alreadySent(env, row.id, `gv_connect_reminder_${i}_v1`)) break;
      const mode = (await env.DB.prepare(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = 'google_mode'`).bind(row.id).first())?.value_text;
      const result = await sendConnectEmail(env, context, { mode, reminder: i });
      if (result.ok) sent += 1;
      break;
    }
  }
  return { waiting: waiting.length, sent };
}

export { parseGoogleBrief, startGoogleVisibility, remindGoogleVisibilityConnects };
