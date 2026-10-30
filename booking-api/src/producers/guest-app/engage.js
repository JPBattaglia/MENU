// Stage 11 part 1: push notifications and loyalty in the Guest App, included in the Guest App plan.
//
// Guest side (same origin as the app, so the app's CSP "connect-src 'self'" holds):
//   GET  <app>/api/config              push key and loyalty settings
//   POST <app>/api/push/subscribe      { endpoint, keys: { p256dh, auth } }
//   POST <app>/api/push/unsubscribe    { endpoint }
//   POST <app>/api/loyalty             { action: me | earn | redeem, member, code }
// Restaurant side (signed links in the delivery and monthly emails and on the account page; no password or token):
//   GET/POST /api/app-push/<appId>?t=      write a notification (at most DAILY_PUSH_LIMIT a day, manual + automatic)
//   GET      /api/app-counter/<appId>?t=   the counter screen: a 6-digit code that changes every minute
// Loyalty: a guest collects a visit by typing the code shown at the counter. A card is a random key kept in the app on
// the guest's phone; no personal details. A code is good for its minute and the one before, once per card, and a card
// collects at most one visit every EARN_GAP_HOURS. A reward is used the same way (code at the counter) once the card
// has enough visits. Codes are derived from PRODUCTION_RUNNER_SECRET and the app id, so the counter screen reads nothing
// from the database to show one.
// Why a typed code and not a scanned QR: on iPhone the camera opens Safari, not the home-screen app, and the two keep
// separate storage, so a scanned QR would collect points on a different card.
import { escapeHtml } from "../../lib/email.js";
import { nowIso, parseJsonOrNull, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { publicBaseUrl } from "../../lib/config.js";
import { sha256Hex } from "../../lib/util.js";
import { pushEndpointAllowed, sendWebPush, vapidKeys } from "../../lib/webpush.js";
import { nativeDeviceCount, queueNativePush, registerNativeDevice } from "../../store-app/native-push.js";

const PUSH_LINK_KIND = "apppush";
const COUNTER_LINK_KIND = "appcounter";
const LINK_TTL_DAYS = 400;
const DAILY_PUSH_LIMIT = 2;
const WINDOW_SECONDS = 60;
const EARN_GAP_HOURS = 6;
const MAX_FAILED_PER_HOUR = 8;
const SENDS_PER_TICK = 120;
const BATCH = 10;
const DEFAULT_GOAL = 10;
const enc = new TextEncoder();

// The Store App's origins (stage 11 part 2; native.js serves its content). Kept here so native.js can import engage.js
// without a cycle back.
const NATIVE_ORIGINS = new Set(["capacitor://localhost", "https://localhost"]);
const nativeCors = (origin) => ({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" });

const API_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: API_HEADERS });

// What the owner chose on the app form. Rewards are off until the owner writes what the reward is.
function engagementSettings(data = {}) {
  const reward = String(data.loyalty_reward || "").trim().slice(0, 80);
  const goal = Math.min(30, Math.max(1, Number.parseInt(data.loyalty_visits, 10) || DEFAULT_GOAL));
  return { loyalty: { enabled: Boolean(reward), reward, goal }, pushSpecials: String(data.push_specials || "yes").toLowerCase() !== "no" };
}

async function pushLink(env, appId) {
  return `${publicBaseUrl(env)}/api/app-push/${appId}?t=${await signLinkToken(env, { kind: PUSH_LINK_KIND, id: appId, ttlDays: LINK_TTL_DAYS })}`;
}
async function counterLink(env, appId) {
  return `${publicBaseUrl(env)}/api/app-counter/${appId}?t=${await signLinkToken(env, { kind: COUNTER_LINK_KIND, id: appId, ttlDays: LINK_TTL_DAYS })}`;
}

// ---- counter codes ----
const windowAt = (ms = Date.now()) => Math.floor(ms / 1000 / WINDOW_SECONDS);
async function counterCode(env, appId, window) {
  if (!env.PRODUCTION_RUNNER_SECRET) throw new Error("PRODUCTION_RUNNER_SECRET is not configured");
  const key = await crypto.subtle.importKey("raw", enc.encode(`menu-made-loyalty-v1:${env.PRODUCTION_RUNNER_SECRET}:${appId}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(String(window))));
  return String(new DataView(mac.buffer).getUint32(0) % 1_000_000).padStart(6, "0");
}
// The window a typed code belongs to (this minute or the one before), or null.
async function matchCode(env, appId, typed, now = Date.now()) {
  const code = String(typed || "").replace(/\D/g, "");
  if (code.length !== 6) return null;
  const w = windowAt(now);
  for (const candidate of [w, w - 1]) if ((await counterCode(env, appId, candidate)) === code) return candidate;
  return null;
}

// ---- guest API ----
const appBySlug = (env, slug) => env.DB.prepare(`SELECT id, business_id, data_json FROM guest_apps WHERE slug = ?`).bind(slug).first();

async function readJson(request) {
  const text = await request.text().catch(() => "");
  if (text.length > 4096) return null;
  try { const value = JSON.parse(text); return value && typeof value === "object" ? value : null; } catch { return null; }
}

async function memberRow(env, appId, member) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(String(member || ""))) return { id: null };
  const id = await sha256Hex(enc.encode(`${appId}:${member}`));
  const row = await env.DB.prepare(`SELECT * FROM loyalty_members WHERE id = ? AND app_id = ?`).bind(id, appId).first();
  return { id, row };
}

const cardOf = (row, settings) => ({ points: row?.points || 0, visits: row?.visits || 0, goal: settings.loyalty.goal, reward: settings.loyalty.reward, can_redeem: (row?.points || 0) >= settings.loyalty.goal });

async function loyaltyAction(env, app, body) {
  const settings = engagementSettings(parseJsonOrNull(app.data_json) || {});
  if (!settings.loyalty.enabled) return json({ ok: false, error: "Rewards aren't turned on for this app." }, 404);
  const { id, row } = await memberRow(env, app.id, body.member);
  if (!id) return json({ ok: false, error: "This rewards card isn't valid." }, 400);
  if (body.action === "me") return json({ ok: true, card: cardOf(row, settings) });
  if (body.action !== "earn" && body.action !== "redeem") return json({ ok: false, error: "Unknown action." }, 400);
  const t = nowIso();
  const hour = t.slice(0, 13);
  const failures = row && row.failed_window === hour ? row.failed_attempts : 0;
  if (failures >= MAX_FAILED_PER_HOUR) return json({ ok: false, error: "Too many wrong codes. Please try again later." }, 429);
  const window = await matchCode(env, app.id, body.code);
  if (window === null) {
    if (row) await env.DB.prepare(`UPDATE loyalty_members SET failed_attempts = ?, failed_window = ?, updated_at = ? WHERE id = ?`).bind(failures + 1, hour, t, id).run();
    return json({ ok: false, error: "That code isn't right or has changed. Check the code at the counter and try again." }, 400);
  }
  if (body.action === "earn") {
    if (row?.last_earn_at && Date.now() - Date.parse(row.last_earn_at) < EARN_GAP_HOURS * 3600_000) {
      return json({ ok: false, error: "This visit is already on your card. See you next time!", card: cardOf(row, settings) }, 409);
    }
    if (!row) await env.DB.prepare(`INSERT OR IGNORE INTO loyalty_members (id, app_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).bind(id, app.id, t, t).run();
    const added = await env.DB.prepare(`INSERT OR IGNORE INTO loyalty_events (id, app_id, member_id, kind, points, code_window, created_at) VALUES (?, ?, ?, 'EARN', 1, ?, ?)`).bind(crypto.randomUUID(), app.id, id, window, t).run();
    if (!added.meta?.changes) return json({ ok: false, error: "That code was already used on this card." }, 409);
    await env.DB.prepare(`UPDATE loyalty_members SET points = points + 1, visits = visits + 1, last_earn_at = ?, failed_attempts = 0, updated_at = ? WHERE id = ?`).bind(t, t, id).run();
  } else {
    if (!row || row.points < settings.loyalty.goal) return json({ ok: false, error: `You need ${settings.loyalty.goal} visits for this reward.`, card: cardOf(row, settings) }, 409);
    const added = await env.DB.prepare(`INSERT OR IGNORE INTO loyalty_events (id, app_id, member_id, kind, points, code_window, created_at) VALUES (?, ?, ?, 'REDEEM', ?, ?, ?)`).bind(crypto.randomUUID(), app.id, id, -settings.loyalty.goal, window, t).run();
    if (!added.meta?.changes) return json({ ok: false, error: "That code was already used on this card." }, 409);
    await env.DB.prepare(`UPDATE loyalty_members SET points = points - ?, rewards_redeemed = rewards_redeemed + 1, failed_attempts = 0, updated_at = ? WHERE id = ? AND points >= ?`).bind(settings.loyalty.goal, t, id, settings.loyalty.goal).run();
  }
  const after = await env.DB.prepare(`SELECT * FROM loyalty_members WHERE id = ?`).bind(id).first();
  return json({ ok: true, action: body.action, at: t, card: cardOf(after, settings) });
}

async function subscribe(env, app, body) {
  const endpoint = String(body.endpoint || "");
  const p256dh = String(body.keys?.p256dh || "");
  const auth = String(body.keys?.auth || "");
  if (!pushEndpointAllowed(endpoint) || !/^[A-Za-z0-9_-]{86,88}$/.test(p256dh) || !/^[A-Za-z0-9_-]{21,24}$/.test(auth)) return json({ ok: false, error: "This browser's notification details weren't accepted." }, 400);
  const t = nowIso();
  await env.DB.prepare(`
      INSERT INTO push_subscriptions (id, app_id, endpoint, p256dh, auth, status, failures, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET app_id = excluded.app_id, p256dh = excluded.p256dh, auth = excluded.auth, status = 'ACTIVE', failures = 0, updated_at = excluded.updated_at
    `).bind(crypto.randomUUID(), app.id, endpoint, p256dh, auth, t, t).run();
  return json({ ok: true });
}

// path is what follows "app/api/". POSTs must come from the app's own page.
async function handleAppApi(request, env, slug, path) {
  if (!env.DB) return json({ ok: false, error: "Temporarily unavailable" }, 503);
  let app;
  try { app = await appBySlug(env, slug); } catch { return json({ ok: false, error: "Temporarily unavailable" }, 503); }
  if (!app) return json({ ok: false, error: "Not found" }, 404);
  if (request.method === "GET" && path === "config") {
    const settings = engagementSettings(parseJsonOrNull(app.data_json) || {});
    const keys = await vapidKeys(env).catch(() => null);
    return json({ push: { enabled: Boolean(keys), key: keys?.publicKey || null }, loyalty: settings.loyalty });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Not found" }, 404);
  const origin = request.headers.get("Origin") || "";
  // The Store App (stage 11 part 2) runs from capacitor://localhost or https://localhost and may only use rewards and
  // register its phone for native push (src/store-app/native-push.js); the counter code is what protects a visit, the
  // Origin check only stops other websites posting for a guest.
  const native = NATIVE_ORIGINS.has(origin);
  if (origin !== new URL(request.url).origin && !(native && (path === "loyalty" || path === "push/native"))) return json({ ok: false, error: "Not allowed" }, 403);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "Bad request" }, 400);
  if (native) {
    const response = path === "push/native" ? await registerNativeDevice(env, app, body) : await loyaltyAction(env, app, body);
    for (const [k, v] of Object.entries(nativeCors(origin))) response.headers.set(k, v);
    return response;
  }
  if (path === "push/subscribe") return subscribe(env, app, body);
  if (path === "push/unsubscribe") {
    await env.DB.prepare(`UPDATE push_subscriptions SET status = 'GONE', updated_at = ? WHERE endpoint = ? AND app_id = ?`).bind(nowIso(), String(body.endpoint || ""), app.id).run();
    return json({ ok: true });
  }
  if (path === "loyalty") return loyaltyAction(env, app, body);
  return json({ ok: false, error: "Not found" }, 404);
}

// ---- sending ----
// Queues a notification for every phone subscribed to the app. Returns { ok, id } or { ok: false, reason }.
async function queuePush(env, appId, { title, body, source = "MANUAL", status = "QUEUED" }) {
  const cleanTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 50);
  const cleanBody = String(body || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!cleanTitle || !cleanBody) return { ok: false, reason: "empty" };
  const since = new Date(Date.now() - 86400_000).toISOString();
  const sent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM push_messages WHERE app_id = ? AND created_at > ?`).bind(appId, since).first();
  if ((sent?.n || 0) >= DAILY_PUSH_LIMIT) return { ok: false, reason: "limit" };
  const id = crypto.randomUUID();
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO push_messages (id, app_id, title, body, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, appId, cleanTitle, cleanBody, source, status, t, t).run();
  // Store App phones (native push) get the same message through the GitHub sender. Never blocks the web push.
  if (status === "QUEUED") {
    await queueNativePush(env, id, appId).catch((error) => console.error("Native push queue failed:", error instanceof Error ? error.message : String(error)));
  }
  return { ok: true, id };
}

// Sends one message to up to `max` subscriptions after its cursor. Returns how many it tried.
async function sendPushMessage(env, message, { max = SENDS_PER_TICK, fetchImpl = fetch, keys = null } = {}) {
  const vapid = keys || await vapidKeys(env);
  const subs = (await env.DB.prepare(`SELECT id, endpoint, p256dh, auth, failures FROM push_subscriptions WHERE app_id = ? AND status = 'ACTIVE' AND id > ? ORDER BY id LIMIT ?`)
    .bind(message.app_id, message.cursor || "", max).all()).results || [];
  const payload = JSON.stringify({ title: message.title, body: message.body, url: "./", tag: message.id });
  const t = nowIso();
  let sent = 0; let failed = 0; let gone = 0;
  const results = [];
  for (let i = 0; i < subs.length; i += BATCH) {
    const batch = subs.slice(i, i + BATCH);
    const outcomes = await Promise.all(batch.map((s) => sendWebPush(vapid, s, payload, { fetchImpl }).catch((error) => ({ ok: false, status: 0, gone: false, error: String(error?.message || error) }))));
    for (let j = 0; j < batch.length; j++) {
      const sub = batch[j]; const outcome = outcomes[j];
      results.push({ subscription: sub.id, ...outcome });
      if (outcome.ok) { sent++; await env.DB.prepare(`UPDATE push_subscriptions SET last_sent_at = ?, failures = 0 WHERE id = ?`).bind(t, sub.id).run(); }
      else if (outcome.gone || sub.failures + 1 >= 5) { gone++; await env.DB.prepare(`UPDATE push_subscriptions SET status = 'GONE', updated_at = ? WHERE id = ?`).bind(t, sub.id).run(); }
      else { failed++; await env.DB.prepare(`UPDATE push_subscriptions SET failures = failures + 1, updated_at = ? WHERE id = ?`).bind(t, sub.id).run(); }
    }
  }
  const done = subs.length < max;
  await env.DB.prepare(`UPDATE push_messages SET status = ?, cursor = ?, sent_count = sent_count + ?, failed_count = failed_count + ?, gone_count = gone_count + ?, updated_at = ?, finished_at = ? WHERE id = ?`)
    .bind(done ? "SENT" : "SENDING", subs.length ? subs[subs.length - 1].id : message.cursor || "", sent, failed, gone, t, done ? t : null, message.id).run();
  return { tried: subs.length, sent, failed, gone, done, results };
}

// From the 5-minute schedule.
async function sendQueuedPushes(env) {
  if (!env.DB || !env.PRODUCTION_RUNNER_SECRET) return { messages: 0 };
  const messages = (await env.DB.prepare(`SELECT * FROM push_messages WHERE status IN ('QUEUED', 'SENDING') ORDER BY created_at LIMIT 3`).all()).results || [];
  if (!messages.length) return { messages: 0 };
  const keys = await vapidKeys(env);
  let budget = SENDS_PER_TICK;
  for (const message of messages) {
    if (budget <= 0) break;
    const out = await sendPushMessage(env, message, { max: budget, keys });
    budget -= out.tried;
  }
  return { messages: messages.length };
}

// ---- restaurant pages ----
async function linkedApp(env, request, appId, kind) {
  const url = new URL(request.url);
  let form = null;
  if (request.method === "POST") { try { form = await request.formData(); } catch { return { error: simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>") }; } }
  const token = form ? String(form.get("t") || "") : url.searchParams.get("t") || "";
  const payload = await verifyLinkToken(env, token, [kind], appId);
  if (!payload || payload.expired) return { error: simplePage(403, "This link has expired or isn't valid", "<p>Sign in to your account at menu-made.com/account for a fresh link, or reply to your latest email.</p>") };
  const app = await env.DB.prepare(`SELECT id, slug, business_id, data_json FROM guest_apps WHERE id = ?`).bind(appId).first();
  if (!app) return { error: simplePage(404, "App not found", "<p>Reply to your latest email and we'll help.</p>") };
  return { app, token, form, data: parseJsonOrNull(app.data_json) || {} };
}

const planActive = async (env, businessId) => Boolean(businessId && await env.DB.prepare(`SELECT 1 AS ok FROM entitlements WHERE business_id = ? AND entitlement_type = 'GUEST_APP' AND status = 'ACTIVE' LIMIT 1`).bind(businessId).first());

async function handleAppPush(request, env, appId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const linked = await linkedApp(env, request, appId, PUSH_LINK_KIND);
  if (linked.error) return linked.error;
  const { app, token, form, data } = linked;
  if (!(await planActive(env, app.business_id))) return simplePage(403, "Your Guest App plan isn't active", "<p>Notifications are part of an active Guest App plan. Reply to your latest email and we'll help.</p>");
  const name = data.app_name || "your app";
  const subscribers = ((await env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE app_id = ? AND status = 'ACTIVE'`).bind(app.id).first())?.n || 0)
    + await nativeDeviceCount(env, app.id).catch(() => 0); // Store App phones count too
  const page = (status, notice, values = {}) => simplePage(status, "Send a notification", `${notice || ""}
<p><strong>${subscribers}</strong> ${subscribers === 1 ? "phone has" : "phones have"} notifications turned on in ${escapeHtml(name)}. You can send ${DAILY_PUSH_LIMIT} notifications a day (this includes the automatic one when you publish a new special), so guests keep them on.</p>
<form method="post" action="/api/app-push/${escapeHtml(app.id)}"><input type="hidden" name="t" value="${escapeHtml(token)}">
<p><label for="title"><strong>Title</strong></label><br><input id="title" name="title" maxlength="50" required value="${escapeHtml(values.title ?? name)}" style="width:100%;box-sizing:border-box;font:inherit;padding:10px"></p>
<p><label for="body"><strong>Message</strong></label><br><textarea id="body" name="body" maxlength="160" rows="3" required style="width:100%;box-sizing:border-box;font:inherit;padding:10px">${escapeHtml(values.body || "")}</textarea><br><small>Up to 160 characters, for example: Soup of the day is tomato basil. Open until 9 tonight.</small></p>
<button type="submit">Send to ${subscribers} ${subscribers === 1 ? "phone" : "phones"}</button></form>`);
  if (request.method === "GET") return page(200, "");
  const values = { title: String(form.get("title") || ""), body: String(form.get("body") || "") };
  const queued = await queuePush(env, app.id, { ...values, source: "MANUAL" });
  if (!queued.ok) {
    const why = queued.reason === "limit" ? `You've sent ${DAILY_PUSH_LIMIT} notifications in the last 24 hours. Please try again tomorrow.` : "Please write a title and a message.";
    return page(400, `<p style="color:#9b1c1c"><strong>${escapeHtml(why)}</strong></p>`, values);
  }
  return simplePage(200, "Notification on its way", `<p>Your notification is going out to ${subscribers} ${subscribers === 1 ? "phone" : "phones"} within the next few minutes.</p>`);
}

