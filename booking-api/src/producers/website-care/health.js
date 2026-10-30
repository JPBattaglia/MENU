// Website & App Care: a daily check that each live site answers, and how fast. One request per site per day through the public
// address (so DNS, the edge and the Worker are all in the path), recorded in site_health_checks. The monthly report reads
// these. To protect the free-tier limits it only runs inside one UTC hour and checks at most 10 sites per tick.
import { publicBaseUrl } from "../../lib/config.js";
import { nowIso } from "../../lib/http.js";

const CHECK_HOUR_UTC = 9;
const PER_TICK = 10;
const MIN_HOURS_BETWEEN = 20;

async function checkOne(env, slug, fetchImpl) {
  const started = Date.now();
  try {
    const response = await fetchImpl(`${publicBaseUrl(env)}/api/site/${slug}/`, { headers: { "User-Agent": "MenuMade-SiteCheck/1" }, redirect: "follow" });
    const body = await response.text();
    const ms = Date.now() - started;
    const ok = response.status === 200 && /<h1[\s>]/i.test(body);
    return { ok, status: response.status, ms, bytes: body.length, detail: ok ? "" : `HTTP ${response.status}${response.status === 200 ? " without a page heading" : ""}` };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, bytes: 0, detail: String(error instanceof Error ? error.message : error).slice(0, 200) };
  }
}

async function runSiteHealthPass(env, { now = new Date(), force = false, fetchImpl = fetch } = {}) {
  if (!env.DB) return null;
  if (!force && now.getUTCHours() !== CHECK_HOUR_UTC) return { skipped: "outside the check hour" };
  const since = new Date(now.getTime() - MIN_HOURS_BETWEEN * 3600000).toISOString();
  const due = (await env.DB.prepare(`
      SELECT s.slug FROM website_sites s
      WHERE NOT EXISTS (SELECT 1 FROM site_health_checks h WHERE h.slug = s.slug AND h.checked_at > ?)
      ORDER BY s.created_at LIMIT ?
    `).bind(since, PER_TICK).all()).results || [];
  let checked = 0;
  for (const { slug } of due) {
    const result = await checkOne(env, slug, fetchImpl);
    await env.DB.prepare(`INSERT INTO site_health_checks (id, slug, checked_at, ok, status, ms, bytes, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), slug, nowIso(), result.ok ? 1 : 0, result.status, result.ms, result.bytes, result.detail).run();
    checked += 1;
  }
  return { checked };
}

export { CHECK_HOUR_UTC, checkOne, runSiteHealthPass };
