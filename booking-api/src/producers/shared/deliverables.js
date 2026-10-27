// Stores one produced file as an asset + deliverable on a project (used by the stage 6 producers).
// The deliverable starts as DRAFT and invisible to the buyer; the shared DELIVER step releases it after approval.
import { nowIso } from "../../lib/http.js";
import { sha256Hex } from "../../lib/util.js";

async function nextVersion(env, projectId, type) {
  const row = await env.DB.prepare(`SELECT MAX(version) AS v FROM deliverables WHERE project_id = ? AND deliverable_type = ?`).bind(projectId, type).first();
  return Number(row?.v || 0) + 1;
}

async function storeDeliverable(env, context, { type, filename, mime, bytes, folder, metadata = {} }) {
  const version = await nextVersion(env, context.id, type);
  const assetId = crypto.randomUUID();
  const deliverableId = crypto.randomUUID();
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  const storageKey = ["customers", context.customer_id, "projects", context.id, "deliverables", folder, `v${version}`, `${assetId}${ext}`].join("/");
  const checksum = await sha256Hex(bytes);
  const t = nowIso();
  await env.ASSETS.put(storageKey, bytes, { httpMetadata: { contentType: mime } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type,
        size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, ?, ?, ?, ?, 'VALID', ?, ?, 1, 0, 1, ?)
    `).bind(assetId, context.business_id || null, context.customer_id, context.id, storageKey, filename, mime, bytes.byteLength, checksum, t, t,
    JSON.stringify({ generated_by: "MENU_MADE_AUTOMATION", ...metadata })).run();
  await env.DB.prepare(`
      INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, created_at)
      VALUES (?, ?, ?, ?, ?, 'DRAFT', 0, ?)
    `).bind(deliverableId, context.id, assetId, type, version, t).run();
  return { assetId, deliverableId, version, storageKey };
}

export { storeDeliverable };
