import { publicBaseUrl } from "../lib/config.js";
import { parseJsonOrNull, simplePage } from "../lib/http.js";
import { escapeHtml2 } from "../lib/util.js";
import { OCCASION_NAMES, holidayEnded } from "../checkout/holiday.js";
import { verifyLinkToken } from "../lib/links.js";
import { menuHostingState } from "../producers/menu-qr/hosting-renewal.js";
import { buildPrintMenuPdf, buildTableTentPdf, buildTriFoldPdf } from "../producers/menu-qr/print-pdf.js";
import { buildTvMenuHtml, qrModulesToSvg } from "../producers/menu-qr/tv-menu.js";
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
async function loadHostedMenu(env, slug, { now = Date.now() } = {}) {
  const hostedUrl = `${publicBaseUrl(env)}/api/menu/${slug}`;
  // The project this address belongs to. A Holiday Menu (checkout/holiday.js) shows only its own approved page and
  // ends after its holiday; a regular menu shows the business's newest approved regular menu (Menu Care updates
  // included) and never a holiday one.
  const owner = await env.DB.prepare(`
      SELECT p0.id, p0.business_id, p0.metadata_json, b.name AS business_name, b.website_url
      FROM project_inputs pi JOIN projects p0 ON p0.id = pi.project_id LEFT JOIN businesses b ON b.id = p0.business_id
      WHERE pi.input_key = 'qr_destination' AND pi.value_text = ?
      ORDER BY p0.created_at DESC LIMIT 1
    `).bind(hostedUrl).first();
  const holiday = parseJsonOrNull(owner?.metadata_json)?.holiday_menu || null;
  if (holiday && holidayEnded(holiday.ends_on, now)) return { response: await holidayEndedPage(env, owner, holiday) };
  const row = await env.DB.prepare(`
      SELECT a.storage_key, p0.business_id
      FROM project_inputs pi
      JOIN projects p0 ON p0.id = pi.project_id
      JOIN projects p ON p.business_id = p0.business_id AND p.workflow_key IN ('MENU_QR_V1', 'MENU_CARE_V1')
      JOIN deliverables d ON d.project_id = p.id
      JOIN assets a ON a.id = d.asset_id
      WHERE pi.input_key = 'qr_destination' AND pi.value_text = ?
        AND d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1
        AND (p.id = p0.id OR (json_extract(COALESCE(p0.metadata_json, '{}'), '$.holiday_menu') IS NULL
          AND json_extract(COALESCE(p.metadata_json, '{}'), '$.holiday_menu') IS NULL))
      ORDER BY d.delivered_at DESC, d.version DESC
      LIMIT 1
    `).bind(hostedUrl).first();
  // Without Menu Care the menu goes offline 30 days after its first year (owner decision Oct 28, 2026). Nothing is
  // deleted: adding Menu Care brings it back at this same address. Holiday Menus have no hosting year.
  if (row?.business_id && !holiday) {
    const state = await menuHostingState(env, row.business_id).catch(() => ({ live: true }));
    if (!state.live) {
      return { response: simplePage(200, "This menu isn't available right now",
        `<p>This online menu is currently offline. Please ask a member of staff for a menu.</p><p style="font-size:14px">Is this your business? Reply to any email from Menu-Made, or sign in to <a href="${publicBaseUrl(env)}/account.html">your account</a>, to bring your menu back with Menu Care at this same address and QR code.</p>`) };
    }
  }
  const object = row ? await env.ASSETS.get(row.storage_key) : null;
  if (!object) {
    return {
      response: owner
        ? simplePage(200, "Menu coming soon", "<p>This menu is being prepared. Please check back shortly.</p>")
        : simplePage(404, "Menu not found", "<p>This menu link isn't active.</p>")
    };
  }
  return { object, row, hostedUrl };
}

// After its holiday a Holiday Menu's address (and QR code) says so, and points to the business's regular menu with
// us if it has one, otherwise to its website.
async function holidayEndedPage(env, owner, holiday) {
  const regular = await env.DB.prepare(`
      SELECT pi.value_text FROM project_inputs pi JOIN projects p ON p.id = pi.project_id
      WHERE p.business_id = ? AND p.workflow_key = 'MENU_QR_V1' AND pi.input_key = 'qr_destination'
        AND json_extract(COALESCE(p.metadata_json, '{}'), '$.holiday_menu') IS NULL
        AND EXISTS (SELECT 1 FROM deliverables d WHERE d.project_id = p.id AND d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1)
      ORDER BY p.created_at DESC LIMIT 1
    `).bind(owner.business_id).first().catch(() => null);
  const website = /^https?:\/\//i.test(String(owner.website_url || "")) ? owner.website_url : null;
  const link = regular?.value_text || website;
  const name = escapeHtml2(owner.business_name || "This business");
  const what = OCCASION_NAMES[holiday.occasion] || "holiday";
  return simplePage(200, `The ${what} menu has ended`,
    `<p>${name}'s ${escapeHtml2(what)} menu has ended. Thank you for celebrating with us.</p>${link ? `<p><a href="${escapeHtml2(link)}">${regular ? "See our menu" : "Visit our website"}</a></p>` : "<p>Please ask a member of staff for today's menu.</p>"}`);
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

// Print-ready PDFs of the same live menu, each with a QR code back to it (owner, Nov 5, 2026: part of Online
// Menu + QR): print.pdf (letter), tri-fold.pdf and table-tent.pdf. Built from the current menu page, so Menu Care
// updates reach them too. Each version is drawn once and kept in R2 next to the page it was made from.
const PRINT_FORMATS = {
  "print.pdf": { build: buildPrintMenuPdf, cache: "print-v3", file: "menu", what: "print PDF" },
  "tri-fold.pdf": { build: buildTriFoldPdf, cache: "tri-fold-v2", file: "tri-fold-menu", what: "tri-fold", tooLong: true },
  "table-tent.pdf": { build: buildTableTentPdf, cache: "table-tent-v2", file: "table-tent", what: "table tent" }
};

async function parseHosted(found) {
  try {
    return parseMenuHtml(await found.object.text());
  } catch {
    return null;
  }
}

async function handleHostedMenuPdf(request, env, slug, format = "print.pdf") {
  const spec = PRINT_FORMATS[format];
  if (!spec) return simplePage(404, "Not found", "<p>This page doesn't exist.</p>");
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const found = await loadHostedMenu(env, slug);
  if (found.response) return found.response;
  const pdfHeaders = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${slug}-${spec.file}.pdf"`,
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff"
  };
  const cacheKey = `${found.row.storage_key}.${spec.cache}.pdf`;
  const cached = await env.ASSETS.get(cacheKey);
  if (cached) return new Response(cached.body, { status: 200, headers: pdfHeaders });
  const parsed = await parseHosted(found);
  const qrModules = parsed ? QRCode.create(found.hostedUrl, { errorCorrectionLevel: "M" }).modules : null;
  const bytes = parsed ? await spec.build({ ...parsed, qrModules, qrUrl: found.hostedUrl }) : null;
  if (!bytes) {
    const reason = spec.tooLong
      ? `This menu is too long to fit a tri-fold at a readable size. <a href="${found.hostedUrl}/print.pdf">The print PDF</a> fits any length.`
      : `This menu can't be turned into a ${spec.what} automatically. <a href="${found.hostedUrl}">Open the online menu</a>, or reply to any email from Menu-Made and we'll make it for you.`;
    return simplePage(200, "Print version not available", `<p>${reason}</p>`);
  }
  await env.ASSETS.put(cacheKey, bytes, { httpMetadata: { contentType: "application/pdf" } }).catch(() => {});
  return new Response(bytes, { status: 200, headers: pdfHeaders });
}

