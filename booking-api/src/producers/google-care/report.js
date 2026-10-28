// The monthly Google profile report (Google Profile Care, stage 5): the last 30 days of Business Profile Performance
// numbers next to the 30 days before, as a web page the customer opens from their weekly email. Google's numbers lag a
// few days, so the window ends 3 days ago. The AI writes only a 2-3 sentence summary from the numbers; every figure on
// the page comes from Google.
import { generate } from "../../ai/generate.js";
import { escapeHtml } from "../../lib/email.js";
import { fetchDailyMetrics } from "../../google/api.js";

const DAY = 864e5;
const LAG_DAYS = 3;
const WINDOW_DAYS = 30;
const METRICS = {
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Seen in Google Search on phones",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Seen in Google Search on computers",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Seen in Google Maps on phones",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Seen in Google Maps on computers",
  CALL_CLICKS: "Calls",
  BUSINESS_DIRECTION_REQUESTS: "Direction requests",
  WEBSITE_CLICKS: "Website clicks"
};
const HEADLINES = [
  ["views", "Profile views", ["BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_MAPS"]],
  ["calls", "Calls", ["CALL_CLICKS"]],
  ["directions", "Direction requests", ["BUSINESS_DIRECTION_REQUESTS"]],
  ["website", "Website clicks", ["WEBSITE_CLICKS"]]
];
const e = escapeHtml;

function windows(now) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - LAG_DAYS * DAY);
  const start = new Date(end.getTime() - (WINDOW_DAYS - 1) * DAY);
  const prevEnd = new Date(start.getTime() - DAY);
  const prevStart = new Date(prevEnd.getTime() - (WINDOW_DAYS - 1) * DAY);
  return { start, end, prevStart, prevEnd };
}

const ymd = (d) => d.toISOString().slice(0, 10);

// { current: {METRIC: n}, previous: {METRIC: n}, headline: {views: {current, previous}, ...}, range }
async function fetchProfileNumbers(token, locationName, now, fetchImpl) {
  const w = windows(now);
  const series = await fetchDailyMetrics(token, locationName, Object.keys(METRICS), w.prevStart, w.end, fetchImpl);
  const current = {};
  const previous = {};
  for (const metric of Object.keys(METRICS)) {
    current[metric] = 0; previous[metric] = 0;
    for (const point of series[metric] || []) {
      if (point.date >= ymd(w.start) && point.date <= ymd(w.end)) current[metric] += point.value;
      else if (point.date >= ymd(w.prevStart) && point.date <= ymd(w.prevEnd)) previous[metric] += point.value;
    }
  }
  const headline = Object.fromEntries(HEADLINES.map(([key, , metrics]) => [key, {
    current: metrics.reduce((n, m) => n + current[m], 0), previous: metrics.reduce((n, m) => n + previous[m], 0)
  }]));
  return { current, previous, headline, range: { start: ymd(w.start), end: ymd(w.end), prevStart: ymd(w.prevStart), prevEnd: ymd(w.prevEnd) } };
}

function change({ current, previous }) {
  if (!previous) return current ? "new this month" : "no change";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct === 0 ? "no change" : `${pct > 0 ? "+" : ""}${pct}% vs the 30 days before`;
}

async function reportSummary(env, numbers, businessName, scope, deps) {
  const lines = HEADLINES.map(([key, label]) => `${label}: ${numbers.headline[key].current} (previous 30 days: ${numbers.headline[key].previous})`);
  const fallback = `In the last 30 days ${businessName} was seen ${numbers.headline.views.current} times on Google, with ${numbers.headline.calls.current} calls, ${numbers.headline.directions.current} direction requests and ${numbers.headline.website.current} website clicks.`;
  if (!env.ANTHROPIC_API_KEY) return fallback;
  try {
    const result = await generate(env, {
      purpose: "google_report_summary",
      system: "You write a 2-3 sentence plain-language summary of a restaurant's Google profile numbers for its owner. Use ONLY the numbers given. Never guess why numbers moved and never promise results.",
      prompt: `${businessName}, ${numbers.range.start} to ${numbers.range.end}:\n${lines.join("\n")}`,
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] }, scope, maxTokens: 400
    }, deps);
    const text = String(result.output.summary || "").trim();
    return text.length >= 40 && text.length <= 600 ? text : fallback;
  } catch { return fallback; }
}

function reportHtml({ business, numbers, summary, posts = 0, photos = 0, replies = 0 }) {
  const tiles = HEADLINES.map(([key, label]) => `<div class="tile"><div class="n">${numbers.headline[key].current.toLocaleString("en-US")}</div><div class="l">${e(label)}</div><div class="c">${e(change(numbers.headline[key]))}</div></div>`).join("");
  const rows = Object.entries(METRICS).map(([m, label]) => `<tr><td>${e(label)}</td><td>${numbers.current[m].toLocaleString("en-US")}</td><td>${numbers.previous[m].toLocaleString("en-US")}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(business)} Google report</title>
<style>body{margin:0;background:#f4f1ec;font:16px/1.55 system-ui,sans-serif;color:#1d1d1b}main{max-width:780px;margin:0 auto;padding:24px 16px 48px}h1{font-size:28px;margin:0 0 4px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}.tile{background:#fff;border:1px solid #e3ddd2;border-radius:10px;padding:14px}.n{font-size:30px;font-weight:700}.l{font-weight:600}.c{font-size:13px;color:#6b675f}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3ddd2;border-radius:8px}td,th{padding:8px 12px;border-bottom:1px solid #eee7da;text-align:left}td:not(:first-child),th:not(:first-child){text-align:right}.note{font-size:13px;color:#6b675f}</style></head>
<body><main><h1>${e(business)}</h1><p>Google profile report · ${e(numbers.range.start)} to ${e(numbers.range.end)}</p><p>${e(summary)}</p>
<div class="grid">${tiles}</div>
<h2>The details</h2><table><thead><tr><th>Google counted</th><th>Last 30 days</th><th>30 days before</th></tr></thead><tbody>${rows}</tbody></table>
<h2>What we did this month</h2><ul><li>${posts} Google post${posts === 1 ? "" : "s"}</li><li>${photos} photo${photos === 1 ? "" : "s"} added to your profile</li><li>${replies} review repl${replies === 1 ? "y" : "ies"}</li></ul>
<p class="note">All numbers come from Google's Business Profile Performance data and usually run 2-3 days behind. A "view" is Google showing your profile once; one person can count more than once.</p></main></body></html>`;
}

export { METRICS, windows, fetchProfileNumbers, reportSummary, reportHtml };
