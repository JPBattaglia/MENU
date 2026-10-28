// Google Profile Care photo library (stage 5): the customer adds photos once, through a signed page linked from our
// emails; weekly posts use them, and each month a few are added to their Google profile.
//   GET/POST /api/photo-library/<subscriptionId>?t=<token>   the upload page (PNG or JPG, 10 KB to 5 MB, at least 250 px)
//   GET      /api/gmedia/<assetId>?t=<token>                 the image itself, for Google to download (link valid 7 days)
// Photos are assets with no project; metadata_json.photo_library holds the subscription id, used_post_at and
// used_upload_at record when a photo last went into a post or onto the profile.
import { publicBaseUrl } from "../../lib/config.js";
import { escapeHtml } from "../../lib/email.js";
import { nowIso, parseJsonOrNull, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { sha256Hex } from "../../lib/util.js";
import { sniffImage } from "../website/intake.js";

const LINK_KIND = "photolib";
const MEDIA_KIND = "gmedia";
const MIN_BYTES = 10 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_SIDE = 250;
const MAX_PER_UPLOAD = 10;

async function photoLibraryLink(env, subscriptionId) {
  return `${publicBaseUrl(env)}/api/photo-library/${subscriptionId}?t=${encodeURIComponent(await signLinkToken(env, { kind: LINK_KIND, id: subscriptionId, ttlDays: 400 }))}`;
}

async function mediaUrl(env, assetId) {
  return `${publicBaseUrl(env)}/api/gmedia/${assetId}?t=${encodeURIComponent(await signLinkToken(env, { kind: MEDIA_KIND, id: assetId, ttlDays: 7 }))}`;
}

// Width and height from a PNG or JPEG header, or null.
function imageSize(bytes) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      }
      i += 2 + length;
    }
  }
  return null;
}

function checkPhoto(bytes) {
  const type = sniffImage(bytes);
  if (!type || type.mime === "image/webp") return { error: "must be a PNG or JPG photo" };
  if (bytes.length < MIN_BYTES) return { error: "is too small a file (Google needs at least 10 KB)" };
  if (bytes.length > MAX_BYTES) return { error: "is over 5 MB" };
  const size = imageSize(bytes);
  if (!size || size.width < MIN_SIDE || size.height < MIN_SIDE) return { error: `is smaller than ${MIN_SIDE} x ${MIN_SIDE} pixels` };
  return { type, size };
}

async function storePhoto(env, subscription, bytes, filename, extra = {}) {
  const checked = checkPhoto(bytes);
  if (checked.error) return checked;
  const id = crypto.randomUUID();
  const key = ["customers", subscription.customer_id, "photo-library", subscription.id, `${id}.${checked.type.ext}`].join("/");
  const t = nowIso();
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: checked.type.mime } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum,
        width_px, height_px, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, NULL, 'PHOTO', 'R2', ?, ?, ?, ?, ?, ?, ?, 'VALID', ?, ?, 1, 1, 1, ?)
    `).bind(id, subscription.business_id || null, subscription.customer_id, key, String(filename || "photo").slice(0, 100), checked.type.mime, bytes.length,
    await sha256Hex(bytes), checked.size.width, checked.size.height, t, t, JSON.stringify({ photo_library: subscription.id, ...extra })).run();
  return { id };
}

async function libraryPhotos(env, subscriptionId) {
  return (await env.DB.prepare(`
      SELECT id, original_filename, metadata_json, uploaded_at FROM assets
      WHERE asset_type = 'PHOTO' AND status = 'VALID' AND json_extract(metadata_json, '$.photo_library') = ?
      ORDER BY uploaded_at
    `).bind(subscriptionId).all()).results || [];
}

// Least recently posted photo, or null.
async function photoForPost(env, subscriptionId) {
  const photos = await libraryPhotos(env, subscriptionId);
  photos.sort((a, b) => String(parseJsonOrNull(a.metadata_json)?.used_post_at || "").localeCompare(String(parseJsonOrNull(b.metadata_json)?.used_post_at || "")));
  return photos[0] || null;
}

async function photosNotOnProfile(env, subscriptionId, limit) {
  return (await libraryPhotos(env, subscriptionId)).filter((p) => !parseJsonOrNull(p.metadata_json)?.used_upload_at).slice(0, limit);
}

async function markPhoto(env, assetId, field) {
  const row = await env.DB.prepare(`SELECT metadata_json FROM assets WHERE id = ?`).bind(assetId).first();
  const meta = { ...(parseJsonOrNull(row?.metadata_json) || {}), [field]: nowIso() };
  await env.DB.prepare(`UPDATE assets SET metadata_json = ? WHERE id = ?`).bind(JSON.stringify(meta), assetId).run();
}

function libraryPage(subscriptionId, token, photos, { error = null, notice = null } = {}) {
  return simplePage(error ? 400 : 200, "Your photo library", `${notice ? `<p><strong>${escapeHtml(notice)}</strong></p>` : ""}${error ? `<p style="color:#9b1c1c"><strong>${escapeHtml(error)}</strong></p>` : ""}
