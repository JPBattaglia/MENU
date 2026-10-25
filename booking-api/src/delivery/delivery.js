import { publicBaseUrl } from "../lib/config.js";
import { simplePage } from "../lib/http.js";
import { verifyLinkToken } from "../lib/links.js";

async function handleDeliveryDownload(request, env, deliverableId) {
  const url = new URL(request.url);
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your delivery email and we'll send fresh links.</p>");
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const payload = await verifyLinkToken(env, url.searchParams.get("t"), ["deliver", "preview"], deliverableId);
  if (!payload || payload.expired) return denied();
  const row = await env.DB.prepare(`
      SELECT d.id, d.status, d.customer_visible, a.storage_key, a.mime_type, a.original_filename
      FROM deliverables d JOIN assets a ON a.id = d.asset_id
      WHERE d.id = ? LIMIT 1
    `).bind(deliverableId).first();
  if (!row) return simplePage(404, "File not found", "<p>This file is no longer available.</p>");
  if (payload.k === "deliver" && !(row.status === "FINAL" && Number(row.customer_visible) === 1)) {
    return simplePage(404, "File not found", "<p>This file is no longer available.</p>");
  }
  const object = await env.ASSETS.get(row.storage_key);
  if (!object) return simplePage(404, "File not found", "<p>This file is no longer available.</p>");
  const filename = String(row.original_filename || "download").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);
  const mime = String(row.mime_type || "application/octet-stream");
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": mime === "text/html" ? "text/html; charset=utf-8" : mime,
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:"
    }
  });
}

// Public menu page that each QR code opens. Shows the approved menu only; before approval, a holding page.
async function handleHostedMenu(request, env, slug) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const hostedUrl = `${publicBaseUrl(env)}/api/menu/${slug}`;
  const row = await env.DB.prepare(`
      SELECT a.storage_key
      FROM project_inputs pi
      JOIN deliverables d ON d.project_id = pi.project_id
      JOIN assets a ON a.id = d.asset_id
      WHERE pi.input_key = 'qr_destination' AND pi.value_text = ?
        AND d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1
      ORDER BY d.version DESC, d.delivered_at DESC
      LIMIT 1
    `).bind(hostedUrl).first();
  const object = row ? await env.ASSETS.get(row.storage_key) : null;
  if (!object) {
    const known = await env.DB.prepare(`SELECT 1 AS found FROM project_inputs WHERE input_key = 'qr_destination' AND value_text = ? LIMIT 1`).bind(hostedUrl).first();
    return known
      ? simplePage(200, "Menu coming soon", "<p>This menu is being prepared. Please check back shortly.</p>")
      : simplePage(404, "Menu not found", "<p>This menu link isn't active.</p>");
  }
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:"
    }
  });
}

export {
  handleDeliveryDownload,
  handleHostedMenu
};
