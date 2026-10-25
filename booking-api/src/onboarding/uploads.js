import { bytesToHex, extensionForMime, jsonResponse, nowIso, safeFilename } from "../lib/http.js";
import { refreshOnboardingState, verifyCheckoutAccess } from "./onboarding.js";

async function uploadOnboardingAsset(request, env) {
  try {
    if (!env.DB) {
      return jsonResponse(
        {
          ok: false,
          error: "D1 binding DB is not available"
        },
        500
      );
    }
    if (!env.ASSETS) {
      return jsonResponse(
        {
          ok: false,
          error: "R2 ASSETS binding is not available"
        },
        500
      );
    }
    const contentType = request.headers.get(
      "Content-Type"
    ) || "";
    if (!contentType.toLowerCase().includes(
      "multipart/form-data"
    )) {
      return jsonResponse(
        {
          ok: false,
          error: "Upload must use multipart/form-data"
        },
        400
      );
    }
    const form = await request.formData();
    const orderId = String(
      form.get("order_id") || ""
    ).trim();
    const sessionId = String(
      form.get("session_id") || ""
    ).trim();
    const inputKey = String(
      form.get("input_key") || "logo"
    ).trim();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return jsonResponse(
        {
          ok: false,
          error: "A file is required"
        },
        400
      );
    }
    const access = await verifyCheckoutAccess(
      orderId,
      sessionId,
      env
    );
    if (!access.ok) {
      return jsonResponse(
        {
          ok: false,
          error: access.error
        },
        access.status
      );
    }
    const project = await env.DB.prepare(`
          SELECT
            id,
            customer_id,
            business_id,
            workflow_key
          FROM projects
          WHERE order_id = ?
          ORDER BY
            created_at ASC
          LIMIT 1
        `).bind(orderId).first();
    if (!project) {
      return jsonResponse(
        {
          ok: false,
          error: "No onboarding project exists for this order"
        },
        404
      );
    }
    const input = await env.DB.prepare(`
          SELECT
            id,
            input_key,
            input_type,
            asset_id,
            required,
            status
          FROM project_inputs
          WHERE project_id = ?
            AND input_key = ?
          LIMIT 1
        `).bind(
      project.id,
      inputKey
    ).first();
    if (!input) {
      return jsonResponse(
        {
          ok: false,
          error: "Onboarding file field not found"
        },
        404
      );
    }
    if (input.input_type !== "FILE") {
      return jsonResponse(
        {
          ok: false,
          error: "This onboarding field is not a file field"
        },
        400
      );
    }
    const uploadRules = {
      logo: { assetType: "LOGO", label: "Logo", maxMb: 10, types: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"], typeText: "PNG, JPEG, WebP, or SVG" },
      menu_file: { assetType: "MENU_SOURCE", label: "Menu file", maxMb: 20, types: ["application/pdf", "image/png", "image/jpeg", "image/webp"], typeText: "PDF, PNG, JPEG, or WebP" }
    };
    const rule = uploadRules[input.input_key];
    if (!rule) {
      return jsonResponse(
        {
          ok: false,
          error: "Unsupported upload field"
        },
        400
      );
    }
    const mimeType = String(
      file.type || ""
    ).toLowerCase();
    if (!rule.types.includes(
      mimeType
    )) {
      return jsonResponse(
        {
          ok: false,
          error: `${rule.label} must be ${rule.typeText}`
        },
        400
      );
    }
    if (mimeType === "application/pdf") {
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (String.fromCharCode(...head) !== "%PDF-") {
        return jsonResponse({ ok: false, error: "Menu file is not a valid PDF" }, 400);
      }
    }
    const maxBytes = rule.maxMb * 1024 * 1024;
    if (Number(file.size) <= 0) {
      return jsonResponse(
        {
          ok: false,
          error: "Uploaded file is empty"
        },
        400
      );
    }
    if (Number(file.size) > maxBytes) {
      return jsonResponse(
        {
          ok: false,
          error: `${rule.label} must be ${rule.maxMb} MB or smaller`
        },
        413
      );
    }
    const arrayBuffer = await file.arrayBuffer();
    const checksumBuffer = await crypto.subtle.digest(
      "SHA-256",
      arrayBuffer
    );
    const checksum = bytesToHex(
      new Uint8Array(
        checksumBuffer
      )
    );
    const assetId = crypto.randomUUID();
    const extension = extensionForMime(
      mimeType
    );
    const originalFilename = safeFilename(
      file.name || `logo.${extension}`
    );
    const storageKey = [
      "customers",
      project.customer_id,
      "projects",
      project.id,
      "logo",
      `${assetId}.${extension}`
    ].join("/");
    const timestamp = nowIso();
    await env.ASSETS.put(
      storageKey,
      arrayBuffer,
      {
        httpMetadata: {
          contentType: mimeType
        },
        customMetadata: {
          assetId,
          projectId: project.id,
          orderId,
          customerId: project.customer_id,
          businessId: project.business_id || "",
          inputKey: input.input_key,
          originalFilename
        }
      }
    );
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
            ?,
            'R2',
            ?,
            ?,
            ?,
            ?,
            ?,
            'VALID',
            ?,
            ?,
            1,
            1,
            1,
            ?
          )
        `).bind(
        assetId,
        project.business_id || null,
        project.customer_id,
        project.id,
        rule.assetType,
        storageKey,
        originalFilename,
        mimeType,
        Number(file.size),
        checksum,
        timestamp,
        timestamp,
        JSON.stringify({
          input_key: input.input_key,
          environment: access.environment
        })
      ).run();
      await env.DB.prepare(`
          UPDATE project_inputs
          SET
            asset_id = ?,
            value_text = NULL,
            status = 'VALID',
            validation_message = NULL,
            submitted_at = ?,
            validated_at = ?,
            updated_at = ?
          WHERE id = ?
        `).bind(
        assetId,
        timestamp,
        timestamp,
        timestamp,
        input.id
      ).run();
    } catch (dbError) {
      await env.ASSETS.delete(
        storageKey
      );
      throw dbError;
    }
    if (input.asset_id && input.asset_id !== assetId) {
      const oldAsset = await env.DB.prepare(`
            SELECT
              id,
              storage_key
            FROM assets
            WHERE id = ?
            LIMIT 1
          `).bind(
        input.asset_id
      ).first();
      if (oldAsset) {
        await env.DB.prepare(`
            UPDATE assets
            SET
              status = 'ARCHIVED',
              approved_for_use = 0
            WHERE id = ?
          `).bind(
          oldAsset.id
        ).run();
        if (oldAsset.storage_key) {
          await env.ASSETS.delete(
            oldAsset.storage_key
          );
        }
      }
    }
    const remaining = await refreshOnboardingState(
      project.id,
      orderId,
      project.customer_id,
      project.workflow_key,
      env
    );
    return jsonResponse({
      ok: true,
      environment: access.environment,
      project_id: project.id,
      input_key: input.input_key,
      asset: {
        id: assetId,
        asset_type: "LOGO",
        original_filename: originalFilename,
        mime_type: mimeType,
        size_bytes: Number(file.size),
        checksum,
        status: "VALID"
      },
      onboarding_complete: remaining.length === 0,
      remaining_required: remaining.map(
        (item) => ({
          key: item.input_key,
          type: item.input_type,
          status: item.status
        })
      )
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

export {
  uploadOnboardingAsset
};
