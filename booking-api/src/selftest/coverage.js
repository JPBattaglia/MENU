// Stage 12, task 1: the coverage map. Every offer in the catalog that is on sale (or waiting to launch), what
// produces it, which self-tests prove it, and when each of those last passed. Built from the live offers table and
// self_tests, so a new offer with no self-test shows up as a gap by itself.
//
//   GET  /api/system/coverage        "Email me the link" (no token to remember)   POST (no t) emails a 7-day link
//   GET  /api/system/coverage?t=     the coverage page
//   GET  /api/system/coverage        with Authorization: Bearer <ADMIN_API_TOKEN>: the map as JSON
//   POST /api/system/coverage        with t and run=1: "Run every self-test now" (stage 12 task 3, the full run)
//
// Stage 12 task 3: every self-test already runs daily on its own slot (15:00-20:40 UTC). Once a day at 22:00 UTC,
// after the last slot, the map is checked; only when something failed or went stale does the owner get ONE email
// with what failed, the likely cause, and a link to this page. A green day sends nothing. (The plan said a GitHub
// Actions schedule; the worker's own clock does the same with no extra secret.)
//
// A row is OK when every one of its self-tests passed within FRESH_HOURS. Otherwise: NO_TEST (nothing listed for the
// offer), NEVER_PASSED, or STALE (last pass too old, which is what happens to a self-test that isn't scheduled daily).
// The map is "green" only when every public offer and every shared system is OK; hidden offers waiting to launch are
// listed but don't count until they go public; other hidden offers aren't listed.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { constantTimeEqual } from "../admin/queue.js";

const LINK_KIND = "system-coverage";
const LINK_TTL_DAYS = 7;
const FRESH_HOURS = 36;
const REPORT_HOUR_UTC = 22;

// Offer code -> the self-test kinds that prove it (each: what it covers for that offer).
const OFFER_TESTS = {
  ONLINE_MENU_QR: [["MENU_QR_EXTRA_PAGES", "checkout with PDF upload, extra pages, approval, hosted menu"], ["MENU_HOSTING_RENEWAL", "year-one reminder and the 30-day grace"]],
  MENU_CARE: [["MENU_CARE_EDIT", "change request, AI edit, approval, hosted menu updated"]],
  REVIEW_REPLIES: [["REVIEW_REPLIES_RUN", "Google reviews read, replies drafted, routed and sent to Google"]],
  GOOGLE_PROFILE_CARE: [["GOOGLE_PROFILE_CARE_RUN", "weekly post, photo, monthly report"]],
  GOOGLE_VISIBILITY: [["GOOGLE_VISIBILITY_RUN", "profile audit, planned changes, approval, report"]],
  SOCIAL_POSTS: [["SOCIAL_POSTS_RUN", "AI posts, rendered PNGs, approval, ZIP delivery"]],
  ACCESSIBILITY_MONITORING: [["ACCESSIBILITY_RUN", "settings link, real scan, monthly report"]],
  CONVERSION_FIX: [["CONVERSION_RUN", "audit, AI recommendations, approval, report"]],
  WEBSITE_PACKAGE: [["WEBSITE_PACKAGE_RUN", "intake form, AI copy, approval, live site"], ["WEBSITE_TRIAL_RUN", "real checkout starts the Website & App Care trial; trial end charges the first month"]],
  WEBSITE_CARE: [["WEBSITE_CARE_RUN", "change request, AI edit, approval, live site updated"]],
  GUEST_APP_SETUP: [["GUEST_APP_RUN", "intake form, icons, preview, approval, live app"]],
  GUEST_APP: [["GUEST_APP_PUSH_RUN", "notifications and the rewards card"]],
  BUNDLE_STARTER: [["SUBSCRIPTION_STARTER", "checkout, plan switch as the billing portal does, declined renewal (past due, services paused), cancel"]],
  BUNDLE_GROWTH: [["SUBSCRIPTION_GROWTH", "bundle checkout, billing portal link, renewal on a test clock, cancel at period end as the portal does"]],
  BUNDLE_PRO: [["SUBSCRIPTION_PRO", "bundle checkout, 6 plans, renewal on a test clock, cancel"]],
  NINO_SOCIAL_PACK: [["NINO_DESIGN_RUN", "ninobattaglia.com checkout, brief, production, approval, delivery"]],
  NINO_FLYER: [["NINO_DESIGN_RUN", "ninobattaglia.com checkout, brief, production, approval, delivery"]],
  NINO_MENU_DESIGN: [["NINO_DESIGN_RUN", "ninobattaglia.com checkout, menu read, extra pages, approval, delivery"]],
  NINO_LOGO: [["NINO_DESIGN_RUN", "ninobattaglia.com checkout, brief, production, approval, delivery"]],
  STAFF_MERCH: [["STAFF_MERCH_RUN", "logo upload, Printful quote, checkout, proof approval, Printful draft"]],
  STORE_APP_SETUP: [["STORE_APP_RUN", "store steps, keys, build start, listing, approval, sandbox go-live"], ["STORE_APP_TRIAL_RUN", "real checkout starts the app tier's 90-day trial"]],
  STORE_APP_CARE: [["STORE_APP_TRIAL_RUN", "app-tier subscription trialing from checkout"]]
};

