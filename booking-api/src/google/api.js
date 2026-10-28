// Stage 5: Google Business Profile API calls. Read-only helpers here; producers add their own writes.
//   Account Management v1  - accounts the signed-in Google user can manage
//   Business Information v1 - the locations (profiles) under each account
//   Google My Business v4   - reviews and posts (accounts/{a}/locations/{l}/...)
import { nowIso } from "../lib/http.js";
import { decryptToken, GoogleAuthError, refreshAccessToken } from "./oauth.js";

const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4_BASE = "https://mybusiness.googleapis.com/v4";
const MAX_PAGES = 10;

class GoogleApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function googleGet(accessToken, url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.message || data?.error?.status || `HTTP ${response.status}`;
    throw new GoogleApiError(`Google API ${new URL(url).hostname} returned ${response.status}: ${reason}`, response.status);
  }
  return data;
}

async function listAccounts(accessToken, fetchImpl = fetch) {
  const accounts = [];
  let pageToken = "";
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const data = await googleGet(accessToken, `${ACCOUNTS_URL}?pageSize=20${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, fetchImpl);
    accounts.push(...(data.accounts || []));
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return accounts;
}

function formatAddress(address) {
  if (!address) return "";
  return [...(address.addressLines || []), address.locality, address.administrativeArea].filter(Boolean).join(", ");
}

// Every Business Profile the user can manage, as { account, location, title, address }.
async function listProfiles(accessToken, fetchImpl = fetch) {
  const profiles = [];
  for (const account of await listAccounts(accessToken, fetchImpl)) {
    let pageToken = "";
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const url = `${INFO_BASE}/${account.name}/locations?readMask=name,title,storefrontAddress&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const data = await googleGet(accessToken, url, fetchImpl);
      for (const location of data.locations || []) {
        profiles.push({ account: account.name, location: location.name, title: location.title || "Untitled profile", address: formatAddress(location.storefrontAddress) });
      }
      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
    }
  }
  return profiles;
}

async function getLocation(accessToken, locationName, fetchImpl = fetch) {
  return googleGet(accessToken, `${INFO_BASE}/${locationName}?readMask=name,title,storefrontAddress,regularHours,phoneNumbers,websiteUri,profile`, fetchImpl);
}

// v4 resource path for a connection: accounts/{a}/locations/{l}
function v4LocationPath(connection) {
  const location = String(connection.location_name || "").replace(/^locations\//, "");
  return `${connection.account_name}/locations/${location}`;
}

async function listReviews(accessToken, connection, { pageSize = 50, pageToken = "", orderBy = "" } = {}, fetchImpl = fetch) {
  const url = `${V4_BASE}/${v4LocationPath(connection)}/reviews?pageSize=${pageSize}${orderBy ? `&orderBy=${encodeURIComponent(orderBy)}` : ""}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
  return googleGet(accessToken, url, fetchImpl);
}

// One review by its resource name (accounts/{a}/locations/{l}/reviews/{r}).
async function getReview(accessToken, reviewName, fetchImpl = fetch) {
  return googleGet(accessToken, `${V4_BASE}/${reviewName}`, fetchImpl);
}

async function googleWrite(accessToken, url, method, body, fetchImpl) {
  const response = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.message || data?.error?.status || `HTTP ${response.status}`;
    throw new GoogleApiError(`Google API ${new URL(url).hostname} returned ${response.status}: ${reason}`, response.status);
  }
  return data;
}

// A Google post ("What's new") on a profile. locationPath is accounts/{a}/locations/{l} (v4LocationPath).
async function createLocalPost(accessToken, locationPath, post, fetchImpl = fetch) {
  return googleWrite(accessToken, `${V4_BASE}/${locationPath}/localPosts`, "POST", post, fetchImpl);
}

// Adds a photo to the profile; Google downloads it from sourceUrl. category: ADDITIONAL, LOGO or COVER.
async function createMedia(accessToken, locationPath, sourceUrl, fetchImpl = fetch, category = "ADDITIONAL") {
  return googleWrite(accessToken, `${V4_BASE}/${locationPath}/media`, "POST",
    { mediaFormat: "PHOTO", locationAssociation: { category }, sourceUrl }, fetchImpl);
}

// Everything Google Visibility audits on a profile (Business Information v1).
const AUDIT_READ_MASK = "name,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,serviceArea,profile,openInfo,metadata";
async function getLocationForAudit(accessToken, locationName, fetchImpl = fetch) {
  return googleGet(accessToken, `${INFO_BASE}/${locationName}?readMask=${AUDIT_READ_MASK}`, fetchImpl);
}

// Changes the named fields of a profile. validateOnly asks Google to check the request without changing anything.
async function patchLocation(accessToken, locationName, location, updateMask, { validateOnly = false } = {}, fetchImpl = fetch) {
  const url = `${INFO_BASE}/${locationName}?updateMask=${encodeURIComponent(updateMask)}${validateOnly ? "&validateOnly=true" : ""}`;
  return googleWrite(accessToken, url, "PATCH", location, fetchImpl);
}

// The attributes set on a profile ({ attributes: [{ name: "attributes/url_menu", valueType, uriValues }] }).
async function getAttributes(accessToken, locationName, fetchImpl = fetch) {
  return googleGet(accessToken, `${INFO_BASE}/${locationName}/attributes`, fetchImpl);
}

// The attribute ids Google offers for this profile (its category and country), e.g. "attributes/url_menu".
async function availableAttributes(accessToken, locationName, fetchImpl = fetch) {
  const ids = new Set();
  let pageToken = "";
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const data = await googleGet(accessToken, `${INFO_BASE}/attributes?parent=${encodeURIComponent(locationName)}&pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, fetchImpl);
    for (const meta of data.attributeMetadata || []) if (meta.parent && !meta.deprecated) ids.add(meta.parent);
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return ids;
}

