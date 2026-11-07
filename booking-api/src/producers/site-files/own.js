// Your Website, after payment (owner, Nov 6, 2026): "Add photos after paying". The delivery email carries a link
// (OWN_DAYS) to one page where the buyer adds a logo, up to 6 photos and a brand colour. Saving rebuilds the zip
// (and the live site, on Website Care) from the same design, free, and emails the new download link.
//   GET/POST /api/site-files/own/<projectId>?t=<signed link>
import { publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { parseJsonOrNull, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { isTestOrder, loadDeliveryContext } from "../../approvals/release.js";
import { DELIVERY_LINK_TTL_DAYS } from "../../lib/config.js";
import { MAX_PHOTOS, applyOwnForm, detailFields } from "../../marketing/website-preview.js";
import { makeSiteFiles } from "./files-step.js";
import { hasSamplePhotos, ownPhotoCount } from "../website/mood.js";

const OWN_KIND = "siteown";
const OWN_DAYS = 30;
const MAX_UPDATES = 20;

async function ownLink(env, projectId) {
  const token = await signLinkToken(env, { kind: OWN_KIND, id: projectId, ttlDays: OWN_DAYS });
  return `${publicBaseUrl(env)}/api/site-files/own/${projectId}?t=${encodeURIComponent(token)}`;
}

async function downloadLink(env, deliverableId) {
  const token = await signLinkToken(env, { kind: "deliver", id: deliverableId, ttlDays: DELIVERY_LINK_TTL_DAYS });
  return `${publicBaseUrl(env)}/api/delivery/${deliverableId}?t=${token}&download=1`;
}

function formHtml(action, site, note = "", copy = {}) {
  const n = ownPhotoCount(site);
  const have = [site.logo ? "your logo" : "", n ? `${n} photo${n === 1 ? "" : "s"}` : "", site.brand ? "your colour" : ""].filter(Boolean);
  const sample = hasSamplePhotos(site) ? " Your site shows sample photos for now; your own photos replace them." : "";
  return `${note}<p>${have.length ? `Your site uses ${escapeHtml(have.join(", "))}. New files replace them.` : "Add your logo, photos, brand colour and details (motto, About, contact, social and order links). We rebuild your website with them, free."}${sample}</p>
<form method="post" enctype="multipart/form-data" action="${escapeHtml(action)}" style="display:grid;gap:14px">
<label style="display:grid;gap:4px;font-weight:bold">Logo (PNG, JPG or WebP)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label>
<label style="display:grid;gap:4px;font-weight:bold">Photos (up to ${MAX_PHOTOS}, 5 MB each)<input type="file" name="photos" accept="image/png,image/jpeg,image/webp" multiple></label>
<label style="display:flex;gap:10px;align-items:center;font-weight:bold">Brand colour <input type="color" name="brand" value="${escapeHtml(site.brand || "#00a7b5")}"></label>
<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="use_brand" value="1"${site.brand ? " checked" : ""}> Use this colour</label>
<style>.own-details details{border-top:1px solid #dce8ec;padding:10px 0}.own-details summary{font-weight:bold;cursor:pointer;color:#071f2c}.own-details label{display:grid;gap:4px;font-weight:bold;margin-top:10px}.own-details small{font-weight:normal;color:#45616c}.own-details input,.own-details textarea,.own-details select{font:15px Arial,sans-serif;padding:10px;border:1px solid #c5d6dc;border-radius:6px;width:100%;box-sizing:border-box}</style>
<div class="own-details">${detailFields(site, copy)}</div>
<button type="submit">Update my website</button><p style="margin:0;font-size:14px;color:#45616c">After you tap it, updating takes up to a minute. Keep this page open until it says your website is updated.</p>
</form>`;
}

async function handleSiteFilesOwn(request, env, projectId) {
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your delivery email and we'll add your photos for you.</p>");
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const url = new URL(request.url);
  const payload = await verifyLinkToken(env, url.searchParams.get("t") || "", [OWN_KIND], projectId);
  if (!payload || payload.expired) return denied();
  const context = await loadDeliveryContext(projectId, env);
  if (!context || context.workflow_key !== "SITE_FILES_V1") return denied();
  const item = await env.DB.prepare(`SELECT oi.metadata_json FROM projects p JOIN order_items oi ON oi.id = p.order_item_id WHERE p.id = ?`).bind(projectId).first();
  const meta = parseJsonOrNull(item?.metadata_json) || {};
  const key = /^[a-f0-9]{36}$/.test(String(meta.site_preview || "")) ? `website-previews/${meta.site_preview}/data.json` : null;
  const data = key ? parseJsonOrNull(await (await env.ASSETS.get(key))?.text()) : null;
  if (!data?.site || !data?.copy) return denied();
  const action = `${url.pathname}?t=${encodeURIComponent(url.searchParams.get("t"))}`;
  const title = `Make ${context.business_name || "your website"} yours`;
  if (request.method !== "POST") return simplePage(200, title, formHtml(action, data.site, "", data.copy));

  const delivered = await env.DB.prepare(`SELECT 1 AS ok FROM deliverables WHERE project_id = ? AND deliverable_type = 'SITE_ZIP' AND status = 'FINAL'`).bind(projectId).first();
  if (!delivered) return simplePage(409, "Your website is still being made", "<p>Your download arrives by email in a few minutes. Use the link in that email.</p>");
  const again = (text) => simplePage(400, title, formHtml(action, data.site, `<p style="color:#a4161a;font-weight:bold">${escapeHtml(text)}</p>`, data.copy));
  if (Number(data.updates_after || 0) >= MAX_UPDATES) return again("This link has been used as many times as it allows. Reply to your delivery email and we'll make further changes.");
  const form = await request.formData().catch(() => null);
  if (!form) return again("We couldn't read the upload.");
  const site = { ...data.site };
  const applied = await applyOwnForm(env, meta.site_preview, site, form);
  if (applied.error) return again(applied.error);
  await env.ASSETS.put(key, JSON.stringify({ ...data, site, updates_after: Number(data.updates_after || 0) + 1 }), { httpMetadata: { contentType: "application/json" } });
  const made = await makeSiteFiles(env, context, meta, { replace: true });
  if (made.missing) return denied();
  const zip = await downloadLink(env, made.zipId);
  const business = context.business_name || "your business";
  await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `${isTestOrder(context) ? "[TEST] " : ""}Your updated website`,
    html: brandedEmailHtml({ preheader: `${business}'s website, with your photos.`, eyebrow: "YOUR WEBSITE", heading: `${business}'s website is updated`,
      paragraphs: [`Your logo, photos and colour are in. ${made.live ? `Your live site has them now: <a href="${escapeHtml(made.live)}">${escapeHtml(made.live)}</a>.` : "Download the new zip below; it replaces the old one."}`],
      buttons: [{ label: "Download your website (zip)", url: zip, primary: true }, ...(made.live ? [{ label: "Open your live site", url: made.live }] : [])],
      footnote: `The download link works for ${DELIVERY_LINK_TTL_DAYS} days. Questions? Reply to this email.` }),
    text: [`${business}'s website is updated with your logo and photos.`, `Download (zip): ${zip}`, ...(made.live ? [`Live now: ${made.live}`] : [])].join("\n"),
    idempotencyKey: `site-files-own/${projectId}/${made.zipId}`, purpose: "ORDER_DELIVERY", templateKey: "site_files_updated_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId }
  }).catch(() => null);
  return simplePage(200, "Your website is updated", `<p>Your logo, photos and colour are in. We've emailed the new download link too.</p><p><a class="btn" href="${escapeHtml(zip)}">Download your website (zip)</a>${made.live ? `<a class="btn" href="${escapeHtml(made.live)}">Open your live site</a>` : ""}</p><p><a href="${escapeHtml(action)}">Change them again</a></p>`);
}

export { OWN_DAYS, handleSiteFilesOwn, ownLink };
