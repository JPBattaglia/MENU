// Social Posts PNGs are drawn outside the Worker. On the free plan a scheduled run gets 10 ms of CPU, and turning 24
// SVGs into PNGs takes far longer, so Cloudflare ended the run mid-step (Oct 27, 2026). The PRODUCE step now parks a
// render job (the SVGs and captions in R2, the step WAITING) and a GitHub Actions workflow in JPBattaglia/MENU
// (.github/workflows/render-social-posts.yml) collects it every 5 minutes, draws the PNGs with resvg, zips them and
// posts the ZIP back here. Delivery then continues exactly as before.
//
// Auth needs no shared secret: the workflow sends a GitHub Actions OIDC token, and only that one workflow, on master
// of JPBattaglia/MENU, is accepted. Fork pull requests never receive such a token.
//
// Routes (all Bearer <GitHub OIDC token>):
//   GET  /api/render-jobs/next   -> { job: "<id>" | null }
//   GET  /api/render-jobs/<id>   -> the job spec (JSON)
//   POST /api/render-jobs/<id>   -> body: the finished ZIP; stores it and resumes the workflow
import { jsonResponse, nowIso, parseJsonOrNull } from "../../lib/http.js";
import { completeStep } from "../../workflows/runner.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { ownerEmailAddress } from "../../lib/config.js";
import { brandedEmailHtml, sendTransactionalEmail } from "../../lib/email.js";

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const OIDC_AUDIENCE = "menu-made-render";
const RENDER_REPOSITORY = "JPBattaglia/MENU";
const RENDER_WORKFLOW = "JPBattaglia/MENU/.github/workflows/render-social-posts.yml@refs/heads/master";
const MAX_ZIP_BYTES = 40 * 1024 * 1024;
const specKey = (id) => `render-jobs/social/${id}/spec.json`;

// ---------- Queue (called from the PRODUCE step) ----------

// Workflows whose PRODUCE step can wait for the renderer. Guest App setups use it for their home-screen icons, the
// Nino design services (stage 10) for every design they make.
const RENDER_WORKFLOWS = ["SOCIAL_POSTS_V1", "GUEST_APP_SETUP_V1", "NINO_SOCIAL_PACK_V1", "NINO_FLYER_V1", "NINO_MENU_DESIGN_V1", "NINO_LOGO_V1"];
const RENDER_IN = `wr.workflow_key IN (${RENDER_WORKFLOWS.map((k) => `'${k}'`).join(", ")})`;

// files: [{ name, svg, width, height, min_bytes? }]; extra: [{ name, text }]; assets: { logo: data URI } substituted
// for __LOGO_DATA_URI__ in the SVGs by the renderer; finish: what the result handler needs later (finish.kind picks it).
// fonts: display font families the renderer should load (Nino designs); preview: { title, sections, widths } asks the
// renderer to add preview.html (small copies of the images on one page) to the ZIP.
async function queueRender(env, targetStep, { kind = "SOCIAL", files, extra = [], assets = {}, fonts = [], preview = null, finish }) {
  const id = targetStep.workflow_step_id;
  await env.ASSETS.put(specKey(id), JSON.stringify({ version: 1, id, kind, zip_name: finish.pack_filename, files, extra, assets, ...(fonts.length ? { fonts } : {}), ...(preview ? { preview } : {}) }), {
    httpMetadata: { contentType: "application/json" }
  });
  const output = { waiting_for: "RENDER", render_job: id, requested_at: nowIso(), finish };
  await env.DB.prepare(`UPDATE workflow_steps SET status = 'WAITING', error_message = NULL, output_json = ? WHERE id = ?`)
    .bind(JSON.stringify(output), id).run();
  await env.DB.prepare(`UPDATE workflow_runs SET status = 'WAITING', error_code = 'RENDER_PENDING', error_message = 'Waiting for the graphics to be drawn' WHERE id = ?`)
    .bind(targetStep.workflow_run_id).run();
  await startRenderer(env, id); // never fails the step: the schedule and nudgeWaitingRenders are the fallbacks
  return {
    waiting: true,
    response: jsonResponse({ ok: true, processed: true, status: "WAITING", waiting_for: "RENDER", workflow_run_id: targetStep.workflow_run_id, step_key: targetStep.step_key }, 202)
  };
}
const queueSocialRender = (env, targetStep, job) => queueRender(env, targetStep, { ...job, kind: "SOCIAL" });

// ---------- Starting the renderer ----------

