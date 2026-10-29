// Self-test for customer accounts (stage 9 part 2), run on the live worker against the self-test buyer
// (SELF_TEST_EMAIL, the address every product self-test buys with): request a sign-in link (the email really goes
// out, to Resend's test inbox), check GET does not use it, sign in with POST, read the account, open one listed
// delivery link, sign out and check the session is gone. Daily at 9:20am Pacific; start one by inserting a self_tests
// row with kind ACCOUNT_SIGNIN. Only a failure emails the owner.
import { ownerEmailAddress } from "../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail, SELF_TEST_EMAIL } from "../lib/email.js";
import { nowIso } from "../lib/http.js";
import { handleMe, handleOpen, handleSignOut, sendSignInLink } from "../account/account.js";
import { updateTest } from "./menu-qr-selftest.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "ACCOUNT_SIGNIN";
const DAILY_HOUR_UTC = 16;
const DAILY_MINUTE_FROM = 20;

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < DAILY_MINUTE_FROM) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`)
    .bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`)
    .bind(crypto.randomUUID(), KIND, t, t).run();
}

async function runAccountCheck(env, deps = {}) {
  const base = "https://menu-made.com";
  const fetchImpl = deps.fetch || fetch;
  const buyer = await env.DB.prepare(`SELECT id, email FROM customers WHERE lower(email) = ?`).bind(SELF_TEST_EMAIL).first();
  if (!buyer) throw new Error(`No self-test buyer (${SELF_TEST_EMAIL}) in customers`);
  const sent = await sendSignInLink(env, buyer, SELF_TEST_EMAIL);
  if (!sent.ok) throw new Error(`Sign-in email not sent: ${sent.error || "unknown"}`);
  const url = new URL(sent.link);
  const token = url.searchParams.get("t");
  const page = await handleOpen(new Request(url.href), env, sent.id);
  if (page.status !== 200) throw new Error(`Opening the sign-in link answered ${page.status}`);
  const unused = await env.DB.prepare(`SELECT used_at FROM account_sign_ins WHERE id = ?`).bind(sent.id).first();
  if (unused?.used_at) throw new Error("Opening the link (GET) used it up; email scanners would break sign-in");
  const signIn = await handleOpen(new Request(url.href.split("?")[0], { method: "POST", body: new URLSearchParams({ t: token }) }), env, sent.id);
  const cookie = (signIn.headers.get("Set-Cookie") || "").split(";")[0];
  if (signIn.status !== 303 || !cookie.startsWith("mm_account=")) throw new Error(`Sign-in POST answered ${signIn.status} without a session cookie`);
  const again = await handleOpen(new Request(url.href.split("?")[0], { method: "POST", body: new URLSearchParams({ t: token }) }), env, sent.id);
  if (again.status !== 410) throw new Error(`A used sign-in link answered ${again.status}, not 410`);
  const meResponse = await handleMe(new Request(`${base}/api/account/me`, { headers: { Cookie: cookie } }), env);
  if (meResponse.status !== 200) throw new Error(`Account summary answered ${meResponse.status}`);
  const me = await meResponse.json();
  if (me.email !== SELF_TEST_EMAIL || !Array.isArray(me.plans) || !Array.isArray(me.orders) || !Array.isArray(me.deliveries)) {
    throw new Error("Account summary is missing its email, plans, orders or deliveries");
  }
  let delivery = "no deliveries listed";
  if (me.deliveries[0]) {
    const response = await fetchImpl(me.deliveries[0].url, { redirect: "manual" });
    if (response.status !== 200) throw new Error(`Listed delivery link answered ${response.status}`);
    delivery = `delivery link 200`;
  }
  const out = await handleSignOut(new Request(`${base}/api/account/sign-out`, { method: "POST", headers: { Cookie: cookie } }), env);
  if (out.status !== 200) throw new Error(`Sign-out answered ${out.status}`);
  const after = await handleMe(new Request(`${base}/api/account/me`, { headers: { Cookie: cookie } }), env);
  if (after.status !== 401) throw new Error(`After sign-out the account still answered ${after.status}`);
  return `signed in and out; ${me.plans.length} plans, ${me.orders.length} orders, ${me.deliveries.length} deliveries; ${delivery}`;
}

async function advanceAccountSelfTests(env, deps = {}) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env, deps.now).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status = 'REQUESTED' ORDER BY created_at LIMIT 2`).bind(KIND).all()).results || [];
  const results = [];
  for (const test of tests) {
    try {
      const summary = await runAccountCheck(env, deps);
      await updateTest(env, test, { status: "PASSED", stage: "DONE", log: `PASSED: ${summary}` });
      results.push({ id: test.id, status: "PASSED", summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateTest(env, test, { status: "FAILED", stage: "CHECK", error: message, log: `FAILED: ${message}` });
      results.push({ id: test.id, status: "FAILED", error: message });
      await sendTransactionalEmail(env, {
        to: ownerEmailAddress(env),
        subject: "Account sign-in self-test failed",
        html: brandedEmailHtml({ eyebrow: "Self-test", heading: "Customer sign-in needs a look", paragraphs: [`The daily account check failed: ${message}`, "Buyers may not be able to sign in to their account until this is fixed."] }),
        text: `The daily account sign-in self-test failed: ${message}`,
        idempotencyKey: `self-test-failed/${test.id}`,
        purpose: "AUTOMATION_ALERT",
        templateKey: "self_test_failed_v1"
      }).catch(() => null);
    }
  }
  return results;
}

export { KIND, advanceAccountSelfTests, runAccountCheck };
