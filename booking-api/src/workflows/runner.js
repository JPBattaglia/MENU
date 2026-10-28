import { AUTOMATION_START_AT, EMAIL_MAX_ATTEMPTS, SCHEDULED_RUNNER_BUDGET_MS, SCHEDULED_RUNNER_MAX_STEPS, ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { jsonResponse, nowIso } from "../lib/http.js";
import { runGenerateMenuDraftStep } from "../producers/menu-qr/draft-step.js";
import { runPrepareInputsStep } from "../producers/menu-qr/inputs.js";
import { autoReleaseWaitingApprovals } from "../approvals/actions.js";
import { sendOwnerDigests } from "../approvals/digest.js";
import { presenterFor } from "../approvals/presenters.js";
import { runDeliverStep } from "../approvals/release.js";
import { runPackageDeliverablesStep } from "../producers/menu-qr/package.js";
import { runSelfTestProduceStep } from "../selftest/routing-selftest.js";
import { runProduceStep } from "../producers/produce.js";
import { runGenerateQrStep } from "../producers/menu-qr/qr-step.js";
import { runQualityCheckStep } from "../producers/menu-qr/quality-check.js";
import { sendPageBillingReminders } from "../producers/menu-qr/page-billing.js";

function verifyProductionRunner(request, env) {
  if (!env.PRODUCTION_RUNNER_SECRET) {
    return {
      ok: false,
      status: 500,
      error: "Production runner secret is not configured"
    };
  }
  const authorization = request.headers.get(
    "Authorization"
  ) || "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(
    prefix
  )) {
    return {
      ok: false,
      status: 401,
      error: "Production runner authorization is required"
    };
  }
  const suppliedSecret = authorization.slice(prefix.length).trim();
  if (suppliedSecret !== env.PRODUCTION_RUNNER_SECRET) {
    return {
      ok: false,
      status: 403,
      error: "Invalid production runner authorization"
    };
  }
  return {
    ok: true
  };
}

async function loadProject(projectId, env) {
  return env.DB.prepare(`
      SELECT
        p.id,
        p.order_id,
        p.order_item_id,
        p.business_id,
        p.customer_id,
        p.project_type,
        p.workflow_key,
        p.workflow_version,

        b.name AS business_name,

        c.email AS customer_email,
        c.first_name,
        c.last_name

      FROM projects p

      JOIN businesses b
        ON b.id =
          p.business_id

      JOIN customers c
        ON c.id =
          p.customer_id

      WHERE
        p.id = ?

      LIMIT 1
    `).bind(projectId).first();
}

