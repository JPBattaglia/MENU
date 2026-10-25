import QRCode from "qrcode/lib/browser.js";
import { nowIso } from "../../lib/http.js";
import { sanitizeFilename, sha256Hex } from "../../lib/util.js";
import { getInputValue, loadPreparedPayload } from "./inputs.js";
import { completeStep, loadProject } from "../../workflows/runner.js";

async function runGenerateQrStep(targetStep, env) {
  if (!env.ASSETS) {
    throw new Error(
      "R2 ASSETS binding is not available"
    );
  }
  const preparedPayload = await loadPreparedPayload(
    targetStep,
    env
  );
  const project = await loadProject(
    targetStep.project_id,
    env
  );
  if (!project) {
    throw new Error(
      "Production project could not be loaded"
    );
  }
  const qrDestination = getInputValue(
    preparedPayload.inputs,
    "qr_destination"
  );
  if (!qrDestination) {
    throw new Error(
      "qr_destination is required to generate the QR code"
    );
  }
  let destinationUrl;
  try {
    destinationUrl = new URL(
      qrDestination
    );
  } catch {
    throw new Error(
      "qr_destination is not a valid URL"
    );
  }
  if (destinationUrl.protocol !== "https:" && destinationUrl.protocol !== "http:") {
    throw new Error(
      "qr_destination must use HTTP or HTTPS"
    );
  }
  const existingDeliverable = await env.DB.prepare(`
        SELECT
          d.id AS deliverable_id,
          d.asset_id,
          d.version,
          a.storage_key,
          a.original_filename,
          a.mime_type,
          a.size_bytes,
          a.checksum
        FROM deliverables d
        JOIN assets a
          ON a.id =
            d.asset_id
        WHERE
          d.project_id = ?
          AND d.deliverable_type =
            'QR_CODE'
          AND d.version = 1
        LIMIT 1
      `).bind(
    project.id
  ).first();
  if (existingDeliverable) {
    const output2 = {
      generated_at: nowIso(),
      reused_existing: true,
      destination_url: destinationUrl.toString(),
      asset: {
        id: existingDeliverable.asset_id,
        storage_provider: "R2",
        storage_key: existingDeliverable.storage_key,
        original_filename: existingDeliverable.original_filename,
        mime_type: existingDeliverable.mime_type,
        size_bytes: Number(
          existingDeliverable.size_bytes || 0
        ),
        checksum: existingDeliverable.checksum
      },
      deliverable: {
        id: existingDeliverable.deliverable_id,
        type: "QR_CODE",
        version: Number(
          existingDeliverable.version
        ),
        status: "DRAFT"
      }
    };
    await completeStep(
      targetStep,
      output2,
      env
    );
    return output2;
  }
  const svg = await QRCode.toString(
    destinationUrl.toString(),
    {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 4,
      width: 1024
    }
  );
  const encodedQr = new TextEncoder().encode(svg);
  const checksum = await sha256Hex(
    encodedQr
  );
  const assetId = crypto.randomUUID();
  const deliverableId = crypto.randomUUID();
  const filenameBase = sanitizeFilename(
    project.business_name
  );
  const originalFilename = `${filenameBase}-qr-v1.svg`;
  const storageKey = [
    "customers",
    project.customer_id,
    "projects",
    project.id,
    "deliverables",
    "qr",
    "v1",
    `${assetId}.svg`
  ].join("/");
  const timestamp = nowIso();
  await env.ASSETS.put(
    storageKey,
    encodedQr,
    {
      httpMetadata: {
        contentType: "image/svg+xml"
      },
      customMetadata: {
        assetId,
        projectId: project.id,
        orderId: project.order_id,
        customerId: project.customer_id,
        businessId: project.business_id || "",
        deliverableType: "QR_CODE",
        version: "1",
        originalFilename,
        destinationUrl: destinationUrl.toString()
      }
    }
  );
  let assetInserted = false;
  try {
    await env.DB.prepare(`
        INSERT INTO assets (
          id,
          business_id,
          customer_id,
          project_id,
          asset_type,
          storage_provider,
          storage_key,
          original_filename,
          mime_type,
          size_bytes,
          checksum,
          status,
          uploaded_at,
          validated_at,
          approved_for_use,
          is_customer_supplied,
          rights_confirmed,
          metadata_json
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          'DELIVERABLE',
          'R2',
          ?,
          ?,
          'image/svg+xml',
          ?,
          ?,
          'VALID',
          ?,
          ?,
          1,
          0,
          1,
          ?
        )
      `).bind(
      assetId,
      project.business_id || null,
      project.customer_id,
      project.id,
      storageKey,
      originalFilename,
      encodedQr.byteLength,
      checksum,
      timestamp,
      timestamp,
      JSON.stringify({
        generated_by: "MENU_MADE_AUTOMATION",
        workflow_run_id: targetStep.workflow_run_id,
        workflow_step_id: targetStep.workflow_step_id,
        workflow_key: targetStep.workflow_key,
        workflow_version: Number(
          targetStep.workflow_version
        ),
        destination_url: destinationUrl.toString(),
        deliverable_type: "QR_CODE",
        deliverable_version: 1
      })
    ).run();
    assetInserted = true;
    await env.DB.prepare(`
        INSERT INTO deliverables (
          id,
          project_id,
          asset_id,
          deliverable_type,
          version,
          status,
          customer_visible,
          created_at
        )
        VALUES (
          ?,
          ?,
          ?,
          'QR_CODE',
          1,
          'DRAFT',
          0,
          ?
        )
      `).bind(
      deliverableId,
      project.id,
      assetId,
      timestamp
    ).run();
  } catch (error) {
    if (assetInserted) {
      try {
        await env.DB.prepare(`
            DELETE FROM assets
            WHERE id = ?
          `).bind(assetId).run();
      } catch {
      }
    }
    try {
      await env.ASSETS.delete(
        storageKey
      );
    } catch {
    }
    throw error;
  }
  const output = {
    generated_at: timestamp,
    reused_existing: false,
    destination_url: destinationUrl.toString(),
    asset: {
      id: assetId,
      storage_provider: "R2",
      storage_key: storageKey,
      original_filename: originalFilename,
      mime_type: "image/svg+xml",
      size_bytes: encodedQr.byteLength,
      checksum
    },
    deliverable: {
      id: deliverableId,
      type: "QR_CODE",
      version: 1,
      status: "DRAFT",
      customer_visible: false
    }
  };
  await completeStep(
    targetStep,
    output,
    env
  );
  return output;
}

export {
  runGenerateQrStep
};