<p>Photos here are used in your weekly Google posts, and a few each month are added to your Google profile. Food, your room, your team and your storefront all work well. Only add photos you took or have the right to use.</p>
<p><strong>${photos.length}</strong> photo${photos.length === 1 ? "" : "s"} in your library${photos.length ? `, ${photos.filter((p) => !parseJsonOrNull(p.metadata_json)?.used_upload_at).length} not yet on your profile` : ""}.</p>
<form method="post" action="/api/photo-library/${escapeHtml(subscriptionId)}" enctype="multipart/form-data"><input type="hidden" name="t" value="${escapeHtml(token)}">
<p><input type="file" name="photos" accept="image/png,image/jpeg" multiple required><br><small>Up to ${MAX_PER_UPLOAD} at a time. PNG or JPG, at least ${MIN_SIDE} x ${MIN_SIDE} pixels, under 5 MB each.</small></p>
<button type="submit">Add photos</button></form>`);
}

async function handlePhotoLibrary(request, env, subscriptionId) {
  if (!env.DB || !env.ASSETS) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const denied = () => simplePage(403, "This link has expired or isn't valid", "<p>Reply to your latest email and we'll send a fresh one.</p>");
  const subscription = await env.DB.prepare(`SELECT id, customer_id, business_id FROM subscriptions WHERE id = ?`).bind(subscriptionId).first();
  if (request.method === "GET") {
    const token = new URL(request.url).searchParams.get("t") || "";
    const payload = await verifyLinkToken(env, token, [LINK_KIND], subscriptionId);
    if (!payload || payload.expired || !subscription) return denied();
    return libraryPage(subscriptionId, token, await libraryPhotos(env, subscriptionId));
  }
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], subscriptionId);
  if (!payload || payload.expired || !subscription) return denied();
  const files = form.getAll("photos").filter((f) => f && typeof f !== "string").slice(0, MAX_PER_UPLOAD);
  if (files.length === 0) return libraryPage(subscriptionId, token, await libraryPhotos(env, subscriptionId), { error: "Choose at least one photo." });
  const problems = [];
  let added = 0;
  for (const file of files) {
    const stored = await storePhoto(env, subscription, new Uint8Array(await file.arrayBuffer()), file.name);
    if (stored.error) problems.push(`${file.name || "A photo"} ${stored.error}`); else added += 1;
  }
  return libraryPage(subscriptionId, token, await libraryPhotos(env, subscriptionId), {
    notice: added ? `${added} photo${added === 1 ? "" : "s"} added.` : null,
    error: problems.length ? `Not added: ${problems.join("; ")}.` : null
  });
}

async function handleGoogleMedia(request, env, assetId) {
  const payload = await verifyLinkToken(env, new URL(request.url).searchParams.get("t") || "", [MEDIA_KIND], assetId);
  if (!payload || payload.expired || !env.DB || !env.ASSETS) return new Response("Not found", { status: 404 });
  // Library photos (Google Profile Care), and the logo and photos a Google Visibility order puts on the profile.
  const row = await env.DB.prepare(`
      SELECT storage_key, mime_type FROM assets
      WHERE id = ? AND ((asset_type = 'PHOTO' AND json_extract(metadata_json, '$.photo_library') IS NOT NULL)
        OR (asset_type IN ('PHOTO', 'LOGO') AND EXISTS (SELECT 1 FROM visibility_fixes v WHERE v.asset_id = assets.id)))
    `).bind(assetId).first();
  const object = row ? await env.ASSETS.get(row.storage_key) : null;
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { status: 200, headers: { "Content-Type": row.mime_type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } });
}

export { imageSize, checkPhoto, storePhoto, photoLibraryLink, mediaUrl, libraryPhotos, photoForPost, photosNotOnProfile, markPhoto, handlePhotoLibrary, handleGoogleMedia };
