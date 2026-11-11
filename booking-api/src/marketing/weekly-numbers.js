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

// Nino site steps by source (owner, Nov 10, 2026: "if ~200 people visited and none bought, is it the designs?").
// ninobattaglia.com/visit-count.js sends each step once per browser tab, with no identifiers: SITE_VISIT, DESIGN_VIEW
// (each design once; metadata.first marks the tab's first), ADD_TO_CART and CHECKOUT_CLICK, tagged with the ad label
// or the linking site's name ("direct" when none). So counts here are browser tabs reaching each step.
const NINO_STEPS = ["SITE_VISIT", "DESIGN_VIEW", "ADD_TO_CART", "CHECKOUT_CLICK"];
function ninoSourceName(source, medium, campaign) {
  const known = CAMPAIGNS.find((c) => c.key === campaign);
  if (known) return known.name;
  if (/^(fb|ig|facebook|instagram)$/i.test(source || "") && /paid|cpc|ad/i.test(medium || "")) return "Facebook/Instagram ads";
  if (campaign) return `${source || "other"} (${campaign.length > 24 ? "campaign" : campaign})`;
  return source || "direct";
}
async function ninoSteps(env, sinceIso) {
  try {
    const rows = (await env.DB.prepare(`
        SELECT source, medium, campaign, event_type, COUNT(*) AS n FROM funnel_events
        WHERE created_at >= ? AND json_extract(metadata_json, '$.site') = 'ninobattaglia.com'
          AND event_type IN ('SITE_VISIT', 'ADD_TO_CART', 'CHECKOUT_CLICK', 'DESIGN_VIEW')
          AND (event_type <> 'DESIGN_VIEW' OR json_extract(metadata_json, '$.first') = 1)
        GROUP BY source, medium, campaign, event_type`).bind(sinceIso).all()).results || [];
    const bySource = new Map();
    for (const r of rows) {
      const name = ninoSourceName(r.source, r.medium, r.campaign);
      const counts = bySource.get(name) || Object.fromEntries(NINO_STEPS.map((k) => [k, 0]));
      counts[r.event_type] += Number(r.n);
      bySource.set(name, counts);
    }
    const designs = (await env.DB.prepare(`
        SELECT json_extract(metadata_json, '$.design') AS design, COUNT(*) AS n FROM funnel_events
        WHERE created_at >= ? AND event_type = 'DESIGN_VIEW' AND json_extract(metadata_json, '$.site') = 'ninobattaglia.com'
        GROUP BY design ORDER BY n DESC LIMIT 5`).bind(sinceIso).all()).results || [];
    return { bySource: [...bySource.entries()].sort((a, b) => b[1].SITE_VISIT - a[1].SITE_VISIT), designs };
  } catch { return { bySource: [], designs: [] }; }
}
async function designTitles(env, ids) {
  if (!env.NINO_DB || !ids.length) return new Map();
  try {
    const rows = (await env.NINO_DB.prepare(`SELECT id, title FROM catalog_products WHERE id IN (${ids.map(() => "?").join(",")}) GROUP BY id`).bind(...ids).all()).results || [];
    return new Map(rows.map((r) => [String(r.id), r.title]));
  } catch { return new Map(); }
}
function ninoStepLine(c) {
  const pct = (n) => (c.SITE_VISIT ? ` (${Math.round((n / c.SITE_VISIT) * 100)}%)` : "");
  return `${c.SITE_VISIT} visit${c.SITE_VISIT === 1 ? "" : "s"}, ${c.DESIGN_VIEW} looked at a design${pct(c.DESIGN_VIEW)}, ${c.ADD_TO_CART} added to cart${pct(c.ADD_TO_CART)}, ${c.CHECKOUT_CLICK} pressed checkout${pct(c.CHECKOUT_CLICK)}.`;
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
      made: await one(`SELECT COUNT(*) AS n FROM menu_previews WHERE status = 'READY' AND created_at >= ? AND COALESCE(campaign, '') <> 'prospect'`, sinceIso),
      opened: await one(`SELECT COUNT(*) AS n FROM menu_previews WHERE status = 'READY' AND created_at >= ? AND open_count > 0 AND COALESCE(campaign, '') <> 'prospect'`, sinceIso),
      ordered: await one(`SELECT COUNT(DISTINCT m.token) AS n FROM menu_previews m JOIN orders o ON o.notes LIKE '%Document ref: ' || m.request_id || '%'
        WHERE m.status = 'READY' AND COALESCE(m.campaign, '') <> 'prospect' AND o.payment_status = 'PAID' AND o.created_at >= ?`, sinceIso)
    };
  } catch { return { made: 0, opened: 0, ordered: 0 }; }
}

// New openings (owner, Nov 8, 2026): SF food and drink businesses the Monday finder picked up from the city's registry
// this week, newest opening first, with what happened: emailed, queued for the next email run, or no email found (the
// phone and address are there for a visit or a call). Also useful for Shift4 visits.
async function newOpenings(env, sinceIso, limit = 15) {
  try {
    const rows = (await env.DB.prepare(`SELECT name, address, phone, email, website, status, offer_code, opened_on FROM prospects
        WHERE opened_on IS NOT NULL AND found_at >= ? ORDER BY opened_on DESC, name LIMIT ?`).bind(sinceIso, limit + 1).all()).results || [];
    const total = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM prospects WHERE opened_on IS NOT NULL AND found_at >= ?`).bind(sinceIso).first())?.n || 0);
    return { total, rows: rows.slice(0, limit) };
  } catch { return { total: 0, rows: [] }; }
}
function openingLine(r) {
  const outreach = ["SENT", "REPLIED"].includes(r.status) ? "emailed" : r.status === "DRAFTED" ? "email drafted" : r.status === "OPTED_OUT" ? "said no thanks"
    : r.status === "BOUNCED" ? "email bounced" : r.email && r.offer_code ? "in the next email run" : r.email ? "has an email, nothing to pitch from its website" : "no email found";
  return `${r.address || "San Francisco"}. Opened ${shortDate(r.opened_on)}. ${r.phone ? `${r.phone}. ` : ""}${r.website ? `${r.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}. ` : ""}${outreach[0].toUpperCase()}${outreach.slice(1)}.`;
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
  const fresh = await newOpenings(env, weekIso);
  if (fresh.total) {
    rows.push(["New openings found", `${fresh.total} new San Francisco food & drink business${fresh.total === 1 ? "" : "es"} this week${fresh.total > fresh.rows.length ? ` (newest ${fresh.rows.length} below)` : ""}. Those with an email go into the prospect emails first.`]);
    for (const r of fresh.rows) rows.push([r.name, openingLine(r)]);
  }
  const steps = await ninoSteps(env, weekIso);
  if (steps.bySource.length) {
    rows.push(["Nino site, where shoppers stop", "This week, by where the visit came from. Each step counts once per browser tab."]);
    for (const [name, c] of steps.bySource.slice(0, 8)) rows.push([`Nino: ${name}`, ninoStepLine(c)]);
    if (steps.designs.length) {
      const titles = await designTitles(env, steps.designs.map((d) => String(d.design)));
      rows.push(["Nino designs looked at most", steps.designs.map((d) => `${titles.get(String(d.design)) || `design ${d.design}`} (${d.n})`).join(", ") + "."]);
    }
  }
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
