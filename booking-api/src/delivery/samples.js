// Stage 9 part 2: sample outputs for the product pages. Each sample is the newest REAL output of a product's daily
// self-test (sandbox orders by the self-test buyer), so the samples always match what the producers make today.
// Served with the fictional test business renamed "Sample Cafe", every signed private link removed, no scripts on
// report pages, noindex. Google samples are not served: those self-tests run on Menu-Made's own Google profile.
//   /api/samples/<menu|accessibility|conversion|social>   one stored page
//   /api/samples/website/...  /api/samples/app/...       the newest self-test website or Guest App, proxied
import { SELF_TEST_EMAIL } from "../lib/email.js";
import { simplePage } from "../lib/http.js";
import { handleLiveSite } from "../producers/website/serve.js";
import { handleLiveApp } from "../producers/guest-app/serve.js";

const SAMPLE_NAME = "Sample Cafe";
const PAGES = {
  menu: { workflow: "MENU_QR_V1", type: "MENU_DRAFT", label: "Online Menu + QR" },
  accessibility: { workflow: "ACCESSIBILITY_MONITORING_V1", type: "ACCESSIBILITY_REPORT", label: "Accessibility Monitoring" },
  conversion: { workflow: "CONVERSION_FIX_V1", type: "CONVERSION_REPORT", label: "Conversion Fix" },
  social: { workflow: "SOCIAL_POSTS_V1", type: "SOCIAL_CALENDAR", label: "Social Posts" }
};

