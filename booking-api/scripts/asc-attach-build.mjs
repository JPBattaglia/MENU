// Puts a new iOS build where it needs to be in App Store Connect, so nobody has to click it in the website
// (store-app-build.yml: after each TestFlight upload, and on its own with platforms=ios-attach).
//
// Why (Nov 9, 2026): after every upload the owner had to open App Store Connect on the Mac to add the build to the
// internal TestFlight group and swap it into the App Store version waiting for review. This does both through the
// API key the build already has:
//   1. waits until Apple has processed the build (up to WAIT_MINUTES),
//   2. adds it to every internal TestFlight group of the app,
//   3. if the App Store version with the same version number is still editable (being prepared, or rejected),
//      makes this build that version's build.
// It never submits anything for review and never touches a version that is in review or live.
//
// Usage: node booking-api/scripts/asc-attach-build.mjs <AuthKey.p8> <key id> <issuer id> <bundle id> <version> <build>
// Prints states and counts only (public logs).
import { token } from "./asc-free-cert-slot.mjs";

const API = "https://api.appstoreconnect.apple.com/v1";
const WAIT_MINUTES = Number(process.env.ASC_WAIT_MINUTES || 40);
// App Store version states in which the build can still be changed (Apple's appStoreState / appVersionState values).
const EDITABLE = new Set([
  "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"
]);

export function editableVersion(versions) {
  return (versions || []).find((v) => EDITABLE.has(v?.attributes?.appStoreState) || EDITABLE.has(v?.attributes?.appVersionState)) || null;
}

export function internalGroups(groups) {
  return (groups || []).filter((g) => g?.attributes?.isInternalGroup);
}

// What to log after adding a build to a group. Apple's error code and title say why (no account data in them).
export function groupAddResult(add) {
  if (add?.ok || add?.status === 409) return "build added";
  const err = add?.body?.errors?.[0];
  const why = [err?.code, err?.title].filter(Boolean).join(": ");
  return `answer ${add?.status}${why ? ` (${why})` : ""}`;
}

async function main([keyPath, keyId, issuerId, bundleId, version, build]) {
  if (!keyPath || !keyId || !issuerId || !bundleId || !version || !/^\d+$/.test(build || "")) {
    throw new Error("Usage: asc-attach-build.mjs <AuthKey.p8> <key id> <issuer id> <bundle id> <version> <build>");
  }
  let jwt = await token(keyPath, keyId, issuerId);
  let jwtAt = Date.now();
  const call = async (path, init = {}) => {
    if (Date.now() - jwtAt > 8 * 60 * 1000) { jwt = await token(keyPath, keyId, issuerId); jwtAt = Date.now(); }
    const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers || {}) } });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  };

  const apps = await call(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
  const appId = apps.body?.data?.[0]?.id;
  if (!appId) { console.log(`App not found in App Store Connect (answer ${apps.status}); nothing attached`); return; }

  // 1. Wait for Apple to finish processing the upload.
  let buildRow = null;
  const deadline = Date.now() + WAIT_MINUTES * 60 * 1000;
  for (;;) {
    const found = await call(`/builds?filter[app]=${appId}&filter[version]=${build}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&limit=1`);
    buildRow = found.body?.data?.[0] || null;
    const state = buildRow?.attributes?.processingState || "NOT_SEEN_YET";
    if (state === "VALID") break;
    if (state === "FAILED" || state === "INVALID") { console.log(`Build ${build} processing ended ${state}; nothing attached`); process.exitCode = 1; return; }
    if (Date.now() > deadline) { console.log(`Build ${build} still ${state} after ${WAIT_MINUTES} minutes; nothing attached`); process.exitCode = 1; return; }
    console.log(`Build ${build}: ${state}, checking again in a minute`);
    await new Promise((r) => setTimeout(r, 60 * 1000));
  }
  console.log(`Build ${build} processed`);

  // 2. Internal TestFlight groups.
  const groups = internalGroups((await call(`/apps/${appId}/betaGroups?limit=50`)).body?.data);
  for (const g of groups) {
    // A group with automatic distribution already gets every build; Apple answers 422 if one is added by hand.
    if (g?.attributes?.hasAccessToAllBuilds) { console.log("TestFlight internal group: gets every build automatically"); continue; }
    const add = await call(`/betaGroups/${g.id}/relationships/builds`, { method: "POST", body: JSON.stringify({ data: [{ type: "builds", id: buildRow.id }] }) });
    console.log(`TestFlight internal group: ${groupAddResult(add)}`);
  }
  if (!groups.length) console.log("No internal TestFlight group on this app");

  // 3. The App Store version waiting for this build, if it can still be changed.
  const versions = (await call(`/apps/${appId}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${encodeURIComponent(version)}&limit=5`)).body?.data;
  const target = editableVersion(versions);
  if (!target) {
    const states = (versions || []).map((v) => v.attributes?.appStoreState).join(", ") || "none";
    console.log(`App Store version ${version}: not editable (${states}); build left for TestFlight only`);
    return;
  }
  const set = await call(`/appStoreVersions/${target.id}/relationships/build`, { method: "PATCH", body: JSON.stringify({ data: { type: "builds", id: buildRow.id } }) });
  console.log(set.ok
    ? `App Store version ${version} (${target.attributes?.appStoreState}) now uses build ${build}. Not submitted.`
    : `Could not set the build on App Store version ${version} (answer ${set.status})`);
  if (!set.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
