// Stage 12, task 7 (failure drills): one alert per problem, and a second way to reach the owner when email is down.
//
// alertOnce(env, key, windowMs): true the first time a problem key is seen in the window (and records it), false after.
// Stored in worker_settings as "alert:<key>" = ISO time of the last alert. One indexed read and at most one write.
//
// Email-down fallback: sendTransactionalEmail calls noteMailResult after every send. When an owner alert fails, or
// three sends in a row fail, the worker starts .github/workflows/owner-alert.yml with the alert as its run name; the
// run fails on purpose, so GitHub emails the owner ("Run failed: <title>") through GitHub's own mail, not Resend.
// At most one fallback alert every 6 hours.
import { nowIso } from "./http.js";

const OWNER_ALERT_DISPATCH = "https://api.github.com/repos/JPBattaglia/MENU/actions/workflows/owner-alert.yml/dispatches";
const MAIL_DOWN_STREAK = 3;
const MAIL_DOWN_WINDOW_MS = 6 * 3600000;

async function alertOnce(env, key, windowMs, now = Date.now()) {
  if (!env.DB) return true;
  const k = `alert:${key}`;
  const row = await env.DB.prepare(`SELECT value FROM worker_settings WHERE key = ?`).bind(k).first().catch(() => null);
  if (row && now - Date.parse(row.value) < windowMs) return false;
  const t = new Date(now).toISOString();
  await env.DB.prepare(`INSERT INTO worker_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(k, t, t).run();
  return true;
}

// The owner alert through GitHub. title becomes the run name (and so the email subject); message is the action.
async function githubOwnerAlert(env, title, message) {
  if (!env.GITHUB_DISPATCH_TOKEN) return { sent: false, status: 0 };
  let status = 0;
  try {
    const response = await (env.GITHUB_DISPATCH_FETCH || fetch)(OWNER_ALERT_DISPATCH, { // GITHUB_DISPATCH_FETCH is a test seam
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "menu-made-worker", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "master", inputs: { title: String(title).slice(0, 120), message: String(message).slice(0, 900) } })
    });
    status = response.status;
  } catch (error) {
    console.error("Owner alert through GitHub failed:", error instanceof Error ? error.message : String(error));
  }
  return { sent: status === 204, status };
}

// After every send. ok: the send worked; toOwner: it was an alert to the owner; error: Resend's words.
async function noteMailResult(env, { ok, toOwner, error }, now = Date.now()) {
  if (!env.DB) return { fallback: false };
  const k = "mail:fail-streak";
  if (ok) {
    await env.DB.prepare(`DELETE FROM worker_settings WHERE key = ?`).bind(k).run().catch(() => null);
    return { fallback: false };
  }
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO worker_settings (key, value, updated_at) VALUES (?, '1', ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at`).bind(k, t).run().catch(() => null);
  const streak = Number((await env.DB.prepare(`SELECT value FROM worker_settings WHERE key = ?`).bind(k).first().catch(() => null))?.value || 1);
  if (!toOwner && streak < MAIL_DOWN_STREAK) return { fallback: false };
  if (!(await alertOnce(env, "mail-down", MAIL_DOWN_WINDOW_MS, now))) return { fallback: false };
  const reason = String(error || "unknown error").slice(0, 200);
  const result = await githubOwnerAlert(env, "Menu-made can't send email",
    `Email isn't going out (Resend said: ${reason}). Customer deliveries retry on their own, so nothing is lost yet. ` +
    "What to do: open https://resend-status.com. If Resend shows an outage, wait; nothing else is needed. If it shows no outage, tell Claude 'email is down' so it can check the Resend key and domain.");
  return { fallback: true, ...result };
}

export { MAIL_DOWN_STREAK, alertOnce, githubOwnerAlert, noteMailResult };
