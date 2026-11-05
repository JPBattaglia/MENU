// Marketing plan v4 (Nov 3, 2026, owner-approved): one email to the owner every Friday with both businesses' numbers.
// .github/workflows/weekly-numbers.yml calls POST /api/system/weekly-numbers over its GitHub OIDC token (no secret).
//
// Sales come from our own records, by the campaign label each visit arrived with (utm_campaign): Menu-made and Nino
// design-service orders from funnel_events + orders here, Nino shop orders from the shop's own database (NINO_DB,
// read only). The Google Ads tag on both sites reports to Google, not here, so ad spend isn't known here: the email shows the most each campaign
// can have spent so far (its daily budget times days run, capped at its total), and so the highest possible cost per
// sale. Claude adds the exact spend at the weekly check in the Google Ads account.
import { nowIso } from "../lib/http.js";
import { sendTransactionalEmail, brandedEmailHtml } from "../lib/email.js";
import { ownerEmailAddress } from "../lib/config.js";
import { repUrl } from "./public-preview.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";

const AUDIENCE = "menu-made-weekly-numbers";
const WORKFLOW = "JPBattaglia/MENU/.github/workflows/weekly-numbers.yml@refs/heads/master";

// The three ad campaigns (plan v4 amended Nov 4, 2026 by the owner: $500 total, live Nov 4 to Jan 2 for Google's
// spend-$500-get-$500 credit), with what one sale keeps (for the break-even line). Cents.
const CAMPAIGNS = [
  { key: "mm-search", name: "Menu-made search ads", daily: 370, cap: 22200, start: "2026-11-04", end: "2027-01-02", keeps: 13500, store: "menu" },
  { key: "nino-design", name: "Nino design search ads", daily: 262, cap: 15700, start: "2026-11-04", end: "2027-01-02", keeps: 19000, store: "menu" },
  { key: "nino-shop", name: "Nino shopping ads", daily: 202, cap: 12100, start: "2026-11-04", end: "2027-01-02", keeps: 900, store: "nino" }
];
const OUTREACH = "demo-menu";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const money = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const DAY = 86400000;

// Most a campaign can have spent by `now`: whole days run (start day counts) times the daily budget, capped.
function maxSpend(c, now) {
  const start = Date.parse(`${c.start}T00:00:00-08:00`);
  const end = Date.parse(`${c.end}T23:59:59-08:00`);
  if (now < start) return 0;
  const days = Math.floor((Math.min(now, end) - start) / DAY) + 1;
  return Math.min(c.cap, days * c.daily);
}

async function menuSales(env, sinceIso) {
  const rows = (await env.DB.prepare(`
      SELECT campaign, COUNT(*) AS sales, COALESCE(SUM(total_cents), 0) AS cents FROM (
        SELECT DISTINCT f.campaign AS campaign, o.id, o.total_cents
        FROM funnel_events f JOIN orders o ON o.id = f.order_id
        WHERE f.event_type = 'CHECKOUT_STARTED' AND json_extract(f.metadata_json, '$.environment') = 'live'
          AND o.payment_status = 'PAID' AND o.created_at >= ? AND f.campaign IS NOT NULL)
      GROUP BY campaign`).bind(sinceIso).all()).results || [];
  return new Map(rows.map((r) => [r.campaign, { sales: Number(r.sales), cents: Number(r.cents) }]));
}

async function menuCheckouts(env, sinceIso) {
  const rows = (await env.DB.prepare(`
      SELECT campaign, COUNT(DISTINCT order_id) AS n FROM funnel_events
      WHERE event_type = 'CHECKOUT_STARTED' AND json_extract(metadata_json, '$.environment') = 'live' AND created_at >= ? AND campaign IS NOT NULL
      GROUP BY campaign`).bind(sinceIso).all()).results || [];
  return new Map(rows.map((r) => [r.campaign, Number(r.n)]));
}

// Visits that arrived with a campaign label (both sites send SITE_VISIT here; the Nino site only for labelled
// visits, with no identifiers, so each Nino page load counts once).
async function campaignVisits(env, sinceIso) {
  const rows = (await env.DB.prepare(`
      SELECT campaign, COUNT(DISTINCT COALESCE(session_id, id)) AS n FROM funnel_events
      WHERE event_type = 'SITE_VISIT' AND created_at >= ? AND campaign IS NOT NULL
      GROUP BY campaign`).bind(sinceIso).all()).results || [];
  return new Map(rows.map((r) => [r.campaign, Number(r.n)]));
}

