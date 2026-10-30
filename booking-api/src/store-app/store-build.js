// Stage 11 part 2: each restaurant's Store App build, started by the worker.
//
//   READY_TO_BUILD  the 5-minute tick starts .github/workflows/store-app-build.yml through the GitHub API with
//                   store_app=<id>, upload ticked, both platforms (GITHUB_DISPATCH_TOKEN, as the renderer) -> BUILDING
//   BUILDING        the workflow fetches its build config here, builds and uploads, and reports each platform back;
//                   iOS uploaded + Android uploaded (or its first file emailed to the owner, which Google only takes by
//                   hand) -> WAITING_SUBMIT_APPROVAL. A failed platform, or no report within 2 hours, emails the owner
//                   once with the run link and a signed "Build again" link (no token to remember).
//
//   GET  /api/store-build/config?store_app=<id>        (OIDC, manual runs of the workflow on master) the build config:
//                                                      app id, name, brand colour, api base, version, and the 1024 px
//                                                      store icon and Android icon foreground as SVG (logo inlined)
//                                                      for the workflow to draw (scripts/store-icons.mjs)
//   POST /api/store-build/result?store_app=<id>        (OIDC) { platform: ios|android, outcome: UPLOADED|FIRST_UPLOAD|
//                                                      FAILED, version, run_id }
//   GET/POST /api/store-app/<id>/rebuild?t=            the owner's "Build again" button
// Build config and icon are the restaurant's public app content (they end up in the stores), so nothing secret passes
// through; the repo is public and the workflow still never prints them.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";
import { LOGO_PLACEHOLDER, brandOf, storeIconSvg } from "../producers/guest-app/build.js";
import { appUrl, findAppLogo } from "../producers/guest-app/app-step.js";
import { keysReady, storeScope } from "./restaurant-keys.js";
import { OWNER, OWNER_BUNDLE_ID } from "./keys.js";
import { pausedWorkflows } from "../lib/switches.js";

