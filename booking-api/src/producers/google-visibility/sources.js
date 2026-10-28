// Google Visibility: what Menu-Made already knows about a business that can fill gaps on its Google profile. Only
// facts the business gave us for public use count: its live Menu-Made website, its hosted menu, the public phone and
// story from its website form, and the logo and photos it uploaded (customer-supplied, rights confirmed). The phone
// typed at checkout is never used: it may be a personal number.
import { publicBaseUrl } from "../../lib/config.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { checkPhoto } from "../google-care/library.js";
import { siteUrl } from "../website/presenter.js";

const MAX_PHOTO_CANDIDATES = 8;

async function liveWebsite(env, businessId) {
  const site = await env.DB.prepare(`
      SELECT s.slug, s.custom_domain, s.domain_status FROM website_sites s
      WHERE s.business_id = ? AND EXISTS (
        SELECT 1 FROM projects p
        JOIN deliverables d ON d.project_id = p.id AND d.deliverable_type = 'SITE_BUILD' AND d.status = 'FINAL' AND d.customer_visible = 1
        JOIN assets a ON a.id = d.asset_id
        WHERE p.business_id = s.business_id AND json_extract(a.metadata_json, '$.website.slug') = s.slug)
      ORDER BY s.updated_at DESC LIMIT 1
    `).bind(businessId).first();
  if (!site) return null;
  return site.domain_status === "ACTIVE" && site.custom_domain ? `https://${site.custom_domain}/` : siteUrl(env, site.slug);
}

async function hostedMenu(env, businessId) {
  const row = await env.DB.prepare(`
      SELECT pi.value_text FROM project_inputs pi
      JOIN projects p ON p.id = pi.project_id
      WHERE p.business_id = ? AND p.workflow_key = 'MENU_QR_V1' AND pi.input_key = 'qr_destination' AND pi.value_text LIKE ?
        AND EXISTS (SELECT 1 FROM deliverables d WHERE d.project_id = p.id AND d.deliverable_type = 'MENU_DRAFT' AND d.status = 'FINAL' AND d.customer_visible = 1)
      ORDER BY p.created_at DESC LIMIT 1
    `).bind(businessId, `${publicBaseUrl(env)}/api/menu/%`).first();
  return row?.value_text || null;
}

// The newest website form's answers (phone, about), or {}.
async function websiteForm(env, businessId) {
  const project = await env.DB.prepare(`
      SELECT p.id FROM projects p WHERE p.business_id = ? AND p.workflow_key = 'WEBSITE_PACKAGE_V1'
        AND EXISTS (SELECT 1 FROM project_inputs pi WHERE pi.project_id = p.id AND pi.input_key = 'about' AND pi.status = 'VALID')
      ORDER BY p.created_at DESC LIMIT 1
    `).bind(businessId).first();
  if (!project) return {};
  const rows = (await env.DB.prepare(`SELECT input_key, value_text FROM project_inputs WHERE project_id = ? AND status = 'VALID' AND input_key IN ('phone', 'about', 'kind')`).bind(project.id).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.input_key, String(r.value_text || "").trim()]));
}

// Customer-supplied images that meet Google's photo rules (PNG or JPG, 10 KB to 5 MB, at least 250 px).
async function usableImages(env, businessId, assetType, limit) {
  const rows = (await env.DB.prepare(`
      SELECT id, storage_key, metadata_json FROM assets
      WHERE business_id = ? AND asset_type = ? AND status = 'VALID' AND is_customer_supplied = 1 AND rights_confirmed = 1
        AND mime_type IN ('image/png', 'image/jpeg')
      ORDER BY uploaded_at DESC LIMIT ?
    `).bind(businessId, assetType, MAX_PHOTO_CANDIDATES).all()).results || [];
  const out = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    if (parseJsonOrNull(row.metadata_json)?.google_visibility_uploaded) continue;
    const object = await env.ASSETS.get(row.storage_key);
    if (!object) continue;
    if (!checkPhoto(new Uint8Array(await object.arrayBuffer())).error) out.push(row.id);
  }
  return out;
}

async function businessSources(env, businessId) {
  if (!businessId) return {};
  const form = await websiteForm(env, businessId);
  return {
    website: await liveWebsite(env, businessId),
    menu: await hostedMenu(env, businessId),
    phone: form.phone || null,
    about: form.about || null,
    logoAssetId: (await usableImages(env, businessId, "LOGO", 1))[0] || null,
    photoAssetIds: await usableImages(env, businessId, "PHOTO", 5)
  };
}

export { businessSources, liveWebsite, hostedMenu };
