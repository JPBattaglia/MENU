// Serves generated sites (stage 7) from R2.
//   live:     GET /api/site/<slug>/<path>                 (and <slug>.menu-made.com once wildcard routing is switched on)
//   preview:  GET /api/site-preview/<buildId>/<token>/<path>   owner/buyer review of a build that is not live yet
// A build is one JSON asset { pages: {file: html}, images: [{path, storage_key, mime}] }. "Live" = the newest FINAL,
// customer-visible SITE_BUILD of the site's project, so approving a build publishes it and requesting changes does not.
import { simplePage } from "../../lib/http.js";
import { verifyLinkToken } from "../../lib/links.js";

const CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function loadBuild(env, storageKey) {
  const object = await env.ASSETS.get(storageKey);
  if (!object) return null;
  try { return JSON.parse(await object.text()); } catch { return null; }
}

async function respond(env, build, rawPath, extra = {}) {
  const path = rawPath.replace(/^\/+/, "") || "index.html";
  const headers = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": CSP, "Referrer-Policy": "strict-origin-when-cross-origin", ...extra };
  if (build.pages[path] !== undefined) return new Response(build.pages[path], { status: 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  const image = (build.images || []).find((i) => i.path === path);
  if (image) {
    const object = await env.ASSETS.get(image.storage_key);
    if (object) return new Response(object.body, { status: 200, headers: { ...headers, "Content-Type": image.mime } });
  }
  return notFound(build, headers);
}

function notFound(build, headers = {}) {
  const home = build?.pages?.["index.html"] ? '<p><a href="index.html">Back to the home page</a></p>' : "";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title></head><body><main><h1>Page not found</h1>${home}</main></body></html>`, { status: 404, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

async function handleLiveSite(request, env, slug, path) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  // Newest approved build for this site from ANY project of the business: the original Website Package or a later
  // Website & App Care edit. The slug check keeps one business's two sites apart.
  let row;
  try {
  row = await env.DB.prepare(`
      SELECT a.storage_key FROM website_sites s
      JOIN projects p ON p.business_id = s.business_id
      JOIN deliverables d ON d.project_id = p.id AND d.deliverable_type = 'SITE_BUILD' AND d.status = 'FINAL' AND d.customer_visible = 1
      JOIN assets a ON a.id = d.asset_id
      WHERE s.slug = ? AND json_extract(a.metadata_json, '$.website.slug') = s.slug
      ORDER BY d.delivered_at DESC, d.created_at DESC, d.version DESC LIMIT 1
    `).bind(slug).first();
  if (!row) {
    const known = await env.DB.prepare(`SELECT 1 AS found FROM website_sites WHERE slug = ?`).bind(slug).first();
    return known ? simplePage(200, "Website coming soon", "<p>This website is being prepared. Please check back shortly.</p>") : simplePage(404, "Website not found", "<p>This address isn't active.</p>");
  }
  } catch (error) {
    // A missing table or a D1 limit must not crash the Worker for every visitor.
    console.error("live site lookup failed", error?.message);
    return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  }
  const build = await loadBuild(env, row.storage_key);
  if (!build) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  if (!path && new URL(request.url).pathname.endsWith(slug)) return Response.redirect(new URL(`${new URL(request.url).pathname}/`, request.url).toString(), 301);
  return respond(env, build, path, { "Cache-Control": "public, max-age=300" });
}

async function handleSitePreview(request, env, buildId, token, path) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const payload = await verifyLinkToken(env, token, ["sitepreview"], buildId);
  if (!payload || payload.expired) return simplePage(403, "This link has expired or isn't valid", "<p>Ask for a fresh preview link.</p>");
  const row = await env.DB.prepare(`
      SELECT a.storage_key FROM deliverables d JOIN assets a ON a.id = d.asset_id
      WHERE d.id = ? AND d.deliverable_type = 'SITE_BUILD' AND d.status != 'SUPERSEDED' LIMIT 1
    `).bind(buildId).first();
  const build = row ? await loadBuild(env, row.storage_key) : null;
  if (!build) return simplePage(404, "Preview not found", "<p>This preview is no longer available.</p>");
  if (!path && !new URL(request.url).pathname.endsWith("/")) return Response.redirect(new URL(`${new URL(request.url).pathname}/`, request.url).toString(), 301);
  return respond(env, build, path, { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" });
}

export { handleLiveSite, handleSitePreview, loadBuild };