const BUILD_AUDIENCE = "menu-made-store-build";
const BUILD_WORKFLOW = "JPBattaglia/MENU/.github/workflows/store-app-build.yml@refs/heads/master";
const DISPATCH_URL = "https://api.github.com/repos/JPBattaglia/MENU/actions/workflows/store-app-build.yml/dispatches";
const RUNS_URL = "https://github.com/JPBattaglia/MENU/actions/workflows/store-app-build.yml";
const REBUILD_KIND = "storeapp-rebuild";
const BUILD_TIMEOUT_MS = 2 * 3600000;
// The version string a build asks for: 1.0.0 for an app never live, else one patch above what is live in the stores
// (a yearly or fix rebuild of a live app needs a higher version; the build number is the workflow run number).
function nextVersion(live) {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(live || "").trim());
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "1.0.0";
}
async function liveVersionOf(env, storeAppId) {
  const row = await env.DB.prepare(`SELECT live_version FROM store_app_listings WHERE store_app_id = ?`).bind(storeAppId).first();
  return row?.live_version || null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Statuses a build may run in: the first build, and rebuilds once it is in the stores (yearly SDK updates).
const BUILDABLE = new Set(["READY_TO_BUILD", "BUILDING", "WAITING_SUBMIT_APPROVAL", "IN_REVIEW", "LIVE", "REJECTED"]);
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

// Which keys and app a build request is for: ?store_app=<id> (a restaurant, or the owner's test app) or ?scope=owner
// (the sample build config in the repo). Used by build-credentials.js too.
async function buildTarget(request, env) {
  const auth = await verifyRenderer(request, env, { audience: BUILD_AUDIENCE, workflow: BUILD_WORKFLOW, events: ["workflow_dispatch"] });
  if (!auth.ok) return { error: json({ ok: false, error: auth.error }, auth.status) };
  const params = new URL(request.url).searchParams;
  const id = String(params.get("store_app") || "").toLowerCase();
  if (id) {
    if (!UUID.test(id)) return { error: json({ ok: false, error: "Unknown Store App" }, 404) };
    const storeApp = await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ?`).bind(id).first();
    if (!storeApp) return { error: json({ ok: false, error: "Unknown Store App" }, 404) };
    if (!BUILDABLE.has(storeApp.status)) return { error: json({ ok: false, error: `This Store App isn't ready to build (${storeApp.status})` }, 409) };
    const scope = storeScope(storeApp);
    if (!scope) return { error: json({ ok: false, error: "This Store App has no restaurant record" }, 409) };
    return { scope, packageId: storeApp.bundle_id, storeApp };
  }
  if ((params.get("scope") || OWNER) !== OWNER) return { error: json({ ok: false, error: "Unknown scope" }, 404) };
  return { scope: OWNER, packageId: OWNER_BUNDLE_ID, storeApp: null };
}

async function appRow(env, storeApp) {
  const row = await env.DB.prepare(`SELECT id, slug, business_id, data_json FROM guest_apps WHERE project_id = ?`).bind(storeApp.project_id).first();
  let data = {};
  try { data = JSON.parse(row?.data_json || "{}"); } catch { data = {}; }
  return { row, data };
}
const appNameOf = (data) => String(data.app_name || "").trim().slice(0, 30);

// The build config answer for one store app (the self-test calls this directly). -> { status, body }
async function buildConfigFor(env, storeApp, packageId = storeApp.bundle_id) {
  const { row, data } = await appRow(env, storeApp);
  if (!row?.slug || !appNameOf(data)) return { status: 409, body: { ok: false, error: "The app content is missing" } };
  const logo = env.ASSETS ? await findAppLogo(env, { id: storeApp.project_id, business_id: row.business_id }) : null;
  const logoObject = logo ? await env.ASSETS.get(logo.storage_key) : null;
  const logoUri = logoObject ? `data:${logo.mime_type};base64,${base64(new Uint8Array(await logoObject.arrayBuffer()))}` : null;
  const draw = (pad) => { const svg = storeIconSvg(data, { hasLogo: Boolean(logoUri), pad }); return logoUri ? svg.replace(LOGO_PLACEHOLDER, logoUri) : svg; };
  return { status: 200, body: {
    ok: true,
    config: {
      app_id: packageId,
      app_name: appNameOf(data),
      brand_color: brandOf(data),
      api_base: `${appUrl({ ...env, SITE_WILDCARD: "1" }, row.slug)}api`,
      version: nextVersion(await liveVersionOf(env, storeApp.id))
    },
    icon_svg: draw(0.14),
    android_foreground_svg: draw(0.24),
    feature_svg: featureSvg(data, logoUri)
  } };
}

async function handleBuildConfig(request, env) {
  const target = await buildTarget(request, env);
  if (target.error) return target.error;
  if (!target.storeApp) return json({ ok: false, error: "The owner's sample uses app-shell/sample/build.json" }, 404);
  const out = await buildConfigFor(env, target.storeApp, target.packageId);
  return json(out.body, out.status);
}

// Google Play's feature graphic (1024 x 500): the brand colour, the logo (or nothing) and the app name.
function featureSvg(data, logoUri) {
  const brand = brandOf(data);
  const m = /^#([0-9a-f]{6})$/i.exec(brand); const n = m ? parseInt(m[1], 16) : 0;
  const lum = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const ink = 0.2126 * lum(n >> 16 & 255) + 0.7152 * lum(n >> 8 & 255) + 0.0722 * lum(n & 255) > 0.4 ? "#1b1f23" : "#ffffff";
  const name = String(data.app_name || "").trim().slice(0, 30).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const size = name.length > 20 ? 52 : name.length > 12 ? 64 : 80;
  const x = logoUri ? 380 : 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500"><rect width="1024" height="500" fill="${brand}"/>`
    + (logoUri ? `<image href="${logoUri}" x="90" y="110" width="280" height="280" preserveAspectRatio="xMidYMid meet"/>` : "")
    + `<text x="${x}" y="250" dy="0.35em" text-anchor="${logoUri ? "start" : "middle"}" font-family="Liberation Sans" font-weight="bold" font-size="${size}" fill="${ink}">${name}</text></svg>`;
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// ---------- Results from the workflow ----------

async function rebuildLink(env, storeApp) {
  const token = await signLinkToken(env, { kind: REBUILD_KIND, id: storeApp.id, ttlDays: 30 });
  return `${publicBaseUrl(env)}/api/store-app/${storeApp.id}/rebuild?t=${encodeURIComponent(token)}`;
}

async function alertBuildProblem(env, storeApp, heading, detail, runId) {
  const { data } = await appRow(env, storeApp);
  const name = appNameOf(data) || storeApp.bundle_id;
  const runLink = runId && /^\d{1,20}$/.test(String(runId)) ? `https://github.com/JPBattaglia/MENU/actions/runs/${runId}` : RUNS_URL;
  const link = await rebuildLink(env, storeApp);
  const paragraphs = [detail, "The build log is on GitHub (link below). Once the cause is fixed, press Build again; nothing else needs to be re-entered.", "Claude can read the log and fix it if you forward this email."];
  await env.DB.prepare(`UPDATE store_apps SET last_email_at = ?, note = ? WHERE id = ?`).bind(nowIso(), String(detail).slice(0, 200), storeApp.id).run();
  return sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `Store App build needs a look: ${name}`,
    html: brandedEmailHtml({ preheader: heading, eyebrow: "STORE APP", heading, paragraphs, rows: [["App", storeApp.bundle_id]],
      buttons: [{ label: "Build again", url: link, primary: true }, { label: "Build log", url: runLink }] }),
    text: `${heading}\n\n${paragraphs.join("\n\n")}\n\nBuild again: ${link}\nBuild log: ${runLink}`,
    idempotencyKey: `store-build-alert/${storeApp.id}/${runId || storeApp.updated_at}/${heading.length}`, purpose: "OWNER_ACTION", templateKey: "store_build_alert_v1"
  }).catch(() => ({ ok: false }));
}