// The same four formats before the menu is live (owner, Nov 12, 2026: "I need to preview and approve ALL items"):
// built from the newest menu draft waiting for approval, with the QR code the live menu will have. Reached only
// from the owner's signed approval link (approvals.js); never cached, so a redone draft shows at once.
async function handleDraftFormat(request, env, projectId, format) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const draft = await env.DB.prepare(`
      SELECT a.storage_key FROM deliverables d JOIN assets a ON a.id = d.asset_id
      WHERE d.project_id = ? AND d.deliverable_type = 'MENU_DRAFT' AND d.status != 'SUPERSEDED' ORDER BY d.version DESC LIMIT 1`).bind(projectId).first();
  const object = draft?.storage_key ? await env.ASSETS.get(draft.storage_key) : null;
  if (!object) return simplePage(404, "No draft to show", "<p>This order has no menu draft waiting. Open your newest approval email.</p>");
  const destination = (await env.DB.prepare(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = 'qr_destination' LIMIT 1`).bind(projectId).first())?.value_text;
  const qrUrl = typeof destination === "string" && /^https?:\/\//.test(destination) ? destination : "https://menu-made.com";
  let parsed = null;
  try { parsed = parseMenuHtml(await object.text()); } catch { parsed = null; }
  const cant = (what) => simplePage(200, "Not available for this menu", `<p>This menu can't be turned into a ${what} automatically, so the buyer will not get one. The online menu and QR code are not affected.</p>`);
  if (format === "tv") {
    if (!parsed) return cant("TV screen");
    const page = Number(new URL(request.url).searchParams.get("p")) || 1;
    const screen = buildTvMenuHtml({ ...parsed, qrSvg: qrModulesToSvg(QRCode.create(qrUrl, { errorCorrectionLevel: "M" }).modules), page });
    return new Response(screen.html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
  }
  const spec = PRINT_FORMATS[format];
  if (!spec) return simplePage(404, "Not found", "<p>This page doesn't exist.</p>");
  const bytes = parsed ? await spec.build({ ...parsed, qrModules: QRCode.create(qrUrl, { errorCorrectionLevel: "M" }).modules, qrUrl }) : null;
  if (!bytes) return spec.tooLong
    ? simplePage(200, "Too long for a tri-fold", "<p>This menu is too long to fit a tri-fold at a readable size, so the buyer will be pointed to the print PDF instead, which fits any length.</p>")
    : cant(spec.what);
  return new Response(bytes, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="draft-${spec.file}.pdf"`, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
}

// Menu screen for a TV running a browser. Long menus rotate through screens with a Refresh header (no scripts);
// a single screen reloads every 5 minutes so Menu Care changes appear by themselves.
async function handleHostedMenuTv(request, env, slug) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const found = await loadHostedMenu(env, slug);
  if (found.response) return found.response;
  const parsed = await parseHosted(found);
  if (!parsed) {
    return simplePage(200, "Menu screen not available", `<p>This menu can't be shown as a TV screen automatically. <a href="${found.hostedUrl}">Open the online menu</a>.</p>`);
  }
  const page = Number(new URL(request.url).searchParams.get("p")) || 1;
  const qrSvg = qrModulesToSvg(QRCode.create(found.hostedUrl, { errorCorrectionLevel: "M" }).modules);
  const screen = buildTvMenuHtml({ ...parsed, qrSvg, page });
  const tvUrl = `${found.hostedUrl}/tv`;
  const refresh = screen.pages > 1 ? `12; url=${tvUrl}?p=${screen.page % screen.pages + 1}` : `300; url=${tvUrl}`;
  return new Response(screen.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Refresh": refresh,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

export { handleDraftFormat,
  handleDeliveryDownload,
  handleHostedMenu,
  handleHostedMenuPdf,
  handleHostedMenuTv
};