// GitHub's own schedule for the workflow never fired in its first hour (Oct 27, 2026), so the worker starts the
// workflow itself through the GitHub API the moment a job is parked. GITHUB_DISPATCH_TOKEN is a fine-grained token
// limited to Actions: read and write on JPBattaglia/MENU. Without it, or if GitHub refuses, the job still waits for
// the schedule and the hourly owner alert below.
const DISPATCH_URL = "https://api.github.com/repos/JPBattaglia/MENU/actions/workflows/render-social-posts.yml/dispatches";
const NUDGE_AFTER_MINUTES = 10;
const NUDGE_EVERY_MINUTES = 15;

async function startRenderer(env, jobId) {
  if (!env.GITHUB_DISPATCH_TOKEN) return { started: false, reason: "no token" };
  let status = 0;
  try {
    const response = await (env.GITHUB_DISPATCH_FETCH || fetch)(DISPATCH_URL, { // GITHUB_DISPATCH_FETCH is a test seam
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "menu-made-worker", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "master" })
    });
    status = response.status;
  } catch (error) {
    console.error("Renderer start failed:", error instanceof Error ? error.message : String(error));
  }
  const started = status === 204;
  if (!started) console.error(`Renderer start refused: HTTP ${status}`);
  await env.DB.prepare(`UPDATE workflow_steps SET output_json = json_set(output_json, '$.dispatched_at', ?, '$.dispatch_status', ?) WHERE id = ? AND status = 'WAITING'`)
    .bind(nowIso(), status, jobId).run().catch(() => null);
  return { started, status };
}

// Called every 5-minute tick: a job still undrawn 10 minutes after it was parked gets the renderer started again,
// at most every 15 minutes (a dispatch can be lost, or the run can fail).
async function nudgeWaitingRenders(env, now = Date.now()) {
  if (!env.GITHUB_DISPATCH_TOKEN) return [];
  const waitedSince = new Date(now - NUDGE_AFTER_MINUTES * 60000).toISOString();
  const lastNudge = new Date(now - NUDGE_EVERY_MINUTES * 60000).toISOString();
  const jobs = (await env.DB.prepare(`
      SELECT ws.id FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
      WHERE ws.status = 'WAITING' AND ws.step_key = 'PRODUCE' AND ${RENDER_IN}
        AND json_extract(ws.output_json, '$.waiting_for') = 'RENDER'
        AND json_extract(ws.output_json, '$.requested_at') < ?
        AND COALESCE(json_extract(ws.output_json, '$.dispatched_at'), '') < ?
      LIMIT 1
    `).bind(waitedSince, lastNudge).all()).results || [];
  // One dispatch covers every waiting job: a run processes up to 5.
  if (jobs.length) await startRenderer(env, jobs[0].id);
  return jobs.map((job) => job.id);
}

// ---------- GitHub Actions OIDC ----------

const b64url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
let jwksCache = null; // { at, keys }

async function signingKey(kid, fetchImpl) {
  const fresh = jwksCache && Date.now() - jwksCache.at < 3600000;
  if (!fresh || !jwksCache.keys.some((k) => k.kid === kid)) {
    const response = await fetchImpl(`${OIDC_ISSUER}/.well-known/jwks`);
    if (!response.ok) throw new Error(`GitHub JWKS ${response.status}`);
    jwksCache = { at: Date.now(), keys: (await response.json()).keys || [] };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid);
  if (!jwk) return null;
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

// Also used by the Store App build (src/store-app/build-credentials.js) with its own audience and workflow, and only for
// a manual run (event workflow_dispatch) when `events` is given.
async function verifyRenderer(request, env, { audience: wanted = OIDC_AUDIENCE, workflow = RENDER_WORKFLOW, events = null } = {}) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401, error: "A GitHub Actions identity token is required" };
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
    if (header.alg !== "RS256") return { ok: false, status: 403, error: "Unsupported token" };
    const key = await signingKey(header.kid, env.RENDER_OIDC_FETCH || fetch); // RENDER_OIDC_FETCH is a test seam
    if (!key) return { ok: false, status: 403, error: "Unknown signing key" };
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    const now = Math.floor(Date.now() / 1000);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!valid || claims.iss !== OIDC_ISSUER || !audience.includes(wanted) || !(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)
      || claims.repository !== RENDER_REPOSITORY || claims.ref !== "refs/heads/master" || claims.job_workflow_ref !== workflow
      || (events && !events.includes(claims.event_name))) {
      return { ok: false, status: 403, error: "This token may not render" };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 403, error: "Invalid token" };
  }
}

// ---------- Result checks (cheap: directory and PNG headers only, no checksums) ----------

function listZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && end > bytes.length - 22 - 65535 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error("Not a ZIP file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error("Corrupt ZIP directory");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (local + 30 > bytes.length) throw new Error("Corrupt ZIP entry");
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (method !== 0 || dataStart + size > bytes.length) throw new Error(`Unsupported or truncated entry ${name}`);
    entries.push({ name, data: bytes.subarray(dataStart, dataStart + size) });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

function pngSize(data) {
  if (data.length < 24) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint32(0) !== 0x89504e47 || v.getUint32(4) !== 0x0d0a1a0a) return null;
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

// Every PNG the spec asked for, at its size, plus the extra text files: anything else is refused.
function checkPack(entries, spec) {
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  for (const file of spec.files) {
    const data = byName.get(file.name);
    if (!data) return `${file.name} is missing`;
    const size = pngSize(data);
    if (!size) return `${file.name} is not a PNG`;
    if (size.width !== file.width || size.height !== file.height) return `${file.name} is ${size.width}x${size.height}, expected ${file.width}x${file.height}`;
    if (data.length < (file.min_bytes ?? 2000)) return `${file.name} is suspiciously small (${data.length} bytes)`;
  }
  for (const file of spec.extra || []) if (!byName.has(file.name)) return `${file.name} is missing`;
  const previewFiles = spec.preview ? 1 : 0;
  if (spec.preview && !byName.has("preview.html")) return "preview.html is missing";
  const expected = spec.files.length + (spec.extra || []).length + previewFiles;
  if (entries.length !== expected) return `the ZIP holds ${entries.length} files, expected ${expected}`;
  return null;
}

// ---------- Routes ----------

async function waitingStep(env, id) {
  return env.DB.prepare(`
      SELECT ws.id, ws.workflow_run_id, ws.step_key, ws.step_order, ws.output_json, wr.project_id, wr.workflow_key, wr.workflow_version
      FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
      WHERE ws.id = ? AND ws.status = 'WAITING' AND ws.step_key = 'PRODUCE' AND ${RENDER_IN}
    `).bind(id).first();
}

async function handleRenderJobs(request, env, jobId) {
  const auth = await verifyRenderer(request, env);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  if (jobId === "next") {
    const next = await env.DB.prepare(`
        SELECT ws.id FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
        WHERE ws.status = 'WAITING' AND ws.step_key = 'PRODUCE' AND ${RENDER_IN}
          AND json_extract(ws.output_json, '$.waiting_for') = 'RENDER'
        ORDER BY json_extract(ws.output_json, '$.requested_at') LIMIT 1
      `).first();
    return jsonResponse({ ok: true, job: next?.id || null });
  }

  const step = await waitingStep(env, jobId);
  const waiting = parseJsonOrNull(step?.output_json);
  if (!step || waiting?.waiting_for !== "RENDER") return jsonResponse({ ok: false, error: "No render job waiting with that id" }, 404);
  const spec = await env.ASSETS.get(specKey(jobId));
  if (!spec) return jsonResponse({ ok: false, error: "The render job's files are missing" }, 410);

  if (request.method === "GET") {
    return new Response(spec.body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_ZIP_BYTES) return jsonResponse({ ok: false, error: "The ZIP is too large" }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_ZIP_BYTES) return jsonResponse({ ok: false, error: "The ZIP is too large" }, 413);
  const specJson = await spec.json();
  let problem;
  try { problem = checkPack(listZip(bytes), specJson); } catch (error) { problem = error.message; }
  if (problem) return jsonResponse({ ok: false, error: `The ZIP was refused: ${problem}` }, 422);

  const context = await loadDeliveryContext(step.project_id, env);
  if (!context) return jsonResponse({ ok: false, error: "Production project could not be loaded" }, 404);
  const { finish } = waiting;
  // Claim the job before storing, so a second upload of the same job cannot create a second pack.
  const claimed = await env.DB.prepare(`UPDATE workflow_steps SET status = 'RUNNING', started_at = ? WHERE id = ? AND status = 'WAITING'`)
    .bind(nowIso(), jobId).run();
  if (Number(claimed.meta?.changes || 0) === 0) return jsonResponse({ ok: false, error: "This render job was already finished" }, 409);
  let output;
  if (finish.kind === "GUEST_APP" || finish.kind === "NINO_DESIGN") {
    try {
      if (finish.kind === "NINO_DESIGN") {
        const { finishNinoDesignRender } = await import("../nino-design/produce.js");
        output = await finishNinoDesignRender(env, context, listZip(bytes), finish, { zipBytes: bytes });
      } else {
        const { finishGuestAppRender } = await import("../guest-app/app-step.js");
        output = await finishGuestAppRender(env, context, listZip(bytes), finish);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(`UPDATE workflow_steps SET status = 'FAILED', error_message = ?, completed_at = ? WHERE id = ?`).bind(message.slice(0, 500), nowIso(), jobId).run();
      await env.DB.prepare(`UPDATE workflow_runs SET status = 'FAILED', error_code = 'RENDER_FINISH_FAILED', error_message = ? WHERE id = ?`).bind(message.slice(0, 500), step.workflow_run_id).run();
      return jsonResponse({ ok: false, error: "The finished files could not be used" }, 422);
    }
  } else {
    const pack = await storeDeliverable(env, context, {
      type: "SOCIAL_PACK", filename: finish.pack_filename, mime: "application/zip", bytes, folder: "social-pack", metadata: { social: finish.care }
    });
    output = { ...finish.output, png_files: specJson.files.length, pack_deliverable: pack.deliverableId, version: pack.version, rendered_by: "github-actions" };
  }
  await completeStep({
    workflow_step_id: step.id, workflow_run_id: step.workflow_run_id, project_id: step.project_id, step_key: step.step_key,
    workflow_key: step.workflow_key, workflow_version: step.workflow_version
  }, output, env);
  await env.DB.prepare(`UPDATE workflow_runs SET status = 'RUNNING', error_code = NULL, error_message = NULL WHERE id = ? AND status = 'WAITING'`)
    .bind(step.workflow_run_id).run();
  await env.ASSETS.delete(specKey(jobId)).catch(() => null);
  return jsonResponse({ ok: true, job: jobId, stored: specJson.files.length });
}

// ---------- Stalled renders ----------

// GitHub can start scheduled workflows late, and pauses them in a public repo after 60 days without commits. A job
// still undrawn an hour after it was queued means the renderer is not running: the owner is told once per job.
const STALE_RENDER_MINUTES = 60;

async function alertStaleRenders(env, now = Date.now()) {
  const cutoff = new Date(now - STALE_RENDER_MINUTES * 60000).toISOString();
  const stale = (await env.DB.prepare(`
      SELECT ws.id, wr.project_id FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
      WHERE ws.status = 'WAITING' AND ws.step_key = 'PRODUCE' AND ${RENDER_IN}
        AND json_extract(ws.output_json, '$.waiting_for') = 'RENDER'
        AND json_extract(ws.output_json, '$.requested_at') < ?
        AND json_extract(ws.output_json, '$.stale_alerted_at') IS NULL
      LIMIT 5
    `).bind(cutoff).all()).results || [];
  for (const job of stale) {
    const sent = await sendTransactionalEmail(env, {
      to: ownerEmailAddress(env),
      subject: "Graphics are waiting to be drawn",
      html: brandedEmailHtml({
        preheader: "The GitHub renderer has not picked up a job for over an hour.",
        eyebrow: "AUTOMATION ALERT",
        heading: "Graphics have waited over an hour",
        paragraphs: [
          "Social Posts graphics, Guest App icons or a Nino design are waiting, but GitHub has not drawn them yet, so nothing has gone to you for approval.",
          "Open the JPBattaglia/MENU repository on GitHub, go to Actions, choose \"Render social posts\" and click \"Run workflow\". If the workflow shows as disabled, enable it first."
        ],
        rows: [["Render job", job.id]]
      }),
      text: `Graphics (Social Posts or Guest App icons) have waited over an hour to be drawn.\nOpen JPBattaglia/MENU on GitHub > Actions > "Render social posts" > Run workflow (enable it first if disabled).\nRender job: ${job.id}`,
      idempotencyKey: `render-stale/${job.id}`,
      purpose: "AUTOMATION_ALERT",
      templateKey: "render_stale_v1"
    }).catch(() => ({ ok: false }));
    if (sent?.ok === false) continue;
    await env.DB.prepare(`UPDATE workflow_steps SET output_json = json_set(output_json, '$.stale_alerted_at', ?) WHERE id = ? AND status = 'WAITING'`)
      .bind(nowIso(), job.id).run();
  }
  return stale.map((job) => job.id);
}

export { NUDGE_AFTER_MINUTES, nudgeWaitingRenders, startRenderer, OIDC_AUDIENCE, RENDER_WORKFLOW, STALE_RENDER_MINUTES, alertStaleRenders, checkPack, handleRenderJobs, listZip, pngSize, queueRender, queueSocialRender, RENDER_WORKFLOWS, verifyRenderer };