async function handleBuildResult(request, env) {
  const target = await buildTarget(request, env);
  if (target.error) return target.error;
  if (!target.storeApp) return json({ ok: true, recorded: false }); // the owner's sample build has no row to move
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json({ ok: false, error: "Bad request" }, 400); }
  const out = await recordBuildResult(env, target.storeApp, body);
  return json(out.body, out.status);
}

// One platform's result for one store app (the self-test calls this directly). -> { status, body }
async function recordBuildResult(env, storeApp, body) {
  const json = (data, status = 200) => ({ status, body: data });
  const platform = String(body?.platform || ""); const outcome = String(body?.outcome || "");
  if (!["ios", "android"].includes(platform) || !["UPLOADED", "FIRST_UPLOAD", "FAILED"].includes(outcome)) return json({ ok: false, error: "platform must be ios or android; outcome UPLOADED, FIRST_UPLOAD or FAILED" }, 400);
  const version = /^\d{1,9}$/.test(String(body.version || "")) ? Number(body.version) : null;
  const runId = /^\d{1,20}$/.test(String(body.run_id || "")) ? String(body.run_id) : null;
  const t = nowIso();
  await env.DB.prepare(`INSERT INTO store_app_builds (id, store_app_id, platform, outcome, version, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), storeApp.id, platform, outcome, version, runId, t).run();
  if (outcome === "FAILED") {
    await alertBuildProblem(env, storeApp, `The ${platform === "ios" ? "iPhone" : "Android"} build didn't finish`, `Build ${version ?? ""} for ${platform === "ios" ? "the App Store" : "Google Play"} failed.`, runId);
    return json({ ok: true, status: storeApp.status });
  }
  // Both platforms done for this build (results since it started) -> waiting for the store listing and the owner's OK.
  const since = storeApp.updated_at;
  const done = (await env.DB.prepare(`SELECT DISTINCT platform FROM store_app_builds WHERE store_app_id = ? AND created_at >= ? AND outcome IN ('UPLOADED', 'FIRST_UPLOAD')`).bind(storeApp.id, since).all()).results || [];
  let status = storeApp.status;
  if (storeApp.status === "BUILDING" && done.length === 2) {
    await env.DB.prepare(`UPDATE store_apps SET status = 'WAITING_SUBMIT_APPROVAL', note = 'Built and uploaded', reminders = 0, updated_at = ? WHERE id = ? AND status = 'BUILDING'`).bind(t, storeApp.id).run();
    status = "WAITING_SUBMIT_APPROVAL";
  }
  return json({ ok: true, status });
}

// ---------- Starting builds (5-minute tick) ----------

async function dispatchBuild(env, storeApp) {
  if (!env.GITHUB_DISPATCH_TOKEN) return { started: false, status: 0 };
  let status = 0;
  try {
    const response = await (env.GITHUB_DISPATCH_FETCH || fetch)(DISPATCH_URL, { // GITHUB_DISPATCH_FETCH is a test seam
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "menu-made-worker", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "master", inputs: { store_app: storeApp.id, upload: "true", platforms: "both" } })
    });
    status = response.status;
  } catch (error) {
    console.error("Store App build start failed:", error instanceof Error ? error.message : String(error));
  }
  return { started: status === 204, status };
}

