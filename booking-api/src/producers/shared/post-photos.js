// The business's own photos in social posts (owner review, Nov 7, 2026). Posts reference photos by a long-lived signed
// link instead of carrying their bytes: the GitHub renderer downloads each photo once per job, and the review calendar
// shows them by the same link. The Worker never base64-encodes a photo (its CPU budget is too small).
//   GET /api/post-photo/<assetId>?t=<token>   the photo itself (customer photos only)
import { publicBaseUrl } from "../../lib/config.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";

const KIND = "postphoto";
const LINK_DAYS = 400;
const MAX_PHOTOS = 6;

const postPhotoUrl = async (env, assetId) => `${publicBaseUrl(env)}/api/post-photo/${assetId}?t=${encodeURIComponent(await signLinkToken(env, { kind: KIND, id: assetId, ttlDays: LINK_DAYS }))}`;

// Newest first: photos in the subscription's photo library, photos uploaded with this project's brief, and the
// business's other customer photos. Only PNG and JPG (what the renderer and every browser read).
async function postPhotos(env, { businessId = null, subscriptionId = null, projectId = null, limit = MAX_PHOTOS } = {}) {
  const rows = (await env.DB.prepare(`
      SELECT id FROM assets
      WHERE asset_type = 'PHOTO' AND status = 'VALID' AND is_customer_supplied = 1 AND mime_type IN ('image/jpeg', 'image/png')
        AND ((? IS NOT NULL AND json_extract(metadata_json, '$.photo_library') = ?) OR (? IS NOT NULL AND project_id = ?) OR (? IS NOT NULL AND business_id = ?))
      ORDER BY uploaded_at DESC LIMIT ?
    `).bind(subscriptionId, subscriptionId, projectId, projectId, businessId, businessId, limit).all()).results || [];
  const out = [];
  for (const [i, r] of rows.entries()) out.push({ id: r.id, placeholder: `__PHOTO_${i + 1}__`, url: await postPhotoUrl(env, r.id) });
  return out;
}

// Swaps the placeholders in an SVG for the photo links (for pages a browser shows; the renderer embeds the bytes).
const withPhotoLinks = (svg, photos) => photos.reduce((s, p) => s.replaceAll(p.placeholder, p.url.replace(/&/g, "&amp;")), svg);

async function handlePostPhoto(request, env, assetId) {
  const payload = await verifyLinkToken(env, new URL(request.url).searchParams.get("t") || "", [KIND], assetId);
  if (!payload || payload.expired || !env.DB || !env.ASSETS) return new Response("Not found", { status: 404 });
  const row = await env.DB.prepare(`SELECT storage_key, mime_type FROM assets WHERE id = ? AND asset_type = 'PHOTO' AND status IN ('VALID', 'ARCHIVED')`).bind(assetId).first();
  const object = row ? await env.ASSETS.get(row.storage_key) : null;
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { status: 200, headers: { "Content-Type": row.mime_type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } });
}

export { MAX_PHOTOS, handlePostPhoto, postPhotoUrl, postPhotos, withPhotoLinks };