async function completeStep(targetStep, output, env) {
  const completedAt = nowIso();
  await env.DB.prepare(`
      UPDATE workflow_steps
      SET
        status = 'SUCCEEDED',
        completed_at = ?,
        output_json = ?,
        error_message = NULL
      WHERE id = ?
    `).bind(
    completedAt,
    JSON.stringify(output),
    targetStep.workflow_step_id
  ).run();
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
        'PRODUCTION_STEP_COMPLETED',
        'PROJECT',
        ?,
        'SYSTEM',
        'MENU_MADE_AUTOMATION',
        ?,
        ?
      )
    `).bind(
    crypto.randomUUID(),
    completedAt,
    targetStep.project_id,
    targetStep.workflow_run_id,
    JSON.stringify({
      workflow_run_id: targetStep.workflow_run_id,
      workflow_step_id: targetStep.workflow_step_id,
      workflow_key: targetStep.workflow_key,
      workflow_version: Number(
        targetStep.workflow_version
      ),
      step_key: targetStep.step_key
    })
  ).run();
  return completedAt;
}

async function findNextStep(targetStep, env) {
  return env.DB.prepare(`
      SELECT
        id,
        step_key,
        step_order,
        status
      FROM workflow_steps
      WHERE
        workflow_run_id = ?
        AND step_order > ?
        AND status = 'QUEUED'
      ORDER BY
        step_order ASC
      LIMIT 1
    `).bind(
    targetStep.workflow_run_id,
    targetStep.step_order
  ).first();
}

async function runNextProductionStep(request, env, options = {}) {
  // options.createdAfter is set only by the scheduled runner (never from the request body), so older
  // runs that predate automated production are left for an explicit, manual decision.
  const createdAfter = typeof options.createdAfter === "string" && options.createdAfter ? options.createdAfter : null;
  const auth = verifyProductionRunner(
    request,
    env
  );
  if (!auth.ok) {
    return jsonResponse(
      {
        ok: false,
        error: auth.error
      },
      auth.status
    );
  }
  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        error: "D1 binding DB is not available"
      },
      500
    );
  }
  let selection = {};
  try {
    const text = await request.text();
    if (text.length > 4096) return jsonResponse({ok:false,error:"Runner request is too large"},413);
    selection = text.trim() ? JSON.parse(text) : {};
    if (!selection || typeof selection !== "object" || Array.isArray(selection)
      || Object.keys(selection).some(key => !["workflow_run_id","step_key","dry_run"].includes(key))
      || (selection.workflow_run_id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selection.workflow_run_id))
      || (selection.step_key !== undefined && !["PREPARE_INPUTS","GENERATE_MENU_DRAFT","GENERATE_QR","QUALITY_CHECK","PACKAGE_DELIVERABLES","DELIVER","SELFTEST_PRODUCE","PRODUCE"].includes(selection.step_key))
      || (selection.dry_run !== undefined && typeof selection.dry_run !== "boolean")) {
      return jsonResponse({ok:false,error:"Invalid runner selection"},400);
    }
  } catch { return jsonResponse({ok:false,error:"Invalid runner JSON"},400); }
  let targetStep = null;
  try {
    targetStep = await env.DB.prepare(`
          SELECT
            ws.id AS workflow_step_id,
            ws.workflow_run_id,
            ws.step_key,
            ws.step_order,
            ws.status AS step_status,

            wr.project_id,
            wr.workflow_key,
            wr.workflow_version,
            wr.status AS workflow_status,
            wr.created_at AS workflow_created_at,

            p.order_id,
            p.customer_id,
            p.business_id,
            p.status AS project_status

          FROM workflow_steps ws

          JOIN workflow_runs wr
            ON wr.id =
              ws.workflow_run_id

          JOIN projects p
            ON p.id =
              wr.project_id

          WHERE
            ws.status =
              'QUEUED'

            AND ws.step_key IN (
              'PREPARE_INPUTS',
              'GENERATE_MENU_DRAFT',
              'GENERATE_QR',
              'QUALITY_CHECK',
              'PACKAGE_DELIVERABLES',
              'DELIVER',
              'SELFTEST_PRODUCE',
              'PRODUCE'
            )
            AND (ws.step_key != 'PRODUCE' OR wr.workflow_key IN ('MENU_CARE_V1', 'SOCIAL_POSTS_V1', 'ACCESSIBILITY_MONITORING_V1', 'CONVERSION_FIX_V1', 'WEBSITE_PACKAGE_V1', 'WEBSITE_CARE_V1'))
            AND (ws.step_key != 'PRODUCE' OR json_extract(p.metadata_json, '$.source') != 'SUBSCRIPTION_PERIOD' OR NOT EXISTS (
              SELECT 1 FROM customers cx WHERE cx.id = p.customer_id AND cx.email = 'delivered@resend.dev'))

            AND (ws.step_key NOT IN ('QUALITY_CHECK', 'PACKAGE_DELIVERABLES') OR wr.workflow_key = 'MENU_QR_V1')
            AND (ws.step_key != 'SELFTEST_PRODUCE' OR wr.workflow_key LIKE 'ROUTING_SELFTEST_%')
            AND (? IS NULL OR wr.id = ?)
            AND (? IS NULL OR ws.step_key = ?)
            AND (? IS NULL OR wr.created_at >= ?)
            AND NOT EXISTS (
              SELECT 1 FROM projects px
              WHERE px.id = wr.project_id AND json_extract(px.metadata_json, '$.extras_until') > ?
            )

            AND wr.status IN (
              'QUEUED',
              'RUNNING'
            )

            AND NOT EXISTS (
              SELECT 1
              FROM workflow_steps previous
              WHERE
                previous.workflow_run_id =
                  ws.workflow_run_id
                AND previous.step_order <
                  ws.step_order
                AND previous.status !=
                  'SUCCEEDED'
            )

          ORDER BY
            wr.created_at ASC,
            ws.step_order ASC

          LIMIT 1
        `).bind(selection.workflow_run_id || null, selection.workflow_run_id || null,
          selection.step_key || null, selection.step_key || null,
          createdAfter, createdAfter, nowIso()).first();
    if (!targetStep) {
      return jsonResponse({
        ok: true,
        processed: false,
        message: "No runnable production step found"
      });
    }
    // Preview never claims or changes a workflow, project, asset, or notification.
    if (selection.dry_run) return jsonResponse({ok:true,processed:false,dry_run:true,
      selected_step:{id:targetStep.workflow_step_id,key:targetStep.step_key,status:targetStep.step_status},
      workflow_run:{id:targetStep.workflow_run_id,workflow_key:targetStep.workflow_key,status:targetStep.workflow_status},
      project:{id:targetStep.project_id}});
    const timestamp = nowIso();
    const claimResult = await env.DB.prepare(`
          UPDATE workflow_steps
          SET
            status = 'RUNNING',
            -- The latest claim time (not the first): recoverStuckSteps judges this attempt, not an earlier one.
            started_at = ?,
            attempt_count =
              attempt_count + 1,
            error_message =
              NULL
          WHERE
            id = ?
            AND status =
              'QUEUED'
        `).bind(
      timestamp,
      targetStep.workflow_step_id
    ).run();
    if (Number(
      claimResult.meta?.changes || 0
    ) === 0) {
      return jsonResponse({
        ok: true,
        processed: false,
        message: "Production step was already claimed"
      });
    }
    await env.DB.prepare(`
        UPDATE workflow_runs
        SET
          status = 'RUNNING',
          started_at =
            COALESCE(
              started_at,
              ?
            ),
          error_code = NULL,
          error_message = NULL
        WHERE id = ?
      `).bind(
      timestamp,
      targetStep.workflow_run_id
    ).run();
    await env.DB.prepare(`
        UPDATE projects
        SET
          status =
            'AUTOMATION_RUNNING',
          started_at =
            COALESCE(
              started_at,
              ?
            ),
          blocked_reason = NULL,
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      timestamp,
      targetStep.project_id
    ).run();
    let stepOutput;
    if (targetStep.step_key === "PREPARE_INPUTS") {
      const result = await runPrepareInputsStep(
        targetStep,
        env
      );
      if (result.waiting) {
        return result.response;
      }
      stepOutput = result.output;
    } else if (targetStep.step_key === "GENERATE_MENU_DRAFT") {
      stepOutput = await runGenerateMenuDraftStep(
        targetStep,
        env
      );
    } else if (targetStep.step_key === "GENERATE_QR") {
      stepOutput = await runGenerateQrStep(
        targetStep,
        env
      );
    } else if (targetStep.step_key === "QUALITY_CHECK") {
      stepOutput = await runQualityCheckStep(targetStep, env);
    } else if (targetStep.step_key === "PACKAGE_DELIVERABLES") {
      const result = await runPackageDeliverablesStep(targetStep, env);
      if (result.waiting) {
        return result.response;
      }
      stepOutput = result.output;
    } else if (targetStep.step_key === "DELIVER") {
      const result = await runDeliverStep(targetStep, env, presenterFor(targetStep.workflow_key));
      if (result.waiting) {
        return result.response;
      }
      stepOutput = result.output;
    } else if (targetStep.step_key === "PRODUCE") {
      const produced = await runProduceStep(targetStep, env);
      if (produced?.waiting) return produced.response;
      stepOutput = produced;
    } else if (targetStep.step_key === "SELFTEST_PRODUCE") {
      stepOutput = await runSelfTestProduceStep(targetStep, env);
    } else {
      throw new Error(
        `Unsupported production step ${targetStep.step_key}`
      );
    }
    const nextStep = await findNextStep(
      targetStep,
      env
    );
    return jsonResponse({
      ok: true,
      processed: true,
      workflow_run: {
        id: targetStep.workflow_run_id,
        status: "RUNNING",
        workflow_key: targetStep.workflow_key,
        workflow_version: Number(
          targetStep.workflow_version
        )
      },
      project: {
        id: targetStep.project_id,
        status: "AUTOMATION_RUNNING"
      },
      completed_step: {
        id: targetStep.workflow_step_id,
        key: targetStep.step_key,
        status: "SUCCEEDED"
      },
      next_step: nextStep ? {
        id: nextStep.id,
        key: nextStep.step_key,
        order: Number(
          nextStep.step_order
        ),
        status: nextStep.status
      } : null,
      output: stepOutput
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (targetStep) {
      const failedAt = nowIso();
      try {
        await env.DB.prepare(`
            UPDATE workflow_steps
            SET
              status = 'FAILED',
              completed_at = ?,
              error_message = ?
            WHERE id = ?
              AND status =
                'RUNNING'
          `).bind(
          failedAt,
          errorMessage,
          targetStep.workflow_step_id
        ).run();
        await env.DB.prepare(`
            UPDATE workflow_runs
            SET
              status = 'FAILED',
              failed_at = ?,
              error_code =
                'PRODUCTION_STEP_FAILED',
              error_message = ?
            WHERE id = ?
          `).bind(
          failedAt,
          errorMessage,
          targetStep.workflow_run_id
        ).run();
        await env.DB.prepare(`
            UPDATE projects
            SET
              status = 'FAILED',
              blocked_reason = ?,
              updated_at = ?
            WHERE id = ?
          `).bind(
          errorMessage,
          failedAt,
          targetStep.project_id
        ).run();
      } catch {
      }
    }
    return jsonResponse(
      {
        ok: false,
        error: errorMessage,
        workflow_run_id: targetStep?.workflow_run_id || null,
        step_key: targetStep?.step_key || null
      },
      500
    );
  }
}

