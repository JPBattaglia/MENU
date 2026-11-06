import { publicBaseUrl } from "../lib/config.js";
import { simplePage } from "../lib/http.js";
import { verifyLinkToken } from "../lib/links.js";
import { menuHostingState } from "../producers/menu-qr/hosting-renewal.js";
import { buildPrintMenuPdf } from "../producers/menu-qr/print-pdf.js";
import { parseMenuHtml } from "../producers/menu-care/menu-edit.js";
import QRCode from "qrcode/lib/browser.js";

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

// Finds the live menu page for a hosted slug. Returns { object, row } when it can be shown, or { response } with the
// page to show instead (offline, coming soon, not found).
async function loadHostedMenu(env, slug) {
  const hostedUrl = `${publicBaseUrl(env)}/api/menu/${slug}`;
  const row = await env.DB.prepare(`
      SELECT a.storage_key, p0.business_id
      FROM project_inputs pi
      JOIN projects p0 ON p0.id = pi.project_id
      JOIN projects p ON p.business_id = p0.business_id AND p.workflow_key IN ('MENU_QR_V1', 'MENU_CARE_V1')
      JOIN deliverables d ON d.project_id = p.id
      JOIN assets a ON a.id = d.asset_id
      WHERE pi.input_key = 'qr_destination' AND pi.value_text = ?
        AND d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1
      ORDER BY d.delivered_at DESC, d.version DESC
      LIMIT 1
    `).bind(hostedUrl).first();
  // Without Menu Care the menu goes offline 30 days after its first year (owner decision Oct 28, 2026). Nothing is
  // deleted: adding Menu Care brings it back at this same address.
  if (row?.business_id) {
    const state = await menuHostingState(env, row.business_id).catch(() => ({ live: true }));
    if (!state.live) {
      return { response: simplePage(200, "This menu isn't available right now",
        `<p>This online menu is currently offline. Please ask a member of staff for a menu.</p><p style="font-size:14px">Is this your business? Reply to any email from Menu-Made, or sign in to <a href="${publicBaseUrl(env)}/account.html">your account</a>, to bring your menu back with Menu Care at this same address and QR code.</p>`) };
    }
  }
  const object = row ? await env.ASSETS.get(row.storage_key) : null;
  if (!object) {
    const known = await env.DB.prepare(`SELECT 1 AS found FROM project_inputs WHERE input_key = 'qr_destination' AND value_text = ? LIMIT 1`).bind(hostedUrl).first();
    return {
      response: known
        ? simplePage(200, "Menu coming soon", "<p>This menu is being prepared. Please check back shortly.</p>")
        : simplePage(404, "Menu not found", "<p>This menu link isn't active.</p>")
    };
  }
  return { object, row, hostedUrl };
}

// Public menu page that each QR code opens. Shows the approved menu only; before approval, a holding page.
async function handleHostedMenu(request, env, slug) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const found = await loadHostedMenu(env, slug);
  if (found.response) return found.response;
  return new Response(found.object.body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:"
    }
  });
}

// Print-ready PDF of the same live menu, with a QR code back to it (owner, Nov 5, 2026: part of Online Menu + QR).
// Built from the current menu page, so Menu Care updates reach it too. Each version is drawn once and kept in R2
// next to the page it was made from.
async function handleHostedMenuPdf(request, env, slug) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const found = await loadHostedMenu(env, slug);
  if (found.response) return found.response;
  const pdfHeaders = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${slug}-menu.pdf"`,
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff"
  };
  const cacheKey = `${found.row.storage_key}.print-v1.pdf`;
  const cached = await env.ASSETS.get(cacheKey);
  if (cached) return new Response(cached.body, { status: 200, headers: pdfHeaders });
  let parsed;
  try {
    parsed = parseMenuHtml(await found.object.text());
  } catch {
    parsed = null;
  }
  const qrModules = parsed ? QRCode.create(found.hostedUrl, { errorCorrectionLevel: "M" }).modules : null;
  const bytes = parsed ? await buildPrintMenuPdf({ ...parsed, qrModules, qrUrl: found.hostedUrl }) : null;
  if (!bytes) {
    return simplePage(200, "Print version not available",
      `<p>This menu can't be turned into a print PDF automatically. <a href="${found.hostedUrl}">Open the online menu</a>, or reply to any email from Menu-Made and we'll make the print version for you.</p>`);
  }
  await env.ASSETS.put(cacheKey, bytes, { httpMetadata: { contentType: "application/pdf" } }).catch(() => {});
  return new Response(bytes, { status: 200, headers: pdfHeaders });
}

export {
  handleDeliveryDownload,
  handleHostedMenu,
  handleHostedMenuPdf
};
