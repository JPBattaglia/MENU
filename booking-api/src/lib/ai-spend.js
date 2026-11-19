// What the site spends on Claude (the Anthropic API), month by month (owner, Nov 19, 2026: the API credit ran out
// without warning, spent by self-tests, free previews and prospect demos he never saw a cost for; "do all").
//
// Every paid Claude call adds its cost to worker_settings "ai_spend:<YYYY-MM>" (Pacific month): total dollars, calls,
// and dollars by purpose (menu_read, website_copy, ...). The owner gets one email when the month passes 50% and one
// at 80% of AI_MONTHLY_BUDGET_USD (default $100, the cap he set in the Anthropic Console). The monthly report shows
// last month's total and where it went.
//
// The numbers are an estimate from the token counts Anthropic returns, at the list prices below. The Console's own
// usage page is the bill; this exists so he hears before the credit runs out, not after. Two calls finishing at the
// same moment can drop one of them from the count, so it can read a little low, never high. Nothing here ever stops
// a call or throws: tracking must not break an order.
import { brandedEmailHtml, sendTransactionalEmail } from "./email.js";
import { ownerEmailAddress } from "./config.js";

// Dollars per million tokens [input, output], platform.claude.com/docs/en/about-claude/pricing on Nov 19, 2026.
const PRICES = { sonnet: [2, 10], haiku: [0.1, 0.5], opus: [4, 20] };
const WEB_SEARCH_USD = 10 / 1000;
const DEFAULT_BUDGET_USD = 100;
const ALERT_STEPS = [0.5, 0.8];
const CONSOLE_BILLING_URL = "https://platform.claude.com/settings/billing";

function priceFor(model) {
  const name = String(model || "").toLowerCase();
  if (name.includes("haiku")) return PRICES.haiku;
  if (name.includes("opus")) return PRICES.opus;
  return PRICES.sonnet;
}

function costUsd({ model, input_tokens = 0, output_tokens = 0, web_searches = 0 }) {
  const [inPrice, outPrice] = priceFor(model);
  return (Number(input_tokens || 0) * inPrice + Number(output_tokens || 0) * outPrice) / 1e6 + Number(web_searches || 0) * WEB_SEARCH_USD;
}

function monthKey(now = Date.now()) {
  const here = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return `${here.getFullYear()}-${String(here.getMonth() + 1).padStart(2, "0")}`;
}

const budgetUsd = (env) => {
  const value = Number(env?.AI_MONTHLY_BUDGET_USD);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BUDGET_USD;
};

const dollars = (usd) => `$${(Math.round(Number(usd || 0) * 100) / 100).toFixed(2)}`;

async function readAiSpend(env, key) {
  const empty = { usd: 0, calls: 0, by: {} };
  if (!env?.DB) return empty;
  const row = await env.DB.prepare(`SELECT value FROM worker_settings WHERE key = ?`).bind(`ai_spend:${key}`).first().catch(() => null);
  try {
    const saved = row ? JSON.parse(row.value) : null;
    return saved && typeof saved === "object" ? { ...empty, ...saved, by: saved.by || {} } : empty;
  } catch {
    return empty;
  }
}

// The biggest purposes first, as "menu_read $4.10, website_copy $1.20".
function topPurposes(by, count = 4) {
  return Object.entries(by || {}).sort((a, b) => b[1] - a[1]).slice(0, count).map(([purpose, usd]) => `${purpose} ${dollars(usd)}`).join(", ");
}

async function sendSpendAlert(env, key, step, spend, budget) {
  const pct = Math.round(step * 100);
  const claimKey = `ai_spend_alert:${key}:${pct}`;
  const t = new Date().toISOString();
  const claimed = await env.DB.prepare(`INSERT OR IGNORE INTO worker_settings (key, value, updated_at) VALUES (?, ?, ?)`).bind(claimKey, t, t).run().catch(() => null);
  if (!claimed?.meta?.changes) return false;
  const subject = `Claude API spend is past ${pct}% of your ${dollars(budget)} month`;
  const paragraphs = [
    `The website has spent about ${dollars(spend.usd)} on Claude this month (${key}), over ${spend.calls} calls. Your monthly limit is ${dollars(budget)}.`,
    `Where it went: ${topPurposes(spend.by) || "not recorded"}.`,
    `When the limit is reached, the Anthropic Console stops every Claude call until next month: free previews, prospect demos and paying customers' menus all stop being read. To raise the limit or add credit, open the Console's billing page.`,
    "This figure is an estimate from the site's own count; the Console's usage page is the bill."
  ];
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject,
    html: brandedEmailHtml({ preheader: paragraphs[0], eyebrow: "CLAUDE API SPEND", heading: subject, paragraphs, buttons: [{ label: "Open Anthropic billing", url: CONSOLE_BILLING_URL, primary: true }] }),
    text: `${subject}\n\n${paragraphs.join("\n\n")}\n\nAnthropic billing: ${CONSOLE_BILLING_URL}`,
    idempotencyKey: `ai-spend/${key}/${pct}`,
    purpose: "AUTOMATION_ALERT",
    templateKey: "ai_spend_alert_v1"
  }).catch((error) => console.error("AI spend alert failed:", error instanceof Error ? error.message : String(error)));
  return true;
}

// Add one call's cost to this month's total, and email the owner when the total crosses 50% or 80% of the budget.
async function recordAiSpend(env, { purpose, model, input_tokens = 0, output_tokens = 0, web_searches = 0 }, now = Date.now()) {
  try {
    if (!env?.DB) return null;
    const usd = costUsd({ model, input_tokens, output_tokens, web_searches });
    if (!(usd > 0)) return null;
    const key = monthKey(now);
    const before = await readAiSpend(env, key);
    const name = String(purpose || "other").slice(0, 60);
    const after = { usd: before.usd + usd, calls: before.calls + 1, by: { ...before.by, [name]: (before.by[name] || 0) + usd } };
    const t = new Date(now).toISOString();
    await env.DB.prepare(`INSERT INTO worker_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(`ai_spend:${key}`, JSON.stringify(after), t).run();
    const budget = budgetUsd(env);
    for (const step of ALERT_STEPS) {
      if (before.usd < budget * step && after.usd >= budget * step) await sendSpendAlert(env, key, step, after, budget);
    }
    return { key, usd, total: after.usd };
  } catch (error) {
    console.error("AI spend not recorded:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export { ALERT_STEPS, DEFAULT_BUDGET_USD, PRICES, costUsd, dollars, monthKey, readAiSpend, recordAiSpend, topPurposes };
