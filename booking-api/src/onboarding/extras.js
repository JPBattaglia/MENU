import { jsonResponse, nowIso } from "../lib/http.js";
import { verifyCheckoutAccess } from "./onboarding.js";

// Buyer finished (or skipped) the optional extras: close the window so production starts on the next tick.
async function startProductionNow(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request" }, 400);
  }
  const access = await verifyCheckoutAccess(String(body?.order_id || ""), String(body?.session_id || ""), env);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);
  await env.DB.prepare(`
      UPDATE projects
      SET metadata_json = json_remove(COALESCE(metadata_json, '{}'), '$.extras_until'), updated_at = ?
      WHERE order_id = ?
    `).bind(nowIso(), access.order.id).run();
  return jsonResponse({ ok: true, started: true });
}

export {
  startProductionNow
};
