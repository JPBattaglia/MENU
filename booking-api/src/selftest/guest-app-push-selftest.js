// Self-test for Guest App notifications and rewards (stage 11 part 1), run by the worker's 5-minute schedule.
// Daily at 9:50am PT, or start one by inserting a self_tests row with kind GUEST_APP_PUSH_RUN and status REQUESTED.
//
// A scaffold app (with an active Guest App entitlement) is made, then everything goes through the real routes:
//   1. GET <app>/api/config gives the VAPID key and the reward; POSTs without the app's origin, or to an endpoint that
//      isn't a push service, are refused.
//   2. A test phone subscribes (its own ECDH key pair, an FCM-shaped endpoint). A notification is written on the
//      signed "Send a notification" page; the daily limit refuses the third one.
//   3. The real sender (sendPushMessage) sends it. The request is caught instead of going to Google: the VAPID header
//      is verified (signature, audience, expiry), the body is decrypted with the test phone's private key and must be
//      the message. A second subscription answered 410 is marked GONE.
//   4. The served Guest App (the newest live self-test app) runs the current app.js (notifications + rewards) and
//      offline worker (push handler).
//   5. Rewards: the counter page shows this minute's code; a wrong code and an expired code are refused; the current
//      code collects a visit once (a second try is refused); the reward is used with the code; a second use is refused.
// The scaffold is removed at the end. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { base64UrlEncode, signLinkToken } from "../lib/links.js";
import { decryptPushPayload, verifyVapidHeader } from "../lib/webpush.js";
import { COUNTER_LINK_KIND, PUSH_LINK_KIND, counterCode, sendPushMessage, windowAt } from "../producers/guest-app/engage.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "GUEST_APP_PUSH_RUN";
const DAILY_HOUR_UTC = 16;
const DAILY_MINUTE_FROM = 50;
const NAME = "Push Self-Test Cafe";
const REWARD = "a free self-test coffee";

async function maybeScheduleDaily(env, now = new Date()) {
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < DAILY_MINUTE_FROM) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

async function testPhone(short) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const p256dh = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  return { privateKey: pair.privateKey, p256dh, auth, endpoint: `https://fcm.googleapis.com/fcm/send/menu-made-selftest-${short}-${crypto.randomUUID().slice(0, 8)}` };
}

async function scaffold(env, test) {
  const t = nowIso();
  const short = String(test.id).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x";
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(SELF_TEST_EMAIL).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'Menu-Made', 'Self-Test')`).bind(customer.id, t, t, SELF_TEST_EMAIL).run();
  }
  const businessId = crypto.randomUUID(); const appId = crypto.randomUUID(); const entitlementId = crypto.randomUUID();
  const slug = `pushselftest-${short}`;
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'GUEST_APP' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Guest App offer is not in the catalog");
  const orderId = crypto.randomUUID(); const itemId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)`).bind(businessId, t, t, NAME).run();
  await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, stripe_checkout_session_id, placed_at, notes) VALUES (?, ?, ?, ?, ?, 'DELIVERED', 'USD', 0, 0, 0, 0, 'PAID', ?, ?, ?)`)
    .bind(orderId, t, t, customer.id, businessId, `cs_test_apppush_${short}`, t, `Guest App push self-test ${test.id}`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'FULFILLED')`).bind(itemId, orderId, offer.offer_id, offer.version_id).run();
  await env.DB.prepare(`INSERT INTO entitlements (id, customer_id, business_id, order_item_id, entitlement_type, status, starts_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'GUEST_APP', 'ACTIVE', ?, ?, ?, ?)`)
    .bind(entitlementId, customer.id, businessId, itemId, t, JSON.stringify({ self_test_id: test.id, environment: "sandbox" }), t, t).run();
  await env.DB.prepare(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(appId, slug, `selftest-${test.id}`, businessId, customer.id, JSON.stringify({ app_name: NAME, loyalty_reward: REWARD, loyalty_visits: "1", push_specials: "yes" }), t, t).run();
  return { appId, slug, businessId, entitlementId, short };
}

async function cleanup(env, s) {
  if (!s?.appId) return;
  for (const table of ["push_subscriptions", "push_messages", "loyalty_members", "loyalty_events"]) await env.DB.prepare(`DELETE FROM ${table} WHERE app_id = ?`).bind(s.appId).run();
  await env.DB.prepare(`DELETE FROM guest_apps WHERE id = ?`).bind(s.appId).run();
  if (s.entitlementId) await env.DB.prepare(`UPDATE entitlements SET status = 'EXPIRED', ends_at = ?, updated_at = ? WHERE id = ?`).bind(nowIso(), nowIso(), s.entitlementId).run();
}

