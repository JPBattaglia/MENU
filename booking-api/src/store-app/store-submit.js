// Stage 11 part 2: sending a restaurant's approved Mobile App listing to Apple and Google, and checking review status.
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
// A version Apple has not started reviewing yet: approving a newer build takes it back out of the queue first.
const WAITING_STATES = new Set(["WAITING_FOR_REVIEW"]);
const BEING_REVIEWED = new Set(["IN_REVIEW", "PENDING_APPLE_RELEASE"]);
const WITHDRAW_CHECKS = 10;
const WITHDRAW_PAUSE_MS = 6000;
const WHATS_NEW = "Updated for the latest iPhone software, with performance and reliability improvements.";

// Apple rejects an empty string in a URL field (409 "must be a valid RFC 3986 URI"); a link we don't have is left out.
function urlAttrs(map) {
  return Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === "string" && /^https?:\/\/\S+$/.test(v.trim())).map(([k, v]) => [k, v.trim()]));
}

// Apple wants the review contact's phone as +<country code> <number> (409 on Nov 9 for "(415) 555-0100").
// US/Canada numbers without a country code get +1; anything already starting with + keeps its own code.
function intlPhone(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}

class StepError extends Error {
  constructor(step, message) { super(message); this.step = step; }
}

// ---------- Apple ----------

const ASC_TRIES = 4;
const ASC_BACKOFF_MS = [0, 2000, 5000, 10000];
let pauseImpl = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = (attempt) => pauseImpl(ASC_BACKOFF_MS[attempt] || 10000);
function setPauseForTests(fn) { pauseImpl = fn; }

function appleClient(creds, fetchImpl) {
  let token = null;
  return async function asc(method, path, body, step) {
    token = token || await ascToken(creds);
    // Apple's API sometimes answers 5xx (Nov 9, 2026: "520: no detail" on the first call) or 429; those are retried
    // a few times before the owner is told, instead of failing the whole submission on one hiccup.
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetchImpl(path.startsWith("https://") ? path : `${ASC}${path}`, {
          method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined
        });
      } catch (error) {
        if (attempt < ASC_TRIES) { await pause(attempt); continue; }
        throw new StepError(step, `Apple couldn't be reached (${String(error?.message || error).slice(0, 80)})`);
      }
      if ((res.status >= 500 || res.status === 429) && attempt < ASC_TRIES) { await pause(attempt); continue; }
      break;
    }
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Apple often lists several problems at once (e.g. every missing App Store Connect item); show them all.
      // A 409 "cannot be reviewed, check associated errors" carries the real list in meta.associatedErrors
      // ({ "/v1/...": [{ detail }] }), e.g. a missing age rating or App Privacy answers (Nov 9, 2026).
      const nested = (data.errors || []).flatMap((e) => Object.values(e?.meta?.associatedErrors || {}).flat());
      const details = [...new Set([...nested, ...(data.errors || [])].map((e) => String(e?.detail || e?.title || "").trim()).filter(Boolean))];
      throw new StepError(step, `Apple answered ${res.status}: ${(details.join(" | ") || "no detail").slice(0, 900)}`);
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
// What App Review is told about the app (App Review Information > Notes, max 4000 bytes). Inaccurate notes are a
// common rejection cause, so each kind of app says what it really does and how payment works (Nov 9, 2026).
const RESTAURANT_NOTES = "A restaurant's own app: menu, specials, hours, location, a visit rewards card (6-digit code shown at the counter) and notifications. No sign-in.";