async function currentStepAttempts(targetStep, env) {
  const row = await env.DB.prepare(`SELECT attempt_count FROM workflow_steps WHERE id = ?`).bind(targetStep.workflow_step_id).first();
  return Number(row?.attempt_count || 0);
}

// Put the claimed step back in the queue so the next runner tick retries it (used when an email fails).
async function retryStepLater(targetStep, env, reason) {
  if (await currentStepAttempts(targetStep, env) >= EMAIL_MAX_ATTEMPTS) {
    throw new Error(`${reason} after ${EMAIL_MAX_ATTEMPTS} attempts`);
  }
  await env.DB.prepare(`
      UPDATE workflow_steps SET status = 'QUEUED', error_message = ? WHERE id = ? AND status = 'RUNNING'
    `).bind(String(reason).slice(0, 500), targetStep.workflow_step_id).run();
  return {
    waiting: true,
    response: jsonResponse({
      ok: false,
      processed: true,
      status: "RETRY_SCHEDULED",
      workflow_run_id: targetStep.workflow_run_id,
      workflow_step_id: targetStep.workflow_step_id,
      step_key: targetStep.step_key,
      error: reason
    }, 503)
  };
}

function internalRunnerRequest(env, selection = {}) {
  return new Request(`${publicBaseUrl(env)}/api/production/run-next`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.PRODUCTION_RUNNER_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(selection)
  });
}

