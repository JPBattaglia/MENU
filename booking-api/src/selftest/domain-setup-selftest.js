// Self-test for custom domains (Cloudflare for SaaS): a read-only check of the worker settings, the token and the
// fallback origin (see checkSaasSetup in producers/website/domains.js). Creates nothing at Cloudflare.
// Start one by inserting a self_tests row with kind CUSTOM_DOMAIN_SETUP and status REQUESTED. It also runs once a day
// once the settings exist, so an expired token or a broken fallback origin emails the owner instead of failing silently
// on a customer's domain. Only a failure emails the owner.
import { ownerEmailAddress } from "../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso } from "../lib/http.js";
import { checkSaasSetup, saasConfig } from "../producers/website/domains.js";
import { updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "CUSTOM_DOMAIN_SETUP";
const DAILY_HOUR_UTC = 16; // 9am Pacific

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (!saasConfig(env) || now.getUTCHours() !== DAILY_HOUR_UTC) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`)
    .bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`)
    .bind(crypto.randomUUID(), KIND, t, t).run();
}

async function advanceDomainSetupSelfTests(env, deps = {}) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env, deps.now).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status = 'REQUESTED' ORDER BY created_at LIMIT 2`).bind(KIND).all()).results || [];
  const results = [];
  for (const test of tests) {
    const check = await checkSaasSetup(env, { fetchImpl: deps.fetch || fetch }).catch((error) => ({ ok: false, problems: [error instanceof Error ? error.message : String(error)] }));
    if (check.ok) {
      const done = await updateTest(env, test, { status: "PASSED", stage: "DONE", log: `Fallback origin ${check.fallback} is active; the token can read Custom Hostnames (${check.hostnames ?? 0} custom domains)` });
      results.push({ id: done.id, status: done.status });
      continue;
    }
    const message = check.problems.join(" | ");
    const failed = await updateTest(env, test, { status: "FAILED", stage: "CHECK", error: message.slice(0, 1000), log: `FAILED: ${message}` });
    await sendTransactionalEmail(env, {
      to: ownerEmailAddress(env),
      subject: "Custom domain setup check failed",
      html: brandedEmailHtml({ preheader: "Customers' own domains may not connect.", eyebrow: "SELF-TEST", heading: "The custom domain setup check failed",
        paragraphs: ["Customers who ask to use their own domain may not get connected until this is fixed."],
        rows: [["Problem", message.slice(0, 500)], ["Self-test", test.id]] }),
      text: `The custom domain setup check failed.\n${message}\nSelf-test: ${test.id}`,
      idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
    }).catch(() => null);
    results.push({ id: failed.id, status: failed.status });
  }
  return results;
}

export { advanceDomainSetupSelfTests };
