import { jsonResponse, nowIso, parseJsonOrNull } from "../../lib/http.js";
import { completeStep, loadProject } from "../../workflows/runner.js";
import { checkPageBilling } from "./page-billing.js";

function extractReadableText(html) {
  return String(
    html || ""
  ).replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    " "
  ).replace(
    /<style\b[^>]*>[\s\S]*?<\/style>/gi,
    " "
  ).replace(
    /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
    " "
  ).replace(
    /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
    " "
  ).replace(
    /<br\s*\/?>/gi,
    "\n"
  ).replace(
    /<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|tr)>/gi,
    "\n"
  ).replace(
    /<[^>]+>/g,
    " "
  ).replaceAll(
    "&nbsp;",
    " "
  ).replaceAll(
    "&amp;",
    "&"
  ).replaceAll(
    "&quot;",
    '"'
  ).replaceAll(
    "&#39;",
    "'"
  ).replaceAll(
    "&lt;",
    "<"
  ).replaceAll(
    "&gt;",
    ">"
  ).replace(
    /\r/g,
    ""
  ).replace(
    /[ \t]+/g,
    " "
  ).replace(
    /\n[ \t]+/g,
    "\n"
  ).replace(
    /\n{3,}/g,
    "\n\n"
  ).trim();
}

// Projects created after menu file uploads launched have both a menu_file and a menu_source row;
// either one being VALID satisfies the menu requirement. Older projects keep menu_source required.
function menuSourceMissing(rows) {
  const byKey = Object.fromEntries((rows || []).map((row) => [row.input_key, row.status]));
  if (!("menu_file" in byKey)) return false;
  return byKey.menu_file !== "VALID" && byKey.menu_source !== "VALID";
}

function getInputValue(inputs, key) {
  const input = inputs?.[key];
  if (!input) {
    return null;
  }
  if (input.type === "FILE") {
    return input.asset || null;
  }
  return input.value ?? null;
}

async function prepareProjectInputs(projectId, env) {
  const result = await env.DB.prepare(`
        SELECT
          pi.id AS project_input_id,
          pi.input_key,
          pi.input_type,
          pi.value_text,
          pi.value_json,
          pi.asset_id,
          pi.required,
          pi.status,

          a.id AS resolved_asset_id,
          a.asset_type,
          a.storage_provider,
          a.storage_key,
          a.original_filename,
          a.mime_type,
          a.size_bytes,
          a.checksum,
          a.status AS asset_status,
          a.approved_for_use,
          a.rights_confirmed

        FROM project_inputs pi

        LEFT JOIN assets a
          ON a.id =
            pi.asset_id

        WHERE
          pi.project_id = ?

        ORDER BY
          pi.required DESC,
          pi.input_key ASC
      `).bind(projectId).all();
  const rows = result.results || [];
  const invalidRequired = rows.filter(
    (row) => Number(row.required) === 1 && row.status !== "VALID"
  );
  if (menuSourceMissing(rows)) invalidRequired.push({ input_key: "menu_source", status: "MISSING" });
  if (invalidRequired.length > 0) {
    return {
      ok: false,
      error: "Required project inputs are not valid",
      missing_or_invalid: invalidRequired.map(
        (row) => ({
          key: row.input_key,
          status: row.status
        })
      )
    };
  }
  const preparedInputs = {};
  for (const row of rows) {
    if (row.status !== "VALID") {
      continue;
    }
    if (row.input_type === "FILE") {
      if (!row.resolved_asset_id) {
        return {
          ok: false,
          error: `Validated file input ${row.input_key} has no asset`
        };
      }
      if (row.asset_status !== "VALID") {
        return {
          ok: false,
          error: `Asset for ${row.input_key} is not valid`
        };
      }
      preparedInputs[row.input_key] = {
        type: "FILE",
        asset: {
          id: row.resolved_asset_id,
          asset_type: row.asset_type,
          storage_provider: row.storage_provider,
          storage_key: row.storage_key,
          original_filename: row.original_filename,
          mime_type: row.mime_type,
          size_bytes: Number(
            row.size_bytes || 0
          ),
          checksum: row.checksum,
          approved_for_use: Boolean(
            row.approved_for_use
          ),
          rights_confirmed: row.rights_confirmed === null ? null : Boolean(
            row.rights_confirmed
          )
        }
      };
      continue;
    }
    if (row.input_type === "JSON") {
      preparedInputs[row.input_key] = {
        type: "JSON",
        value: parseJsonOrNull(
          row.value_json
        )
      };
      continue;
    }
    preparedInputs[row.input_key] = {
      type: row.input_type,
      value: row.value_text
    };
  }
  return {
    ok: true,
    inputs: preparedInputs
  };
}

