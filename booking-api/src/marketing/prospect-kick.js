// Prospect outreach on time (Nov 9, 2026). GitHub's own timer started these jobs 5 to 10 hours late and skipped some
// days entirely (no Monday drafts or weekday send by 3 pm Pacific on Nov 9), so the worker's 5-minute tick starts
// them itself through the GitHub API, once per Pacific day per slot. The workflows keep only workflow_dispatch, so
// a late GitHub timer can never run a slot twice.
//   prospects   Mondays 5:23 am Pacific           .github/workflows/prospects.yml (find new businesses)
//   drafts      Mondays 7:37 am, Thursdays 8:41 am .github/workflows/prospect-drafts.yml (iCloud drafts + follow-ups)
//   send        weekdays 10:19 am                  .github/workflows/prospect-drafts.yml with send=true (jp@getmenumade.com)
// A slot is started on the first tick at or after its time, up to 6 hours late (the worker was down, or GitHub
// refused). A refused start is retried on later ticks at most every 15 minutes, and dispatchRefused emails the owner.
import { dispatchRefused } from "../lib/dispatch-alert.js";

const REPO = "https://api.github.com/repos/JPBattaglia/MENU/actions/workflows";
const SLOTS = [
  { key: "prospects", days: [1], at: [5, 23], workflow: "prospects.yml", inputs: null, label: "the weekly prospect search" },
  { key: "drafts", days: [1], at: [7, 37], workflow: "prospect-drafts.yml", inputs: null, label: "the prospect email drafts" },
  { key: "prospects-us", days: [4], at: [4, 53], workflow: "prospects.yml", inputs: { region: "next" }, label: "the nationwide prospect search (next US metro)" },
  { key: "drafts", days: [4], at: [8, 41], workflow: "prospect-drafts.yml", inputs: null, label: "the prospect email drafts" },
  { key: "send", days: [1, 2, 3, 4, 5], at: [10, 19], workflow: "prospect-drafts.yml", inputs: { send: "true" }, label: "the prospect email sender" }
];
const LATE_LIMIT_MINUTES = 6 * 60;
const RETRY_MINUTES = 15;

// Pacific wall clock for a moment: { day: "2026-11-09", weekday: 1, minutes: minutes since midnight }.
function pacific(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// The slots due right now (time reached, not more than LATE_LIMIT_MINUTES ago).
function dueSlots(ms) {
  const p = pacific(ms);
  return SLOTS.filter((s) => s.days.includes(p.weekday) && p.minutes >= s.at[0] * 60 + s.at[1] && p.minutes < s.at[0] * 60 + s.at[1] + LATE_LIMIT_MINUTES)
    .map((s) => ({ ...s, day: p.day }));
}

async function readSetting(env, key) {
  return (await env.DB.prepare(`SELECT value FROM worker_settings WHERE key = ?`).bind(key).first().catch(() => null))?.value || null;
}
async function writeSetting(env, key, value, now) {
  const t = new Date(now).toISOString();
  await env.DB.prepare(`INSERT INTO worker_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value, t).run();
}

async function dispatch(env, slot) {
  let status = 0;
  try {
    const response = await (env.GITHUB_DISPATCH_FETCH || fetch)(`${REPO}/${slot.workflow}/dispatches`, { // GITHUB_DISPATCH_FETCH is a test seam
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "menu-made-worker", "Content-Type": "application/json" },
      body: JSON.stringify(slot.inputs ? { ref: "master", inputs: slot.inputs } : { ref: "master" })
    });
    status = response.status;
  } catch (error) {
    console.error(`Starting ${slot.label} failed:`, error instanceof Error ? error.message : String(error));
  }
  return status;
}

// Every tick. Returns the slots started this tick, e.g. ["send"].
async function kickProspectJobs(env, now = Date.now()) {
  if (!env.DB || !env.GITHUB_DISPATCH_TOKEN) return [];
  const started = [];
  for (const slot of dueSlots(now)) {
    const doneKey = `kick:${slot.key}:${slot.day}`;
    if (await readSetting(env, doneKey)) continue;
    const triedKey = `kick-try:${slot.key}:${slot.day}`;
    const tried = await readSetting(env, triedKey);
    if (tried && now - Date.parse(tried) < RETRY_MINUTES * 60000) continue;
    const status = await dispatch(env, slot);
    if (status === 204) {
      await writeSetting(env, doneKey, new Date(now).toISOString(), now);
      started.push(slot.key);
    } else {
      await writeSetting(env, triedKey, new Date(now).toISOString(), now);
      console.error(`Starting ${slot.label} refused: HTTP ${status}`);
      await dispatchRefused(env, status, slot.label).catch(() => null);
    }
  }
  return started;
}

export { kickProspectJobs, dueSlots, pacific, SLOTS };