// Test businesses are named "<Something> Self-Test Cafe"; show them as one neutral sample business.
function scrub(text, names = []) {
  let out = String(text);
  for (const name of names.filter(Boolean).sort((a, b) => b.length - a.length)) out = out.split(name).join(SAMPLE_NAME);
  out = out.replace(/(?:[A-Z][A-Za-z0-9]*\s+){0,3}Self-Test\s+(?:Cafe|Trattoria|Bistro|Restaurant)/g, SAMPLE_NAME)
    .replace(/Menu-Made Self-Test/g, "Sam Sample")
    .replace(/\bSelf-Test\b/g, "Sample")
    .replace(/[A-Za-z]*SelfTest(?:Cafe|Trattoria|Bistro)?/g, "SampleCafe");
  // Signed private links (change forms, approvals, settings, deliveries) never leave a sample.
  out = out.replace(/https?:\/\/[a-z0-9.-]*menu-made\.com\/api\/[^"'\s<>)]*[?&](?:amp;)?t=[^"'\s<>)]*/gi, "#")
    .replace(/delivered@resend\.dev/gi, "hello@example.com");
  return out;
}

function banner(label) {
  return `<div style="position:sticky;top:0;z-index:99999;background:#071f2c;color:#e8f6f7;font:14px/1.5 Arial,Helvetica,sans-serif;padding:10px 16px;text-align:center">Sample ${label} output for a fictional business, made by our automated daily test run. <a href="https://menu-made.com/services.html" target="_top" style="color:#5ff2ff">Back to Menu-Made</a></div>`;
}

const headers = (type) => ({
  "Content-Type": type,
  "Cache-Control": "public, max-age=900",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
});

async function samplePage(env, key) {
  const spec = PAGES[key];
  const row = await env.DB.prepare(`
      SELECT a.storage_key, a.mime_type, b.name AS business_name
      FROM deliverables d JOIN projects p ON p.id = d.project_id JOIN assets a ON a.id = d.asset_id
      JOIN customers c ON c.id = p.customer_id LEFT JOIN businesses b ON b.id = p.business_id
      WHERE lower(c.email) = ? AND p.workflow_key = ? AND d.deliverable_type = ? AND d.status = 'FINAL'
      ORDER BY d.delivered_at DESC, d.version DESC LIMIT 1
    `).bind(SELF_TEST_EMAIL, spec.workflow, spec.type).first();
  const object = row && /^text\/html/i.test(row.mime_type || "") ? await env.ASSETS.get(row.storage_key) : null;
  if (!object) return simplePage(404, "Sample not available", "<p>This sample isn't available right now.</p>");
  let html = scrub(await object.text(), [row.business_name]);
  html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + banner(spec.label)) : banner(spec.label) + html;
  return new Response(html, {
    status: 200,
    headers: {
      ...headers("text/html; charset=utf-8"),
      // Stored reports are static: no scripts, no forms, images from anywhere https.
      "Content-Security-Policy": "sandbox allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:"
    }
  });
}

async function sampleSlug(env, kind) {
  if (kind === "website") {
    return (await env.DB.prepare(`
        SELECT s.slug, b.name FROM website_sites s JOIN businesses b ON b.id = s.business_id
        WHERE EXISTS (
          SELECT 1 FROM projects p JOIN customers c ON c.id = p.customer_id JOIN deliverables d ON d.project_id = p.id
          JOIN assets a ON a.id = d.asset_id
          WHERE p.business_id = s.business_id AND lower(c.email) = ? AND d.deliverable_type = 'SITE_BUILD'
            AND d.status = 'FINAL' AND d.customer_visible = 1 AND json_extract(a.metadata_json, '$.website.slug') = s.slug)
        ORDER BY s.created_at DESC LIMIT 1
      `).bind(SELF_TEST_EMAIL).first()) || null;
  }
  return (await env.DB.prepare(`
      SELECT g.slug, b.name, json_extract(g.data_json, '$.short_name') AS short_name
      FROM guest_apps g JOIN customers c ON c.id = g.customer_id JOIN businesses b ON b.id = g.business_id
      WHERE lower(c.email) = ? ORDER BY g.created_at DESC LIMIT 1
    `).bind(SELF_TEST_EMAIL).first()) || null;
}

async function proxied(request, env, kind, path) {
  const pathname = new URL(request.url).pathname;
  if (!path && !pathname.endsWith("/")) return Response.redirect(new URL(`${pathname}/`, request.url).toString(), 301);
  const live = await sampleSlug(env, kind);
  if (!live) return simplePage(404, "Sample not available", "<p>This sample isn't available right now.</p>");
  const response = kind === "website" ? await handleLiveSite(request, env, live.slug, path) : await handleLiveApp(request, env, live.slug, path);
  const type = response.headers.get("Content-Type") || "";
  if (response.status >= 300 && response.status < 400) {
    // Keep redirects (trailing slash) inside the sample path.
    const location = new URL(response.headers.get("Location"), request.url);
    const base = `/api/samples/${kind}/`;
    if (!location.pathname.startsWith(base)) location.pathname = base + (path ? `${path}/` : "");
    return Response.redirect(location.toString(), response.status);
  }
  if (!/^(text\/|application\/(json|manifest\+json|javascript))/i.test(type)) return response;
  let body = scrub(await response.text(), [live.name, live.short_name && live.short_name !== live.name ? live.short_name : null]);
  if (/^text\/html/i.test(type) && /<body[^>]*>/i.test(body)) {
    body = body.replace(/<body[^>]*>/i, (m) => m + banner(kind === "website" ? "Website Package" : "Guest App"));
  }
  const out = new Headers(response.headers);
  out.set("X-Robots-Tag", "noindex");
  out.set("Cache-Control", "public, max-age=900");
  out.delete("Content-Length");
  return new Response(request.method === "HEAD" ? null : body, { status: response.status, headers: out });
}

async function handleSample(request, env, key, rest) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  try {
    if (key === "website" || key === "app") return await proxied(request, env, key, rest || "");
    if (PAGES[key] && !rest) return await samplePage(env, key);
    return simplePage(404, "Sample not found", "<p>There is no sample here.</p>");
  } catch (error) {
    console.error("sample failed", error?.message);
    return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  }
}

export { handleSample, scrub, SAMPLE_NAME };
