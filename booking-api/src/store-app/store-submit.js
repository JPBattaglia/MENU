// Stage 11 part 2: sending a restaurant's approved Store App listing to Apple and Google, and checking review status.
// Everything here runs with the restaurant's own keys (scope from restaurant-keys.js). Each function returns
// { ok: true, ... } or { ok: false, step, message } with Apple's or Google's own words, which go to the owner by email.
//
// Apple (App Store Connect API): the app record exists (owner's hands-on step); the editable version (or, for an app
// already live, a new version named after the build's version string, with "What's New" text) gets the newest
// valid build, its version string, copyright, description, keywords and URLs; the app info gets name, subtitle and
// privacy URL; iPhone 6.7" screenshots replace any there; review contact = the restaurant; then a review submission.
// Age rating, pricing and App Privacy are set by the owner on the website (Apple's API leaves those to the website or
// they change too often to automate safely).
// Google (Play Developer API, one edit): listing text, icon, feature graphic and phone screenshots, then the newest
// internal-testing build to production. A never-published app only takes a draft release: the owner then presses
// "Send for review" in Play Console once (Google keeps that first rollout on the website).
import { ascToken } from "./apple.js";
import { PLAY_SCOPE, accessToken } from "./google.js";

const ASC = "https://api.appstoreconnect.apple.com/v1";
const PLAY = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const PLAY_UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications";
const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
const LIVE_STATES = new Set(["READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "PENDING_DEVELOPER_RELEASE", "PROCESSING_FOR_DISTRIBUTION"]);
const REJECTED_STATES = new Set(["REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
const WHATS_NEW = "Updated for the latest iPhone software, with performance and reliability improvements.";

class StepError extends Error {
  constructor(step, message) { super(message); this.step = step; }
}

// ---------- Apple ----------

function appleClient(creds, fetchImpl) {
  let token = null;
  return async function asc(method, path, body, step) {
    token = token || await ascToken(creds);
    let res;
    try {
      res = await fetchImpl(path.startsWith("https://") ? path : `${ASC}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined
      });
    } catch (error) { throw new StepError(step, `Apple couldn't be reached (${String(error?.message || error).slice(0, 80)})`); }
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (data.errors || [])[0] || {};
      throw new StepError(step, `Apple answered ${res.status}: ${String(e.detail || e.title || "no detail").slice(0, 300)}`);
    }
    return data;
  };
}

async function md5Hex(bytes) {
  try { return [...new Uint8Array(await crypto.subtle.digest("MD5", bytes))].map((b) => b.toString(16).padStart(2, "0")).join(""); } catch { return null; } // Workers have MD5; Node's WebCrypto doesn't
}

async function uploadScreenshot(asc, setId, name, bytes, fetchImpl) {
  const reserved = await asc("POST", "/appScreenshots", { data: { type: "appScreenshots", attributes: { fileName: name, fileSize: bytes.length }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } } } }, "screenshots");
  const shot = reserved.data;
  for (const op of shot.attributes?.uploadOperations || []) {
    const part = bytes.subarray(op.offset, op.offset + op.length);
    const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
    const res = await fetchImpl(op.url, { method: op.method || "PUT", headers, body: part }).catch(() => null);
    if (!res?.ok) throw new StepError("screenshots", `Uploading ${name} to Apple failed (${res?.status || "no answer"})`);
  }
  const checksum = await md5Hex(bytes);
  await asc("PATCH", `/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, ...(checksum ? { sourceFileChecksum: checksum } : {}) } } }, "screenshots");
}

// listing: { name, subtitle, description, keywords, promo, support_url, marketing_url, privacy_url, copyright }
// images: { "ios-1": Uint8Array, ... }  contact: { first_name, last_name, phone, email }
async function submitApple({ creds, bundleId, listing, images, contact }, { fetchImpl = fetch } = {}) {
  const asc = appleClient(creds, fetchImpl);
  try {
    const app = (await asc("GET", `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`, null, "app")).data?.[0];
    if (!app) throw new StepError("app", `There's no app record for ${bundleId} in App Store Connect yet (owner checklist: New App).`);
    const versions = (await asc("GET", `/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20`, null, "version")).data || [];
    const stateOf = (v) => v.attributes?.appStoreState || v.attributes?.appVersionState;
    const builds = await asc("GET", `/builds?filter[app]=${app.id}&filter[processingState]=VALID&sort=-uploadedDate&limit=1&include=preReleaseVersion`, null, "build");
    const build = builds.data?.[0];
    if (!build) throw new StepError("build", "Apple has no processed build for this app yet (it takes 5-30 minutes after an upload).");
    const buildVersion = (builds.included || []).find((i) => i.type === "preReleaseVersions")?.attributes?.version;
    // An update (an earlier version is or was in the store) needs "What's New" text; a first release must not have it.
    const update = versions.some((v) => !EDITABLE.has(stateOf(v)));
    let version = versions.find((v) => EDITABLE.has(stateOf(v)));
    if (!version) {
      // The app is live and nothing is open: a rebuild (yearly SDK update or a fix) opens the next version, whose
      // string is the build's (the build config asks for one above the live version).
      if (!buildVersion) throw new StepError("version", "No App Store version is open for editing and the newest build has no version string.");
      if (versions.some((v) => v.attributes?.versionString === buildVersion)) {
        throw new StepError("version", `Version ${buildVersion} is already in App Store Connect and not editable; the newest build needs a higher version (press Build again).`);
      }
      version = (await asc("POST", "/appStoreVersions", { data: { type: "appStoreVersions", attributes: { platform: "IOS", versionString: buildVersion },
        relationships: { app: { data: { type: "apps", id: app.id } } } } }, "version")).data;
    }
    await asc("PATCH", `/appStoreVersions/${version.id}`, { data: { type: "appStoreVersions", id: version.id,
      attributes: { ...(buildVersion ? { versionString: buildVersion } : {}), copyright: listing.copyright, releaseType: "AFTER_APPROVAL" },
      relationships: { build: { data: { type: "builds", id: build.id } } } } }, "version");

    const locs = (await asc("GET", `/appStoreVersions/${version.id}/appStoreVersionLocalizations`, null, "description")).data || [];
    const loc = locs.find((l) => l.attributes?.locale === "en-US") || locs[0];
    if (!loc) throw new StepError("description", "The App Store version has no language yet; set the primary language to English (U.S.) in App Store Connect.");
    await asc("PATCH", `/appStoreVersionLocalizations/${loc.id}`, { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: {
      description: listing.description, keywords: listing.keywords, promotionalText: listing.promo, supportUrl: listing.support_url, marketingUrl: listing.marketing_url,
      ...(update ? { whatsNew: listing.whats_new || WHATS_NEW } : {}) } } }, "description");

    const infos = (await asc("GET", `/apps/${app.id}/appInfos`, null, "name")).data || [];
    const info = infos.find((i) => !["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"].includes(i.attributes?.appStoreState || i.attributes?.state)) || infos[0];
    if (info) {
      const infoLocs = (await asc("GET", `/appInfos/${info.id}/appInfoLocalizations`, null, "name")).data || [];
      const infoLoc = infoLocs.find((l) => l.attributes?.locale === loc.attributes?.locale) || infoLocs[0];
      if (infoLoc) await asc("PATCH", `/appInfoLocalizations/${infoLoc.id}`, { data: { type: "appInfoLocalizations", id: infoLoc.id, attributes: { name: listing.name, subtitle: listing.subtitle, privacyPolicyUrl: listing.privacy_url } } }, "name");
    }

    const sets = (await asc("GET", `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`, null, "screenshots")).data || [];
    let set = sets.find((s) => s.attributes?.screenshotDisplayType === "APP_IPHONE_67");
    if (!set) set = (await asc("POST", "/appScreenshotSets", { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: "APP_IPHONE_67" }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } } }, "screenshots")).data;
    const old = (await asc("GET", `/appScreenshotSets/${set.id}/appScreenshots`, null, "screenshots")).data || [];
    for (const shot of old) await asc("DELETE", `/appScreenshots/${shot.id}`, null, "screenshots");
    for (const name of Object.keys(images).filter((n) => n.startsWith("ios-")).sort()) await uploadScreenshot(asc, set.id, `${name}.png`, images[name], fetchImpl);

    const detail = { contactFirstName: contact.first_name, contactLastName: contact.last_name, contactPhone: contact.phone, contactEmail: contact.email, demoAccountRequired: false,
      notes: "A restaurant's own app: menu, specials, hours, location, a visit rewards card (6-digit code shown at the counter) and notifications. No sign-in." };
    const existing = (await asc("GET", `/appStoreVersions/${version.id}/appStoreReviewDetail`, null, "review contact").catch((e) => { if (/ 404:/.test(e.message)) return {}; throw e; })).data;
    if (existing?.id) await asc("PATCH", `/appStoreReviewDetails/${existing.id}`, { data: { type: "appStoreReviewDetails", id: existing.id, attributes: detail } }, "review contact");
    else await asc("POST", "/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes: detail, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } }, "review contact");

    const open = (await asc("GET", `/reviewSubmissions?filter[app]=${app.id}&filter[state]=READY_FOR_REVIEW&limit=1`, null, "submit")).data?.[0];
    const submission = open || (await asc("POST", "/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: app.id } } } } }, "submit")).data;
    await asc("POST", "/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } }, "submit")
      .catch((e) => { if (!/ 409:/.test(e.message)) throw e; }); // already in this submission
    await asc("PATCH", `/reviewSubmissions/${submission.id}`, { data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } } }, "submit");
    return { ok: true, appId: app.id, versionId: version.id, build: buildVersion || null };
  } catch (error) {
    return { ok: false, step: error.step || "apple", message: String(error.message || error).slice(0, 400) };
  }
}

async function appleStatus({ creds, versionId }, { fetchImpl = fetch } = {}) {
  try {
    const v = (await appleClient(creds, fetchImpl)("GET", `/appStoreVersions/${versionId}`, null, "status")).data;
    const state = v?.attributes?.appStoreState || v?.attributes?.appVersionState || "UNKNOWN";
    return { ok: true, state, live: LIVE_STATES.has(state), rejected: REJECTED_STATES.has(state) };
  } catch (error) { return { ok: false, message: String(error.message || error) }; }
}

// ---------- Google ----------

async function play(token, method, url, body, step, fetchImpl, contentType = "application/json") {
  let res;
  try { res = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body != null ? { "Content-Type": contentType } : {}) }, body: body == null ? undefined : contentType === "application/json" ? JSON.stringify(body) : body }); }
  catch (error) { throw new StepError(step, `Google couldn't be reached (${String(error?.message || error).slice(0, 80)})`); }
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new StepError(step, `Google Play answered ${res.status}: ${String(data?.error?.message || "no detail").slice(0, 300)}`);
  return data;
}