// Sets one link attribute (such as attributes/url_menu) and leaves every other attribute alone.
async function setUriAttribute(accessToken, locationName, attribute, uri, fetchImpl = fetch) {
  const url = `${INFO_BASE}/${locationName}/attributes?attributeMask=${encodeURIComponent(attribute)}`;
  return googleWrite(accessToken, url, "PATCH", { name: `${locationName}/attributes`, attributes: [{ name: attribute, valueType: "URL", uriValues: [{ uri }] }] }, fetchImpl);
}

// Photos on the profile (v4): { mediaItems: [{ locationAssociation: { category } }], totalMediaItemCount }.
async function listMedia(accessToken, locationPath, fetchImpl = fetch) {
  return googleGet(accessToken, `${V4_BASE}/${locationPath}/media?pageSize=100`, fetchImpl);
}

const PERFORMANCE_BASE = "https://businessprofileperformance.googleapis.com/v1";

// Daily counts per metric between two dates (inclusive), as { METRIC: [{ date: "YYYY-MM-DD", value }] }.
async function fetchDailyMetrics(accessToken, locationName, metrics, start, end, fetchImpl = fetch) {
  const params = new URLSearchParams();
  for (const metric of metrics) params.append("dailyMetrics", metric);
  for (const [prefix, d] of [["dailyRange.startDate", start], ["dailyRange.endDate", end]]) {
    params.set(`${prefix}.year`, String(d.getUTCFullYear()));
    params.set(`${prefix}.month`, String(d.getUTCMonth() + 1));
    params.set(`${prefix}.day`, String(d.getUTCDate()));
  }
  const data = await googleGet(accessToken, `${PERFORMANCE_BASE}/${locationName}:fetchMultiDailyMetricsTimeSeries?${params}`, fetchImpl);
  const out = Object.fromEntries(metrics.map((m) => [m, []]));
  for (const group of data.multiDailyMetricTimeSeries || []) {
    for (const series of group.dailyMetricTimeSeries || []) {
      const list = out[series.dailyMetric] || (out[series.dailyMetric] = []);
      for (const point of series.timeSeries?.datedValues || []) {
        const d = point.date || {};
        list.push({ date: `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`, value: Number(point.value || 0) });
      }
    }
  }
  return out;
}

// Creates or replaces the business's public reply to a review (v4 updateReply).
async function putReviewReply(accessToken, reviewName, comment, fetchImpl = fetch) {
  const url = `${V4_BASE}/${reviewName}/reply`;
  const response = await fetchImpl(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.message || data?.error?.status || `HTTP ${response.status}`;
    throw new GoogleApiError(`Google API mybusiness.googleapis.com returned ${response.status}: ${reason}`, response.status);
  }
  return data;
}

// A fresh access token for a stored connection. A revoked or expired grant marks the connection NEEDS_RECONNECT.
async function accessTokenFor(env, connection, fetchImpl = fetch) {
  if (!connection?.refresh_token_enc) throw new GoogleAuthError("This Google connection has no stored token", { reconnect: true });
  try {
    const token = await refreshAccessToken(env, await decryptToken(env, connection.refresh_token_enc), fetchImpl);
    await env.DB.prepare(`UPDATE google_connections SET last_used_at = ?, updated_at = ? WHERE id = ?`).bind(nowIso(), nowIso(), connection.id).run();
    return token;
  } catch (error) {
    if (error instanceof GoogleAuthError && error.reconnect) {
      await env.DB.prepare(`UPDATE google_connections SET status = 'NEEDS_RECONNECT', last_error = ?, updated_at = ? WHERE id = ?`)
        .bind(error.message.slice(0, 500), nowIso(), connection.id).run();
    }
    throw error;
  }
}

export { GoogleApiError, listAccounts, listProfiles, getLocation, listReviews, getReview, putReviewReply, createLocalPost, createMedia, fetchDailyMetrics, formatAddress, v4LocationPath, accessTokenFor,
  getLocationForAudit, patchLocation, getAttributes, availableAttributes, setUriAttribute, listMedia };
