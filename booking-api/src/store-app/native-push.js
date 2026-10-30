// Stage 11 part 2: native push notifications for the Store App (iOS now; Android joins with Firebase).
//
// Why a GitHub job: Apple's push service (APNs) speaks HTTP/2 only and Worker fetches don't (the push key check got
// Cloudflare 520, Oct 29, 2026). So, like the Social Posts renderer, the worker parks the work and a GitHub Actions
// workflow in JPBattaglia/MENU (.github/workflows/native-push.yml) sends it. The worker starts that workflow itself
// the moment a notification is queued (GITHUB_DISPATCH_TOKEN); the 5-minute tick starts it again if a job waits.
// Delivery takes 1-2 minutes. No outside service and no per-restaurant owner step.
//
// Phone side (Store App, from capacitor://localhost; routed through engage.js handleAppApi):
//   POST <app>/api/push/native     { platform: "ios", token, bundle_id, environment }
// GitHub job side (Bearer <GitHub OIDC token, audience menu-made-native-push>, manual runs of native-push.yml on master):
//   GET  /api/native-push/next      claims the oldest waiting batch: { job: { id, claim, title, body, tag, devices }, apple }
//   POST /api/native-push/<id>      { claim, results: [{ device, status, reason }] }
// The repo is public, so the job masks the key and device tokens and prints only counts.
//
// The Apple push key is the restaurant's (scope = its business id) once restaurants have their own; until then, and
// for the test restaurant (Sample Cafe on the owner's Apple account), scope 'owner'.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso } from "../lib/http.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";
import { loadCredential } from "./keys.js";

const PUSH_AUDIENCE = "menu-made-native-push";
const PUSH_WORKFLOW = "JPBattaglia/MENU/.github/workflows/native-push.yml@refs/heads/master";
const DISPATCH_URL = "https://api.github.com/repos/JPBattaglia/MENU/actions/workflows/native-push.yml/dispatches";
const BATCH_SIZE = 500;
const CLAIM_MINUTES = 15;
const NUDGE_AFTER_MINUTES = 3;
const NUDGE_EVERY_MINUTES = 10;
const STALE_MINUTES = 60;
const MAX_FAILURES = 5;
const TOKEN_RE = /^[0-9a-f]{64,200}$/;
const BUNDLE_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/;
// Apple's answers that mean this token will never work again.
const GONE_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"]);

const API_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: API_HEADERS });

// ---------- Phone registration ----------

async function registerNativeDevice(env, app, body) {
  const platform = String(body.platform || "").toLowerCase();
  if (platform !== "ios") return json({ ok: false, error: "Notifications on this phone aren't supported yet." }, 400);
  const token = String(body.token || "").trim().toLowerCase();
  const bundleId = String(body.bundle_id || "").trim();
  const environment = body.environment === "sandbox" ? "sandbox" : "production";
  if (!TOKEN_RE.test(token) || !BUNDLE_RE.test(bundleId)) return json({ ok: false, error: "This phone's notification details weren't accepted." }, 400);
  const t = nowIso();
  await env.DB.prepare(`
      INSERT INTO native_push_devices (id, app_id, platform, token, bundle_id, environment, status, failures, created_at, updated_at) VALUES (?, ?, 'IOS', ?, ?, ?, 'ACTIVE', 0, ?, ?)
      ON CONFLICT(token) DO UPDATE SET app_id = excluded.app_id, bundle_id = excluded.bundle_id, environment = excluded.environment, status = 'ACTIVE', failures = 0, updated_at = excluded.updated_at
    `).bind(crypto.randomUUID(), app.id, token, bundleId, environment, t, t).run();
  return json({ ok: true });
}

