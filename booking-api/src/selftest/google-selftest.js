// Self-test for the Google Business Profile connection (stage 5), read-only. Uses the owner's own connected profile
// (google_connections.subscription_id = 'owner', connected once at /api/google/connect/owner):
//   worker settings -> refresh the stored grant -> list the accounts and profiles -> read the profile -> list reviews (v4).
// Proves the OAuth client, the encrypted token storage and all three Google APIs answer, without posting anything.
// Start one by inserting a self_tests row with kind GOOGLE_API_HEALTH and status REQUESTED. Runs daily at 10am Pacific
// once the owner profile is connected. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso } from "../lib/http.js";
import { accessTokenFor, getLocation, listProfiles, listReviews } from "../google/api.js";
import { OWNER } from "../google/connect.js";
import { googleConfig } from "../google/oauth.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "GOOGLE_API_HEALTH";
const DAILY_HOUR_UTC = 17; // 10am Pacific (PDT)

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC || !googleConfig(env)) return;
  const owner = await env.DB.prepare(`SELECT 1 FROM google_connections WHERE subscription_id = ? AND status = 'ACTIVE'`).bind(OWNER).first();
  if (!owner) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`)
    .bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`)
    .bind(crypto.randomUUID(), KIND, t, t).run();
}

async function checkGoogle(env, fetchImpl) {
  if (!googleConfig(env)) return { ok: false, problem: "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set on the worker" };
  const connection = await env.DB.prepare(`SELECT * FROM google_connections WHERE subscription_id = ?`).bind(OWNER).first();
  if (!connection) return { ok: false, problem: `The owner's Google profile is not connected yet: open ${publicBaseUrl(env)}/api/google/connect/owner` };
  if (connection.status !== "ACTIVE") {
    return { ok: false, problem: `The owner's Google connection is ${connection.status}${connection.last_error ? ` (${connection.last_error})` : ""}: reconnect at ${publicBaseUrl(env)}/api/google/connect/owner` };
  }
  const steps = [];
  const token = await accessTokenFor(env, connection, fetchImpl);
  steps.push("grant refreshed");
  const profiles = await listProfiles(token, fetchImpl);
  if (!profiles.some((p) => p.location === connection.location_name)) {
    return { ok: false, problem: `${connection.location_title || connection.location_name} is no longer among the ${profiles.length} profiles this Google account manages` };
  }
  steps.push(`${profiles.length} profile(s) listed`);
  const location = await getLocation(token, connection.location_name, fetchImpl);
  steps.push(`profile "${location.title || connection.location_title}" read`);
  const reviews = await listReviews(token, connection, { pageSize: 1 }, fetchImpl);
  steps.push(`reviews endpoint answered (${Number(reviews.totalReviewCount || 0)} reviews)`);
  return { ok: true, log: steps.join("; ") };
}

async function advanceGoogleSelfTests(env, deps = {}) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env, deps.now).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status = 'REQUESTED' ORDER BY created_at LIMIT 2`).bind(KIND).all()).results || [];
  const results = [];
  for (const test of tests) {
    const check = await checkGoogle(env, deps.fetch || fetch).catch((error) => ({ ok: false, problem: error instanceof Error ? error.message : String(error) }));
    if (check.ok) {
      const done = await updateTest(env, test, { status: "PASSED", stage: "DONE", log: check.log });
      results.push({ id: done.id, status: done.status });
      continue;
    }
    const failed = await updateTest(env, test, { status: "FAILED", stage: "CHECK", error: check.problem.slice(0, 1000), log: `FAILED: ${check.problem}` });
    await sendTransactionalEmail(env, {
      to: ownerEmailAddress(env),
      subject: "Google Business Profile check failed",
      html: brandedEmailHtml({ preheader: "Review Replies and Google Profile Care may not run.", eyebrow: "SELF-TEST", heading: "The Google check failed",
        paragraphs: ["Review Replies and Google Profile Care can't reach Google until this is fixed."],
        rows: [["Problem", check.problem.slice(0, 500)], ["Self-test", test.id]] }),
      text: `The Google Business Profile check failed.\n${check.problem}\nSelf-test: ${test.id}`,
      idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
    }).catch(() => null);
    results.push({ id: failed.id, status: failed.status });
  }
  return results;
}

export { advanceGoogleSelfTests };
