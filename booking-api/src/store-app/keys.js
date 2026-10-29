// Stage 11 part 2: the page where the owner hands over Apple keys, with nothing to remember.
//   GET  /api/store-keys/owner          "Email me the link" (POST sends a one-hour signed link to the owner inbox)
//   GET  /api/store-keys/owner?t=       the upload form: App Store Connect API key (.p8) + Issuer ID, push key (.p8)
//   POST /api/store-keys/owner          (multipart, with t) checks each key live with Apple, then stores it sealed
// The owner's accounts are the test restaurant (scope 'owner', app com.menumade.samplecafe). Restaurants get the same
// page under their own scope later. A key is stored even if Apple's check can't run, so nothing has to be uploaded twice;
// the page says which keys were confirmed. Key files are never logged or shown again.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { base64UrlDecode, base64UrlEncode, signLinkToken, verifyLinkToken } from "../lib/links.js";
import { checkApiKey, checkPushKey, importP8 } from "./apple.js";

const LINK_KIND = "storekeys";
const OWNER = "owner";
const OWNER_BUNDLE_ID = "com.menumade.samplecafe";
const LINK_TTL_DAYS = 1 / 24;
const MAX_KEY_BYTES = 4096;
const enc = new TextEncoder();

async function sealKey(env) {
  if (!env.PRODUCTION_RUNNER_SECRET) throw new Error("PRODUCTION_RUNNER_SECRET is not configured");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`menu-made-store-key-v1:${env.PRODUCTION_RUNNER_SECRET}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env), enc.encode(text)));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(out)}`;
}
async function unseal(env, value) {
  const [v, iv, data] = String(value || "").split(".");
  if (v !== "v1" || !iv || !data) throw new Error("Stored key is not readable");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlDecode(iv) }, await sealKey(env), base64UrlDecode(data)));
}

// The stored key for a scope and kind, unsealed, or null.
async function loadCredential(env, scope, kind) {
  const row = await env.DB.prepare(`SELECT * FROM store_credentials WHERE scope = ? AND kind = ?`).bind(scope, kind).first();
  if (!row) return null;
  return { keyId: row.key_id, issuerId: row.issuer_id, teamId: row.team_id, p8: await unseal(env, row.sealed), status: row.check_status };
}

async function saveCredential(env, scope, kind, fields) {
  const t = nowIso();
  await env.DB.prepare(`
      INSERT INTO store_credentials (id, scope, kind, key_id, issuer_id, team_id, sealed, check_status, check_note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, kind) DO UPDATE SET key_id = excluded.key_id, issuer_id = excluded.issuer_id, team_id = excluded.team_id, sealed = excluded.sealed,
        check_status = excluded.check_status, check_note = excluded.check_note, updated_at = excluded.updated_at
    `).bind(crypto.randomUUID(), scope, kind, fields.keyId, fields.issuerId || null, fields.teamId || null, await seal(env, fields.p8),
    fields.status, fields.note || null, t, t).run();
}