const nativeDeviceCount = async (env, appId) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM native_push_devices WHERE app_id = ? AND status = 'ACTIVE'`).bind(appId).first())?.n || 0;

// ---------- Queue (called by engage.js queuePush for every QUEUED message) ----------

async function queueNativePush(env, messageId, appId) {
  const t = nowIso();
  const made = await env.DB.prepare(`
      INSERT OR IGNORE INTO native_push_jobs (id, message_id, app_id, platform, status, created_at, updated_at)
      SELECT ?, ?, ?, 'IOS', 'QUEUED', ?, ? WHERE EXISTS (SELECT 1 FROM native_push_devices WHERE app_id = ? AND platform = 'IOS' AND status = 'ACTIVE')
    `).bind(crypto.randomUUID(), messageId, appId, t, t, appId).run();
  if (!Number(made.meta?.changes || 0)) return { queued: false };
  const started = await startNativePush(env);
  return { queued: true, ...started };
}

// ---------- Starting the GitHub job ----------

async function startNativePush(env) {
  if (!env.GITHUB_DISPATCH_TOKEN) return { started: false, reason: "no token" };
  let status = 0;
  try {
    const response = await (env.GITHUB_DISPATCH_FETCH || fetch)(DISPATCH_URL, { // GITHUB_DISPATCH_FETCH is a test seam
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "menu-made-worker", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "master" })
    });
    status = response.status;
  } catch (error) {
    console.error("Native push start failed:", error instanceof Error ? error.message : String(error));
  }
  if (status !== 204) console.error(`Native push start refused: HTTP ${status}`);
  // One run handles every waiting job, so every waiting job counts as dispatched.
  await env.DB.prepare(`UPDATE native_push_jobs SET dispatched_at = ?, dispatch_status = ? WHERE status IN ('QUEUED', 'SENDING')`).bind(nowIso(), status).run().catch(() => null);
  return { started: status === 204, status };
}

// Every 5-minute tick: a job still waiting 3 minutes after it was queued (or last started) gets the workflow started
// again, at most every 10 minutes; a job waiting an hour alerts the owner once.
async function nudgeNativePushes(env, now = Date.now()) {
  if (!env.DB) return { nudged: false, alerted: 0 };
  const iso = (minutes) => new Date(now - minutes * 60000).toISOString();
  const pending = (await env.DB.prepare(`
      SELECT id, created_at, dispatched_at, alerted_at FROM native_push_jobs WHERE status IN ('QUEUED', 'SENDING') ORDER BY created_at LIMIT 20
    `).all()).results || [];
  if (!pending.length) return { nudged: false, alerted: 0 };
  let nudged = false;
  if (pending.some((j) => j.created_at < iso(NUDGE_AFTER_MINUTES) && (j.dispatched_at || "") < iso(NUDGE_EVERY_MINUTES))) nudged = (await startNativePush(env)).started;
  let alerted = 0;
  for (const job of pending.filter((j) => j.created_at < iso(STALE_MINUTES) && !j.alerted_at).slice(0, 3)) {
    if (await alertOwner(env, job.id, "Notifications are waiting to be sent", [
      "A Store App notification has waited over an hour because the GitHub sender hasn't run.",
      "Open the JPBattaglia/MENU repository on GitHub, go to Actions, choose \"Native push\" and click \"Run workflow\". If the workflow shows as disabled, enable it first."
    ])) alerted++;
  }
  return { nudged, alerted };
}

async function alertOwner(env, jobId, heading, paragraphs) {
  const sent = await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: heading,
    html: brandedEmailHtml({ preheader: paragraphs[0], eyebrow: "AUTOMATION ALERT", heading, paragraphs, rows: [["Push job", jobId]] }),
    text: `${heading}\n\n${paragraphs.join("\n\n")}\n\nPush job: ${jobId}`,
    idempotencyKey: `native-push-alert/${jobId}`,
    purpose: "AUTOMATION_ALERT",
    templateKey: "native_push_alert_v1"
  }).catch(() => ({ ok: false }));
  if (sent?.ok === false) return false;
  await env.DB.prepare(`UPDATE native_push_jobs SET alerted_at = ? WHERE id = ?`).bind(nowIso(), jobId).run();
  return true;
}

// ---------- Apple key for an app ----------

async function scopeFor(env, appId) {
  const app = await env.DB.prepare(`SELECT business_id FROM guest_apps WHERE id = ?`).bind(appId).first();
  if (app?.business_id) {
    const own = await env.DB.prepare(`SELECT 1 AS ok FROM store_credentials WHERE scope = ? AND kind = 'APPLE_PUSH_KEY'`).bind(app.business_id).first();
    if (own) return app.business_id;
  }
  return "owner";
}

// ---------- GitHub job routes ----------

async function claimNext(env) {
  const t = nowIso();
  const staleClaim = new Date(Date.now() - CLAIM_MINUTES * 60000).toISOString();
  const jobs = (await env.DB.prepare(`
      SELECT * FROM native_push_jobs WHERE status IN ('QUEUED', 'SENDING') ORDER BY created_at LIMIT 5
    `).all()).results || [];
  for (const job of jobs) {
    if (job.status === "SENDING" && (job.claimed_at || "") >= staleClaim) continue; // another run has it
    const devices = (await env.DB.prepare(`
        SELECT id, token, bundle_id, environment FROM native_push_devices WHERE app_id = ? AND platform = 'IOS' AND status = 'ACTIVE' AND id > ? ORDER BY id LIMIT ?
      `).bind(job.app_id, job.cursor || "", BATCH_SIZE).all()).results || [];
    const message = await env.DB.prepare(`SELECT id, title, body FROM push_messages WHERE id = ?`).bind(job.message_id).first();
    if (!devices.length || !message) {
      await env.DB.prepare(`UPDATE native_push_jobs SET status = 'SENT', claim_id = NULL, updated_at = ?, finished_at = ? WHERE id = ?`).bind(t, t, job.id).run();
      continue;
    }
    const scope = await scopeFor(env, job.app_id);
    let key = null;
    try { key = await loadCredential(env, scope, "APPLE_PUSH_KEY"); } catch { key = null; }
    if (!key || key.status === "FAILED" || !key.teamId) {
      await failJob(env, job.id, key ? "The Apple push key on file was refused by Apple" : "No Apple push key on file");
      continue;
    }
    const claim = crypto.randomUUID();
    const taken = await env.DB.prepare(`
        UPDATE native_push_jobs SET status = 'SENDING', claim_id = ?, claimed_at = ?, batch_end = ?, batch_full = ?, updated_at = ?
        WHERE id = ? AND (status = 'QUEUED' OR (status = 'SENDING' AND claimed_at < ?))
      `).bind(claim, t, devices[devices.length - 1].id, devices.length === BATCH_SIZE ? 1 : 0, t, job.id, staleClaim).run();
    if (!Number(taken.meta?.changes || 0)) continue;
    return {
      job: {
        id: job.id, claim, title: message.title, body: message.body, tag: message.id,
        devices: devices.map((d) => ({ id: d.id, token: d.token, topic: d.bundle_id, environment: d.environment }))
      },
      apple: { key_id: key.keyId, team_id: key.teamId, p8: key.p8 }
    };
  }
  return { job: null };
}

async function failJob(env, jobId, note) {
  const t = nowIso();
  await env.DB.prepare(`UPDATE native_push_jobs SET status = 'FAILED', note = ?, claim_id = NULL, updated_at = ?, finished_at = ? WHERE id = ?`).bind(note, t, t, jobId).run();
  await alertOwner(env, jobId, "Store App notifications couldn't be sent", [
    `${note}, so a Store App notification wasn't sent.`,
    `Open ${publicBaseUrl(env)}/api/store-keys/owner, ask for the emailed link, and upload the push key ("Menu made push", AuthKey_….p8) again. Notifications sent after that go out normally.`
  ]);
}