async function submitGoogle({ sa, packageName, listing, images }, { fetchImpl = fetch } = {}) {
  try {
    const token = await accessToken(sa, PLAY_SCOPE, { fetchImpl });
    const base = `${PLAY}/${packageName}/edits`;
    const edit = await play(token, "POST", base, {}, "open", fetchImpl);
    const e = `${base}/${edit.id}`;
    await play(token, "PUT", `${e}/listings/en-US`, { language: "en-US", title: listing.play_title, shortDescription: listing.play_short, fullDescription: listing.play_full }, "listing", fetchImpl);
    const put = async (type, names) => {
      await play(token, "DELETE", `${e}/listings/en-US/${type}`, null, "images", fetchImpl).catch(() => null);
      for (const n of names) await play(token, "POST", `${PLAY_UPLOAD}/${packageName}/edits/${edit.id}/listings/en-US/${type}?uploadType=media`, images[n], "images", fetchImpl, "image/png");
    };
    await put("icon", ["play-icon"]);
    await put("featureGraphic", ["feature"]);
    await put("phoneScreenshots", Object.keys(images).filter((n) => n.startsWith("android-")).sort());
    const internal = await play(token, "GET", `${e}/tracks/internal`, null, "release", fetchImpl);
    const codes = (internal.releases || []).flatMap((r) => r.versionCodes || []).map(Number).filter(Number.isFinite);
    if (!codes.length) throw new StepError("release", "Google Play has no build on internal testing yet.");
    const versionCode = String(Math.max(...codes));
    const release = async (status) => {
      await play(token, "PUT", `${e}/tracks/production`, { track: "production", releases: [{ versionCodes: [versionCode], status }] }, "release", fetchImpl);
      return play(token, "POST", `${e}:commit`, null, "commit", fetchImpl);
    };
    try {
      await release("completed");
      return { ok: true, versionCode, draft: false };
    } catch (error) {
      if (!/draft/i.test(error.message)) throw error;
      // A never-published app: Google takes the release as a draft; the owner sends it for review once on the website.
      const again = await play(token, "POST", base, {}, "open", fetchImpl);
      const e2 = `${base}/${again.id}`;
      await play(token, "PUT", `${e2}/tracks/production`, { track: "production", releases: [{ versionCodes: [versionCode], status: "draft" }] }, "release", fetchImpl);
      await play(token, "POST", `${e2}:commit`, null, "commit", fetchImpl);
      return { ok: true, versionCode, draft: true };
    }
  } catch (error) {
    return { ok: false, step: error.step || "google", message: String(error.message || error).slice(0, 400) };
  }
}

// Google has no review-status API: an app is live when its public store page answers.
async function googleLive(packageName, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}&hl=en_US`, { method: "GET", redirect: "manual" });
    return res.status === 200;
  } catch { return false; }
}

export { appleStatus, googleLive, submitApple, submitGoogle };
