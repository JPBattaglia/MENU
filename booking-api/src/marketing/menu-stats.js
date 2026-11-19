// Stage 15 task 5 (Nov 17, 2026): owner stats. "QR scans, menu views and Google profile clicks in the app, with a
// weekly push."
//
// Counting: every view of a live menu page (/api/menu/<slug>) adds one to menu_stats_daily for its business and
// Pacific day (migration 0062). QR codes made from now on open the menu at <address>?s=qr, so those views also count
// as QR scans (the stored qr_destination never changes; only the drawn code carries the mark). Bots and link
// previews aren't counted. QR codes printed before this still work and count as views.
//
// Showing: the menu editor (menu-made.com/menu-editor, also the MΞNU app's Account tab) shows the last 7 days.
// Google profile clicks (calls, website clicks, directions) come from Google when the business has connected its
// Google profile (MΞNU Max's Google profile care); otherwise that line is left out.
//
// Weekly: Monday morning (17:00 UTC tick, 9 am PST) each business with a live menu gets one email with last week's
// numbers, and a notification on any phone its owner linked in the MΞNU app (Account tab: "Your menu's numbers on
// this phone", confirmed from an emailed link, so nobody can link a phone to someone else's menu). Every email has a
// one-tap "Stop these weekly emails".
import { publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { accessTokenFor, fetchDailyMetrics } from "../google/api.js";
import { menuHostingState } from "../producers/menu-qr/hosting-renewal.js";
import { queuePush } from "../producers/guest-app/engage.js";

const DAY = 86400000;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|headless|lighthouse|curl|wget|python|node-fetch|axios|go-http/i;
const SELFTEST_EMAIL = "delivered@resend.dev";
const GOOGLE_METRICS = ["CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS"];
const WEEKLY_HOUR_UTC = 17;        // 9 am PST (10 am PDT): the first tick of that hour on a Monday
const WEEKLY_MAX = 300;            // businesses per Monday run
const LINK_KIND = "statsphone";
const OFF_KIND = "statsoff";
const MENUMADE_BUNDLE = "com.menumade.menumade";

const pacificDay = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// The address a QR code encodes: the menu's own address with ?s=qr, so a scan can be told from a typed or shared
// link. Anything that isn't a hosted menu address (a buyer's own destination) is left exactly as it is.
function qrScanUrl(url, env = {}) {
  const text = String(url || "");
  const base = `${publicBaseUrl(env)}/api/menu/`;
  if (!text.startsWith(base) && !/^https:\/\/menu-made\.com\/api\/menu\//.test(text)) return text;
  if (/[?&]s=qr(&|$)/.test(text)) return text;
  return `${text}${text.includes("?") ? "&" : "?"}s=qr`;
}

const isBot = (request) => {
  const ua = request.headers.get("User-Agent") || "";
  return !ua || BOT_RE.test(ua) || request.headers.get("Purpose") === "prefetch" || request.headers.get("Sec-Purpose")?.includes("prefetch");
};

// One view (and a scan when it came from a QR code). Never throws: counting must not break the menu.
async function countMenuView(env, businessId, request, now = Date.now()) {
  if (!env.DB || !businessId || request.method !== "GET" || isBot(request)) return false;
  const qr = new URL(request.url).searchParams.get("s") === "qr" ? 1 : 0;
  try {
    await env.DB.prepare(`
        INSERT INTO menu_stats_daily (business_id, day, views, qr_scans) VALUES (?, ?, 1, ?)
        ON CONFLICT (business_id, day) DO UPDATE SET views = views + 1, qr_scans = qr_scans + excluded.qr_scans
      `).bind(businessId, pacificDay(now), qr).run();
    return true;
  } catch (error) {
    console.error("Menu view count failed:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

// Google profile clicks over the 7 days Google has numbers for (its numbers lag a few days). null when the business
// has no working Google connection.
async function googleClicks(env, businessId, now = Date.now(), fetchImpl = fetch) {
  const connection = await env.DB.prepare(`
      SELECT * FROM google_connections WHERE business_id = ? AND status = 'ACTIVE' AND location_name IS NOT NULL
      ORDER BY connected_at DESC LIMIT 1
    `).bind(businessId).first().catch(() => null);
  if (!connection) return null;
  try {
    const token = await accessTokenFor(env, connection, fetchImpl);
    const end = new Date(now - 3 * DAY);
    const start = new Date(end.getTime() - 6 * DAY);
    const series = await fetchDailyMetrics(token, connection.location_name, GOOGLE_METRICS, start, end, fetchImpl);
    const sum = (metric) => (series[metric] || []).reduce((n, p) => n + (Number(p.value) || 0), 0);
    return { calls: sum("CALL_CLICKS"), website: sum("WEBSITE_CLICKS"), directions: sum("BUSINESS_DIRECTION_REQUESTS"),
      from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  } catch (error) {
    console.error("Google clicks failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

// The last `days` whole Pacific days up to and including today, and the same span before it.
async function menuStats(env, businessId, { days = 7, now = Date.now(), google = true, fetchImpl = fetch } = {}) {
  const today = pacificDay(now);
  const first = pacificDay(now - (days - 1) * DAY);
  const before = pacificDay(now - (2 * days - 1) * DAY);
  const rows = (await env.DB.prepare(`
      SELECT day, views, qr_scans FROM menu_stats_daily WHERE business_id = ? AND day >= ? AND day <= ? ORDER BY day
    `).bind(businessId, before, today).all().catch(() => ({ results: [] }))).results || [];
  const span = (from, to) => rows.filter((r) => r.day >= from && r.day <= to);
  const total = (list, key) => list.reduce((n, r) => n + (Number(r[key]) || 0), 0);
  const current = span(first, today);
  const previous = span(before, pacificDay(now - days * DAY));
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = pacificDay(now - i * DAY);
    const r = current.find((x) => x.day === day);
    daily.push({ day, views: Number(r?.views || 0), qr_scans: Number(r?.qr_scans || 0) });
  }
  return {
    days, from: first, to: today,
    views: total(current, "views"), qr_scans: total(current, "qr_scans"),
    previous: { views: total(previous, "views"), qr_scans: total(previous, "qr_scans") },
    daily,
    google: google ? await googleClicks(env, businessId, now, fetchImpl) : null
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function statsLines(stats) {
  const lines = [[`Menu views`, `${stats.views} (the week before: ${stats.previous.views})`],
    [`From the QR code`, `${stats.qr_scans} (the week before: ${stats.previous.qr_scans})`]];
  if (stats.google) {
    lines.push([`Google profile`, `${plural(stats.google.calls, "call")}, ${plural(stats.google.website, "website click")}, ${plural(stats.google.directions, "directions request")}`]);
  }
  return lines;
}

// ---- Weekly email and push -------------------------------------------------------------------------------------

// Businesses with a live regular menu (not a holiday menu, not a self-test or sandbox order), with the email of the
// customer whose menu it is.
async function liveMenus(env, limit = WEEKLY_MAX) {
  return (await env.DB.prepare(`
      SELECT p.business_id, b.name AS business_name, c.id AS customer_id, c.email, MAX(d.delivered_at) AS delivered_at
      FROM projects p
      JOIN deliverables d ON d.project_id = p.id AND d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1
      JOIN businesses b ON b.id = p.business_id
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.workflow_key = 'MENU_QR_V1'
        AND json_extract(COALESCE(p.metadata_json, '{}'), '$.holiday_menu') IS NULL
        AND lower(c.email) != ?
        AND COALESCE(o.stripe_checkout_session_id, '') NOT LIKE 'cs_test_%'
      GROUP BY p.business_id
      ORDER BY p.business_id
      LIMIT ?
    `).bind(SELFTEST_EMAIL, limit).all()).results || [];
}

const offKey = (businessId) => `menu-stats-off:${businessId}`;
async function statsOff(env, businessId) {
  return Boolean(await env.DB.prepare(`SELECT 1 AS off FROM worker_settings WHERE key = ?`).bind(offKey(businessId)).first().catch(() => null));
}

async function menumadeAppId(env) {
  return (await env.DB.prepare(`
      SELECT g.id FROM store_apps s JOIN guest_apps g ON g.project_id = s.project_id WHERE s.own_app = 1 AND s.bundle_id = ? LIMIT 1
    `).bind(MENUMADE_BUNDLE).first().catch(() => null))?.id || null;
}

async function sendWeeklyStats(env, menu, { now = Date.now(), fetchImpl = fetch, appId = null } = {}) {
  const stats = await menuStats(env, menu.business_id, { days: 7, now: now - DAY, fetchImpl });
  const base = publicBaseUrl(env);
  const week = pacificDay(now);
  const off = `${base}/api/menu-stats/off?b=${encodeURIComponent(menu.business_id)}&t=${encodeURIComponent(await signLinkToken(env, { kind: OFF_KIND, id: menu.business_id, ttlDays: 60 }))}`;
  const name = menu.business_name || "your business";
  const subject = `${name}'s menu last week: ${plural(stats.views, "view")}`;
  const lines = statsLines(stats);
  const editor = `${base}/menu-editor.html?business=${encodeURIComponent(menu.business_id)}`;
  const sent = await sendTransactionalEmail(env, {
    to: menu.email, subject,
    html: brandedEmailHtml({ preheader: `${plural(stats.qr_scans, "QR scan")} last week.`, eyebrow: "YOUR MENU THIS WEEK", heading: subject,
      paragraphs: [`Here's how guests found ${escapeHtml(name)}'s menu in the 7 days to yesterday.`,
        stats.google ? `Google's numbers run a few days behind, so they cover ${stats.google.from} to ${stats.google.to}.` : "Connect your Google profile with MΞNU Pro to see calls, website clicks and directions from Google here too."],
      rows: lines,
      buttons: [{ label: "Edit your menu", url: editor, primary: true }],
      footnote: `Get these numbers on your phone: open the MΞNU app, then Account. <a href="${escapeHtml(off)}">Stop these weekly emails</a>.` }),
    text: `${subject}\n\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nEdit your menu: ${editor}\nStop these weekly emails: ${off}`,
    idempotencyKey: `menu-stats/${menu.business_id}/${week}`, purpose: "MENU_STATS", templateKey: "menu_stats_weekly_v1"
  }).catch((error) => ({ ok: false, error }));
  let pushed = false;
  if (appId) {
    const phones = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM native_push_devices WHERE app_id = ? AND customer_id = ? AND status = 'ACTIVE'`)
      .bind(appId, menu.customer_id).first().catch(() => null))?.n || 0;
    if (phones) {
      const out = await queuePush(env, appId, { title: `${name}: your menu this week`.slice(0, 50),
        body: `${plural(stats.views, "view")}, ${plural(stats.qr_scans, "QR scan")} last week.${stats.google ? ` Google: ${plural(stats.google.calls, "call")}, ${plural(stats.google.directions, "directions request")}.` : ""}`,
        target: menu.customer_id }).catch(() => ({ ok: false }));
      pushed = Boolean(out?.ok);
    }
  }
  return { business: menu.business_id, emailed: Boolean(sent?.ok), pushed };
}

// From the 5-minute tick: Mondays, the first tick of the 17:00 UTC hour (or force). One run a Monday.
async function runWeeklyMenuStats(env, { now = Date.now(), force = false, fetchImpl = fetch } = {}) {
  if (!env.DB) return { ran: false };
  const at = new Date(now);
  if (!force && (at.getUTCDay() !== 1 || at.getUTCHours() !== WEEKLY_HOUR_UTC || at.getUTCMinutes() >= 5)) return { ran: false };
  const key = `menu-stats-run:${pacificDay(now)}`;
  const claimed = await env.DB.prepare(`INSERT OR IGNORE INTO worker_settings (key, value, updated_at) VALUES (?, ?, ?)`).bind(key, nowIso(), nowIso()).run();
  if (!force && !Number(claimed.meta?.changes || 0)) return { ran: false, reason: "already ran" };
  const appId = await menumadeAppId(env);
  const out = [];
  for (const menu of await liveMenus(env)) {
    if (await statsOff(env, menu.business_id)) continue;
    const state = await menuHostingState(env, menu.business_id).catch(() => ({ live: true }));
    if (state && state.live === false) continue;
    out.push(await sendWeeklyStats(env, menu, { now, fetchImpl, appId }).catch((error) => ({ business: menu.business_id, error: String(error?.message || error) })));
  }
  return { ran: true, sent: out.filter((o) => o.emailed).length, pushed: out.filter((o) => o.pushed).length, results: out };
}

// GET/POST /api/menu-stats/off?b=<business>&t=<token>: stop the weekly emails (button first, for email scanners).
async function handleMenuStatsOff(request, env) {
  const url = new URL(request.url);
  const form = request.method === "POST" ? await request.formData().catch(() => null) : null;
  const businessId = String((form ? form.get("b") : url.searchParams.get("b")) || "");
  const token = String((form ? form.get("t") : url.searchParams.get("t")) || "");
  const payload = await verifyLinkToken(env, token, [OFF_KIND], businessId);
  if (!payload || payload.expired) return simplePage(403, "This link has expired", "<p>Use the link in your newest weekly email, or reply to it and we'll stop them.</p>");
  if (request.method !== "POST") {
    return simplePage(200, "Stop the weekly menu emails?", `<p>You won't get the Monday email with your menu's views and QR scans any more. Your menu stays exactly as it is.</p>
<form method="post" action="/api/menu-stats/off"><input type="hidden" name="b" value="${escapeHtml(businessId)}"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">Stop the weekly emails</button></form>`);
  }
  await env.DB.prepare(`INSERT INTO worker_settings (key, value, updated_at) VALUES (?, 'off', ?) ON CONFLICT(key) DO UPDATE SET value = 'off', updated_at = excluded.updated_at`).bind(offKey(businessId), nowIso()).run();
  return simplePage(200, "Done", "<p>No more weekly menu emails. Your numbers are still in the menu editor whenever you want them.</p>");
}

// ---- Linking a phone in the MΞNU app ----------------------------------------------------------------------------

// POST <app>/api/menu-stats/link { email, token } from the MΞNU app. Always answers the same way (no hint whether an
// email has a menu); when it does, the owner gets a link that confirms this phone.
async function handleStatsPhoneLink(env, app, body) {
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 254);
  const token = String(body?.token || "").trim();
  const answer = json({ ok: true, message: "If that email has a live menu, we've sent a link to it. Open it to get your numbers on this phone." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !token) return json({ ok: false, error: "Type the email you use with Menu-Made." }, 400);
  const device = await env.DB.prepare(`SELECT id FROM native_push_devices WHERE app_id = ? AND (token = ? OR token = ?) AND status = 'ACTIVE'`)
    .bind(app.id, token, token.toLowerCase()).first().catch(() => null);
  if (!device) return json({ ok: false, error: "Turn on notifications for this app first, then try again." }, 409);
  const menu = (await liveMenus(env, 2000)).find((m) => String(m.email).toLowerCase() === email);
  if (!menu) return answer;
  const id = `${device.id}.${menu.customer_id}`;
  const link = `${publicBaseUrl(env)}/api/menu-stats/phone?d=${encodeURIComponent(device.id)}&c=${encodeURIComponent(menu.customer_id)}&t=${encodeURIComponent(await signLinkToken(env, { kind: LINK_KIND, id, ttlDays: 1 }))}`;
  await sendTransactionalEmail(env, {
    to: menu.email, subject: "Get your menu's numbers on your phone",
    html: brandedEmailHtml({ preheader: "One tap to confirm this phone.", eyebrow: "MΞNU APP", heading: "Get your menu's numbers on your phone",
      paragraphs: ["Someone asked the MΞNU app to send your menu's weekly views and QR scans to their phone. If that was you, tap the button. The link works for one day.", "If it wasn't you, ignore this email and nothing changes."],
      buttons: [{ label: "Yes, send them to my phone", url: link, primary: true }] }),
    text: `Confirm this phone for your menu's weekly numbers (works for one day):\n${link}`,
    idempotencyKey: `menu-stats-phone/${device.id}/${Math.floor(Date.now() / 600000)}`, purpose: "MENU_STATS", templateKey: "menu_stats_phone_v1"
  }).catch(() => null);
  return answer;
}

// GET/POST /api/menu-stats/phone?d=&c=&t=: the emailed confirm link (button first, for email scanners).
async function handleStatsPhoneConfirm(request, env) {
  const url = new URL(request.url);
  const form = request.method === "POST" ? await request.formData().catch(() => null) : null;
  const read = (k) => String((form ? form.get(k) : url.searchParams.get(k)) || "");
  const [deviceId, customerId, token] = [read("d"), read("c"), read("t")];
  const payload = await verifyLinkToken(env, token, [LINK_KIND], `${deviceId}.${customerId}`);
  if (!payload || payload.expired) return simplePage(403, "This link has expired", "<p>Ask again from the MΞNU app: Account, then \"Your menu's numbers on this phone\".</p>");
  if (request.method !== "POST") {
    return simplePage(200, "Send your menu's numbers to your phone?", `<p>Every Monday your phone gets a notification with last week's menu views and QR scans.</p>
<form method="post" action="/api/menu-stats/phone"><input type="hidden" name="d" value="${escapeHtml(deviceId)}"><input type="hidden" name="c" value="${escapeHtml(customerId)}"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">Yes, send them to my phone</button></form>`);
  }
  const done = await env.DB.prepare(`UPDATE native_push_devices SET customer_id = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'`).bind(customerId, nowIso(), deviceId).run();
  if (!Number(done.meta?.changes || 0)) return simplePage(410, "This phone isn't set up for notifications", "<p>Open the MΞNU app, turn on notifications in Account, and ask again.</p>");
  return simplePage(200, "Your phone is set", "<p>You'll get your menu's numbers on this phone every Monday morning. You can close this page.</p>");
}

export { countMenuView, handleMenuStatsOff, handleStatsPhoneConfirm, handleStatsPhoneLink, liveMenus, menuStats, pacificDay, qrScanUrl, runWeeklyMenuStats, sendWeeklyStats, statsLines };
