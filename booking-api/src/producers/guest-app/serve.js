// Serves Guest Apps (stage 8) from R2.
//   live:     <slug>.menu-made.com/app/<file>   (also /api/site/<slug>/app/ and a customer's own domain + /app/)
//   preview:  /api/app-preview/<buildId>/<token>/<file>   owner/buyer review of a build that is not live yet
// A build is one JSON asset { files: {name: text}, icons: [{path, storage_key, mime}] }. "Live" = the newest FINAL,
// customer-visible APP_BUILD for the slug. Unlike generated websites the app runs one script of its own (it registers
// the offline service worker), so its CSP allows scripts and workers from its own origin only.
import { simplePage } from "../../lib/http.js";
import { verifyLinkToken } from "../../lib/links.js";
import { loadLiveApp } from "./app-step.js";
import { APP_JS, serviceWorker, workerVersion } from "./build.js";
import { handleAppApi } from "./engage.js";

const CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; worker-src 'self'; manifest-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const TYPES = { "index.html": "text/html; charset=utf-8", "manifest.webmanifest": "application/manifest+json", "app.js": "text/javascript; charset=utf-8", "sw.js": "text/javascript; charset=utf-8", "qr.svg": "image/svg+xml" };
const PREVIEW_APP_JS = "// Preview: the offline worker is only installed from the live address.\n";

async function respond(env, build, rawPath, { cache, preview = false }) {
  const path = rawPath.replace(/^\/+/, "") || "index.html";
  const headers = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": CSP, "Referrer-Policy": "strict-origin-when-cross-origin", "Cache-Control": cache };
  if (preview) headers["X-Robots-Tag"] = "noindex, nofollow";
  if (build.files[path] !== undefined && TYPES[path]) {
    // The service worker and manifest are always revalidated so a new build reaches installed apps quickly.
    const fresh = path === "sw.js" || path === "app.js" || path === "manifest.webmanifest" || path === "index.html" ? "no-cache" : cache;
    const body = preview && path === "app.js" ? PREVIEW_APP_JS : build.files[path];
    return new Response(body, { status: 200, headers: { ...headers, "Cache-Control": preview ? cache : fresh, "Content-Type": TYPES[path] } });
  }
  const icon = (build.icons || []).find((i) => i.path === path);
  if (icon) {
    const object = await env.ASSETS.get(icon.storage_key);
    if (object) return new Response(object.body, { status: 200, headers: { ...headers, "Content-Type": icon.mime } });
  }
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title></head><body><main><h1>Not found</h1><p><a href="./">Open the app</a></p></main></body></html>',
    { status: 404, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

// A live app always runs the current app.js and offline worker (notifications and rewards, stage 11), whatever build
// it was approved with; the build keeps its own page, manifest and icons.
function withCurrentClient(build) {
  const version = /guest-app-([A-Za-z0-9]+)/.exec(build.files?.["sw.js"] || "")?.[1] || String(build.built_at || "v").replace(/\W/g, "").slice(-8);
  return { ...build, files: { ...build.files, "app.js": APP_JS, "sw.js": serviceWorker(workerVersion(version)) } };
}

// path is what follows "app/" ("" for the app itself). "api/..." is the app's own API (engage.js).
async function handleLiveApp(request, env, slug, path) {
  if (/^api\//.test(path || "")) return handleAppApi(request, env, slug, path.slice(4));
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  let live;
  try { live = await loadLiveApp(env, { slug }); } catch (error) {
    console.error("live app lookup failed", error?.message);
    return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  }
  if (!live) return simplePage(404, "App not found", "<p>This address isn't active.</p>");
  if (!live.build) return simplePage(200, "App coming soon", "<p>This app is being prepared. Please check back shortly.</p>");
  const pathname = new URL(request.url).pathname;
  if (!path && !pathname.endsWith("/")) return Response.redirect(new URL(`${pathname}/`, request.url).toString(), 301);
  return respond(env, withCurrentClient(live.build), path, { cache: "public, max-age=300" });
}

// A slug that has an app but no website: its root opens the app.
async function appOnlyRedirect(request, env, slug) {
  const app = await env.DB.prepare(`SELECT 1 AS found FROM guest_apps WHERE slug = ?`).bind(slug).first().catch(() => null);
  if (!app) return null;
  const site = await env.DB.prepare(`SELECT 1 AS found FROM website_sites WHERE slug = ?`).bind(slug).first().catch(() => null);
  if (site) return null;
  const url = new URL(request.url);
  return Response.redirect(new URL(`${url.pathname.replace(/\/?$/, "/")}app/`, url).toString(), 302);
}

async function handleAppPreview(request, env, buildId, token, path) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const payload = await verifyLinkToken(env, token, ["apppreview"], buildId);
  if (!payload || payload.expired) return simplePage(403, "This link has expired or isn't valid", "<p>Ask for a fresh preview link.</p>");
  const row = await env.DB.prepare(`
      SELECT a.storage_key FROM deliverables d JOIN assets a ON a.id = d.asset_id
      WHERE d.id = ? AND d.deliverable_type = 'APP_BUILD' AND d.status != 'SUPERSEDED' LIMIT 1
    `).bind(buildId).first();
  const object = row ? await env.ASSETS.get(row.storage_key) : null;
  let build = null;
  try { build = object ? JSON.parse(await object.text()) : null; } catch { build = null; }
  if (!build) return simplePage(404, "Preview not found", "<p>This preview is no longer available.</p>");
  if (!path && !new URL(request.url).pathname.endsWith("/")) return Response.redirect(new URL(`${new URL(request.url).pathname}/`, request.url).toString(), 301);
  return respond(env, build, path, { cache: "private, no-store", preview: true });
}

export { CSP, appOnlyRedirect, handleAppPreview, handleLiveApp };
