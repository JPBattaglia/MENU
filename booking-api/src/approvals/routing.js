// Stage 4: one place decides whether a finished deliverable ships to the buyer on its own or waits for the
// owner's one-click approval.
//   1. The delivering step's own setting in workflow_definitions.steps_json ("approval": "auto" | "owner")
//   2. else the offer's requires_approval flag (the catalog)
//   3. else owner approval (the safe default)
// A single deliverable can only tighten that decision: an asset whose metadata_json has "approval": "owner"
// waits for the owner even when the step is automatic (e.g. a 1-star review reply). Nothing can loosen it.
import { parseJsonOrNull } from "../lib/http.js";
import { loadWorkflowDefinition } from "../workflows/definitions.js";

async function loadStepConfig(env, workflowKey, workflowVersion, stepKey) {
  try {
    const definition = await loadWorkflowDefinition(workflowKey, workflowVersion || 1, env);
    return definition.steps.find((step) => step.key === stepKey) || null;
  } catch {
    return null;
  }
}

async function resolveRouting(env, { projectId, workflowKey, workflowVersion = 1, stepKey }) {
  const step = await loadStepConfig(env, workflowKey, workflowVersion, stepKey);
  const options = { autoReleaseDays: step?.autoReleaseDays ?? null, regenerateFrom: step?.regenerateFrom ?? null };
  if (step?.approval) {
    return { mode: step.approval === "auto" ? "AUTO" : "OWNER", source: "STEP", ...options };
  }
  const offer = await env.DB.prepare(`
      SELECT o.requires_approval
      FROM projects p
      JOIN order_items i ON i.id = p.order_item_id
      JOIN offers o ON o.id = i.offer_id
      WHERE p.id = ?
      LIMIT 1
    `).bind(projectId).first();
  if (offer) return { mode: Number(offer.requires_approval) === 1 ? "OWNER" : "AUTO", source: "OFFER", ...options };
  return { mode: "OWNER", source: "DEFAULT", ...options };
}

// files: [{ id, approval }] where approval is the per-deliverable flag ("owner" or empty).
function partitionFiles(routing, files) {
  if (routing.mode === "OWNER") return { auto: [], owner: files };
  return {
    auto: files.filter((file) => file.approval !== "owner"),
    owner: files.filter((file) => file.approval === "owner")
  };
}

function itemApprovalFlag(assetMetadataJson) {
  return parseJsonOrNull(assetMetadataJson)?.approval === "owner" ? "owner" : null;
}

export { resolveRouting, partitionFiles, itemApprovalFlag, loadStepConfig };