// Key id from Apple's file name (AuthKey_ABC123DEFG.p8), else from the typed field.
function keyIdOf(file, typed) {
  const fromName = /AuthKey_([A-Z0-9]{10})\.p8$/i.exec(file?.name || "")?.[1];
  const id = String(fromName || typed || "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(id) ? id : null;
}
async function readKeyFile(file) {
  if (!file || typeof file === "string" || !file.size) return null;
  if (file.size > MAX_KEY_BYTES) return { error: "too big to be a key file" };
  const text = await file.text();
  if (!(await importP8(text))) return { error: "not an Apple .p8 key file" };
  return { text };
}

const status = (ok) => (ok === true ? "VERIFIED" : ok === false ? "FAILED" : "UNVERIFIED");
const mark = (ok) => (ok === true ? "✅" : ok === false ? "❌" : "⚠️");

function formPage(token, error) {
  return simplePage(error ? 400 : 200, "Apple keys for Store App builds", `${error ? `<p style="color:#a11"><strong>${escapeHtml(error)}</strong></p>` : ""}
<p>Already uploaded? Leave both file boxes empty and press <strong>Check and save</strong> to check the saved keys again.</p>
<p>These let Menu-made upload test builds to TestFlight and send push notifications for your test app (<strong>${OWNER_BUNDLE_ID}</strong>). Both files are in your Downloads folder, named <code>AuthKey_…p8</code>. You can send one now and the other later.</p>
<form method="post" action="/api/store-keys/owner" enctype="multipart/form-data">
<input type="hidden" name="t" value="${escapeHtml(token)}">
<h2 style="font-size:18px">1. App Store Connect API key ("Menu made builds")</h2>
<p><label>Key file<br><input type="file" name="api_file" accept=".p8"></label></p>
<p><label>Issuer ID (App Store Connect, Users and Access, Integrations: shown above the key list)<br><input name="issuer_id" size="40" placeholder="69a6de70-…" autocomplete="off"></label></p>
<h2 style="font-size:18px">2. Push key ("Menu made push")</h2>
<p><label>Key file<br><input type="file" name="push_file" accept=".p8"></label></p>
<details><summary style="font-size:14px">The file was renamed?</summary><p><label>API key ID <input name="api_key_id" size="12"></label><br><label>Push key ID <input name="push_key_id" size="12"></label></p></details>
<p><button type="submit">Check and save</button></p>
</form>
<p style="font-size:13px">Keys are checked with Apple, then stored encrypted. They're never shown or emailed back.</p>`);
}

async function emailLink(env) {
  const inbox = ownerEmailAddress(env);
  const link = `${publicBaseUrl(env)}/api/store-keys/owner?t=${encodeURIComponent(await signLinkToken(env, { kind: LINK_KIND, id: OWNER, ttlDays: LINK_TTL_DAYS }))}`;
  const bucket = Math.floor(Date.now() / 600000); // at most one email per 10 minutes
  const sent = await sendTransactionalEmail(env, {
    to: inbox,
    subject: "Upload your Apple keys for Store App builds",
    html: brandedEmailHtml({ preheader: "One-hour link to hand over the Apple keys.", eyebrow: "STORE APP", heading: "Upload your Apple keys",
      paragraphs: ["Open this link on the Mac that has the two AuthKey .p8 files in Downloads. It works for one hour.", "If you didn't ask for this, ignore it."],
      buttons: [{ label: "Upload keys", url: link, primary: true }] }),
    text: `Upload your Apple keys (link works for one hour):\n${link}`,
    idempotencyKey: `store-keys-link/${bucket}`, purpose: "OWNER_ACTION", templateKey: "store_keys_link_v1"
  }).catch((error) => ({ ok: false, error }));
  if (!sent?.ok) return simplePage(502, "The email didn't send", "<p>Please try again in a minute.</p>");
  return simplePage(200, "Check your email", `<p>We sent the link to <strong>${escapeHtml(inbox)}</strong>. If you pressed the button a moment ago, the earlier email is the one to use.</p>`);
}

async function handleStoreKeys(request, env, { fetchImpl = fetch } = {}) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const expired = () => simplePage(403, "This link has expired", `<p>Open <a href="/api/store-keys/owner">the key page</a> again to get a fresh one.</p>`);
  const url = new URL(request.url);
  const isUpload = request.method === "POST" && /multipart\/form-data/i.test(request.headers.get("Content-Type") || "");
  if (request.method === "GET" && !url.searchParams.get("t")) {
    return simplePage(200, "Apple keys for Store App builds", `<p>We'll email a one-hour link to <strong>${escapeHtml(ownerEmailAddress(env))}</strong>.</p>
<form method="post" action="/api/store-keys/owner"><button type="submit">Email me the link</button></form>`);
  }
  if (request.method === "POST" && !isUpload) return emailLink(env);
  if (request.method === "GET") {
    const token = url.searchParams.get("t");
    const payload = await verifyLinkToken(env, token, [LINK_KIND], OWNER);
    return !payload || payload.expired ? expired() : formPage(token, null);
  }
  if (!isUpload) return simplePage(405, "Not allowed", "<p>Use the form.</p>");
  let form;
  try { form = await request.formData(); } catch { return simplePage(400, "Something went wrong", "<p>Please go back and try again.</p>"); }
  const token = String(form.get("t") || "");
  const payload = await verifyLinkToken(env, token, [LINK_KIND], OWNER);
  if (!payload || payload.expired) return expired();

  const apiFile = form.get("api_file"); const pushFile = form.get("push_file");
  const api = await readKeyFile(apiFile); const push = await readKeyFile(pushFile);
  if (api?.error) return formPage(token, `The API key file is ${api.error}.`);
  if (push?.error) return formPage(token, `The push key file is ${push.error}.`);
  const apiKeyId = api ? keyIdOf(apiFile, form.get("api_key_id")) : null;
  const pushKeyId = push ? keyIdOf(pushFile, form.get("push_key_id")) : null;
  if (api && !apiKeyId) return formPage(token, "The API key file was renamed: type its Key ID (10 letters and digits) under \"The file was renamed?\".");
  if (push && !pushKeyId) return formPage(token, "The push key file was renamed: type its Key ID under \"The file was renamed?\".");
  if (api && apiKeyId === pushKeyId) return formPage(token, "Both boxes have the same key. The API key and the push key are two different files.");
  const typedIssuer = String(form.get("issuer_id") || "").trim().toLowerCase();
  if (typedIssuer && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(typedIssuer)) return formPage(token, "The Issuer ID should look like 69a6de70-03db-47e3-e053-5b8c7c11a4d1.");
  if (api && !typedIssuer) return formPage(token, "Paste the Issuer ID too (App Store Connect, Users and Access, Integrations, above the Team Keys list).");

  // No new file: check the keys already saved again (and take a corrected Issuer ID), so nothing is uploaded twice.
  const savedApi = api ? null : await loadCredential(env, OWNER, "APPLE_API_KEY");
  const savedPush = push ? null : await loadCredential(env, OWNER, "APPLE_PUSH_KEY");
  const apiCreds = api ? { p8: api.text, keyId: apiKeyId, issuerId: typedIssuer } : savedApi ? { ...savedApi, issuerId: typedIssuer || savedApi.issuerId } : null;
  const pushCreds = push ? { p8: push.text, keyId: pushKeyId } : savedPush;
  if (!apiCreds && !pushCreds) return formPage(token, "Choose at least one key file.");

  const lines = [];
  let teamId = null;
  if (apiCreds) {
    const check = await checkApiKey(apiCreds, OWNER_BUNDLE_ID, { fetchImpl });
    teamId = check.teamId || null;
    await saveCredential(env, OWNER, "APPLE_API_KEY", { keyId: apiCreds.keyId, issuerId: apiCreds.issuerId, teamId, p8: apiCreds.p8, status: status(check.unreachable ? null : check.ok), note: check.note });
    lines.push(`${mark(check.unreachable ? null : check.ok)} <strong>API key ${escapeHtml(apiCreds.keyId)}</strong>: ${escapeHtml(check.note)}`);
  }
  if (pushCreds) {
    if (!teamId) teamId = (await env.DB.prepare(`SELECT team_id FROM store_credentials WHERE scope = ? AND kind = 'APPLE_API_KEY'`).bind(OWNER).first())?.team_id || null;
    const check = teamId ? await checkPushKey({ p8: pushCreds.p8, keyId: pushCreds.keyId, teamId }, OWNER_BUNDLE_ID, { fetchImpl })
      : { ok: null, note: "Saved. It is checked once the API key works, because that tells us your Team ID." };
    await saveCredential(env, OWNER, "APPLE_PUSH_KEY", { keyId: pushCreds.keyId, teamId, p8: pushCreds.p8, status: status(check.ok), note: check.note });
    lines.push(`${mark(check.ok)} <strong>Push key ${escapeHtml(pushCreds.keyId)}</strong>: ${escapeHtml(check.note)}`);
  }
  const allGood = !lines.some((l) => !l.startsWith("✅"));
  return simplePage(200, allGood ? "Keys saved and working" : "Keys saved", `<p>${lines.join("</p><p>")}</p>
<p>${allGood ? "Nothing else is needed from Apple. You can delete the key files from Downloads." : `To try again without uploading anything, use the button below. To correct the Issuer ID, type it first.`}</p>
${allGood ? "" : `<form method="post" action="/api/store-keys/owner" enctype="multipart/form-data"><input type="hidden" name="t" value="${escapeHtml(token)}">
<p><label>Issuer ID (only if it changed)<br><input name="issuer_id" size="40" autocomplete="off"></label></p><p><button type="submit">Check saved keys again</button></p></form>`}`);
}

export { LINK_KIND, OWNER, OWNER_BUNDLE_ID, handleStoreKeys, keyIdOf, loadCredential, unseal };
