// The clock the daily self-tests schedule themselves by. Only the deployed worker runs them: wrangler.jsonc sets
// SELFTEST_SCHEDULE = "on". Anywhere else (local and CI tests) this returns null, so a test that runs a scheduled tick
// never picks up whichever daily self-test is due at that hour of the real day (before Oct 29, 2026, four tests failed
// between about 8 am and noon PT). Tests of the schedule itself pass their own `now`.
const dailyClock = (env) => (String(env?.SELFTEST_SCHEDULE || "") === "on" ? new Date() : null);

export { dailyClock };