// Systems every order relies on, which aren't one offer.
const SYSTEMS = [
  ["Approval routing", "ROUTING_APPROVAL", "automatic vs owner-approved delivery, owner queue"],
  ["Customer accounts", "ACCOUNT_SIGNIN", "emailed sign-in link, account page, sign-out"],
  ["Unfinished-checkout email", "ABANDONED_CHECKOUT", "reminder email and resumed checkout"],
  ["Custom domains", "CUSTOM_DOMAIN_SETUP", "Cloudflare for SaaS settings, token, fallback origin"],
  ["Google connection", "GOOGLE_API_HEALTH", "OAuth token refresh and the three Google APIs"],
  ["Payments (live, read-only)", "MONEY_PATHS", "every live Stripe price matches the catalog, a live checkout opens, the webhook is set up and nothing failed to arrive"],
  ["Email (both brands)", "EMAIL_HEALTH", "sending domain verified, DKIM, SPF, DMARC and MX for both domains, every template that ran rendered cleanly, nothing failed to send or bounced"],
  ["Database usage (both sites)", "D1_USAGE", "today's D1 reads and writes against the free daily limits, hourly from GitHub Actions; one email a day if near"],
  ["Website checks (both sites)", "SITE_CHECK", "every page loads, no broken links or files, no JavaScript errors, no arrows on buttons or links, accessibility, speed (GitHub Actions, daily)"]
];

// Not tested from this worker; listed so the map shows the whole business.
const ELSEWHERE = [
  ["Nino shirt shop (ninobattaglia.com)", "the Nino shop worker's own self-check (Stripe key, webhook, Printful order access), daily"]
];

// Latest pass and latest run per kind, one indexed query per kind (migration 0030), so reads stay small.
async function lastResults(env, kinds) {
  const out = new Map();
  for (const kind of kinds) {
    const pass = await env.DB.prepare(`SELECT finished_at FROM self_tests WHERE kind = ? AND status = 'PASSED' ORDER BY finished_at DESC LIMIT 1`).bind(kind).first();
    const last = await env.DB.prepare(`SELECT status, error, created_at FROM self_tests WHERE kind = ? ORDER BY created_at DESC LIMIT 1`).bind(kind).first();
    out.set(kind, { lastPass: pass?.finished_at || null, lastStatus: last?.status || null, lastError: last?.status === "FAILED" ? String(last.error || "").slice(0, 200) : null });
  }
  return out;
}