async function reportResults(env, jobId, body) {
  const job = await env.DB.prepare(`SELECT * FROM native_push_jobs WHERE id = ?`).bind(jobId).first();
  if (!job || job.status !== "SENDING" || !body.claim || job.claim_id !== body.claim) return json({ ok: false, error: "No claimed push job with that id" }, 409);
  const results = Array.isArray(body.results) ? body.results.slice(0, BATCH_SIZE) : null;
  if (!results) return json({ ok: false, error: "results must be a list" }, 400);
  const t = nowIso();
  const scope = await scopeFor(env, job.app_id);
  // 403 = Apple refused the key itself (InvalidProviderToken and the like): no device is at fault.
  const keyProblem = results.find((r) => Number(r.status) === 403);
  if (keyProblem) {
    await env.DB.prepare(`UPDATE store_credentials SET check_status = 'FAILED', check_note = ?, updated_at = ? WHERE scope = ? AND kind = 'APPLE_PUSH_KEY'`)
      .bind(`Apple refused the key when sending: ${String(keyProblem.reason || "403").slice(0, 80)}`, t, scope).run();
    await failJob(env, job.id, `Apple refused the push key (${String(keyProblem.reason || "403").slice(0, 80)})`);
    return json({ ok: true, status: "FAILED" });
  }
  let sent = 0; let failed = 0; let gone = 0;
  for (const r of results) {
    const device = await env.DB.prepare(`SELECT id, failures FROM native_push_devices WHERE id = ? AND app_id = ? AND status = 'ACTIVE'`).bind(String(r.device || ""), job.app_id).first();
    if (!device) continue;
    const status = Number(r.status);
    const reason = String(r.reason || "");
    if (status === 200) {
      sent++;
      await env.DB.prepare(`UPDATE native_push_devices SET last_sent_at = ?, failures = 0 WHERE id = ?`).bind(t, device.id).run();
    } else if (status === 410 || GONE_REASONS.has(reason) || device.failures + 1 >= MAX_FAILURES) {
      gone++;
      await env.DB.prepare(`UPDATE native_push_devices SET status = 'GONE', updated_at = ? WHERE id = ?`).bind(t, device.id).run();
    } else {
      failed++;
      await env.DB.prepare(`UPDATE native_push_devices SET failures = failures + 1, updated_at = ? WHERE id = ?`).bind(t, device.id).run();
    }
  }
  if (sent) {
    // A delivered notification proves the push key (the worker itself can't reach Apple to check it).
    await env.DB.prepare(`UPDATE store_credentials SET check_status = 'VERIFIED', check_note = 'Confirmed: Apple accepted a notification', updated_at = ? WHERE scope = ? AND kind = 'APPLE_PUSH_KEY' AND check_status <> 'VERIFIED'`)
      .bind(t, scope).run();
  }
  const more = Number(job.batch_full) === 1;
  await env.DB.prepare(`
      UPDATE native_push_jobs SET status = ?, cursor = ?, claim_id = NULL, sent_count = sent_count + ?, failed_count = failed_count + ?, gone_count = gone_count + ?, updated_at = ?, finished_at = ?
      WHERE id = ?
    `).bind(more ? "QUEUED" : "SENT", job.batch_end || job.cursor || "", sent, failed, gone, t, more ? null : t, job.id).run();
  return json({ ok: true, status: more ? "QUEUED" : "SENT", sent, failed, gone });
}

async function handleNativePushJobs(request, env, jobId) {
  const auth = await verifyRenderer(request, env, { audience: PUSH_AUDIENCE, workflow: PUSH_WORKFLOW, events: ["workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.DB) return json({ ok: false, error: "Temporarily unavailable" }, 503);
  if (jobId === "next") {
    if (request.method !== "GET") return json({ ok: false, error: "Not found" }, 404);
    return json({ ok: true, ...(await claimNext(env)) });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Not found" }, 404);
  const text = await request.text().catch(() => "");
  if (text.length > 200_000) return json({ ok: false, error: "Too large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ ok: false, error: "Bad request" }, 400); }
  return reportResults(env, jobId, body || {});
}

export {
  BATCH_SIZE, CLAIM_MINUTES, PUSH_AUDIENCE, PUSH_WORKFLOW, handleNativePushJobs, nativeDeviceCount, nudgeNativePushes,
  queueNativePush, registerNativeDevice, startNativePush
};
