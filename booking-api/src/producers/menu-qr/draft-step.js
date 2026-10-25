import { nowIso } from "../../lib/http.js";
import { sanitizeFilename, sha256Hex } from "../../lib/util.js";
import { extractMenuFromFile, structureMenuText } from "./claude-reader.js";
import { assertMenuRendered, buildDesignedMenuHtml, buildMenuDraftHtml, loadLogoDataUri } from "./design.js";
import { fetchMenuSource, getInputValue, loadPreparedPayload } from "./inputs.js";
import { completeStep, loadProject } from "../../workflows/runner.js";

async function runGenerateMenuDraftStep(targetStep, env) {
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
  const menuSource = getInputValue(
    preparedPayload.inputs,
    "menu_source"
  );
  const menuFile = getInputValue(
    preparedPayload.inputs,
    "menu_file"
  );
  if (!menuSource && !menuFile) {
    throw new Error(
      "A menu link or menu file is required to generate the menu draft"
    );
  }
  const businessName = getInputValue(
    preparedPayload.inputs,
    "business_name"
  ) || project.business_name;
  const brandColors = getInputValue(
    preparedPayload.inputs,
    "brand_colors"
  );
  // An uploaded PDF/photo takes priority: it is what the owner chose to send.
  const source = menuFile ? await extractMenuFromFile(menuFile, env) : await fetchMenuSource(
    menuSource
  );
  if (!source.menu && env.ANTHROPIC_API_KEY) {
    const read = await structureMenuText(source.text, env);
    source.menu = read.menu;
    source.extraction = read.extraction;
  }
  const logoDataUri = await loadLogoDataUri(getInputValue(preparedPayload.inputs, "logo"), env).catch(() => null);
  const draftHtml = source.menu ? buildDesignedMenuHtml({
    businessName,
    brandColors,
    menu: source.menu,
    logoDataUri
  }) : buildMenuDraftHtml({
    businessName,
    brandColors,
    sourceUrl: source.resolved_url,
    menuText: source.text
  });
  if (source.menu) assertMenuRendered(draftHtml, source.menu);
  const encodedDraft = new TextEncoder().encode(
    draftHtml
  );
  const checksum = await sha256Hex(
    encodedDraft
  );
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
            'MENU_DRAFT'
          AND d.version = 1
        LIMIT 1
      `).bind(
    project.id
  ).first();
  if (existingDeliverable) {
    const output2 = {
      generated_at: nowIso(),
      reused_existing: true,
      source: {
        requested_url: source.requested_url,
        resolved_url: source.resolved_url,
        content_type: source.content_type
      },
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
        type: "MENU_DRAFT",
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
  const assetId = crypto.randomUUID();
  const deliverableId = crypto.randomUUID();
  const filenameBase = sanitizeFilename(
    businessName
  );
  const originalFilename = `${filenameBase}-menu-draft-v1.html`;
  const storageKey = [
    "customers",
    project.customer_id,
    "projects",
    project.id,
    "deliverables",
    "menu-draft",
    "v1",
    `${assetId}.html`
  ].join("/");
  const timestamp = nowIso();
  await env.ASSETS.put(
    storageKey,
    encodedDraft,
    {
      httpMetadata: {
        contentType: "text/html; charset=utf-8"
      },
      customMetadata: {
        assetId,
        projectId: project.id,
        orderId: project.order_id,
        customerId: project.customer_id,
        businessId: project.business_id || "",
        deliverableType: "MENU_DRAFT",
        version: "1",
        originalFilename
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
          'text/html',
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
      encodedDraft.byteLength,
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
        source_url: source.resolved_url,
        source_content_type: source.content_type,
        deliverable_type: "MENU_DRAFT",
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
          'MENU_DRAFT',
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
    source: {
      requested_url: source.requested_url,
      resolved_url: source.resolved_url,
      content_type: source.content_type,
      ...source.extraction ? { extraction: source.extraction } : {}
    },
    asset: {
      id: assetId,
      storage_provider: "R2",
      storage_key: storageKey,
      original_filename: originalFilename,
      mime_type: "text/html",
      size_bytes: encodedDraft.byteLength,
      checksum
    },
    deliverable: {
      id: deliverableId,
      type: "MENU_DRAFT",
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
  runGenerateMenuDraftStep
};