function judge(tests, results, now) {
  if (!tests.length) return "NO_TEST";
  let status = "OK";
  for (const { kind } of tests) {
    const r = results.get(kind);
    if (!r?.lastPass) return "NEVER_PASSED";
    if (now - Date.parse(r.lastPass) > FRESH_HOURS * 3600000) status = "STALE";
  }
  return status;
}

async function buildCoverage(env, now = Date.now()) {
  const offers = (await env.DB.prepare(`SELECT code, name, is_public FROM offers WHERE status = 'ACTIVE' ORDER BY is_public DESC, sort_order, code`).all()).results || [];
  const kinds = [...new Set([...Object.values(OFFER_TESTS).flat().map(([k]) => k), ...SYSTEMS.map(([, k]) => k)])];
  const results = await lastResults(env, kinds);
  const detail = (pairs) => pairs.map(([kind, covers]) => ({ kind, covers, ...results.get(kind) }));
  // Hidden offers are shown only when they're waiting to launch (they have self-tests listed); an offer taken off sale
  // (e.g. Accessibility Upgrade, Oct 2026) isn't part of the business any more.
  const rows = offers.filter((o) => o.is_public || OFFER_TESTS[o.code]).map((o) => {
    const tests = detail(OFFER_TESTS[o.code] || []);
    return { type: "offer", code: o.code, name: o.name, public: Boolean(o.is_public), status: judge(tests, results, now), tests };
  });
  const systems = SYSTEMS.map(([name, kind, covers]) => {
    const tests = detail([[kind, covers]]);
    return { type: "system", code: kind, name, public: true, status: judge(tests, results, now), tests };
  });
  const counted = [...rows, ...systems].filter((r) => r.public);
  const gaps = counted.filter((r) => r.status !== "OK");
  return { ok: gaps.length === 0, fresh_hours: FRESH_HOURS, generated_at: new Date(now).toISOString(), offers: rows, systems,
    elsewhere: ELSEWHERE.map(([name, how]) => ({ name, how })), gaps: gaps.map((r) => ({ code: r.code, name: r.name, status: r.status })) };
}

// ---------- the full run ----------

// SITE_CHECK (daily) and D1_USAGE (hourly) are reported by GitHub Actions, not run by the worker, so the full run doesn't queue them.
const ALL_KINDS = () => [...new Set([...Object.values(OFFER_TESTS).flat().map(([k]) => k), ...SYSTEMS.map(([, k]) => k)])].filter((k) => k !== "SITE_CHECK" && k !== "D1_USAGE");

// Start every self-test that isn't already waiting or running. Returns the kinds started.
async function startFullRun(env, by = "owner-full-run") {
  const started = [];
  for (const kind of ALL_KINDS()) {
    const busy = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND status IN ('REQUESTED', 'RUNNING') LIMIT 1`).bind(kind).first();
    if (busy) continue;
    const t = nowIso();
    await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', ?, ?, ?)`).bind(crypto.randomUUID(), kind, by, t, t).run();
    started.push(kind);
  }
  return started;
}

const likelyCause = (row) => {
  const t = row.tests.find((x) => x.lastError) || row.tests.find((x) => !x.lastPass) || row.tests[0];
  if (!t) return "No self-test is set up for it yet.";
  if (t.lastError) return `${t.kind} failed: ${t.lastError}`;
  if (!t.lastPass) return `${t.kind} has never passed.`;
  return `${t.kind} last passed ${t.lastPass.slice(0, 16).replace("T", " ")} UTC; it may not have run (not scheduled, or stuck waiting).`;
};

