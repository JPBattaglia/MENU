// Logo, designed by Nino by hand (owner, Nov 7, 2026: "Have Nino design each logo"). The automatic wordmarks were the
// business name typed in stock fonts, not worth $249. Now PRODUCE emails Nino the buyer's brief with a private upload
// link and waits; Nino uploads a preview image of each concept (1 to 3) and one ZIP of the final files, which become
// the preview page and the pack. The shared DELIVER step then asks the owner to approve before the buyer gets them;
// "Request changes" runs PRODUCE again, so Nino gets the owner's note and a fresh link.
//   GET/POST /api/nino-logo/<stepId>?t=<token>   Nino's upload page
// Test orders (Stripe test mode) email the owner instead of Nino; the daily self-test plays Nino itself (no email).
import { ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { bytesToBase64 } from "../../lib/util.js";
import { NINO_REPLY_TO } from "../../nino-mail.js";
import { isTestOrder, loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { sniffImage } from "../website/intake.js";

const KIND = "nino-logo";
const LINK_DAYS = 30;
const MAX_CONCEPTS = 3;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_PACK_BYTES = 40 * 1024 * 1024;
const STALE_DAYS = 4;
const e = escapeHtml;

const designerEmail = (env) => env.NINO_DESIGNER_EMAIL || NINO_REPLY_TO;
const uploadLink = async (env, stepId) => `${publicBaseUrl(env)}/api/nino-logo/${stepId}?t=${encodeURIComponent(await signLinkToken(env, { kind: KIND, id: stepId, ttlDays: LINK_DAYS }))}`;

const BRIEF_LABELS = [["business_name", "Name for the logo"], ["tagline", "Tagline"], ["style", "Style"], ["brand_colors", "Colours"], ["ideas", "Ideas, likes and dislikes"], ["usage", "Where it will be used"]];
const briefRows = (brief) => BRIEF_LABELS.filter(([k]) => String(brief[k] || "").trim()).map(([k, label]) => [label, String(brief[k]).trim()]);

// PRODUCE for NINO_LOGO: park the step and ask Nino.
async function requestHandLogo(env, targetStep, context, { brief, note, finish }) {
  const stepId = targetStep.workflow_step_id;
  const output = { waiting_for: "NINO", requested_at: nowIso(), finish };
  await env.DB.prepare(`UPDATE workflow_steps SET status = 'WAITING', error_message = NULL, output_json = ? WHERE id = ?`).bind(JSON.stringify(output), stepId).run();
  await env.DB.prepare(`UPDATE workflow_runs SET status = 'WAITING', error_code = 'NINO_DESIGNING', error_message = 'Waiting for Nino to upload the logo designs' WHERE id = ?`).bind(targetStep.workflow_run_id).run();
  const selfTest = String(context.customer_email || "").toLowerCase() === SELF_TEST_EMAIL;
  if (!selfTest) {
    const link = await uploadLink(env, stepId);
    const to = isTestOrder(context) ? ownerEmailAddress(env) : designerEmail(env);
    const business = brief.business_name || context.business_name || "a customer";
    const rows = briefRows(brief);
    await sendTransactionalEmail(env, {
      to,
      subject: `${note ? "Logo changes requested" : "New logo to design"}: ${business}${isTestOrder(context) ? " (test order)" : ""}`,
      html: brandedEmailHtml({
        preheader: `${business} bought a logo. The brief and your upload link are inside.`,
        eyebrow: "NINO BATTAGLIA DESIGN",
        heading: note ? `Changes for ${business}'s logo` : `New logo: ${business}`,
        paragraphs: [
          ...(note ? [`<strong>The changes asked for:</strong> ${e(note)}`] : [`${e(business)} bought a logo on ninobattaglia.com. Here is their brief.`]),
          `<table style="border-collapse:collapse">${rows.map(([l, v]) => `<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><strong>${e(l)}</strong></td><td style="padding:4px 0">${e(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`,
          `Design 1 to ${MAX_CONCEPTS} concepts. When they're ready, open the upload page and add a preview image of each concept and one ZIP with the final files (PNG with a transparent background, plus SVG or PDF if you have them).`,
          "We show the owner first; the buyer gets the files once they're approved."
        ],
        buttons: [{ label: "Upload the designs", url: link, primary: true }],
        footnote: `The upload link works for ${LINK_DAYS} days.`
      }),
      text: `${note ? `Changes asked for: ${note}\n\n` : ""}${rows.map(([l, v]) => `${l}: ${v}`).join("\n")}\n\nUpload the designs (1 to ${MAX_CONCEPTS} concept previews and one ZIP of final files): ${link}`,
      idempotencyKey: `nino-logo/${stepId}`, purpose: "OWNER_ACTION", templateKey: note ? "nino_logo_changes_v1" : "nino_logo_request_v1"
    }).catch((error) => console.error("Nino logo email failed:", error instanceof Error ? error.message : String(error)));
  }
  return { waiting: true, response: new Response(JSON.stringify({ ok: true, processed: true, status: "WAITING", waiting_for: "NINO", workflow_run_id: targetStep.workflow_run_id, step_key: targetStep.step_key }), { status: 202, headers: { "Content-Type": "application/json" } }) };
}

// Names in a ZIP's central directory (no checksums: the ZIP is stored as uploaded, and checking every byte would cost
// more CPU than the worker has).
function zipNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && end > bytes.length - 65600 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) return null;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return null;
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    names.push(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + extra + comment;
  }
  return names;
}

function previewHtml({ title, concepts, note }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title>
<style>body{margin:0;background:#f4f1ec;font:16px/1.55 system-ui,sans-serif;color:#1d1d1b}main{max-width:900px;margin:0 auto;padding:28px 16px 48px}h1{font-size:28px;margin:0 0 6px}h2{font-size:19px;margin:28px 0 10px}.card{background:#fff;border:1px solid #e3ddd2;border-radius:12px;padding:14px}.card img{display:block;max-width:100%;height:auto;margin:0 auto}.note{background:#fff;border-left:4px solid #c9a227;padding:10px 14px}</style></head>
<body><main><h1>${e(title)}</h1><p>Designed by hand by Nino Battaglia. The final files are in the ZIP.</p>${note ? `<p class="note">${e(note).replace(/\n/g, "<br>")}</p>` : ""}
${concepts.map((c, i) => `<h2>Concept ${i + 1}${c.name ? `: ${e(c.name)}` : ""}</h2><div class="card"><img src="data:${c.mime};base64,${c.b64}" alt="Logo concept ${i + 1}"></div>`).join("\n")}
</main></body></html>`;
}

async function loadWaiting(env, stepId) {
  const step = await env.DB.prepare(`SELECT ws.id, ws.workflow_run_id, ws.step_key, ws.status, ws.output_json, wr.project_id, wr.workflow_key, wr.workflow_version FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id WHERE ws.id = ?`).bind(stepId).first();
  const waiting = parseJsonOrNull(step?.output_json);
  return step && step.status === "WAITING" && waiting?.waiting_for === "NINO" ? { step, waiting } : null;
}

function formPage(action, brief, error = "") {
  const rows = briefRows(brief);
  const concept = (n) => `<fieldset style="border:1px solid #dce8ec;padding:12px;margin:0 0 14px"><legend><strong>Concept ${n}${n === 1 ? "" : " (optional)"}</strong></legend>
<label style="display:grid;gap:4px">Preview image (PNG, JPG or WebP, up to 2 MB)<input type="file" name="concept_${n}" accept="image/png,image/jpeg,image/webp"${n === 1 ? " required" : ""}></label>
<label style="display:grid;gap:4px;margin-top:8px">Name (optional)<input name="concept_${n}_name" maxlength="60" style="font:inherit;padding:8px"></label></fieldset>`;
  return simplePage(error ? 400 : 200, "Upload the logo designs", `${error ? `<p style="color:#9b1c1c"><strong>${e(error)}</strong></p>` : ""}
<dl>${rows.map(([l, v]) => `<dt>${e(l)}</dt><dd>${e(v).replace(/\n/g, "<br>")}</dd>`).join("")}</dl>
<form method="post" enctype="multipart/form-data" action="${e(action)}">
${[1, 2, 3].map(concept).join("\n")}
<label style="display:grid;gap:4px;font-weight:bold">Final files, as one ZIP (up to 40 MB)<input type="file" name="pack" accept=".zip,application/zip" required></label>
<p style="font-size:14px;color:#45616c">Include a transparent PNG of each concept, plus SVG or PDF if you have them.</p>
<label style="display:grid;gap:4px;font-weight:bold">Note to the customer (optional)<textarea name="note" rows="3" maxlength="600" style="font:inherit;padding:8px"></textarea></label>
<p><button type="submit">Send the designs</button></p></form>`);
}

async function handleNinoLogoUpload(request, env, stepId) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") || "";
  const payload = await verifyLinkToken(env, token, [KIND], stepId);
  if (!payload || payload.expired) return simplePage(403, "This link has expired or isn't valid", "<p>Ask the owner for a fresh upload link.</p>");
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const found = await loadWaiting(env, stepId);
  if (!found) return simplePage(200, "Already received", "<p>These designs are already in. Thank you.</p>");
  const context = await loadDeliveryContext(found.step.project_id, env);
  if (!context) return simplePage(404, "Not found", "<p>This order could not be found.</p>");
  const briefRowsDb = (await env.DB.prepare(`SELECT input_key, value_text FROM project_inputs WHERE project_id = ? AND value_text IS NOT NULL`).bind(context.id).all()).results || [];
  const brief = Object.fromEntries(briefRowsDb.map((r) => [r.input_key, r.value_text]));
  const action = `${url.pathname}?t=${encodeURIComponent(token)}`;
  if (request.method !== "POST") return formPage(action, brief);

  const form = await request.formData().catch(() => null);
  if (!form) return formPage(action, brief, "The upload could not be read. Try again.");
  const fileOf = (name) => { const f = form.get(name); return f && typeof f === "object" && typeof f.arrayBuffer === "function" && f.size > 0 ? f : null; };
  const concepts = [];
  for (let n = 1; n <= MAX_CONCEPTS; n++) {
    const f = fileOf(`concept_${n}`);
    if (!f) continue;
    if (f.size > MAX_PREVIEW_BYTES) return formPage(action, brief, `Concept ${n}'s preview is over 2 MB. Export a smaller preview; the full files go in the ZIP.`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type) return formPage(action, brief, `Concept ${n}'s preview isn't a PNG, JPG or WebP image.`);
    concepts.push({ name: String(form.get(`concept_${n}_name`) || "").replace(/\s+/g, " ").trim().slice(0, 60), mime: type.mime, b64: bytesToBase64(bytes) });
  }
  if (!concepts.length) return formPage(action, brief, "Add a preview image of at least one concept.");
  const packFile = fileOf("pack");
  if (!packFile) return formPage(action, brief, "Add the ZIP of final files.");
  if (packFile.size > MAX_PACK_BYTES) return formPage(action, brief, "The ZIP is over 40 MB.");
  const packBytes = new Uint8Array(await packFile.arrayBuffer());
  const names = zipNames(packBytes);
  if (!names) return formPage(action, brief, "That file isn't a ZIP.");
  if (!names.some((n) => !n.endsWith("/"))) return formPage(action, brief, "The ZIP is empty.");
  if (names.some((n) => n.includes("..") || n.startsWith("/"))) return formPage(action, brief, "The ZIP has file names that aren't allowed (\"..\" or a leading /).");

  // Claim the step first, so a double submit cannot store two packs.
  const claimed = await env.DB.prepare(`UPDATE workflow_steps SET status = 'RUNNING', started_at = ? WHERE id = ? AND status = 'WAITING'`).bind(nowIso(), stepId).run();
  if (Number(claimed.meta?.changes || 0) === 0) return simplePage(200, "Already received", "<p>These designs are already in. Thank you.</p>");
  const { finish } = found.waiting;
  const business = brief.business_name || context.business_name || "Your business";
  const note = String(form.get("note") || "").trim().slice(0, 600);
  const html = new TextEncoder().encode(previewHtml({ title: `${business} - Logo`, concepts, note }));
  const { finishNinoDesignRender } = await import("./produce.js");
  const output = await finishNinoDesignRender(env, context, [{ name: "preview.html", data: html }],
    { ...finish, info: { ...(finish.info || {}), hand_designed: true, concepts: concepts.length, files: names.filter((n) => !n.endsWith("/")).length } }, { zipBytes: packBytes });
  await completeStep({ workflow_step_id: found.step.id, workflow_run_id: found.step.workflow_run_id, project_id: found.step.project_id, step_key: found.step.step_key, workflow_key: found.step.workflow_key, workflow_version: found.step.workflow_version }, { ...output, concepts: concepts.length }, env);
  await env.DB.prepare(`UPDATE workflow_runs SET status = 'RUNNING', error_code = NULL, error_message = NULL WHERE id = ? AND status = 'WAITING'`).bind(found.step.workflow_run_id).run();
  return simplePage(200, "Thank you, Nino", `<p>${concepts.length} concept${concepts.length === 1 ? "" : "s"} and the final files are in. The owner approves them next, then ${e(business)} gets them.</p>`);
}

// Cron (daily): a logo still waiting on Nino after STALE_DAYS tells the owner once, with the upload link to pass on.
async function alertStaleHandLogos(env, { now = Date.now() } = {}) {
  if (!env.DB) return 0;
  const { results = [] } = await env.DB.prepare(`
      SELECT ws.id, ws.output_json, wr.project_id FROM workflow_steps ws JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
      WHERE ws.status = 'WAITING' AND json_extract(ws.output_json, '$.waiting_for') = 'NINO'
        AND json_extract(ws.output_json, '$.requested_at') < ? AND json_extract(ws.output_json, '$.alerted_at') IS NULL LIMIT 5
    `).bind(new Date(now - STALE_DAYS * 864e5).toISOString()).all();
  let sent = 0;
  for (const row of results) {
    const waiting = parseJsonOrNull(row.output_json) || {};
    await env.DB.prepare(`UPDATE workflow_steps SET output_json = ? WHERE id = ?`).bind(JSON.stringify({ ...waiting, alerted_at: new Date(now).toISOString() }), row.id).run();
    const context = await loadDeliveryContext(row.project_id, env);
    if (!context || String(context.customer_email || "").toLowerCase() === SELF_TEST_EMAIL) continue;
    const link = await uploadLink(env, row.id);
    const result = await sendTransactionalEmail(env, {
      to: ownerEmailAddress(env),
      subject: `[Logo] ${context.business_name || "A customer"}'s logo is still waiting on Nino`,
      html: brandedEmailHtml({ eyebrow: "LOGO", heading: `${e(context.business_name || "A customer")}'s logo: ${STALE_DAYS} days with no designs`,
        paragraphs: [`Nino was emailed the brief ${STALE_DAYS} days ago and hasn't uploaded the designs yet. The buyer is waiting.`, "Check in with Nino. If he needs the link again, forward him this button."],
        buttons: [{ label: "Upload page for Nino", url: link, primary: true }] }),
      text: `${context.business_name}'s logo has waited ${STALE_DAYS} days for Nino's designs. Upload page: ${link}`,
      idempotencyKey: `nino-logo-stale/${row.id}`, purpose: "AUTOMATION_ALERT", templateKey: "nino_logo_stale_v1"
    }).catch(() => null);
    if (result?.ok) sent++;
  }
  return sent;
}

export { KIND as NINO_LOGO_KIND, alertStaleHandLogos, designerEmail, handleNinoLogoUpload, requestHandLogo, uploadLink as ninoLogoUploadLink, zipNames };