async function alertOwnerOfFailure(env, body) {
  const runId = body.workflow_run_id || null;
  try {
    await env.DB.prepare(`
        INSERT INTO system_errors (id, created_at, updated_at, error_type, severity, status, message, workflow_run_id, manual_intervention_required, details_json)
        VALUES (?, ?, ?, 'PRODUCTION_STEP_FAILED', 'ERROR', 'OPEN', ?, ?, 1, ?)
      `).bind(crypto.randomUUID(), nowIso(), nowIso(), String(body.error || "Production step failed").slice(0, 500), runId, JSON.stringify({ step_key: body.step_key || null })).run();
  } catch (error) {
    console.error("Could not record production failure:", error instanceof Error ? error.message : String(error));
  }
  if (!runId) return;
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: "Automation stopped on an order",
    html: brandedEmailHtml({
      preheader: "A production step failed and needs a look.",
      eyebrow: "AUTOMATION ALERT",
      heading: "A production step failed",
      paragraphs: ["The automation stopped on one order and won't retry this step on its own."],
      rows: [["Workflow run", runId], ["Step", body.step_key || "unknown"], ["Error", String(body.error || "").slice(0, 300)]]
    }),
    text: `A production step failed.\nWorkflow run: ${runId}\nStep: ${body.step_key || "unknown"}\nError: ${String(body.error || "").slice(0, 300)}`,
    idempotencyKey: `production-failed/${runId}/${body.step_key || "unknown"}`,
    purpose: "AUTOMATION_ALERT",
    templateKey: "automation_failure_v1"
  });
}

