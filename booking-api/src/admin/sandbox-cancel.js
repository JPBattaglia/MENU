// Cancel owner test (Stripe sandbox) subscriptions on request (owner, Nov 12, 2026: "remove all test purchases").
// The Stripe connector only reaches live mode, so the worker does it with its own sandbox key. Start one by inserting
// a self_tests row: kind SANDBOX_CANCEL, status REQUESTED, state_json {"subscriptions": ["sub_..."]}. Each id is
// cancelled with the SANDBOX key only, so a live subscription can never be touched (Stripe answers "no such
// subscription"). The Stripe webhook then marks each one canceled here, as it would for any cancellation.
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { stripeRequest } from "../lib/stripe.js";

const KIND = "SANDBOX_CANCEL";

async function advanceSandboxCancels(env) {
  if (!env.DB || !env.STRIPE_SECRET_KEY_TEST) return [];
  const { results = [] } = await env.DB.prepare(`SELECT id, state_json FROM self_tests WHERE kind = ? AND status = 'REQUESTED' LIMIT 3`).bind(KIND).all();
  const done = [];
  for (const row of results) {
    const claimed = await env.DB.prepare(`UPDATE self_tests SET status = 'RUNNING', updated_at = ? WHERE id = ? AND status = 'REQUESTED'`).bind(nowIso(), row.id).run();
    if (!claimed?.meta?.changes) continue;
    const ids = (parseJsonOrNull(row.state_json)?.subscriptions || []).filter((id) => /^sub_[A-Za-z0-9]{8,64}$/.test(String(id))).slice(0, 50);
    const log = [];
    for (const id of ids) {
      try {
        const sub = await stripeRequest(env, "sandbox", `/v1/subscriptions/${id}`, { method: "DELETE" });
        log.push({ id, status: sub?.status || "canceled" });
      } catch (error) {
        log.push({ id, error: String(error?.message || error).slice(0, 200) });
      }
    }
    const failed = log.filter((l) => l.error && !/No such subscription|canceled/i.test(l.error));
    const t = nowIso();
    await env.DB.prepare(`UPDATE self_tests SET status = ?, log_json = ?, error = ?, updated_at = ?, finished_at = ? WHERE id = ?`)
      .bind(failed.length ? "FAILED" : "PASSED", JSON.stringify(log), failed.length ? failed.map((f) => `${f.id}: ${f.error}`).join("; ").slice(0, 500) : null, t, t, row.id).run();
    done.push({ id: row.id, log });
  }
  return done;
}

export { KIND, advanceSandboxCancels };