// Shop checkouts opened (paid or not), by campaign.
async function shopCheckouts(env, sinceIso) {
  if (!env.NINO_DB) return null;
  const since = Math.floor(Date.parse(sinceIso) / 1000);
  const rows = (await env.NINO_DB.prepare(`
      SELECT COALESCE(json_extract(snapshot_json, '$.attribution.campaign'), json_extract(snapshot_json, '$.attribution.source'), 'none') AS campaign,
        COUNT(*) AS n
      FROM commerce_orders WHERE live_mode = 1 AND created_at >= ? GROUP BY campaign`).bind(since).all()).results || [];
  return new Map(rows.map((r) => [r.campaign, Number(r.n)]));
}

// Where a campaign is losing people, from the step counts since it started. Null when there is too little to say.
function weakStep({ visits, checkouts, sales }) {
  if (visits < 15) return null;
  if (checkouts === 0) return "people visit but none start checkout: the page or the price is the likely problem";
  if (sales === 0 && checkouts >= 3) return "checkouts start but none finish: the checkout step is the likely problem";
  if (checkouts / visits < 0.02) return "under 2 in 100 visitors start checkout: the page or the price is the likely problem";
  return null;
}

async function shopSales(env, sinceIso) {
  if (!env.NINO_DB) return null;
  const since = Math.floor(Date.parse(sinceIso) / 1000);
  const rows = (await env.NINO_DB.prepare(`
      SELECT COALESCE(json_extract(snapshot_json, '$.attribution.campaign'), json_extract(snapshot_json, '$.attribution.source'), 'none') AS campaign,
        COUNT(*) AS sales, COALESCE(SUM(paid_total_cents), 0) AS cents
      FROM commerce_orders WHERE payment_status = 'paid' AND live_mode = 1 AND paid_at >= ? GROUP BY campaign`).bind(since).all()).results || [];
  return new Map(rows.map((r) => [r.campaign, { sales: Number(r.sales), cents: Number(r.cents) }]));
}

