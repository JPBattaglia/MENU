import { nowIso } from "../lib/http.js";

async function loadWorkflowDefinition(workflowKey, workflowVersion, env) {
  if (!env.DB) {
    throw new Error(
      "D1 binding DB is not available"
    );
  }
  const cleanWorkflowKey = String(
    workflowKey || ""
  ).trim();
  const cleanWorkflowVersion = Number(
    workflowVersion
  );
  if (!cleanWorkflowKey) {
    throw new Error(
      "Workflow key is required"
    );
  }
  if (!Number.isInteger(
    cleanWorkflowVersion
  ) || cleanWorkflowVersion <= 0) {
    throw new Error(
      "Workflow version must be a positive integer"
    );
  }
  const definition = await env.DB.prepare(`
        SELECT
          id,
          workflow_key,
          version,
          status,
          steps_json
        FROM workflow_definitions
        WHERE
          workflow_key = ?
          AND version = ?
          AND status = 'ACTIVE'
        LIMIT 1
      `).bind(
    cleanWorkflowKey,
    cleanWorkflowVersion
  ).first();
  if (!definition) {
    throw new Error(
      `Active workflow definition not found for ${cleanWorkflowKey} v${cleanWorkflowVersion}`
    );
  }
  let parsedSteps;
  try {
    parsedSteps = JSON.parse(
      definition.steps_json
    );
  } catch {
    throw new Error(
      `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains invalid steps_json`
    );
  }
  if (!Array.isArray(
    parsedSteps
  ) || parsedSteps.length === 0) {
    throw new Error(
      `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} has no configured steps`
    );
  }
  const seenKeys = /* @__PURE__ */ new Set();
  const seenOrders = /* @__PURE__ */ new Set();
  const steps = parsedSteps.map(
    (step, index) => {
      const key = String(
        step?.key || ""
      ).trim();
      const order = Number(
        step?.order
      );
      if (!key) {
        throw new Error(
          `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains a step with no key at index ${index}`
        );
      }
      if (!Number.isInteger(order) || order < 0) {
        throw new Error(
          `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains an invalid step order for ${key}`
        );
      }
      if (seenKeys.has(key)) {
        throw new Error(
          `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains duplicate step key ${key}`
        );
      }
      if (seenOrders.has(order)) {
        throw new Error(
          `Workflow definition ${cleanWorkflowKey} v${cleanWorkflowVersion} contains duplicate step order ${order}`
        );
      }
      seenKeys.add(key);
      seenOrders.add(order);
      return {
        key,
        order
      };
    }
  );
  steps.sort(
    (a, b) => a.order - b.order
  );
  return {
    id: definition.id,
    workflowKey: definition.workflow_key,
    workflowVersion: Number(
      definition.version
    ),
    steps
  };
}

async function ensureProductionWorkflow(projectId, workflowKey, workflowVersion, customerId, orderId, env) {
  const definition = await loadWorkflowDefinition(
    workflowKey,
    workflowVersion,
    env
  );
  const existingRun = await env.DB.prepare(`
        SELECT
          id,
          status
        FROM workflow_runs
        WHERE project_id = ?
          AND workflow_key = ?
          AND workflow_version = ?
          AND trigger_type =
            'PROJECT_READY'
          AND trigger_reference = ?
        LIMIT 1
      `).bind(
    projectId,
    definition.workflowKey,
    definition.workflowVersion,
    projectId
  ).first();
  let workflowRunId = existingRun?.id || null;
  let created = false;
  if (existingRun?.id && existingRun.status === "WAITING") {
    // A run parks in WAITING when PREPARE_INPUTS found missing inputs. This function is only called
    // once every required input is VALID again, so release the run for the next runner tick.
    const requeuedAt = nowIso();
    const released = await env.DB.prepare(`
        UPDATE workflow_steps
        SET status = 'QUEUED', error_message = NULL
        WHERE workflow_run_id = ?
          AND step_key = 'PREPARE_INPUTS'
          AND status = 'WAITING'
      `).bind(existingRun.id).run();
    if (Number(released.meta?.changes || 0) > 0) {
      await env.DB.prepare(`
          UPDATE workflow_runs
          SET status = 'QUEUED', error_code = NULL, error_message = NULL
          WHERE id = ?
            AND status = 'WAITING'
        `).bind(existingRun.id).run();
      await env.DB.prepare(`
          INSERT INTO business_events (
            id, created_at, event_type, entity_type, entity_id,
            actor_type, actor_id, correlation_id, payload_json
          )
          VALUES (?, ?, 'PRODUCTION_WORKFLOW_REQUEUED', 'PROJECT', ?, 'SYSTEM', 'MENU_MADE_AUTOMATION', ?, ?)
        `).bind(
        crypto.randomUUID(),
        requeuedAt,
        projectId,
        existingRun.id,
        JSON.stringify({ reason: "inputs_now_valid" })
      ).run();
    }
  }
  if (!workflowRunId) {
    workflowRunId = crypto.randomUUID();
    const timestamp2 = nowIso();
    const insertResult = await env.DB.prepare(`
          INSERT OR IGNORE INTO workflow_runs (
            id,
            project_id,
            workflow_key,
            workflow_version,
            status,
            trigger_type,
            trigger_reference,
            attempt_number,
            created_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            'QUEUED',
            'PROJECT_READY',
            ?,
            1,
            ?
          )
        `).bind(
      workflowRunId,
      projectId,
      definition.workflowKey,
      definition.workflowVersion,
      projectId,
      timestamp2
    ).run();
    if (Number(
      insertResult.meta?.changes || 0
    ) > 0) {
      created = true;
    } else {
      const concurrentRun = await env.DB.prepare(`
            SELECT
              id,
              status
            FROM workflow_runs
            WHERE project_id = ?
              AND workflow_key = ?
              AND workflow_version = ?
              AND trigger_type =
                'PROJECT_READY'
              AND trigger_reference = ?
            LIMIT 1
          `).bind(
        projectId,
        definition.workflowKey,
        definition.workflowVersion,
        projectId
      ).first();
      workflowRunId = concurrentRun?.id || workflowRunId;
    }
  }
  const timestamp = nowIso();
  for (const step of definition.steps) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO workflow_steps (
          id,
          workflow_run_id,
          step_key,
          step_order,
          status,
          attempt_count,
          input_json
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          'QUEUED',
          0,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      workflowRunId,
      step.key,
      step.order,
      JSON.stringify({
        project_id: projectId,
        order_id: orderId,
        customer_id: customerId,
        workflow_key: definition.workflowKey,
        workflow_version: definition.workflowVersion,
        workflow_definition_id: definition.id,
        queued_at: timestamp
      })
    ).run();
  }
  if (created) {
    await env.DB.prepare(`
        INSERT INTO business_events (
          id,
          created_at,
          event_type,
          entity_type,
          entity_id,
          actor_type,
          actor_id,
          correlation_id,
          payload_json
        )
        VALUES (
          ?,
          ?,
          'PRODUCTION_WORKFLOW_QUEUED',
          'PROJECT',
          ?,
          'SYSTEM',
          'MENU_MADE_AUTOMATION',
          ?,
          ?
        )
      `).bind(
      crypto.randomUUID(),
      timestamp,
      projectId,
      workflowRunId,
      JSON.stringify({
        order_id: orderId,
        workflow_key: definition.workflowKey,
        workflow_version: definition.workflowVersion,
        workflow_definition_id: definition.id
      })
    ).run();
  }
  return {
    id: workflowRunId,
    created,
    workflow_definition_id: definition.id
  };
}

export {
  loadWorkflowDefinition,
  ensureProductionWorkflow
};