// Once a day after the last self-test slot: one email to the owner only if something needs attention.
async function dailyCoverageReport(env, now = Date.now(), { force = false } = {}) {
  if (!env.DB) return { sent: false };
  const d = new Date(now);
  if (!force && (String(env.SELFTEST_SCHEDULE || "") !== "on" || d.getUTCHours() !== REPORT_HOUR_UTC || d.getUTCMinutes() >= 5)) return { sent: false };
  const map = await buildCoverage(env, now);
  if (map.ok) return { sent: false, ok: true };
  const rows = [...map.offers, ...map.systems].filter((r) => r.public && r.status !== "OK");
  const link = `${publicBaseUrl(env)}/api/system/coverage?t=${encodeURIComponent(await signLinkToken(env, { kind: LINK_KIND, id: "owner", ttlDays: LINK_TTL_DAYS }))}`;
  const day = d.toISOString().slice(0, 10);
  const sent = await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `${rows.length} Menu-made check${rows.length === 1 ? " needs" : "s need"} a look`,
    html: brandedEmailHtml({ preheader: rows.map((r) => r.name).join(", "), eyebrow: "DAILY CHECK", heading: "Something didn't pass today",
      paragraphs: ["Everything else passed. Forward this email to Claude to have it looked at; the page has every service and its last result."],
      rows: rows.map((r) => [r.name, likelyCause(r)]),
      buttons: [{ label: "Open coverage", url: link, primary: true }] }),
    text: `Daily check, ${day}:\n${rows.map((r) => `- ${r.name}: ${likelyCause(r)}`).join("\n")}\n\nCoverage: ${link}`,
    idempotencyKey: `coverage-report/${day}`, purpose: "AUTOMATION_ALERT", templateKey: "coverage_report_v1"
  }).catch((error) => ({ ok: false, error }));
  return { sent: Boolean(sent?.ok), ok: false, gaps: rows.map((r) => r.code) };
}

// ---------- owner page ----------

const LABEL = { OK: "OK", STALE: "Stale", NEVER_PASSED: "Never passed", NO_TEST: "No self-test" };
const COLOR = { OK: "#1a6b3a", STALE: "#9a5b00", NEVER_PASSED: "#b42318", NO_TEST: "#b42318" };
const ago = (iso, now) => {
  if (!iso) return "never";
  const h = Math.round((now - Date.parse(iso)) / 3600000);
  return h < 1 ? "under an hour ago" : h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
};

function coveragePage(map, token = "", notice = "", now = Date.parse(map.generated_at)) {
  const cell = "padding:8px 6px;border-bottom:1px solid #dce8ec;vertical-align:top;text-align:left";
  const row = (r) => `<tr><td style="${cell}"><strong>${escapeHtml(r.name)}</strong>${r.public ? "" : "<br><small>not on sale yet</small>"}</td>
<td style="${cell};color:${COLOR[r.status]}"><strong>${LABEL[r.status]}</strong></td>
<td style="${cell}">${r.tests.length ? r.tests.map((t) => `${escapeHtml(t.kind)}: passed ${ago(t.lastPass, now)}${t.lastError ? `<br><small style="color:#b42318">last run failed: ${escapeHtml(t.lastError)}</small>` : ""}<br><small>${escapeHtml(t.covers)}</small>`).join("<br>") : "none"}</td></tr>`;
  const table = (rows) => `<table style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="${cell}">Item</th><th style="${cell}">Status</th><th style="${cell}">Self-tests</th></tr>${rows.map(row).join("")}</table>`;
  const summary = map.ok
    ? `<p style="color:#1a6b3a"><strong>Everything on sale has a self-test that passed in the last ${map.fresh_hours} hours.</strong></p>`
    : `<p style="color:#b42318"><strong>${map.gaps.length} item${map.gaps.length === 1 ? " needs" : "s need"} attention:</strong> ${map.gaps.map((g) => `${escapeHtml(g.name)} (${LABEL[g.status].toLowerCase()})`).join(", ")}.</p>`;
  const runForm = token ? `<form method="post" action="/api/system/coverage"><input type="hidden" name="t" value="${escapeHtml(token)}"><input type="hidden" name="run" value="1"><button type="submit">Run every self-test now</button> <small>Results arrive over the next hour; you'll only get an email if something fails.</small></form>` : "";
  return simplePage(200, "System coverage", `${notice}${summary}${runForm}
<p><small>Stale means the self-test hasn't passed in the last ${map.fresh_hours} hours, usually because it isn't on a daily schedule yet. Checked ${escapeHtml(map.generated_at.slice(0, 16).replace("T", " "))} UTC.</small></p>
<h2 style="font-size:18px">What's for sale</h2>${table(map.offers)}
<h2 style="font-size:18px">Shared systems</h2>${table(map.systems)}
<h2 style="font-size:18px">Checked elsewhere</h2>${map.elsewhere.map((e) => `<p><strong>${escapeHtml(e.name)}</strong>: ${escapeHtml(e.how)}</p>`).join("")}`);
}