async function outreach(env, sinceIso) {
  const one = async (sql, ...args) => Number((await env.DB.prepare(sql).bind(...args).first())?.n || 0);
  return {
    sent: await one(`SELECT COUNT(*) AS n FROM prospects WHERE sent_at >= ?`, sinceIso),
    previews: await one(`SELECT COUNT(*) AS n FROM prospect_demos WHERE status = 'READY' AND created_at >= ?`, sinceIso),
    opened: await one(`SELECT COUNT(*) AS n FROM prospect_demos WHERE first_opened_at >= ?`, sinceIso),
    followups: await one(`SELECT COUNT(*) AS n FROM prospects WHERE followup_drafted_at >= ?`, sinceIso),
    replied: await one(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'REPLIED' AND updated_at >= ?`, sinceIso),
    optedOut: await one(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'OPTED_OUT' AND updated_at >= ?`, sinceIso),
    bounced: await one(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'BOUNCED' AND updated_at >= ?`, sinceIso)
  };
}

// Free Online Menu previews (src/marketing/public-preview.js): made, opened, and paid orders that reused the file.
async function freePreviews(env, sinceIso) {
  try {
    const one = async (sql, ...args) => Number((await env.DB.prepare(sql).bind(...args).first())?.n || 0);
    return {
      made: await one(`SELECT COUNT(*) AS n FROM menu_previews WHERE status = 'READY' AND created_at >= ?`, sinceIso),
      opened: await one(`SELECT COUNT(*) AS n FROM menu_previews WHERE status = 'READY' AND created_at >= ? AND open_count > 0`, sinceIso),
      ordered: await one(`SELECT COUNT(DISTINCT m.token) AS n FROM menu_previews m JOIN orders o ON o.notes LIKE '%Document ref: ' || m.request_id || '%'
        WHERE m.status = 'READY' AND o.payment_status = 'PAID' AND o.created_at >= ?`, sinceIso)
    };
  } catch { return { made: 0, opened: 0, ordered: 0 }; }
}

// The report itself, exported for the tests: { subject, rows, paragraphs, text }.
async function weeklyNumbers(env, now = Date.now()) {
  const weekIso = new Date(now - 7 * DAY).toISOString();
  const startIso = new Date(Date.parse(`${CAMPAIGNS[0].start}T00:00:00-08:00`)).toISOString();
  const [mmWeek, mmAll, checkouts, shopWeek, shopAll, out, visits, shopOpened] = await Promise.all([
    menuSales(env, weekIso), menuSales(env, startIso), menuCheckouts(env, startIso), shopSales(env, weekIso), shopSales(env, startIso), outreach(env, weekIso),
    campaignVisits(env, startIso), shopCheckouts(env, startIso)
  ]);
  const rows = [];
  let totalSales = 0;
  for (const c of CAMPAIGNS) {
    const week = (c.store === "menu" ? mmWeek : shopWeek)?.get(c.key) || { sales: 0, cents: 0 };
    const all = (c.store === "menu" ? mmAll : shopAll)?.get(c.key) || { sales: 0, cents: 0 };
    totalSales += week.sales;
    const spent = maxSpend(c, now);
    if (c.store === "nino" && !shopAll) { rows.push([c.name, "Shop sales can't be read yet (the shop database isn't connected)."]); continue; }
    if (spent === 0) { rows.push([c.name, `Starts ${shortDate(c.start)}. No spend yet.`]); continue; }
    const perSale = all.sales ? Math.round(spent / all.sales) : null;
    const verdict = perSale === null ? "no sale yet" : perSale <= c.keeps ? "under break-even" : "over break-even";
    const steps = { visits: visits.get(c.key) || 0, checkouts: (c.store === "menu" ? checkouts.get(c.key) : shopOpened?.get(c.key)) || 0, sales: all.sales };
    const weak = weakStep(steps);
    rows.push([c.name, `${week.sales} sale${week.sales === 1 ? "" : "s"} this week (${money(week.cents)}). Since ${shortDate(c.start)}: ${steps.visits} visit${steps.visits === 1 ? "" : "s"}, ${steps.checkouts} checkout${steps.checkouts === 1 ? "" : "s"} started, ${all.sales} paid; at most ${money(spent)} spent, ${perSale === null ? "no sale yet" : `at most ${money(perSale)} per sale`} (break-even ${money(c.keeps)}: ${verdict}).${weak ? ` Weak step: ${weak}.` : ""}`]);
  }
  const previews = await freePreviews(env, weekIso);
  if (previews.made || previews.ordered) rows.push(["Free menu previews", `${previews.made} made this week, ${previews.opened} opened, ${previews.ordered} went on to a paid order.`]);
  const demo = mmAll.get(OUTREACH) || { sales: 0, cents: 0 };
  const demoWeek = mmWeek.get(OUTREACH) || { sales: 0, cents: 0 };
  totalSales += demoWeek.sales;
  rows.push(["Prospect emails", `${out.sent} sent this week, ${out.previews} menu previews built, ${out.opened} opened, ${out.followups} follow-ups drafted, ${out.replied} replies, ${out.optedOut} opt-outs, ${out.bounced} bounces. Sales from the emails since ${shortDate(CAMPAIGNS[0].start)}: ${demo.sales} (${money(demo.cents)}).`]);
  if (shopWeek) {
    const other = [...shopWeek.entries()].filter(([k]) => !CAMPAIGNS.some((c) => c.key === k)).reduce((n, [, v]) => n + v.sales, 0);
    totalSales += other;
    rows.push(["Nino shop, other", `${other} order${other === 1 ? "" : "s"} this week not from the shopping ads (free Google listings, Pinterest, direct).`]);
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const subject = `Friday numbers: ${totalSales} sale${totalSales === 1 ? "" : "s"} this week`;
  const paragraphs = ["Both businesses, the week to this morning. Spend shown is the most each campaign could have used; Claude adds the exact figure from Google Ads at the weekly check.", "Nothing here needs you unless a line says so."];
  const text = `${subject} (${day})\n\n${rows.map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n${paragraphs[0]}`;
  return { subject, rows, paragraphs, text, day };
}

async function handleWeeklyNumbers(request, env, { now = Date.now() } = {}) {
  const auth = await verifyRenderer(request, env, { audience: AUDIENCE, workflow: WORKFLOW, events: ["schedule", "workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.DB) return json({ ok: false, error: "No database" }, 503);
  const report = await weeklyNumbers(env, now);
  const rep = env.PRODUCTION_RUNNER_SECRET ? await repUrl(env).catch(() => null) : null;
  const sent = await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject: report.subject,
    // A fresh rep mode link every week (owner, Nov 5, 2026), so it's always in the inbox when a visit comes up.
    html: brandedEmailHtml({ preheader: report.rows.map(([k]) => k).join(", "), eyebrow: "FRIDAY NUMBERS", heading: report.subject, paragraphs: report.paragraphs, rows: report.rows,
      ...(rep ? { buttons: [{ label: "Rep mode: show a menu on a visit", url: rep, primary: false }] } : {}) }),
    text: report.text + (rep ? `\n\nRep mode (show a business its phone menu during a visit): ${rep}` : ""), idempotencyKey: `weekly-numbers/${report.day}`, purpose: "OWNER_REPORT", templateKey: "weekly_numbers_v1"
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return json({ ok: Boolean(sent?.ok), at: nowIso(), lines: report.rows.length, ...(sent?.ok ? {} : { error: String(sent?.error || "send failed") }) });
}

export { AUDIENCE as WEEKLY_NUMBERS_AUDIENCE, WORKFLOW as WEEKLY_NUMBERS_WORKFLOW, CAMPAIGNS, maxSpend, weakStep, weeklyNumbers, handleWeeklyNumbers };
