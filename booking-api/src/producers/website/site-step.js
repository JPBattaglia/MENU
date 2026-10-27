// Website Package PRODUCE step (stage 7): intake -> AI copy -> pages -> automated checks -> a SITE_BUILD draft.
// Nothing is live until the owner approves (the shared DELIVER step). A build that fails its checks, or copy that fails its
// quality checks twice, is never shown to the buyer: the owner is told what failed.
import { ownerEmailAddress } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { AiCapError } from "../../ai/generate.js";
import { loadRegenerationNote } from "../../approvals/actions.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { finishRun } from "../menu-care/care-step.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { buildSite } from "./build.js";
import { checkSite } from "./check.js";
import { writeCopy } from "./copy.js";

async function tellOwner(env, context, subject, reasons) {
  const business = context.business_name || "A customer";
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[Website Package] ${subject} for ${business}`,
    html: brandedEmailHtml({ eyebrow: "WEBSITE PACKAGE", heading: `${escapeHtml(business)}: ${escapeHtml(subject)}`, paragraphs: [`<ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`, "Nothing was shown to the customer."] }),
    text: `${business}: ${subject}\n- ${reasons.join("\n- ")}\nNothing was shown to the customer.`,
    idempotencyKey: `website-blocked/${context.id}/${reasons.join("|").length}`, purpose: "AUTOMATION_ALERT", templateKey: "website_blocked_v1"
  }).catch(() => null);
}

async function loadSiteInputs(env, projectId) {
  const rows = (await env.DB.prepare(`SELECT input_key, value_text FROM project_inputs WHERE project_id = ? AND status = 'VALID'`).bind(projectId).all()).results || [];
  const v = Object.fromEntries(rows.map((r) => [r.input_key, r.value_text || ""]));
  const assets = (await env.DB.prepare(`
      SELECT id, asset_type, storage_key, mime_type, size_bytes, json_extract(metadata_json, '$.site_image') AS kind, json_extract(metadata_json, '$.order') AS ord
      FROM assets WHERE project_id = ? AND status = 'VALID' AND json_extract(metadata_json, '$.site_image') IS NOT NULL ORDER BY ord ASC
    `).bind(projectId).all()).results || [];
  return { v, assets };
}

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

async function runWebsiteProduceStep(targetStep, env, deps = {}) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const business = context.business_name || "Your business";
  const blocked = async (subject, reasons) => {
    await tellOwner(env, context, subject, reasons);
    await finishRun(targetStep, context, { outcome: "NOT_PRODUCED", reasons }, env);
    return { outcome: "NOT_PRODUCED", reasons };
  };
  const { v, assets } = await loadSiteInputs(env, context.id);
  const siteRow = await env.DB.prepare(`SELECT slug FROM website_sites WHERE project_id = ?`).bind(context.id).first();
  if (!siteRow || !v.about || !v.offerings || !v.phone || !v.address || !v.hours) return blocked("the website details are incomplete", ["The intake form is missing required answers."]);

  const captions = String(v.photo_captions || "").split("\n").map((c) => c.trim());
  const photoAssets = assets.filter((a) => a.kind === "photo");
  const logoAsset = assets.find((a) => a.kind === "logo");
  const images = [];
  const photos = photoAssets.map((a, i) => {
    const path = `img/photo-${i + 1}.${EXT[a.mime_type] || "jpg"}`;
    images.push({ path, storage_key: a.storage_key, mime: a.mime_type, size: a.size_bytes });
    return { path, alt: (captions[i] || `Photo ${i + 1} of ${business}`).slice(0, 140) };
  });
  let logo = null;
  if (logoAsset) { logo = { path: `img/logo.${EXT[logoAsset.mime_type] || "png"}` }; images.push({ path: logo.path, storage_key: logoAsset.storage_key, mime: logoAsset.mime_type, size: logoAsset.size_bytes }); }
  const site = { name: business, kind: v.kind === "services" ? "services" : "restaurant", about: v.about, offerings: v.offerings, phone: v.phone, address: v.address, hours: v.hours, email: v.contact_email || "", style: v.style || "modern", brand: v.brand_color || "", facebook: v.facebook || "", instagram: v.instagram || "", photos, logo };

  const note = await loadRegenerationNote(env, context.id);
  const scope = { entityType: "PROJECT", entityId: context.id, correlationId: targetStep.workflow_run_id };
  const written = await writeCopy(env, site, { note: note?.note || "", scope }, deps.generate).catch((error) => (error instanceof AiCapError ? { capped: error.message } : Promise.reject(error)));
  if (written.capped) return blocked("monthly AI limit reached", [written.capped]);
  if (written.problems.length) return blocked("the website copy failed the quality checks", written.problems);

  const pages = buildSite(site, written.copy);
  const problems = checkSite({ pages, images: Object.fromEntries(images.map((i) => [i.path, i.size])), site });
  if (problems.length) return blocked("the built website failed its checks", problems);

  const build = { version: 1, slug: siteRow.slug, style: site.style, built_at: new Date().toISOString(), pages, images };
  const stored = await storeDeliverable(env, context, { type: "SITE_BUILD", filename: `${siteRow.slug}-site-v.json`, mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify(build)), folder: "site-build",
    metadata: { website: { slug: siteRow.slug, style: site.style, pages: Object.keys(pages).length, images: images.length, attempts: written.attempts, tagline: written.copy.tagline } } });
  const output = { outcome: "PRODUCED", slug: siteRow.slug, pages: Object.keys(pages).length, images: images.length, build_deliverable: stored.deliverableId, version: stored.version };
  await completeStep(targetStep, output, env);
  return output;
}

export { runWebsiteProduceStep };