async function advanceStoreBuilds(env, now = Date.now(), { only = null } = {}) {
  if (!env.DB) return { started: 0 };
  const rows = (only
    ? await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ? AND status IN ('READY_TO_BUILD', 'BUILDING')`).bind(only).all()
    : await env.DB.prepare(`SELECT * FROM store_apps WHERE status IN ('READY_TO_BUILD', 'BUILDING') ORDER BY updated_at LIMIT 10`).all()).results || [];
  let started = 0;
  for (const row of rows) {
    if (row.status === "READY_TO_BUILD") {
      if (!(await keysReady(env, row)).ready) continue;
      const result = await dispatchBuild(env, row);
      if (!result.started) {
        await env.DB.prepare(`UPDATE store_apps SET note = ? WHERE id = ?`).bind(`Build start refused: HTTP ${result.status}`, row.id).run();
        continue;
      }
      const t = nowIso();
      await env.DB.prepare(`UPDATE store_apps SET status = 'BUILDING', note = 'Build started', updated_at = ? WHERE id = ? AND status = 'READY_TO_BUILD'`).bind(t, row.id).run();
      started++;
    } else if (now - Date.parse(row.updated_at) > BUILD_TIMEOUT_MS && !(row.last_email_at && row.last_email_at >= row.updated_at)) {
      // One alert per build: a failed platform already sent one (last_email_at after the start).
      await alertBuildProblem(env, row, "A Store App build hasn't reported back", "The build started over 2 hours ago and hasn't reported a result.", null);
    }
  }
  return { started };
}

// ---------- Yearly rebuilds (owner decision, Oct 30, 2026) ----------
// Apple and Google keep raising the SDK an app must be built with, so an app in the stores is rebuilt every year: a LIVE
// app whose last version went live a year ago, with an active app-tier plan (STORE_APP_CARE), goes back to
// READY_TO_BUILD by itself. From there it is the normal path: build (one patch version up), the owner's listing
// preview, submission, review. Checked once a day (16:00-16:04 UTC tick); the Store App "Making" switch pauses it.
const YEARLY_MS = 365 * 86400000;

async function scheduleYearlyRebuilds(env, now = Date.now(), { force = false } = {}) {
  if (!env.DB) return { queued: 0 };
  const d = new Date(now);
  if (!force && (d.getUTCHours() !== 16 || d.getUTCMinutes() >= 5)) return { queued: 0 };
  const paused = await pausedWorkflows(env);
  if (paused.all || paused.keys.includes("STORE_APP_SETUP_V1")) return { queued: 0 };
  const due = (await env.DB.prepare(`
      SELECT s.id FROM store_apps s JOIN store_app_listings l ON l.store_app_id = s.id
      WHERE s.status = 'LIVE' AND l.live_at IS NOT NULL AND l.live_at < ?
        AND EXISTS (SELECT 1 FROM entitlements e WHERE e.business_id = s.business_id AND e.entitlement_type = 'STORE_APP_CARE' AND e.status = 'ACTIVE')
      LIMIT 20`).bind(new Date(now - YEARLY_MS).toISOString()).all()).results || [];
  let queued = 0;
  for (const { id } of due) {
    const r = await env.DB.prepare(`UPDATE store_apps SET status = 'READY_TO_BUILD', note = 'Yearly rebuild', updated_at = ? WHERE id = ? AND status = 'LIVE'`).bind(nowIso(), id).run();
    queued += r.meta?.changes || 0;
  }
  if (queued) console.log(`Store App yearly rebuilds queued: ${queued}`);
  return { queued };
}

// ---------- The owner's "Build again" ----------

async function handleRebuild(request, env, id) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const url = new URL(request.url);
  let token = url.searchParams.get("t") || "";
  if (request.method === "POST") { try { token = String((await request.formData()).get("t") || token); } catch { /* keep the query token */ } }
  const payload = await verifyLinkToken(env, token, [REBUILD_KIND], id);
  if (!payload || payload.expired) return simplePage(403, "This link has expired or isn't valid", "<p>Ask Claude for a fresh one.</p>");
  const row = await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ?`).bind(id).first();
  if (!row || !BUILDABLE.has(row.status)) return simplePage(409, "Can't build this app now", `<p>Status: ${escapeHtml(row?.status || "unknown")}.</p>`);
  if (row.status === "READY_TO_BUILD") return simplePage(200, "Already queued", "<p>The build starts within 5 minutes.</p>");
  if (request.method === "GET") {
    return simplePage(200, "Build again?", `<p>Starts a new build of <strong>${escapeHtml(row.bundle_id)}</strong> for both stores within 5 minutes.</p>
<form method="post" action="/api/store-app/${escapeHtml(id)}/rebuild"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">Build again</button></form>`);
  }
  await env.DB.prepare(`UPDATE store_apps SET status = 'READY_TO_BUILD', note = 'Build again (owner)', updated_at = ? WHERE id = ? AND status = ?`).bind(nowIso(), id, row.status).run();
  return simplePage(200, "Queued", "<p>The build starts within 5 minutes. You'll get an email only if something needs a look.</p>");
}

export { BUILD_AUDIENCE, BUILD_WORKFLOW, REBUILD_KIND, YEARLY_MS, advanceStoreBuilds, scheduleYearlyRebuilds, buildConfigFor, liveVersionOf, nextVersion, rebuildLink, recordBuildResult, buildTarget, handleBuildConfig, handleBuildResult, handleRebuild };
