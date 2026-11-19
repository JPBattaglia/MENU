// The clock the scheduled self-tests start themselves by. Only the deployed worker runs them: wrangler.jsonc sets
// SELFTEST_SCHEDULE = "on". Anywhere else (local and CI tests) this returns null, so a test that runs a scheduled tick
// never picks up whichever self-test is due at that hour of the real day (before Oct 29, 2026, four tests failed
// between about 8 am and noon PT). Tests of the schedule itself pass their own `now`.
//
// WEEKLY, not daily (owner, Nov 19, 2026): most self-tests run a real order through Claude, and that is paid for from
// the owner's Anthropic credit. Run every day they used up the credit. With "on" they now start on Mondays (UTC) only;
// a run already under way still finishes, because its steps don't use this clock. "daily" brings back every day.
// Later Nov 19, 2026 the owner linked his Max plan's free $100/month API credit and chose daily again: wrangler.jsonc
// sets "daily". The site's AI spend emails (lib/ai-spend.js) warn at 50% and 80% of the month's $100.
const SELFTEST_WEEKDAY_UTC = 1; // Monday

function dailyClock(env, now = new Date()) {
  const mode = String(env?.SELFTEST_SCHEDULE || "");
  if (mode === "daily") return now;
  if (mode !== "on") return null;
  return now.getUTCDay() === SELFTEST_WEEKDAY_UTC ? now : null;
}

export { dailyClock, SELFTEST_WEEKDAY_UTC };
