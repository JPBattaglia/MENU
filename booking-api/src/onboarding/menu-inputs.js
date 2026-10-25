import { PUBLIC_BASE_URL } from "../lib/config.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";

function hostedMenuSlug(projectId, businessName) {
  const base = String(businessName || "menu").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "menu";
  return `${base}-${String(projectId).replace(/-/g, "").slice(0, 8)}`;
}

function hostedMenuUrl(projectId, businessName) {
  return `${PUBLIC_BASE_URL}/api/menu/${hostedMenuSlug(projectId, businessName)}`;
}

async function attachCheckoutMenuDocument(projectId, orderId, env) {
  const order = await env.DB.prepare(`SELECT notes FROM orders WHERE id = ?`).bind(orderId).first();
  const reference = /Document ref: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(order?.notes || "")?.[1];
  if (!reference) return false;
  const request = await env.DB.prepare(`SELECT payload FROM mm_booking_requests WHERE id = ?`).bind(reference.toLowerCase()).first();
  const document = parseJsonOrNull(request?.payload)?.document;
  const mime = String(document?.contentType || "").toLowerCase();
  if (!document?.storageKey || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(mime)) return false;
  const project = await env.DB.prepare(`SELECT business_id, customer_id FROM projects WHERE id = ?`).bind(projectId).first();
  const timestamp = nowIso();
  await env.DB.prepare(`
      INSERT OR IGNORE INTO assets (
        id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key,
        original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at,
        approved_for_use, is_customer_supplied, rights_confirmed, metadata_json
      )
      VALUES (?, ?, ?, ?, 'MENU_SOURCE', 'R2', ?, ?, ?, ?, ?, 'VALID', ?, ?, 1, 1, 1, ?)
    `).bind(
    crypto.randomUUID(),
    project?.business_id || null,
    project?.customer_id || null,
    projectId,
    document.storageKey,
    String(document.name || "menu").slice(0, 200),
    mime,
    Number(document.size || 0),
    document.checksum || null,
    timestamp,
    timestamp,
    JSON.stringify({ source: "checkout_upload", inquiry_request_id: reference })
  ).run();
  const asset = await env.DB.prepare(`SELECT id FROM assets WHERE storage_provider = 'R2' AND storage_key = ?`).bind(document.storageKey).first();
  if (!asset) return false;
  const updated = await env.DB.prepare(`
      UPDATE project_inputs
      SET asset_id = ?, status = 'VALID', validation_message = NULL, submitted_at = ?, validated_at = ?, updated_at = ?
      WHERE project_id = ? AND input_key = 'menu_file' AND status != 'VALID'
    `).bind(asset.id, timestamp, timestamp, timestamp, projectId).run();
  return Number(updated.meta?.changes || 0) > 0;
}

async function createMenuQrInputs(projectId, order, timestamp, env) {
  const business = await env.DB.prepare(`
        SELECT name
        FROM businesses
        WHERE id = ?
        LIMIT 1
      `).bind(
    order.business_id
  ).first();
  const customer = await env.DB.prepare(`
        SELECT email
        FROM customers
        WHERE id = ?
        LIMIT 1
      `).bind(
    order.customer_id
  ).first();
  const onboardingInputs = [
    {
      key: "business_name",
      type: "TEXT",
      required: 1,
      value: business?.name || null,
      status: business?.name ? "VALID" : "MISSING"
    },
    {
      // A menu link OR an uploaded menu file (PDF/photo) is required; see menuSourceMissing().
      key: "menu_source",
      type: "URL",
      required: 0,
      value: null,
      status: "MISSING"
    },
    {
      key: "menu_file",
      type: "FILE",
      required: 0,
      value: null,
      status: "MISSING"
    },
    {
      key: "logo",
      type: "FILE",
      required: 0,
      value: null,
      status: "MISSING"
    },
    {
      key: "brand_colors",
      type: "TEXT",
      required: 0,
      value: null,
      status: "MISSING"
    },
    {
      // Defaults to the menu page Menu-Made hosts for this project; the buyer may override it.
      key: "qr_destination",
      type: "URL",
      required: 1,
      value: hostedMenuUrl(projectId, business?.name),
      status: "VALID"
    },
    {
      key: "contact_email",
      type: "TEXT",
      required: 1,
      value: customer?.email || null,
      status: customer?.email ? "VALID" : "MISSING"
    },
  ];
  for (const input of onboardingInputs) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO project_inputs (
          id,
          project_id,
          input_key,
          input_type,
          value_text,
          required,
          status,
          submitted_at,
          validated_at,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      projectId,
      input.key,
      input.type,
      input.value,
      input.required,
      input.status,
      input.status === "VALID" ? timestamp : null,
      input.status === "VALID" ? timestamp : null,
      timestamp,
      timestamp
    ).run();
  }
}

export {
  hostedMenuSlug,
  hostedMenuUrl,
  attachCheckoutMenuDocument,
  createMenuQrInputs
};
