// Conversion Fix intake (stage 6). The Start page puts the buyer's brief into the order notes as
//   "Website fix: <url>\nGoal: <goal>"
// This turns it into project inputs and releases the project to production. If the brief is missing or unusable the
// project stays as before (awaiting inputs) and the owner is told, because no one else is going to notice.
import { ownerEmailAddress } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso } from "../../lib/http.js";
import { refreshOnboardingState } from "../../onboarding/onboarding.js";

function parseBrief(notes) {
  const text = String(notes ?? "");
  const url = /Website fix:\s*(https?:\/\/\S+)/i.exec(text)?.[1] || "";
  const goal = /(?:^|\n)Goal:\s*([^\n]{3,80})/i.exec(text)?.[1]?.trim() || "";
  let valid = "";
  try { const u = new URL(url); if (/^https?:$/.test(u.protocol) && u.hostname.includes(".") && !u.username && !/^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname)) valid = u.href; } catch { /* unusable */ }
  return { url: valid, goal };
}

async function startConversionFix(env, { projectId, orderId, customerId, notes }) {
  const { url, goal } = parseBrief(notes);
  const t = nowIso();
  if (!url || !goal) {
    await sendTransactionalEmail(env, {
      to: ownerEmailAddress(env),
      subject: "[Conversion Fix] order without a usable website brief",
      html: brandedEmailHtml({ eyebrow: "CONVERSION FIX", heading: "A Conversion Fix order has no usable brief", paragraphs: [`Order ${escapeHtml(orderId)} was paid, but the website address or goal could not be read from the order notes, so nothing was started.`] }),
      text: `Order ${orderId} was paid, but the website address or goal could not be read from the order notes, so nothing was started.`,
      idempotencyKey: `conversion-no-brief/${projectId}`, purpose: "AUTOMATION_ALERT", templateKey: "conversion_no_brief_v1"
    }).catch(() => null);
    return { started: false };
  }
  for (const [key, type, value] of [["website_url", "URL", url], ["main_goal", "TEXT", goal]]) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO project_inputs (id, project_id, input_key, input_type, value_text, required, status, submitted_at, validated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 'VALID', ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), projectId, key, type, value, t, t, t, t).run();
  }
  await refreshOnboardingState(projectId, orderId, customerId, "CONVERSION_FIX_V1", env);
  return { started: true };
}

export { parseBrief, startConversionFix };
