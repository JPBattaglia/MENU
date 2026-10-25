import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { sha256Hex } from "../../lib/util.js";
import { getInputValue, loadPreparedPayload } from "./inputs.js";
import { completeStep } from "../../workflows/runner.js";

async function runQualityCheckStep(targetStep, env) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const prepared = await loadPreparedPayload(targetStep, env);
  const checks = [];
  for (const [stepKey, type, mime] of [
    ["GENERATE_MENU_DRAFT", "MENU_DRAFT", "text/html"],
    ["GENERATE_QR", "QR_CODE", "image/svg+xml"]
  ]) {
    const previous = await env.DB.prepare(`SELECT output_json FROM workflow_steps
      WHERE workflow_run_id = ? AND step_key = ? AND status = 'SUCCEEDED'
      ORDER BY step_order ASC LIMIT 1`).bind(targetStep.workflow_run_id, stepKey).first();
    const output = parseJsonOrNull(previous?.output_json);
    if (!output?.asset?.id) throw new Error(`QC: missing successful ${stepKey} output`);
    const asset = await env.DB.prepare(`SELECT a.id, a.storage_key, a.mime_type,
      a.size_bytes, a.checksum, a.status, d.customer_visible, d.status AS deliverable_status
      FROM deliverables d JOIN assets a ON a.id = d.asset_id
      WHERE d.project_id = ? AND d.deliverable_type = ? AND d.asset_id = ?
      AND a.project_id = ? LIMIT 1`).bind(targetStep.project_id, type, output.asset.id, targetStep.project_id).first();
    if (!asset || asset.status !== 'VALID' || asset.mime_type !== mime)
      throw new Error(`QC: invalid ${type} asset record`);
    if (asset.deliverable_status !== 'DRAFT' || Number(asset.customer_visible) !== 0)
      throw new Error(`QC: ${type} must remain a private draft`);
    if (asset.storage_key !== output.asset.storage_key || asset.checksum !== output.asset.checksum)
      throw new Error(`QC: ${type} output does not match persisted asset`);
    const object = await env.ASSETS.get(asset.storage_key);
    if (!object) throw new Error(`QC: ${type} object is missing from R2`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength !== Number(asset.size_bytes) || await sha256Hex(bytes) !== asset.checksum)
      throw new Error(`QC: ${type} content integrity failed`);
    const text = new TextDecoder().decode(bytes);
    if (type === 'MENU_DRAFT') {
      if (!/<html\b/i.test(text) || !/<section\b[^>]*class="menu-content"[^>]*>\s*\S/i.test(text) || /<script\b/i.test(text))
        throw new Error('QC: menu draft structure or content failed');
    } else {
      if (!/<svg\b/i.test(text) || !/<path\b/i.test(text) || /<script\b|<foreignObject\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=/i.test(text))
        throw new Error('QC: QR SVG structure failed');
      const expected = getInputValue(prepared.inputs, 'qr_destination');
      if (!expected || new URL(expected).toString() !== output.destination_url)
        throw new Error('QC: QR destination does not match prepared input');
    }
    checks.push({type, asset_id: asset.id, integrity: 'PASS', structure: 'PASS'});
  }
  const output = {checked_at: nowIso(), result: 'PASS', checks,
    scope: 'Stored file integrity, draft structure and QR destination metadata; excludes semantic menu review and QR scan verification',
    customer_visible: false};
  await completeStep(targetStep, output, env);
  return output;
}

export {
  runQualityCheckStep
};
