// Stage 15 (Nov 17, 2026): "an edit reaches every format and Google". The live menu page, print PDF, tri-fold, table
// tent and TV menu already follow the page itself. This carries an owner's menu edit to the other two places:
//   - the business's Menu-made-hosted website (a Your Website site from the generator): its menu section is rebuilt
//     from the edited menu and goes live at once, as a new SITE_BUILD of the same site (images and wording kept);
//   - its Google profile's menu (Google Business Profile food menus), when the business has connected Google.
// The owner made the edit themselves, so nothing here waits for approval. A failure never undoes the menu save; it
// is reported back to the editor ("couldn't update ...").
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { accessTokenFor, updateFoodMenus, v4LocationPath } from "../../google/api.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { buildDesignSite } from "../website/templates/index.js";
import { offeringsFromMenu } from "../../marketing/website-preview.js";
import { formAction } from "../site-files/site-form.js";
import { inlined } from "../site-files/files-step.js";
import { normalizeTags } from "./dietary.js";

const enc = new TextEncoder();

// The newest live generator build of the business's hosted website, with its project.
async function liveSiteBuild(env, businessId) {
  return env.DB.prepare(`
      SELECT d.id AS deliverable_id, d.project_id, a.storage_key, json_extract(a.metadata_json, '$.website.slug') AS slug,
        json_extract(a.metadata_json, '$.website.style') AS style
      FROM website_sites s
      JOIN projects p ON p.business_id = s.business_id
      JOIN deliverables d ON d.project_id = p.id AND d.deliverable_type = 'SITE_BUILD' AND d.status = 'FINAL' AND d.customer_visible = 1
      JOIN assets a ON a.id = d.asset_id
      WHERE s.business_id = ? AND json_extract(a.metadata_json, '$.website.slug') = s.slug
      ORDER BY d.delivered_at DESC, d.created_at DESC, d.version DESC LIMIT 1
    `).bind(businessId).first();
}

async function syncWebsiteMenu(env, businessId, menu) {
  const row = await liveSiteBuild(env, businessId).catch(() => null);
  if (!row) return { done: false, reason: "no_site" };
  if (!String(row.style || "").startsWith("generator:")) return { done: false, reason: "not_generator" };
  const object = await env.ASSETS.get(row.storage_key);
  const build = object ? parseJsonOrNull(await object.text()) : null;
  if (!build?.site || !build?.copy) return { done: false, reason: "no_source" };
  const offerings = offeringsFromMenu(menu);
  if (!offerings) return { done: false, reason: "empty" };
  if (offerings === build.site.offerings) return { done: true, unchanged: true };
  const site = { ...build.site, offerings };
  const design = String(row.style).slice("generator:".length);
  const files = buildDesignSite(site, build.copy, design, { formAction: await formAction(env, row.project_id) });
  const pages = Object.fromEntries(Object.keys(files).filter((f) => f.endsWith(".html")).map((f) => [f, inlined(files, f)]));
  const context = await loadDeliveryContext(row.project_id, env);
  if (!context) return { done: false, reason: "no_project" };
  const next = { ...build, built_at: nowIso(), pages, site, menu_synced_at: nowIso() };
  const stored = await storeDeliverable(env, context, { type: "SITE_BUILD", filename: `${build.slug || row.slug}-site.json`, mime: "application/json",
    bytes: enc.encode(JSON.stringify(next)), folder: "site-build",
    metadata: { website: { slug: build.slug || row.slug, style: row.style, pages: Object.keys(pages).length, images: (build.images || []).length }, menu_sync: true } });
  const t = nowIso();
  await env.DB.prepare(`UPDATE deliverables SET status = 'SUPERSEDED' WHERE project_id = ? AND deliverable_type = 'SITE_BUILD' AND status != 'SUPERSEDED' AND id != ?`).bind(row.project_id, stored.deliverableId).run();
  await env.DB.prepare(`UPDATE deliverables SET status = 'FINAL', customer_visible = 1, delivered_at = ? WHERE id = ?`).bind(t, stored.deliverableId).run();
  return { done: true, slug: build.slug || row.slug };
}

// "$12", "12", "$12.50" become a Google price; anything else ("12 / 18", "market price") is left without one.
function googlePrice(text) {
  const m = /^\$?\s*(\d{1,5})(?:\.(\d{1,2}))?$/.exec(String(text || "").trim());
  if (!m) return null;
  return { currencyCode: "USD", units: m[1], nanos: m[2] ? Number(m[2].padEnd(2, "0")) * 10000000 : 0 };
}

// The menu as Google's FoodMenus resource. Only marks Google has a field for go across (vegetarian, vegan, spicy).
function foodMenusFromMenu(menu, businessName) {
  const sections = (menu?.sections || []).map((section) => ({
    labels: [{ displayName: String(section.name || "Menu").slice(0, 140), languageCode: "en" }],
    items: (section.items || []).filter((i) => i?.name && !i.sold_out).slice(0, 200).map((item) => {
      const tags = normalizeTags(item.tags);
      const price = googlePrice(item.price);
      const diet = [...(tags.includes("VG") ? ["VEGAN"] : []), ...(tags.includes("V") || tags.includes("VG") ? ["VEGETARIAN"] : [])];
      return {
        labels: [{ displayName: String(item.name).slice(0, 140), ...(item.description ? { description: String(item.description).slice(0, 1000) } : {}), languageCode: "en" }],
        attributes: { ...(price ? { price } : {}), ...(diet.length ? { dietaryRestriction: diet } : {}), ...(tags.includes("HOT") ? { spiciness: "HOT" } : {}) }
      };
    })
  })).filter((s) => s.items.length);
  return { menus: [{ labels: [{ displayName: `${String(businessName || "Our").slice(0, 120)} menu`, languageCode: "en" }], sections }] };
}

async function syncGoogleMenu(env, businessId, menu, businessName, fetchImpl = fetch) {
  const connection = await env.DB.prepare(`
      SELECT * FROM google_connections WHERE business_id = ? AND status = 'ACTIVE' AND location_name IS NOT NULL AND account_name IS NOT NULL
      ORDER BY connected_at DESC LIMIT 1
    `).bind(businessId).first().catch(() => null);
  if (!connection) return { done: false, reason: "no_google" };
  try {
    const token = await accessTokenFor(env, connection, fetchImpl);
    await updateFoodMenus(token, v4LocationPath(connection), foodMenusFromMenu(menu, businessName), fetchImpl);
    return { done: true };
  } catch (error) {
    console.error("Google menu sync failed:", error instanceof Error ? error.message : String(error));
    return { done: false, reason: "google_error", error: String(error?.message || error).slice(0, 200) };
  }
}

async function syncMenuEverywhere(env, business, menu, { fetchImpl = fetch } = {}) {
  const [website, google] = await Promise.all([
    syncWebsiteMenu(env, business.id, menu).catch((error) => ({ done: false, reason: "error", error: String(error?.message || error).slice(0, 200) })),
    syncGoogleMenu(env, business.id, menu, business.name, fetchImpl)
  ]);
  return { website, google };
}

export { foodMenusFromMenu, googlePrice, syncGoogleMenu, syncMenuEverywhere, syncWebsiteMenu };
