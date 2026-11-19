// Stage 14, kept on its own (owner, Nov 17, 2026: "do the monthly marketing report emails and forget the rest for
// stage 14"). One email to the owner on the 1st of each month, about 8 am Pacific, with last month for both
// businesses: what sold, what the ads brought, where buyers came from, the free menus and previews,
// the prospect emails, guests reading menus, and the apps. Sent by the worker's own 5-minute tick (once a month,
// claimed in worker_settings), so it doesn't depend on GitHub's scheduler. Read-only apart from that claim.
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { ownerEmailAddress } from "../lib/config.js";
import { nowIso } from "../lib/http.js";
import { dollars, readAiSpend, topPurposes } from "../lib/ai-spend.js";
import { CAMPAIGNS, campaignVisits, freePreviews, holidayNumbers, menuCheckouts, menuSales, money, ninoStepLine, ninoSteps, outreach, shopSales } from "./weekly-numbers.js";

const SEND_HOUR_UTC = 16;   // 8 am PST
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Last month in Pacific time: { label, startIso, endIso, days[] } (days as YYYY-MM-DD for the per-day tables).
function lastMonth(now) {
  const here = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const year = here.getMonth() === 0 ? here.getFullYear() - 1 : here.getFullYear();
  const month = here.getMonth() === 0 ? 11 : here.getMonth() - 1;
  const pad = (n) => String(n).padStart(2, "0");
  const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const first = `${year}-${pad(month + 1)}-01`;
  const next = month === 11 ? `${year + 1}-01-01` : `${year}-${pad(month + 2)}-01`;
  // Pacific midnight is 08:00 UTC (PST) or 07:00 (PDT); 08:00 is used for both, close enough for a monthly report.
  return { label: `${MONTHS[month]} ${year}`, key: `${year}-${pad(month + 1)}`, startIso: `${first}T08:00:00.000Z`, endIso: `${next}T08:00:00.000Z`,
    first, next, days: Array.from({ length: daysIn }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`) };
}

async function one(env, sql, ...args) {
  try { return Number((await env.DB.prepare(sql).bind(...args).first())?.n || 0); } catch { return 0; }
}

async function menuMadeMoney(env, m) {
  const paid = `FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.payment_status = 'PAID' AND o.stripe_checkout_session_id LIKE 'cs_live_%' AND lower(c.email) <> ? AND o.created_at >= ? AND o.created_at < ?`;
  return {
    orders: await one(env, `SELECT COUNT(*) AS n ${paid}`, SELF_TEST_EMAIL, m.startIso, m.endIso),
    cents: await one(env, `SELECT COALESCE(SUM(o.total_cents), 0) AS n ${paid}`, SELF_TEST_EMAIL, m.startIso, m.endIso)
  };
}

async function plans(env, m) {
  const real = `FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE lower(c.email) <> ?`;
  return {
    started: await one(env, `SELECT COUNT(*) AS n ${real} AND s.started_at >= ? AND s.started_at < ?`, SELF_TEST_EMAIL, m.startIso, m.endIso),
    cancelled: await one(env, `SELECT COUNT(*) AS n ${real} AND s.cancelled_at >= ? AND s.cancelled_at < ?`, SELF_TEST_EMAIL, m.startIso, m.endIso),
    active: await one(env, `SELECT COUNT(*) AS n ${real} AND s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE')`, SELF_TEST_EMAIL),
    monthlyCents: await one(env, `SELECT COALESCE(SUM(CASE WHEN s.billing_interval = 'YEAR' THEN s.amount_cents / 12 ELSE s.amount_cents END), 0) AS n ${real} AND s.status IN ('ACTIVE', 'PAST_DUE')`, SELF_TEST_EMAIL)
  };
}

async function freeMenus(env, m) {
  return one(env, `SELECT COUNT(*) AS n FROM menu_previews WHERE free_project_id IS NOT NULL AND free_claimed_at >= ? AND free_claimed_at < ? AND COALESCE(campaign, '') <> 'selftest'`, m.startIso, m.endIso);
}

async function guestsReading(env, m) {
  try {
    const row = await env.DB.prepare(`SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(qr_scans), 0) AS scans, COUNT(DISTINCT business_id) AS menus
      FROM menu_stats_daily WHERE day >= ? AND day < ?`).bind(m.first, m.next).first();
    return { views: Number(row?.views || 0), scans: Number(row?.scans || 0), menus: Number(row?.menus || 0) };
  } catch { return { views: 0, scans: 0, menus: 0 }; }
}

async function appMonth(env, m) {
  try {
    const marks = m.days.map(() => "?").join(",");
    const rows = (await env.DB.prepare(`SELECT app, SUM(opens) AS n FROM app_opens WHERE day IN (${marks}) GROUP BY app`).bind(...m.days).all()).results || [];
    return Object.fromEntries(rows.map((r) => [r.app, Number(r.n || 0)]));
  } catch { return {}; }
}

async function monthlyReport(env, now = Date.now()) {
  const m = lastMonth(now);
  const [mm, shop, sub, free, previews, out, guests, apps, holiday, steps, salesByCampaign, visits, checkouts] = await Promise.all([
    menuMadeMoney(env, m), shopSales(env, m.startIso).catch(() => null), plans(env, m), freeMenus(env, m), freePreviews(env, m.startIso), outreach(env, m.startIso).catch(() => null),
    guestsReading(env, m), appMonth(env, m), holidayNumbers(env, m.startIso), ninoSteps(env, m.startIso), menuSales(env, m.startIso).catch(() => new Map()),
    campaignVisits(env, m.startIso).catch(() => new Map()), menuCheckouts(env, m.startIso).catch(() => new Map())
  ]);
  const shopTotal = shop ? [...shop.values()].reduce((a, v) => ({ sales: a.sales + v.sales, cents: a.cents + v.cents }), { sales: 0, cents: 0 }) : null;
  const rows = [];
  rows.push(["Menu-made sales", `${plural(mm.orders, "paid order")}, ${money(mm.cents)}.`]);
  rows.push(["Menu-made plans", `${sub.started} started, ${sub.cancelled} cancelled; ${plural(sub.active, "plan")} active now, about ${money(sub.monthlyCents)} a month.`]);
  rows.push(["Nino shop sales", shopTotal ? `${plural(shopTotal.sales, "order")}, ${money(shopTotal.cents)}.` : "Can't be read yet (the shop database isn't connected)."]);
  if (holiday && (holiday.all || holiday.previews)) rows.push(["Holiday Menu", `${holiday.week} sold (${money(holiday.cents)}), ${holiday.all} this season; ${holiday.previews} holiday previews made.`]);
  rows.push(["Free menus started", `${free} business${free === 1 ? "" : "es"} put a free MΞNU menu live.`]);
  rows.push(["Free previews", `${previews.made} made, ${previews.opened} opened, ${previews.ordered} went on to a paid order.`]);
  rows.push(["Guests reading menus", `${plural(guests.views, "menu view")} across ${plural(guests.menus, "live menu")}, ${plural(guests.scans, "QR scan")}.`]);
  // Ads (owner, Nov 16, 2026: the whole Google Ads budget goes to Menu-made's search ads; Nino has none). Spend isn't
  // known here, so the line gives what the ads brought; the spend is read in Google Ads at the check-in.
  for (const c of CAMPAIGNS.filter((x) => x.key === "mm-search" && Date.parse(`${x.start}T08:00:00Z`) < Date.parse(m.endIso))) {
    const sold = salesByCampaign.get(c.key) || { sales: 0, cents: 0 };
    rows.push(["Google Ads (Menu-made)", `${plural(visits.get(c.key) || 0, "visit")}, ${plural(checkouts.get(c.key) || 0, "checkout")} started, ${plural(sold.sales, "sale")} (${money(sold.cents)}). The month's spend is in Google Ads.`]);
  }
  if (out) {
    const demo = salesByCampaign.get("demo-menu") || { sales: 0, cents: 0 };
    rows.push(["Prospect emails", `${out.sent} sent, ${out.opened} previews opened, ${out.replied} replies, ${out.optedOut} opt-outs, ${out.bounced} bounces; ${plural(demo.sales, "sale")} from them (${money(demo.cents)}).`]);
  }
  for (const [name, c] of (steps?.bySource || []).slice(0, 4)) rows.push([`Nino site: ${name}`, ninoStepLine(c)]);
  rows.push(["Apps", `MΞNU opened ${plural(apps.menumade || 0, "time")}, Nino opened ${plural(apps.nino || 0, "time")}.`]);
  // Running cost (owner, Nov 19, 2026): what the site spent on Claude, and on what. An estimate; the Console is the bill.
  const ai = await readAiSpend(env, m.key);
  rows.push(["Claude API spend", ai.calls ? `About ${dollars(ai.usd)} over ${plural(ai.calls, "call")}: ${topPurposes(ai.by)}.` : "None recorded."]);
  const sales = mm.orders + (shopTotal?.sales || 0);
  const subject = `${m.label} marketing report: ${plural(sales, "sale")}`;
  const paragraphs = [`Both businesses for ${m.label} (Pacific time).`,
    "Nothing here needs you unless a line says so. The Friday numbers still come every week."];
  const text = `${subject}\n\n${rows.map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n${paragraphs[0]}`;
  return { subject, rows, paragraphs, text, month: m.key, label: m.label };
}

// From the 5-minute tick: the 1st of the month, the 16:00 UTC hour (or force). One email a month.
async function runMonthlyReport(env, { now = Date.now(), force = false } = {}) {
  if (!env.DB) return { ran: false };
  const at = new Date(now);
  if (!force && (at.getUTCDate() !== 1 || at.getUTCHours() !== SEND_HOUR_UTC || at.getUTCMinutes() >= 5)) return { ran: false };
  const report = await monthlyReport(env, now);
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO worker_settings (key, value, updated_at) VALUES (?, ?, ?)`).bind(`monthly-report:${report.month}`, nowIso(), nowIso()).run();
  if (!force && !Number(claim.meta?.changes || 0)) return { ran: false, reason: "already sent" };
  const sent = await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject: report.subject,
    html: brandedEmailHtml({ preheader: report.rows.slice(0, 3).map(([, v]) => v).join(" "), eyebrow: "MONTHLY REPORT", heading: report.subject, paragraphs: report.paragraphs, rows: report.rows }),
    text: report.text, idempotencyKey: `monthly-report/${report.month}${force ? `/${Date.now()}` : ""}`, purpose: "OWNER_REPORT", templateKey: "monthly_marketing_v1"
  }).catch((error) => ({ ok: false, error }));
  return { ran: true, sent: Boolean(sent?.ok), month: report.month, lines: report.rows.length };
}

export { lastMonth, monthlyReport, runMonthlyReport };
