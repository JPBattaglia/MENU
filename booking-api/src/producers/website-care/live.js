// Website Care: which site a subscription looks after, and what is live on it now.
import { loadBuild } from "../website/serve.js";

// The (first) website Menu-made built for this business, with its newest approved build.
async function loadLiveSite(env, businessId) {
  const site = await env.DB.prepare(`SELECT id, slug, project_id, custom_domain FROM website_sites WHERE business_id = ? ORDER BY created_at ASC LIMIT 1`).bind(businessId).first();
  if (!site) return null;
  const row = await env.DB.prepare(`
      SELECT a.storage_key, d.version FROM projects p
      JOIN deliverables d ON d.project_id = p.id AND d.deliverable_type = 'SITE_BUILD' AND d.status = 'FINAL' AND d.customer_visible = 1
      JOIN assets a ON a.id = d.asset_id
      WHERE p.business_id = ? AND json_extract(a.metadata_json, '$.website.slug') = ?
      ORDER BY d.delivered_at DESC, d.created_at DESC, d.version DESC LIMIT 1
    `).bind(businessId, site.slug).first();
  if (!row) return { ...site, build: null };
  return { ...site, build: await loadBuild(env, row.storage_key) };
}

export { loadLiveSite };
