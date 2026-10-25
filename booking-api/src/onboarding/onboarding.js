import { jsonResponse, nowIso, parseJsonOrNull } from "../lib/http.js";
import { sendOnboardingConfirmationEmail } from "./confirmation-email.js";
import { validateOnboardingValue } from "./validation.js";
import { menuSourceMissing } from "../producers/menu-qr/inputs.js";
import { ensureProductionWorkflow } from "../workflows/definitions.js";

async function verifyCheckoutAccess(orderId, sessionId, env) {
  if (!orderId || !sessionId) {
    return {
      ok: false,
      status: 400,
      error: "order_id and session_id are required"
    };
  }
  if (!env.DB) {
    return {
      ok: false,
      status: 500,
      error: "D1 binding DB is not available"
    };
  }
  const order = await env.DB.prepare(`
        SELECT
          id,
          customer_id,
          business_id,
          status,
          payment_status,
          stripe_checkout_session_id,
          stripe_payment_intent_id
        FROM orders
        WHERE id = ?
        LIMIT 1
      `).bind(orderId).first();
  if (!order) {
    return {
      ok: false,
      status: 404,
      error: "Order not found"
    };
  }
  if (!order.stripe_checkout_session_id) {
    return {
      ok: false,
      status: 403,
      error: "Order has no verified Checkout Session"
    };
  }
  if (order.stripe_checkout_session_id !== sessionId) {
    return {
      ok: false,
      status: 403,
      error: "Checkout Session does not match this order"
    };
  }
  if (order.payment_status !== "PAID") {
    return {
      ok: false,
      status: 403,
      error: "Order payment has not been verified"
    };
  }
  const environment = sessionId.startsWith("cs_test_") ? "sandbox" : "live";
  return {
    ok: true,
    order,
    environment
  };
}

async function refreshOnboardingState(projectId, orderId, customerId, workflowKey, env) {
  const remainingResult = await env.DB.prepare(`
        SELECT
          input_key,
          input_type,
          status
        FROM project_inputs
        WHERE project_id = ?
          AND required = 1
          AND status <> 'VALID'
        ORDER BY input_key ASC
      `).bind(projectId).all();
  const remaining = remainingResult.results || [];
  const menuInputs = await env.DB.prepare(`
        SELECT input_key, status FROM project_inputs
        WHERE project_id = ? AND input_key IN ('menu_source', 'menu_file')
      `).bind(projectId).all();
  if (menuSourceMissing(menuInputs.results || [])) {
    remaining.push({ input_key: "menu_source", input_type: "URL", status: "MISSING" });
  }
  const timestamp = nowIso();
  if (remaining.length === 0) {
    await env.DB.prepare(`
        UPDATE projects
        SET
          status = 'READY',
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      projectId
    ).run();
    await env.DB.prepare(`
        UPDATE orders
        SET
          status =
            'READY_FOR_PRODUCTION',
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      orderId
    ).run();
    const project = await env.DB.prepare(`
          SELECT
            workflow_version
          FROM projects
          WHERE id = ?
          LIMIT 1
        `).bind(projectId).first();
    const workflowVersion = Number(
      project?.workflow_version || 1
    );
    await ensureProductionWorkflow(
      projectId,
      workflowKey,
      workflowVersion,
      customerId,
      orderId,
      env
    );
    const existingEvent = await env.DB.prepare(`
          SELECT id
          FROM business_events
          WHERE event_type =
            'ONBOARDING_COMPLETED'
            AND entity_type =
              'PROJECT'
            AND entity_id = ?
          LIMIT 1
        `).bind(projectId).first();
    if (!existingEvent) {
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
            'ONBOARDING_COMPLETED',
            'PROJECT',
            ?,
            'CUSTOMER',
            ?,
            ?,
            ?
          )
        `).bind(
        crypto.randomUUID(),
        timestamp,
        projectId,
        customerId,
        orderId,
        JSON.stringify({
          workflow_key: workflowKey,
          workflow_version: workflowVersion
        })
      ).run();
    }
    try {
      await sendOnboardingConfirmationEmail(
        {
          projectId,
          orderId
        },
        env
      );
    } catch (emailError) {
      console.error(
        "Onboarding confirmation email failed:",
        emailError instanceof Error ? emailError.message : String(emailError)
      );
    }
  } else {
    await env.DB.prepare(`
        UPDATE projects
        SET
          status =
            'AWAITING_INPUTS',
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      projectId
    ).run();
    await env.DB.prepare(`
        UPDATE orders
        SET
          status =
            'ONBOARDING_REQUIRED',
          updated_at = ?
        WHERE id = ?
      `).bind(
      timestamp,
      orderId
    ).run();
  }
  return remaining;
}