async function runPrepareInputsStep(targetStep, env) {
  const prepared = await prepareProjectInputs(
    targetStep.project_id,
    env
  );
  if (!prepared.ok) {
    const waitingTimestamp = nowIso();
    await env.DB.prepare(`
        UPDATE workflow_steps
        SET
          status = 'WAITING',
          error_message = ?,
          output_json = ?
        WHERE id = ?
      `).bind(
      prepared.error,
      JSON.stringify({
        ok: false,
        error: prepared.error,
        missing_or_invalid: prepared.missing_or_invalid || []
      }),
      targetStep.workflow_step_id
    ).run();
    await env.DB.prepare(`
        UPDATE workflow_runs
        SET
          status = 'WAITING',
          error_code =
            'INPUTS_NOT_READY',
          error_message = ?
        WHERE id = ?
      `).bind(
      prepared.error,
      targetStep.workflow_run_id
    ).run();
    await env.DB.prepare(`
        UPDATE projects
        SET
          status = 'BLOCKED',
          blocked_reason = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
      prepared.error,
      waitingTimestamp,
      targetStep.project_id
    ).run();
    return {
      waiting: true,
      response: jsonResponse(
        {
          ok: false,
          processed: true,
          workflow_run_id: targetStep.workflow_run_id,
          workflow_step_id: targetStep.workflow_step_id,
          step_key: targetStep.step_key,
          status: "WAITING",
          error: prepared.error,
          missing_or_invalid: prepared.missing_or_invalid || []
        },
        409
      )
    };
  }
  const project = await loadProject(
    targetStep.project_id,
    env
  );
  if (!project) {
    throw new Error(
      "Production project could not be loaded"
    );
  }
  // More pages than the order paid for: park here until the buyer pays the balance.
  const billing = await checkPageBilling(targetStep, project, prepared.inputs, env);
  if (!billing.proceed) {
    return { waiting: true, response: billing.response };
  }
  const preparedPayload = {
    prepared_at: nowIso(),
    project: {
      id: project.id,
      order_id: project.order_id,
      order_item_id: project.order_item_id,
      project_type: project.project_type,
      workflow_key: project.workflow_key,
      workflow_version: Number(
        project.workflow_version
      )
    },
    business: {
      id: project.business_id,
      name: project.business_name
    },
    customer: {
      id: project.customer_id,
      email: project.customer_email,
      name: [
        project.first_name,
        project.last_name
      ].filter(Boolean).join(" ")
    },
    inputs: prepared.inputs,
    page_billing: billing.summary
  };
  await completeStep(
    targetStep,
    preparedPayload,
    env
  );
  return {
    waiting: false,
    output: preparedPayload
  };
}

async function loadPreparedPayload(targetStep, env) {
  const previousStep = await env.DB.prepare(`
        SELECT
          output_json
        FROM workflow_steps
        WHERE
          workflow_run_id = ?
          AND step_key =
            'PREPARE_INPUTS'
          AND status =
            'SUCCEEDED'
        ORDER BY
          step_order ASC
        LIMIT 1
      `).bind(
    targetStep.workflow_run_id
  ).first();
  if (!previousStep?.output_json) {
    throw new Error(
      "PREPARE_INPUTS output is not available"
    );
  }
  const payload = parseJsonOrNull(
    previousStep.output_json
  );
  if (!payload || !payload.inputs) {
    throw new Error(
      "PREPARE_INPUTS output is invalid"
    );
  }
  return payload;
}

async function fetchMenuSource(menuSource) {
  let sourceUrl;
  try {
    sourceUrl = new URL(
      menuSource
    );
  } catch {
    throw new Error(
      "menu_source is not a valid URL"
    );
  }
  if (sourceUrl.protocol !== "https:" && sourceUrl.protocol !== "http:") {
    throw new Error(
      "menu_source must use HTTP or HTTPS"
    );
  }
  const response = await fetch(
    sourceUrl.toString(),
    {
      headers: {
        "User-Agent": "Menu-Made-Automation/1.0",
        "Accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.5"
      },
      redirect: "follow"
    }
  );
  if (!response.ok) {
    throw new Error(
      `Menu source returned HTTP ${response.status}`
    );
  }
  const contentType = (response.headers.get(
    "content-type"
  ) || "").split(";")[0].trim().toLowerCase();
  if (contentType === "application/pdf" || contentType.startsWith(
    "image/"
  )) {
    throw new Error(
      `Menu source format ${contentType} requires document extraction before GENERATE_MENU_DRAFT can process it`
    );
  }
  const allowed = contentType === "text/html" || contentType === "text/plain" || contentType === "application/json" || contentType.endsWith(
    "+json"
  );
  if (!allowed) {
    throw new Error(
      `Unsupported menu source content type: ${contentType || "unknown"}`
    );
  }
  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error(
      "Menu source returned no readable content"
    );
  }
  let readableText;
  if (contentType === "text/html") {
    readableText = extractReadableText(
      raw
    );
  } else if (contentType === "application/json" || contentType.endsWith(
    "+json"
  )) {
    try {
      readableText = JSON.stringify(
        JSON.parse(raw),
        null,
        2
      );
    } catch {
      readableText = raw.trim();
    }
  } else {
    readableText = raw.trim();
  }
  if (!readableText) {
    throw new Error(
      "Menu source contained no readable menu text"
    );
  }
  return {
    requested_url: menuSource,
    resolved_url: response.url || menuSource,
    content_type: contentType,
    text: readableText
  };
}

export {
  extractReadableText,
  menuSourceMissing,
  getInputValue,
  prepareProjectInputs,
  runPrepareInputsStep,
  loadPreparedPayload,
  fetchMenuSource
};