async function emailLink(env) {
  const inbox = ownerEmailAddress(env);
  const link = `${publicBaseUrl(env)}/api/system/coverage?t=${encodeURIComponent(await signLinkToken(env, { kind: LINK_KIND, id: "owner", ttlDays: LINK_TTL_DAYS }))}`;
  const sent = await sendTransactionalEmail(env, {
    to: inbox,
    subject: "Your Menu-made system coverage",
    html: brandedEmailHtml({ preheader: "Every service and the self-test that proves it.", eyebrow: "OWNER", heading: "System coverage",
      paragraphs: ["Every service on sale, the self-tests that prove it works, and when each last passed. The link works for 7 days; open the page again any time for a fresh one.", "If you didn't ask for this, ignore it."],
      buttons: [{ label: "Open coverage", url: link, primary: true }] }),
    text: `Your system coverage (link works for 7 days):\n${link}`,
    idempotencyKey: `coverage-link/${Math.floor(Date.now() / 600000)}`, purpose: "OWNER_ACTION", templateKey: "coverage_link_v1"
  }).catch((error) => ({ ok: false, error }));
  if (!sent?.ok) return simplePage(502, "The email didn't send", "<p>Please try again in a minute.</p>");
  return simplePage(200, "Check your email", `<p>We sent the link to <strong>${escapeHtml(inbox)}</strong>.</p>`);
}

async function handleCoverage(request, env) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const noStore = (response) => { response.headers.set("Cache-Control", "no-store"); response.headers.set("X-Robots-Tag", "noindex"); return response; };
  const url = new URL(request.url);
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer) {
    if (!env.ADMIN_API_TOKEN || !constantTimeEqual(bearer, env.ADMIN_API_TOKEN)) return noStore(Response.json({ ok: false, error: "Not authorized" }, { status: 401 }));
    return noStore(Response.json(await buildCoverage(env)));
  }
  let token = url.searchParams.get("t");
  let run = false;
  if (request.method === "POST") {
    try { const form = await request.formData(); token = token || String(form.get("t") || ""); run = form.get("run") === "1"; } catch { /* no form */ }
  }
  if (request.method === "POST" && !token) return noStore(await emailLink(env));
  if (!token) {
    return noStore(simplePage(200, "System coverage", `<p>Every service on sale, the self-tests that prove it works, and when each last passed. We'll email a 7-day link to <strong>${escapeHtml(ownerEmailAddress(env))}</strong>.</p>
<form method="post" action="/api/system/coverage"><button type="submit">Email me the link</button></form>`));
  }
  const payload = await verifyLinkToken(env, token, [LINK_KIND], "owner");
  if (!payload || payload.expired) return noStore(simplePage(403, "This link has expired", `<p>Open <a href="/api/system/coverage">the coverage page</a> again to get a fresh link.</p>`));
  let notice = "";
  if (run) {
    const started = await startFullRun(env);
    notice = `<p style="color:#1a6b3a"><strong>${started.length ? `Started ${started.length} self-test${started.length === 1 ? "" : "s"}.` : "Every self-test is already running."}</strong></p>`;
  }
  return noStore(coveragePage(await buildCoverage(env), token, notice));
}

export { ELSEWHERE, FRESH_HOURS, LINK_KIND, OFFER_TESTS, SYSTEMS, buildCoverage, coveragePage, dailyCoverageReport, handleCoverage, startFullRun };