async function getOnboarding(request, env) {
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
    const url = new URL(request.url);
    const orderId = url.searchParams.get(
      "order_id"
    );
    const sessionId = url.searchParams.get(
      "session_id"
    );
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
            p.id,
            p.project_type,
            p.status,
            p.workflow_key,
            p.workflow_version,
            p.business_id,
            p.customer_id,
            p.metadata_json,
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
          WHERE p.order_id = ?
          ORDER BY
            p.created_at ASC
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
    const inputs = await env.DB.prepare(`
          SELECT
            id,
            input_key,
            input_type,
            value_text,
            value_json,
            asset_id,
            required,
            status,
            validation_message,
            submitted_at,
            validated_at
          FROM project_inputs
          WHERE project_id = ?
          ORDER BY
            required DESC,
            input_key ASC
        `).bind(project.id).all();
    const rows = inputs.results || [];
    const missingRequired = rows.filter(
      (input) => Number(
        input.required
      ) === 1 && input.status !== "VALID"
    );
    if (menuSourceMissing(rows)) missingRequired.push({ input_key: "menu_source" });
    return jsonResponse({
      ok: true,
      environment: access.environment,
      order: {
        id: access.order.id,
        status: access.order.status,
        payment_status: access.order.payment_status
      },
      project: {
        id: project.id,
        project_type: project.project_type,
        status: project.status,
        workflow_key: project.workflow_key,
        workflow_version: project.workflow_version
      },
      customer: {
        email: project.customer_email,
        name: [
          project.first_name,
          project.last_name
        ].filter(Boolean).join(" ")
      },
      business: {
        id: project.business_id,
        name: project.business_name
      },
      onboarding: {
        complete: missingRequired.length === 0,
        // After payment the buyer may add optional extras (logo, colors, notes) before production starts.
        extras_open_until: (() => {
          const until = parseJsonOrNull(project.metadata_json)?.extras_until;
          return until && until > nowIso() ? until : null;
        })(),
        missing_required: missingRequired.map(
          (input) => input.input_key
        ),
        inputs: rows.map(
          (input) => ({
            key: input.input_key,
            type: input.input_type,
            required: Boolean(
              input.required
            ),
            status: input.status,
            value: input.value_text,
            asset_id: input.asset_id,
            validation_message: input.validation_message,
            file_upload_required: input.input_type === "FILE"
          })
        )
      }
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

async function saveOnboarding(request, env) {
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
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid JSON body"
        },
        400
      );
    }
    const orderId = String(
      data?.order_id || ""
    ).trim();
    const sessionId = String(
      data?.session_id || ""
    ).trim();
    const submittedFields = data?.fields && typeof data.fields === "object" && !Array.isArray(
      data.fields
    ) ? data.fields : {};
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
            status,
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
    const inputRows = await env.DB.prepare(`
          SELECT
            id,
            input_key,
            input_type,
            required,
            status
          FROM project_inputs
          WHERE project_id = ?
        `).bind(project.id).all();
    const timestamp = nowIso();
    const results = [];
    for (const input of inputRows.results || []) {
      if (!Object.prototype.hasOwnProperty.call(
        submittedFields,
        input.input_key
      )) {
        continue;
      }
      if (input.input_type === "FILE") {
        results.push({
          key: input.input_key,
          saved: false,
          status: input.status,
          message: "This field requires a file upload."
        });
        continue;
      }
      const supplied = submittedFields[input.input_key];
      if (Number(
        input.required
      ) === 0 && String(
        supplied ?? ""
      ).trim() === "") {
        await env.DB.prepare(`
            UPDATE project_inputs
            SET
              value_text = NULL,
              status = 'MISSING',
              validation_message = NULL,
              submitted_at = NULL,
              validated_at = NULL,
              updated_at = ?
            WHERE id = ?
          `).bind(
          timestamp,
          input.id
        ).run();
        results.push({
          key: input.input_key,
          saved: true,
          status: "MISSING"
        });
        continue;
      }
      const validation = validateOnboardingValue(
        input.input_key,
        input.input_type,
        supplied
      );
      if (!validation.valid) {
        await env.DB.prepare(`
            UPDATE project_inputs
            SET
              value_text = ?,
              status = 'INVALID',
              validation_message = ?,
              submitted_at = ?,
              validated_at = NULL,
              updated_at = ?
            WHERE id = ?
          `).bind(
          validation.value,
          validation.message,
          timestamp,
          timestamp,
          input.id
        ).run();
        results.push({
          key: input.input_key,
          saved: false,
          status: "INVALID",
          message: validation.message
        });
        continue;
      }
      await env.DB.prepare(`
          UPDATE project_inputs
          SET
            value_text = ?,
            status = 'VALID',
            validation_message = NULL,
            submitted_at = ?,
            validated_at = ?,
            updated_at = ?
          WHERE id = ?
        `).bind(
        validation.value,
        timestamp,
        timestamp,
        timestamp,
        input.id
      ).run();
      results.push({
        key: input.input_key,
        saved: true,
        status: "VALID"
      });
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
      saved: results,
      onboarding_complete: remaining.length === 0,
      remaining_required: remaining.map(
        (item) => ({
          key: item.input_key,
          type: item.input_type,
          status: item.status,
          file_upload_required: item.input_type === "FILE"
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
  verifyCheckoutAccess,
  refreshOnboardingState,
  getOnboarding,
  saveOnboarding
};