async function run(env, app, test) {
  const base = publicBaseUrl(env);
  const origin = new URL(base).origin;
  const s = await scaffold(env, test);
  await updateTest(env, test, { status: "RUNNING", stage: "RUN", state: s, log: `Scaffold app ${s.slug} made` });
  const notes = [];
  try {
    const appBase = `${base}/api/site/${s.slug}/app/`;
    const post = (path, body, headers = { Origin: origin }) => app(new Request(`${appBase}api/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));

    // 1. config and refusals
    const config = await (await app(new Request(`${appBase}api/config`))).json();
    if (!config.push?.enabled || !/^[A-Za-z0-9_-]{86,88}$/.test(config.push.key || "")) throw new Error("The app config has no push key");
    if (!config.loyalty?.enabled || config.loyalty.reward !== REWARD || config.loyalty.goal !== 1) throw new Error(`The app config has the wrong rewards: ${JSON.stringify(config.loyalty)}`);
    const phone = await testPhone(s.short);
    const sub = { endpoint: phone.endpoint, keys: { p256dh: phone.p256dh, auth: phone.auth } };
    if ((await post("push/subscribe", sub, {})).status !== 403) throw new Error("A subscribe without the app's origin was accepted");
    if ((await post("push/subscribe", { ...sub, endpoint: "https://evil.example/push" })).status !== 400) throw new Error("A subscribe to a non-push-service endpoint was accepted");
    // 2. subscribe, write a notification on the signed page, daily limit
    const subscribed = await post("push/subscribe", sub);
    if (subscribed.status !== 200) throw new Error(`Subscribing failed (HTTP ${subscribed.status})`);
    const second = await testPhone(s.short);
    await post("push/subscribe", { endpoint: second.endpoint, keys: { p256dh: second.p256dh, auth: second.auth } });
    const pushToken = await signLinkToken(env, { kind: PUSH_LINK_KIND, id: s.appId, ttlDays: 1 });
    const page = await app(new Request(`${base}/api/app-push/${s.appId}?t=${pushToken}`));
    if (page.status !== 200 || !(await page.text()).includes("<strong>2</strong> phones have notifications")) throw new Error("The Send a notification page doesn't show the 2 subscribed phones");
    const send = async (body) => {
      const form = new FormData(); form.append("t", pushToken); form.append("title", NAME); form.append("body", body);
      const res = await app(new Request(`${base}/api/app-push/${s.appId}`, { method: "POST", body: form }));
      // Held so the 5-minute sender never sends test messages to the fake endpoints; this test sends them itself.
      await env.DB.prepare(`UPDATE push_messages SET status = 'HELD' WHERE app_id = ? AND status = 'QUEUED'`).bind(s.appId).run();
      return res;
    };
    const message = `Self-test special ${s.short}: tomato soup today`;
    if ((await send(message)).status !== 200) throw new Error("The notification was not accepted");
    if ((await send("Second notice")).status !== 200) throw new Error("The second notification of the day was refused");
    const third = await send("Third notice");
    if (third.status !== 400 || !(await third.text()).includes("last 24 hours")) throw new Error("The daily limit did not refuse a third notification");
    notes.push("subscribe + page + daily limit OK");

    // 3. the real sender, request caught and checked as a push service would
    const first = await env.DB.prepare(`SELECT * FROM push_messages WHERE app_id = ? AND body = ?`).bind(s.appId, message).first();
    const caught = [];
    const sink = async (url, init) => {
      caught.push({ url, init });
      return new Response(null, { status: url === second.endpoint ? 410 : 201 });
    };
    const out = await sendPushMessage(env, first, { fetchImpl: sink });
    if (out.sent !== 1 || out.gone !== 1) throw new Error(`Sending gave sent ${out.sent}, gone ${out.gone}; expected 1 and 1`);
    const mine = caught.find((c) => c.url === phone.endpoint);
    const vapid = await verifyVapidHeader(mine.init.headers.Authorization, phone.endpoint);
    if (!vapid.ok || vapid.publicKey !== config.push.key) throw new Error(`The VAPID header failed: ${vapid.error || "key differs from the app's"}`);
    if (mine.init.headers["Content-Encoding"] !== "aes128gcm" || !Number(mine.init.headers.TTL)) throw new Error("The push request headers are wrong");
    const payload = JSON.parse(await decryptPushPayload(phone, mine.init.body));
    if (payload.title !== NAME || payload.body !== message || payload.url !== "./") throw new Error(`The decrypted notification is wrong: ${JSON.stringify(payload)}`);
    const goneRow = await env.DB.prepare(`SELECT status FROM push_subscriptions WHERE endpoint = ?`).bind(second.endpoint).first();
    const sentRow = await env.DB.prepare(`SELECT status, sent_count FROM push_messages WHERE id = ?`).bind(first.id).first();
    if (goneRow?.status !== "GONE" || sentRow?.status !== "SENT" || sentRow.sent_count !== 1) throw new Error("Send results were not recorded");
    notes.push("VAPID verified, body decrypted, 410 marked GONE");

    // 4. the served client
    const live = await env.DB.prepare(`SELECT slug FROM guest_apps WHERE slug LIKE 'appselftest-%' ORDER BY created_at DESC LIMIT 1`).first();
    if (live) {
      const liveBase = `${base}/api/site/${live.slug}/app/`;
      const js = await (await app(new Request(`${liveBase}app.js`))).text();
      const sw = await (await app(new Request(`${liveBase}sw.js`))).text();
      if (!js.includes("push/subscribe") || !js.includes("Rewards") || !js.includes('navigator.serviceWorker.register("sw.js"')) throw new Error("The live app's app.js lacks notifications or rewards");
      if (!sw.includes('addEventListener("push"') || !sw.includes('addEventListener("notificationclick"')) throw new Error("The live app's offline worker lacks the push handler");
      notes.push(`live app ${live.slug} serves the new app.js and worker`);
    } else notes.push("no live self-test app to check app.js on");

    // 5. rewards
    const counterToken = await signLinkToken(env, { kind: COUNTER_LINK_KIND, id: s.appId, ttlDays: 1 });
    const counterPage = await app(new Request(`${base}/api/app-counter/${s.appId}?t=${counterToken}`));
    const counterHtml = await counterPage.text();
    const shown = /letter-spacing:6px[^>]*>(\d{3}) (\d{3})</.exec(counterHtml);
    if (counterPage.status !== 200 || !shown || !counterPage.headers.get("Refresh")) throw new Error("The counter screen didn't show a code that refreshes");
    const member = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const loyalty = async (body) => { const res = await post("loyalty", { member, ...body }); return { status: res.status, ...(await res.json()) }; };
    const fresh = await loyalty({ action: "me" });
    if (!fresh.ok || fresh.card.points !== 0) throw new Error("A new card doesn't start at 0");
    const w = windowAt();
    const wrong = String((Number(await counterCode(env, s.appId, w)) + 1) % 1000000).padStart(6, "0");
    if ((await loyalty({ action: "earn", code: wrong })).status !== 400) throw new Error("A wrong code collected a visit");
    if ((await loyalty({ action: "earn", code: await counterCode(env, s.appId, w - 3) })).status !== 400) throw new Error("A code from 3 minutes ago collected a visit");
    const code = `${shown[1]}${shown[2]}`;
    const earned = await loyalty({ action: "earn", code });
    if (!earned.ok || earned.card.points !== 1 || !earned.card.can_redeem) {
      // The counter page's minute may have just ended; the current code must still work.
      const retry = await loyalty({ action: "earn", code: await counterCode(env, s.appId, windowAt()) });
      if (!retry.ok || retry.card.points !== 1) throw new Error(`Collecting a visit failed: ${earned.error || JSON.stringify(earned)}`);
    }
    if ((await loyalty({ action: "earn", code: await counterCode(env, s.appId, windowAt()) })).status !== 409) throw new Error("A second visit right away was collected");
    const used = await loyalty({ action: "redeem", code: await counterCode(env, s.appId, windowAt()) });
    if (!used.ok || used.card.points !== 0) throw new Error(`Using the reward failed: ${used.error || JSON.stringify(used)}`);
    if ((await loyalty({ action: "redeem", code: await counterCode(env, s.appId, windowAt()) })).status !== 409) throw new Error("The reward was used twice");
    const card = await env.DB.prepare(`SELECT visits, rewards_redeemed FROM loyalty_members WHERE app_id = ?`).bind(s.appId).first();
    if (card?.visits !== 1 || card.rewards_redeemed !== 1) throw new Error("The card's visits and rewards were not recorded");
    notes.push("counter code, wrong/expired refused, visit once, reward once");
  } finally {
    await cleanup(env, s).catch(() => null);
  }
  return updateTest(env, { ...test, status: "RUNNING", stage: "RUN", state_json: JSON.stringify(s) }, { status: "PASSED", stage: "DONE", log: `PASSED: ${notes.join("; ")}. Scaffold removed.` });
}

async function failTest(env, test, message) {
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Guest App notifications and rewards self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of Guest App notifications and rewards failed.", eyebrow: "SELF-TEST", heading: "Guest App notifications or rewards need a look",
      paragraphs: ["The daily test of Guest App notifications and the rewards card failed. Guests may not get notifications or collect visits until this is fixed."], rows: [["Error", failed.error], ["Self-test", test.id]] }),
    text: `The Guest App notifications and rewards self-test failed.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceGuestAppPushSelfTests(env, app) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') ORDER BY created_at ASC LIMIT 1`).bind(KIND).all()).results || [];
  const results = [];
  for (const test of tests) {
    if (test.status === "RUNNING") {
      // A run is finished within one tick; one still RUNNING was cut off. Clean up and fail it.
      await cleanup(env, parseJsonOrNull(test.state_json)).catch(() => null);
      results.push(await failTest(env, test, "The run was cut off before it finished"));
      continue;
    }
    try { results.push(await run(env, app, test)); } catch (error) {
      const latest = await env.DB.prepare(`SELECT * FROM self_tests WHERE id = ?`).bind(test.id).first();
      results.push(await failTest(env, latest || test, error instanceof Error ? error.message : String(error)));
    }
  }
  return results;
}

export { KIND, advanceGuestAppPushSelfTests };