// A step still RUNNING long after it was claimed was cut off without recording an error: on the free plan Cloudflare
// ends a run that overruns its CPU time and nothing after that line executes. Without this the step stays RUNNING
// forever and the order sits stuck with nobody told. It is failed the same way a thrown error is, and the owner alerted.
const STUCK_STEP_MINUTES = 20;

async function recoverStuckSteps(env, now = Date.now()) {
  const cutoff = new Date(now - STUCK_STEP_MINUTES * 60000).toISOString();
  const stuck = (await env.DB.prepare(`
      SELECT ws.id, ws.step_key, ws.workflow_run_id, wr.project_id
      FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
      WHERE ws.status = 'RUNNING' AND ws.started_at < ?
      LIMIT 5
    `).bind(cutoff).all()).results || [];
  const recovered = [];
  for (const step of stuck) {
    const message = `Stopped without finishing: still running ${STUCK_STEP_MINUTES} minutes after it started (most likely Cloudflare ended the run at the free plan's CPU limit)`;
    const t = nowIso();
    const updated = await env.DB.prepare(`
        UPDATE workflow_steps SET status = 'FAILED', completed_at = ?, error_message = ? WHERE id = ? AND status = 'RUNNING'
      `).bind(t, message, step.id).run();
    if (Number(updated.meta?.changes || 0) === 0) continue;
    await env.DB.prepare(`
        UPDATE workflow_runs SET status = 'FAILED', failed_at = ?, error_code = 'PRODUCTION_STEP_STUCK', error_message = ? WHERE id = ?
      `).bind(t, message, step.workflow_run_id).run();
    await env.DB.prepare(`
        UPDATE projects SET status = 'FAILED', blocked_reason = ?, updated_at = ? WHERE id = ? AND status NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED')
      `).bind(message, t, step.project_id).run();
    await alertOwnerOfFailure(env, { workflow_run_id: step.workflow_run_id, step_key: step.step_key, error: message });
    recovered.push(step.id);
  }
  return recovered;
}

async function runScheduledProduction(env) {
  if (!env.DB || !env.PRODUCTION_RUNNER_SECRET) return { skipped: true };
  try {
    await sendPageBillingReminders(env);
  } catch (error) {
    console.error("Extra pages reminders failed:", error instanceof Error ? error.message : String(error));
  }
  try {
    await recoverStuckSteps(env);
  } catch (error) {
    console.error("Stuck step recovery failed:", error instanceof Error ? error.message : String(error));
  }
  try {
    await autoReleaseWaitingApprovals(env, null);
  } catch (error) {
    console.error("Auto-release failed:", error instanceof Error ? error.message : String(error));
  }
  const createdAfter = env.AUTOMATION_START_AT || AUTOMATION_START_AT;
  const started = Date.now();
  const seenSteps = new Set();
  const results = [];
  for (let i = 0; i < SCHEDULED_RUNNER_MAX_STEPS; i++) {
    if (Date.now() - started > SCHEDULED_RUNNER_BUDGET_MS) break;
    let body;
    try {
      const response = await runNextProductionStep(internalRunnerRequest(env, {}), env, { createdAfter });
      body = await response.json();
      body.http_status = response.status;
    } catch (error) {
      console.error("Scheduled production runner error:", error instanceof Error ? error.message : String(error));
      break;
    }
    results.push(body);
    if (body.processed === false) break;
    if (body.http_status === 500) {
      await alertOwnerOfFailure(env, body);
      continue;
    }
    const stepId = body.completed_step?.id || body.workflow_step_id;
    if (stepId) {
      if (seenSteps.has(stepId)) break;
      seenSteps.add(stepId);
    }
  }
  try {
    // One email for everything that newly started waiting for the owner during this tick.
    await sendOwnerDigests(env);
  } catch (error) {
    console.error("Owner approval email failed:", error instanceof Error ? error.message : String(error));
  }
  return { steps: results.length, results };
}

export {
  recoverStuckSteps,
  STUCK_STEP_MINUTES,
  verifyProductionRunner,
  loadProject,
  completeStep,
  findNextStep,
  runNextProductionStep,
  currentStepAttempts,
  retryStepLater,
  internalRunnerRequest,
  alertOwnerOfFailure,
  runScheduledProduction
};
