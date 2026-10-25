import { jsonResponse, nowIso } from "./http.js";

async function recordProjectEvent(env, projectId, eventType, correlationId, payload, actorType = "SYSTEM", actorId = "MENU_MADE_AUTOMATION") {
  await env.DB.prepare(`
      INSERT INTO business_events (
        id, created_at, event_type, entity_type, entity_id,
        actor_type, actor_id, correlation_id, payload_json
      )
      VALUES (?, ?, ?, 'PROJECT', ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), nowIso(), eventType, projectId, actorType, actorId, correlationId, JSON.stringify(payload || {})).run();
}

async function databaseHealthCheck(env) {
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
    const result = await env.DB.prepare(`
          SELECT COUNT(*) AS application_tables
          FROM sqlite_schema
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
            AND name NOT LIKE '_cf_%'
        `).first();
    return jsonResponse({
      ok: true,
      database: "menu-made-db",
      application_tables: result?.application_tables ?? null
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
  recordProjectEvent,
  databaseHealthCheck
};
