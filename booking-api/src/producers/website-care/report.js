// Website & App Care: the monthly health report. Facts only: how many daily checks answered, how fast, what the automated
// page checks find on the live pages, and how many changes were made. It says what it measures and what it does not.
import { checkSite } from "../website/check.js";

async function monthlyReport(env, { slug, build, subscriptionId, now = new Date(), days = 30 }) {
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const checks = (await env.DB.prepare(`SELECT ok, ms, detail FROM site_health_checks WHERE slug = ? AND checked_at > ? ORDER BY checked_at`).bind(slug, since).all()).results || [];
  const answered = checks.filter((c) => c.ok).length;
  const times = checks.filter((c) => c.ok).map((c) => Number(c.ms));
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  const slowest = times.length ? Math.max(...times) : null;
  const failures = checks.filter((c) => !c.ok).map((c) => c.detail).filter(Boolean).slice(0, 3);
  let issues = [];
  if (build?.pages) {
    const images = Object.fromEntries((build.images || []).map((i) => [i.path, i.size]));
    issues = checkSite({ pages: build.pages, images, site: build.site || { phone: "", address: "", hours: "" } });
  }
  const changes = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_change_requests WHERE subscription_id = ? AND created_at > ? AND status IN ('DRAFTED', 'DELIVERED')`).bind(subscriptionId, since).first())?.n || 0);
  const lines = [];
  lines.push(checks.length
    ? `Your site answered ${answered} of ${checks.length} daily checks${checks.length ? ` (${Math.round((answered / checks.length) * 100)}%)` : ""}.`
    : "We have not recorded a daily check yet; the first one runs within a day.");
  if (avg !== null) lines.push(`Average response time ${avg} ms; slowest ${slowest} ms.`);
  if (failures.length) lines.push(`Problems seen: ${failures.join("; ")}.`);
  lines.push(issues.length ? `Automated page checks found ${issues.length} thing${issues.length === 1 ? "" : "s"} to look at.` : "Automated page checks (links, images, accessibility basics, contact details) found nothing to fix.");
  lines.push(changes ? `${changes} change${changes === 1 ? "" : "s"} made at your request this month.` : "No changes were requested this month.");
  return { checks: checks.length, answered, avg_ms: avg, slowest_ms: slowest, issues, changes, lines,
    note: "We check once a day from our own servers, so this shows whether your site was reachable and how quickly it replied, not minute-by-minute uptime or how it feels on a slow phone connection." };
}

export { monthlyReport };