async function handleAppCounter(request, env, appId) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const linked = await linkedApp(env, request, appId, COUNTER_LINK_KIND);
  if (linked.error) return linked.error;
  const { app, data } = linked;
  const settings = engagementSettings(data);
  if (!settings.loyalty.enabled) {
    return simplePage(200, "Rewards are off", `<p>Rewards aren't turned on for ${escapeHtml(data.app_name || "your app")} yet. Use the update link in your latest Guest App email (or your account at menu-made.com/account) and write what a regular gets, for example "a free coffee", and how many visits it takes.</p>`);
  }
  const now = Date.now();
  const window = windowAt(now);
  const code = await counterCode(env, app.id, window);
  const secondsLeft = Math.max(1, Math.ceil(((window + 1) * WINDOW_SECONDS * 1000 - now) / 1000));
  const response = simplePage(200, `${data.app_name || "Rewards"}: code for this minute`, `
<p style="font-size:64px;font-weight:bold;letter-spacing:6px;text-align:center;margin:12px 0;font-variant-numeric:tabular-nums" aria-live="polite">${code.slice(0, 3)} ${code.slice(3)}</p>
<p style="text-align:center">This code changes every minute, and this page updates by itself.</p>
<dl><dt>How guests use it</dt><dd>In the app, under Rewards, they type this code to collect a visit, or to use their reward.</dd>
<dt>The reward</dt><dd>${escapeHtml(settings.loyalty.reward)} after ${settings.loyalty.goal} visits</dd>
<dt>Tip</dt><dd>Leave this page open on a tablet or phone by the till. Each card collects one visit every ${EARN_GAP_HOURS} hours at most.</dd></dl>`);
  const headers = new Headers(response.headers);
  headers.set("Refresh", String(secondsLeft + 1));
  return new Response(response.body, { status: 200, headers });
}

export {
  COUNTER_LINK_KIND, DAILY_PUSH_LIMIT, EARN_GAP_HOURS, NATIVE_ORIGINS, PUSH_LINK_KIND, WINDOW_SECONDS, nativeCors,
  counterCode, counterLink, engagementSettings, handleAppApi, handleAppCounter, handleAppPush, matchCode, pushLink,
  queuePush, sendPushMessage, sendQueuedPushes, windowAt
};