async function submitApple({ creds, bundleId, listing, images, contact, reviewNotes = "", settings = {} }, { fetchImpl = fetch } = {}) {
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
    let version = versions.find((v) => EDITABLE.has(stateOf(v)));
    // A newer build was approved while an earlier one waits in Apple's queue (owner, Nov 10, 2026: the Menu-made app
    // was rebuilt while build 36 waited): the waiting submission is taken out of review, which makes its version
    // editable again, and the newest build goes in its place. A version already waiting with this very build is left
    // alone, and one a reviewer has opened is never pulled.
    const waiting = !version && versions.find((v) => WAITING_STATES.has(stateOf(v)));
    if (waiting) {
      const waitingBuild = (await asc("GET", `/appStoreVersions/${waiting.id}/build`, null, "version").catch(() => ({}))).data;
      if (waitingBuild?.id === build.id) return { ok: true, appId: app.id, versionId: waiting.id, build: buildVersion || null, unchanged: true };
      const queued = (await asc("GET", `/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW&limit=10`, null, "withdraw")).data || [];
      for (const q of queued) await asc("PATCH", `/reviewSubmissions/${q.id}`, { data: { type: "reviewSubmissions", id: q.id, attributes: { canceled: true } } }, "withdraw");
      for (let i = 0; i < WITHDRAW_CHECKS && !version; i++) {
        await pauseImpl(WITHDRAW_PAUSE_MS);
        const again = (await asc("GET", `/appStoreVersions/${waiting.id}`, null, "withdraw")).data;
        if (again && EDITABLE.has(stateOf(again))) version = again;
      }
      // Apple takes a minute or more some days; the listing tick tries again by itself (retry), no email.
      if (!version) return { ok: false, retry: true, step: "withdraw", message: "Apple is still taking the earlier build out of its review queue; trying again in a few minutes." };
    }
    if (!version && versions.some((v) => BEING_REVIEWED.has(stateOf(v)))) {
      throw new StepError("version", "An Apple reviewer has the earlier build open right now, so it can't be swapped. Approve again after Apple answers (usually within a day).");
    }
    const update = versions.some((v) => v.id !== version?.id && !EDITABLE.has(stateOf(v)));
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
      description: listing.description, keywords: listing.keywords, promotionalText: listing.promo, ...urlAttrs({ supportUrl: listing.support_url, marketingUrl: listing.marketing_url }),
      ...(update ? { whatsNew: listing.whats_new || WHATS_NEW } : {}) } } }, "description");

    const infos = (await asc("GET", `/apps/${app.id}/appInfos`, null, "name")).data || [];
    const info = infos.find((i) => !["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"].includes(i.attributes?.appStoreState || i.attributes?.state)) || infos[0];
    if (info) {
      const infoLocs = (await asc("GET", `/appInfos/${info.id}/appInfoLocalizations`, null, "name")).data || [];
      const infoLoc = infoLocs.find((l) => l.attributes?.locale === loc.attributes?.locale) || infoLocs[0];
      if (infoLoc) await asc("PATCH", `/appInfoLocalizations/${infoLoc.id}`, { data: { type: "appInfoLocalizations", id: infoLoc.id, attributes: { name: listing.name, subtitle: listing.subtitle, ...urlAttrs({ privacyPolicyUrl: listing.privacy_url }) } } }, "name");
      // Primary category (Apple refuses review without one, Nov 9, 2026). Only set when missing, so an owner's own
      // choice in App Store Connect stands.
      const current = (await asc("GET", `/appInfos/${info.id}/primaryCategory`, null, "category").catch((e) => { if (/ 404:/.test(e.message)) return {}; throw e; })).data;
      if (!current?.id) {
        await asc("PATCH", `/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships: { primaryCategory: { data: { type: "appCategories", id: settings.category || "FOOD_AND_DRINK" } } } } }, "category");
      }
    }

    // Content rights declaration (does the app show content owned by someone else?), only when not answered yet.
    if (!app.attributes?.contentRightsDeclaration) {
      await asc("PATCH", `/apps/${app.id}`, { data: { type: "apps", id: app.id, attributes: { contentRightsDeclaration: settings.contentRights || "DOES_NOT_USE_THIRD_PARTY_CONTENT" } } }, "content rights");
    }

    // Price: every Mobile App is free to download. Set only when the app has no price schedule yet.
    // An app can have an empty price schedule (Menu-made's did, Nov 9, 2026), so it counts only with a price in it.
    const schedule = await asc("GET", `/apps/${app.id}/appPriceSchedule`, null, "price").catch((e) => { if (/ 404:/.test(e.message)) return {}; throw e; });
    const priced = schedule?.data?.id
      ? ((await asc("GET", `/appPriceSchedules/${schedule.data.id}/manualPrices?limit=1`, null, "price").catch(() => ({}))).data || []).length > 0
      : false;
    if (!priced) {
      const points = (await asc("GET", `/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`, null, "price")).data || [];
      const free = points.find((p) => Number(p.attributes?.customerPrice) === 0);
      if (!free) throw new StepError("price", "Apple didn't offer a free price point for this app; set Pricing to Free in App Store Connect.");
      await asc("POST", "/appPriceSchedules", {
        data: { type: "appPriceSchedules", relationships: {
          app: { data: { type: "apps", id: app.id } },
          baseTerritory: { data: { type: "territories", id: "USA" } },
          manualPrices: { data: [{ type: "appPrices", id: "${free-price}" }] } } },
        included: [{ type: "appPrices", id: "${free-price}", attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: "appPricePoints", id: free.id } } } }]
      }, "price");
    }

    const sets = (await asc("GET", `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`, null, "screenshots")).data || [];
    let set = sets.find((s) => s.attributes?.screenshotDisplayType === "APP_IPHONE_67");
    if (!set) set = (await asc("POST", "/appScreenshotSets", { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: "APP_IPHONE_67" }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } } }, "screenshots")).data;
    const old = (await asc("GET", `/appScreenshotSets/${set.id}/appScreenshots`, null, "screenshots")).data || [];
    // Re-uploading on every retry kept Apple "processing" fresh copies when the review was asked for (Nov 9, 2026:
    // "Asset is being processed"), so screenshots already there with the same names and sizes are kept.
    const mine = Object.keys(images).filter((n) => n.startsWith("ios-")).sort();
    const want = mine.map((n) => `${n}.png:${images[n].length}`).sort().join("|");
    const have = old.map((o) => `${o.attributes?.fileName}:${o.attributes?.fileSize}`).sort().join("|");
    if (!mine.length || want !== have) {
      for (const shot of old) await asc("DELETE", `/appScreenshots/${shot.id}`, null, "screenshots");
      for (const name of mine) await uploadScreenshot(asc, set.id, `${name}.png`, images[name], fetchImpl);
    }

    const detail = { contactFirstName: contact.first_name, contactLastName: contact.last_name, contactPhone: intlPhone(contact.phone), contactEmail: contact.email, demoAccountRequired: false,
      notes: reviewNotes || RESTAURANT_NOTES };
    const existing = (await asc("GET", `/appStoreVersions/${version.id}/appStoreReviewDetail`, null, "review contact").catch((e) => { if (/ 404:/.test(e.message)) return {}; throw e; })).data;
    if (existing?.id) await asc("PATCH", `/appStoreReviewDetails/${existing.id}`, { data: { type: "appStoreReviewDetails", id: existing.id, attributes: detail } }, "review contact");
    else await asc("POST", "/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes: detail, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } }, "review contact");

    const subs = (await asc("GET", `/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW,UNRESOLVED_ISSUES&limit=10`, null, "submit")).data || [];
    // A submission Apple sent back (Unresolved Issues, e.g. guideline 2.1 "Information Needed") is the one to send
    // again: it keeps the App Review conversation, and Apple takes no new submission while it is open. Apple's API
    // does not always allow that resubmission; then everything above is already in place and only the
    // "Resubmit to App Review" button on Apple's website is left (resubmit_by_hand; the owner gets the one click).
    const sentBack = subs.find((r) => r.attributes?.state === "UNRESOLVED_ISSUES");
    if (sentBack) {
      try {
        await asc("PATCH", `/reviewSubmissions/${sentBack.id}`, { data: { type: "reviewSubmissions", id: sentBack.id, attributes: { submitted: true } } }, "resubmit");
        return { ok: true, appId: app.id, versionId: version.id, build: buildVersion || null, resubmitted: true };
      } catch (error) {
        return { ok: true, appId: app.id, versionId: version.id, build: buildVersion || null, resubmit_by_hand: true, apple_said: String(error.message || error).slice(0, 300) };
      }
    }
    const open = subs.find((r) => r.attributes?.state === "READY_FOR_REVIEW") || null;
    const submission = open || (await asc("POST", "/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: app.id } } } } }, "submit")).data;
    // Add the version to the submission unless it's already in it. Apple's refusal here names what's missing in App
    // Store Connect (age rating, App Privacy, pricing...), so it is reported, not swallowed (Nov 9, 2026: swallowing
    // it left only Apple's generic "an appStoreVersions must be included in this review submission").
    const items = (await asc("GET", `/reviewSubmissions/${submission.id}/items?include=appStoreVersion&limit=50`, null, "submit")).data || [];
    const included = items.some((i) => i.relationships?.appStoreVersion?.data?.id === version.id);
    if (!included) {
      await asc("POST", "/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } }, "submit version");
    }
    await asc("PATCH", `/reviewSubmissions/${submission.id}`, { data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } } }, "submit");
    return { ok: true, appId: app.id, versionId: version.id, build: buildVersion || null };
  } catch (error) {
    return { ok: false, step: error.step || "apple", message: String(error.message || error).slice(0, 1000) };
  }
}

async function appleStatus({ creds, versionId }, { fetchImpl = fetch } = {}) {
  try {
    const v = (await appleClient(creds, fetchImpl)("GET", `/appStoreVersions/${versionId}`, null, "status")).data;
    const state = v?.attributes?.appStoreState || v?.attributes?.appVersionState || "UNKNOWN";
    return { ok: true, state, live: LIVE_STATES.has(state), rejected: REJECTED_STATES.has(state), queued: WAITING_STATES.has(state) || BEING_REVIEWED.has(state) };
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

async function submitGoogle({ sa, packageName, listing, images, firstReviewSent = false }, { fetchImpl = fetch } = {}) {
  try {
    const token = await accessToken(sa, PLAY_SCOPE, { fetchImpl });
    const base = `${PLAY}/${packageName}/edits`;
    const edit = await play(token, "POST", base, {}, "open", fetchImpl);
    const e = `${base}/${edit.id}`;
    // Google is still on this app's first review (a release was sent, the store page is not public yet): a second
    // send would put the app back at the start of that wait (owner, Nov 10, 2026: never restart Google's wait).
    // Nothing is changed; the newest build goes up by itself once the app is public (store-listing.js).
    if (firstReviewSent) {
      const production = await play(token, "GET", `${e}/tracks/production`, null, "release", fetchImpl).catch(() => ({}));
      const sent = (production.releases || []).some((r) => r.status && r.status !== "draft");
      if (sent && !(await googleLive(packageName, { fetchImpl }))) {
        await play(token, "DELETE", e, null, "open", fetchImpl).catch(() => null);
        return { ok: true, held: true };
      }
    }
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

export { appleStatus, googleLive, submitApple, submitGoogle, urlAttrs, intlPhone, setPauseForTests };
