// Stage 11 part 2: a restaurant's store listing, the owner's approval, submission and review status.
//
//   WAITING_SUBMIT_APPROVAL  the build run also took the listing pictures (POST /api/store-build/listing, OIDC): iPhone
//                            and Android screenshots of the real app, the Play icon and feature graphic. Once they're
//                            all in, the tick writes the listing text and emails the owner a preview link (signed, no
//                            token to remember). The page shows the text (editable) and pictures; Approve -> the next
//                            tick submits to Apple and Google with the restaurant's keys (store-submit.js) -> IN_REVIEW.
//                            A store refusing the submission emails the owner its words; Approve again retries.
//   IN_REVIEW                checked hourly: Apple's version state; Google's public store page. Both live -> LIVE and
//                            the buyer gets the store links. Apple rejects -> REJECTED and the owner gets the steps
//                            (reply in Resolution Center, then Build again). Google silent for 14 days -> owner alerted.
// Test orders (Stripe test mode) never reach the stores: approval records a sandbox submission and goes straight to
// LIVE with the buyer email marked as a test (Working rules: test orders never trigger real fulfilment).
//
//   POST /api/store-build/listing?store_app=<id>&name=<ios-1..3|android-1..3|play-icon|feature>   (OIDC) one PNG
//   GET  /api/store-app/<id>/listing?t=                    the owner's preview; POST approves (with any edited text)
//   GET  /api/store-app/<id>/listing/<name>.png?t=         a preview picture
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { isTestOrder, loadDeliveryContext } from "../approvals/release.js";
import { buildTarget, rebuildLink } from "./store-build.js";
import { engagementSettings } from "../producers/guest-app/engage.js";
import { parseOfferings } from "../producers/website/build.js";
import { storeScope } from "./restaurant-keys.js";
import { loadCredential } from "./keys.js";
import { parseServiceAccount } from "./google.js";
import { appleStatus, googleLive, submitApple, submitGoogle } from "./store-submit.js";

const LISTING_KIND = "storeapp-listing";
const IMAGE_NAMES = ["ios-1", "ios-2", "ios-3", "android-1", "android-2", "android-3", "play-icon", "feature"];
const REQUIRED = ["ios-1", "android-1", "android-2", "play-icon", "feature"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const POLL_MS = 3600000;
const GOOGLE_SILENT_MS = 14 * 86400000;
const imageKey = (id, name) => `store-app/${id}/listing/${name}.png`;
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
const LIMITS = { name: 30, subtitle: 30, keywords: 100, promo: 170, description: 4000, play_title: 30, play_short: 80, play_full: 4000 };

// ---------- Listing text (pure) ----------

function cut(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const at = t.lastIndexOf(" ", max);
  return t.slice(0, at > max * 0.6 ? at : max).replace(/[\s,;:-]+$/, "");
}

// data = the Guest App's answers (guest_apps.data_json); rewards = its rewards card is on.
function listingText(data, { businessName, baseUrl, rewards = false, year = new Date().getUTCFullYear() }) {
  const name = cut(data.app_name || businessName || "Our restaurant", 30);
  let sections = [];
  try { sections = parseOfferings(data.menu).map((s) => String(s.name || "").trim()).filter(Boolean).slice(0, 4); } catch { sections = []; }
  const city = (String(data.address || "").split(",").map((s) => s.trim()).filter(Boolean)[1] || "").replace(/\d+/g, "").trim();
  const order = /^https:\/\//.test(String(data.order_url || ""));
  const features = [
    "Browse the full menu", "see today's specials", "check our hours", "get directions or call in one tap",
    ...(order ? ["order online"] : []), ...(rewards ? ["collect a visit on your rewards card every time you come in"] : [])
  ];
  const list = `${features.slice(0, -1).join(", ")} and ${features.at(-1)}`;
  const description = [
    `The official app of ${name}${city ? ` in ${city}` : ""}.`,
    `${list[0].toUpperCase()}${list.slice(1)}.`,
    sections.length ? `On the menu: ${sections.join(", ")}.` : "",
    "Turn on notifications to hear about new specials first.",
    data.address ? `Find us at ${String(data.address).trim()}.` : ""
  ].filter(Boolean).join("\n\n");
  // Apple already searches the app name, so its words would waste the 100 characters.
  const nameWords = new Set(String(name).toLowerCase().split(/[^a-z0-9']+/));
  const keywordParts = [city.toLowerCase(), "menu", "restaurant", "food", "specials", ...(rewards ? ["rewards"] : []), ...(order ? ["order"] : []), "hours"]
    .filter((w, i, a) => w && w.length > 1 && !nameWords.has(w) && a.indexOf(w) === i);
  let keywords = "";
  for (const w of keywordParts) if ((keywords ? `${keywords},${w}` : w).length <= 100) keywords = keywords ? `${keywords},${w}` : w;
  const subtitle = rewards ? "Menu, specials and rewards" : "Menu, specials and hours";
  return {
    name, subtitle, keywords, description: cut(description, 4000).length === description.length ? description : description.slice(0, 4000),
    promo: cut(`${rewards ? "Collect a visit every time you come in. " : ""}Today's specials and the full menu, always up to date.`, 170),
    play_title: name, play_short: cut(`${name}: menu, specials, hours${rewards ? " and rewards" : ""}.`, 80), play_full: description.slice(0, 4000),
    support_url: `${baseUrl}/contact.html`, marketing_url: "", privacy_url: `${baseUrl}/privacy.html`, copyright: `${year} ${cut(businessName || name, 60)}`
  };
}

// ---------- Rows ----------

async function listingRow(env, id) {
  return env.DB.prepare(`SELECT * FROM store_app_listings WHERE store_app_id = ?`).bind(id).first();
}
async function upsertListing(env, id, fields) {
  const t = nowIso();
  await env.DB.prepare(`INSERT OR IGNORE INTO store_app_listings (store_app_id, images_json, created_at, updated_at) VALUES (?, '{}', ?, ?)`).bind(id, t, t).run();
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE store_app_listings SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE store_app_id = ?`).bind(...keys.map((k) => fields[k]), t, id).run();
}
const parse = (text, fallback) => { try { return JSON.parse(text || "") ?? fallback; } catch { return fallback; } };

async function appData(env, storeApp) {
  const row = await env.DB.prepare(`SELECT slug, data_json FROM guest_apps WHERE project_id = ?`).bind(storeApp.project_id).first();
  return { slug: row?.slug || "", data: parse(row?.data_json, {}) };
}

// ---------- Pictures from the build ----------

async function handleListingImage(request, env) {
  const target = await buildTarget(request, env);
  if (target.error) return target.error;
  if (!target.storeApp) return json({ ok: true, stored: false }); // the owner's sample build has no listing
  const name = new URL(request.url).searchParams.get("name") || "";
  const out = await storeListingImage(env, target.storeApp, name, new Uint8Array(await request.arrayBuffer()));
  return json(out.body, out.status);
}

// One listing picture for one store app (the self-test calls this directly). -> { status, body }
async function storeListingImage(env, storeApp, name, bytes) {
  const json = (data, status = 200) => ({ status, body: data });
  if (!IMAGE_NAMES.includes(name)) return json({ ok: false, error: `name must be one of ${IMAGE_NAMES.join(", ")}` }, 400);
  if (bytes.length > MAX_IMAGE_BYTES) return json({ ok: false, error: "Too large" }, 413);
  if (bytes.length < 100 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return json({ ok: false, error: "Not a PNG" }, 422);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = { w: v.getUint32(16), h: v.getUint32(20) };
  await env.ASSETS.put(imageKey(storeApp.id, name), bytes, { httpMetadata: { contentType: "image/png" } });
  const row = await listingRow(env, storeApp.id);
  const images = { ...parse(row?.images_json, {}), [name]: { ...size, at: nowIso() } };
  await upsertListing(env, storeApp.id, { images_json: JSON.stringify(images) });
  return json({ ok: true, stored: bytes.length, ...size });
}

// ---------- The owner's preview and approval ----------

async function previewLink(env, id) {
  const token = await signLinkToken(env, { kind: LISTING_KIND, id, ttlDays: 30 });
  return { token, url: `${publicBaseUrl(env)}/api/store-app/${id}/listing?t=${encodeURIComponent(token)}` };
}

function field(key, label, value, rows = 1) {
  const max = LIMITS[key];
  const input = rows > 1
    ? `<textarea name="${key}" rows="${rows}" maxlength="${max}" style="width:100%;font:inherit">${escapeHtml(value)}</textarea>`
    : `<input name="${key}" value="${escapeHtml(value)}" maxlength="${max}" style="width:100%;font:inherit;padding:6px;box-sizing:border-box">`;
  return `<p><label><strong>${label}</strong> <span style="font-size:13px">(up to ${max} characters)</span><br>${input}</label></p>`;
}

async function handleListingPage(request, env, id) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const url = new URL(request.url);
  let token = url.searchParams.get("t") || "";
  let form = null;
  if (request.method === "POST") { try { form = await request.formData(); token = String(form.get("t") || token); } catch { form = null; } }
  const payload = await verifyLinkToken(env, token, [LISTING_KIND], id);
  if (!payload || payload.expired) return simplePage(403, "This link has expired or isn't valid", "<p>Ask Claude for a fresh preview link.</p>");
  const storeApp = await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ?`).bind(id).first();
  const row = await listingRow(env, id);
  const listing = parse(row?.listing_json, null);
  if (!storeApp || !listing) return simplePage(404, "Not ready", "<p>The listing isn't ready yet.</p>");
  if (storeApp.status !== "WAITING_SUBMIT_APPROVAL") return simplePage(200, "Already sent", `<p>This listing was already approved (status: ${escapeHtml(storeApp.status)}).</p>`);

  if (form) {
    const edited = { ...listing };
    for (const key of Object.keys(LIMITS)) {
      const value = form.get(key);
      if (typeof value !== "string") continue;
      const clean = value.replace(/\r\n/g, "\n").trim();
      if (!clean && ["name", "description", "play_title", "play_short", "play_full"].includes(key)) return simplePage(400, "Something is empty", `<p>${escapeHtml(key)} can't be empty. Go back and fill it in.</p>`);
      if (clean.length > LIMITS[key]) return simplePage(400, "Too long", `<p>${escapeHtml(key)} is over ${LIMITS[key]} characters. Go back and shorten it.</p>`);
      edited[key] = clean;
    }
    if (edited.keywords) edited.keywords = edited.keywords.split(",").map((k) => k.trim()).filter(Boolean).join(",").slice(0, 100);
    await upsertListing(env, id, { listing_json: JSON.stringify(edited), approved_at: nowIso(), submit_error: null });
    return simplePage(200, "Approved", "<p>It goes to Apple and Google within 5 minutes. You'll get an email if either store refuses it, and the restaurant gets one when the app is live.</p>");
  }

  const img = (name, w) => `<img src="/api/store-app/${escapeHtml(id)}/listing/${name}.png?t=${encodeURIComponent(token)}" alt="${name}" style="width:${w}px;border:1px solid #ddd;border-radius:8px;margin:4px">`;
  const images = parse(row.images_json, {});
  const { data } = await appData(env, storeApp);
  return simplePage(200, `Store listing: ${listing.name}`, `<p>App <strong>${escapeHtml(storeApp.bundle_id)}</strong>. Edit anything below, then press <strong>Approve and submit</strong>. Apple and Google review it (usually 1-3 days); approval isn't guaranteed.</p>
${row.submit_error ? `<p style="color:#a11"><strong>Last try:</strong> ${escapeHtml(row.submit_error)}</p>` : ""}
<h2 style="font-size:18px">Pictures</h2>
<p>${IMAGE_NAMES.filter((n) => n.startsWith("ios-") && images[n]).map((n) => img(n, 150)).join("")}</p>
<p>${IMAGE_NAMES.filter((n) => n.startsWith("android-") && images[n]).map((n) => img(n, 150)).join("")}</p>
<p>${images["play-icon"] ? img("play-icon", 96) : ""} ${images.feature ? img("feature", 320) : ""}</p>
<form method="post" action="/api/store-app/${escapeHtml(id)}/listing"><input type="hidden" name="t" value="${escapeHtml(token)}">
<h2 style="font-size:18px">App Store</h2>
${field("name", "Name", listing.name)}${field("subtitle", "Subtitle", listing.subtitle)}${field("promo", "Promotional text", listing.promo, 2)}
${field("description", "Description", listing.description, 8)}${field("keywords", "Keywords (commas, no spaces needed)", listing.keywords)}
<h2 style="font-size:18px">Google Play</h2>
${field("play_title", "Title", listing.play_title)}${field("play_short", "Short description", listing.play_short)}${field("play_full", "Full description", listing.play_full, 8)}
<p style="font-size:13px">Review contact for Apple: ${escapeHtml(data.phone || "the restaurant's phone")}. Support and privacy pages: ${escapeHtml(listing.support_url)}, ${escapeHtml(listing.privacy_url)}.</p>
<p><button type="submit">Approve and submit</button></p></form>`);
}

async function handleListingImageView(request, env, id, name) {
  const payload = await verifyLinkToken(env, new URL(request.url).searchParams.get("t"), [LISTING_KIND], id);
  if (!payload || payload.expired || !IMAGE_NAMES.includes(name)) return new Response("Not found", { status: 404 });
  const obj = await env.ASSETS.get(imageKey(id, name));
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" } });
}

// ---------- Emails ----------

async function emailOwner(env, storeApp, subject, heading, paragraphs, buttons, key) {
  return sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject,
    html: brandedEmailHtml({ preheader: heading, eyebrow: "STORE APP", heading, paragraphs, buttons, rows: [["App", storeApp.bundle_id]] }),
    text: `${heading}\n\n${paragraphs.map((p) => p.replace(/<[^>]+>/g, "")).join("\n\n")}\n\n${buttons.map((b) => `${b.label}: ${b.url}`).join("\n")}`,
    idempotencyKey: `store-listing/${storeApp.id}/${key}`, purpose: "OWNER_ACTION", templateKey: "store_listing_owner_v1"
  }).catch(() => ({ ok: false }));
}

async function emailBuyerLive(env, storeApp, context, links, test) {
  const { data } = await appData(env, storeApp);
  const name = String(data.app_name || "Your app");
  const paragraphs = [
    `${escapeHtml(name)} is live in the App Store and Google Play. Share these links with your guests, or put them next to your menu QR code.`,
    "Menu and specials changes reach the app by themselves. To send your guests a notification, use the link in your monthly email."
  ];
  return sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `${test ? "[TEST] " : ""}${name} is live in the App Store and Google Play`,
    html: brandedEmailHtml({ preheader: "Your app is live.", eyebrow: "STORE APP", heading: `${name} is live`, paragraphs,
      buttons: [{ label: "App Store", url: links.apple, primary: true }, { label: "Google Play", url: links.google }] }),
    text: `${paragraphs.join("\n\n").replace(/<[^>]+>/g, "")}\n\nApp Store: ${links.apple}\nGoogle Play: ${links.google}`,
    idempotencyKey: `store-live/${storeApp.id}`, purpose: "DELIVERY", templateKey: "store_app_live_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  }).catch(() => ({ ok: false }));
}

// ---------- The tick ----------

async function submitBoth(env, storeApp, listing, context, deps) {
  const scope = storeScope(storeApp);
  const images = {};
  for (const name of IMAGE_NAMES) {
    const obj = await env.ASSETS.get(imageKey(storeApp.id, name));
    if (obj) images[name] = new Uint8Array(await obj.arrayBuffer());
  }
  const { data } = await appData(env, storeApp);
  const out = { apple: null, google: null };
  let apiKey = null;
  try { apiKey = await loadCredential(env, scope, "APPLE_API_KEY"); } catch { apiKey = null; }
  out.apple = apiKey ? await submitApple({
    creds: apiKey, bundleId: storeApp.bundle_id, listing, images,
    contact: { first_name: context.first_name || "Restaurant", last_name: context.last_name || "Owner", phone: String(data.phone || "").trim() || "+1 000 000 0000", email: context.customer_email }
  }, deps) : { ok: false, step: "keys", message: "No App Store Connect key on file for this restaurant." };
  let play = null;
  try { play = await loadCredential(env, scope, "GOOGLE_PLAY_ACCOUNT"); } catch { play = null; }
  const sa = play ? parseServiceAccount(play.p8) : null;
  out.google = sa ? await submitGoogle({ sa, packageName: storeApp.bundle_id, listing, images }, deps) : { ok: false, step: "keys", message: "No Google Play access on file for this restaurant." };
  return out;
}

// deps: { fetchImpl } for Apple and Google; { only } = one store app id (the self-test's scaffold).
async function advanceStoreListings(env, now = Date.now(), deps = {}) {
  if (!env.DB) return { moved: 0 };
  const rows = (deps.only
    ? await env.DB.prepare(`SELECT * FROM store_apps WHERE id = ? AND status IN ('WAITING_SUBMIT_APPROVAL', 'IN_REVIEW')`).bind(deps.only).all()
    : await env.DB.prepare(`SELECT * FROM store_apps WHERE status IN ('WAITING_SUBMIT_APPROVAL', 'IN_REVIEW') ORDER BY updated_at LIMIT 10`).all()).results || [];
  let moved = 0;
  for (const storeApp of rows) {
    const row = await listingRow(env, storeApp.id);
    const context = await loadDeliveryContext(storeApp.project_id, env);
    if (!context) continue;
    const test = isTestOrder(context);

    if (storeApp.status === "WAITING_SUBMIT_APPROVAL") {
      const images = parse(row?.images_json, {});
      if (!REQUIRED.every((n) => images[n])) continue;
      // A new build (the row moved since the last preview) gets a fresh preview.
      if (!row.preview_sent_at || row.preview_sent_at < storeApp.updated_at) {
        const { data } = await appData(env, storeApp);
        let rewards = false;
        try { rewards = Boolean(engagementSettings(data).loyalty.enabled); } catch { rewards = false; }
        const listing = listingText(data, { businessName: context.business_name, baseUrl: publicBaseUrl(env), rewards });
        await upsertListing(env, storeApp.id, { listing_json: JSON.stringify(listing), approved_at: null, submit_error: null });
        const { url } = await previewLink(env, storeApp.id);
        const sent = await emailOwner(env, storeApp, `${test ? "[TEST] " : ""}Approve the store listing for ${listing.name}`, "Store listing ready for your OK",
          [`${escapeHtml(context.business_name || "A restaurant")}'s app is built and uploaded. The preview shows the App Store and Google Play text and pictures; edit anything, then approve.`,
            "Before approving, make sure the hands-on steps are done in App Store Connect (age rating, App Privacy, pricing: Free) and Play Console (Data safety, content rating, target audience). A store refusing the submission emails you its reason."],
          [{ label: "Preview and approve", url, primary: true }], `preview/${storeApp.updated_at}`);
        if (sent?.ok !== false) await upsertListing(env, storeApp.id, { preview_sent_at: nowIso() });
        continue;
      }
      if (!row.approved_at || row.submitted_at >= row.approved_at) continue;
      const listing = parse(row.listing_json, null);
      if (!listing) continue;
      const t = nowIso();
      if (test) {
        await upsertListing(env, storeApp.id, { submitted_at: t, apple_json: JSON.stringify({ ok: true, sandbox: true }), google_json: JSON.stringify({ ok: true, sandbox: true }), live_at: t });
        await env.DB.prepare(`UPDATE store_apps SET status = 'LIVE', note = 'Test order: listing approved, stores not contacted', updated_at = ? WHERE id = ? AND status = 'WAITING_SUBMIT_APPROVAL'`).bind(t, storeApp.id).run();
        await emailBuyerLive(env, storeApp, context, { apple: `${publicBaseUrl(env)}/`, google: `${publicBaseUrl(env)}/` }, true);
        moved++;
        continue;
      }
      const result = await submitBoth(env, storeApp, listing, context, deps);
      const errors = [["Apple", result.apple], ["Google", result.google]].filter(([, r]) => !r.ok).map(([who, r]) => `${who} (${r.step}): ${r.message}`);
      if (errors.length) {
        // Neither store is retried by itself: the owner fixes the cause and approves again (same link).
        await upsertListing(env, storeApp.id, { submitted_at: t, submit_error: errors.join(" | ").slice(0, 900), apple_json: JSON.stringify(result.apple), google_json: JSON.stringify(result.google) });
        const { url } = await previewLink(env, storeApp.id);
        await emailOwner(env, storeApp, `Store submission needs a look: ${listing.name}`, "A store didn't take the submission",
          [...errors.map(escapeHtml), "Fix what the store asks for (usually a form in App Store Connect or Play Console), then press Approve and submit again on the preview page. A store that already took it is simply sent the same listing again."],
          [{ label: "Preview and approve again", url, primary: true }], `error/${t}`);
        continue;
      }
      await upsertListing(env, storeApp.id, { submitted_at: t, submit_error: null, apple_json: JSON.stringify(result.apple), google_json: JSON.stringify(result.google), last_poll_at: t });
      await env.DB.prepare(`UPDATE store_apps SET status = 'IN_REVIEW', note = ?, updated_at = ? WHERE id = ? AND status = 'WAITING_SUBMIT_APPROVAL'`)
        .bind(result.google.draft ? "Submitted; Google Play draft waits for Send for review" : "Submitted to both stores", t, storeApp.id).run();
      if (result.google.draft) {
        await emailOwner(env, storeApp, `One click in Play Console: ${listing.name}`, "Send the first Android release for review",
          ["Apple has the app for review. Google takes a new app's first production release as a draft: in Play Console, open the app, Publishing overview, and press <strong>Send changes for review</strong>. Later releases go by themselves."],
          [{ label: "Open Play Console", url: "https://play.google.com/console", primary: true }], "google-draft");
      }
      moved++;
      continue;
    }

    // IN_REVIEW: hourly.
    if (row?.last_poll_at && now - Date.parse(row.last_poll_at) < POLL_MS) continue;
    const apple = parse(row?.apple_json, {});
    const google = parse(row?.google_json, {});
    const t = nowIso();
    let appleState = apple.state || null;
    if (apple.versionId && !apple.live) {
      let creds = null;
      try { creds = await loadCredential(env, storeScope(storeApp), "APPLE_API_KEY"); } catch { creds = null; }
      const s = creds ? await appleStatus({ creds, versionId: apple.versionId }, deps) : { ok: false };
      if (s.ok) {
        appleState = s.state;
        apple.state = s.state; apple.live = s.live;
        if (s.rejected) {
          await upsertListing(env, storeApp.id, { apple_json: JSON.stringify(apple), last_poll_at: t });
          await env.DB.prepare(`UPDATE store_apps SET status = 'REJECTED', note = ?, updated_at = ? WHERE id = ?`).bind(`Apple: ${s.state}`, t, storeApp.id).run();
          await emailOwner(env, storeApp, `Apple didn't approve ${storeApp.bundle_id}`, "Apple sent the app back",
            [`Apple's review status: <strong>${escapeHtml(s.state)}</strong>. The reviewer's message is in App Store Connect, App Review (Resolution Center); Apple doesn't share it through its API.`,
              "Reply there, or forward the message to Claude for the likely fix. When the fix needs a new build, press Build again; otherwise resubmit from App Store Connect."],
            [{ label: "Open App Store Connect", url: "https://appstoreconnect.apple.com/apps", primary: true }, { label: "Build again", url: await rebuildLink(env, storeApp) }], `rejected/${s.state}/${t.slice(0, 10)}`);
          continue;
        }
      }
    }
    if (!google.live && await googleLive(storeApp.bundle_id, deps)) google.live = true;
    await upsertListing(env, storeApp.id, { apple_json: JSON.stringify(apple), google_json: JSON.stringify(google), last_poll_at: t });
    if (apple.live && google.live) {
      await upsertListing(env, storeApp.id, { live_at: t });
      await env.DB.prepare(`UPDATE store_apps SET status = 'LIVE', note = 'Live in both stores', updated_at = ? WHERE id = ? AND status = 'IN_REVIEW'`).bind(t, storeApp.id).run();
      await emailBuyerLive(env, storeApp, context, {
        apple: `https://apps.apple.com/app/id${encodeURIComponent(apple.appId || "")}`,
        google: `https://play.google.com/store/apps/details?id=${encodeURIComponent(storeApp.bundle_id)}`
      }, false);
      moved++;
    } else if (!google.live && row.submitted_at && now - Date.parse(row.submitted_at) > GOOGLE_SILENT_MS && !google.alerted) {
      google.alerted = true;
      await upsertListing(env, storeApp.id, { google_json: JSON.stringify(google) });
      await emailOwner(env, storeApp, `Google Play hasn't published ${storeApp.bundle_id}`, "Still not on Google Play after 14 days",
        [`Apple: ${escapeHtml(appleState || "unknown")}. Google Play's page for the app isn't public yet. Check Play Console, Publishing overview and Inbox, for a review result or a missing form.`],
        [{ label: "Open Play Console", url: "https://play.google.com/console", primary: true }], "google-silent");
    }
  }
  return { moved };
}

export { IMAGE_NAMES, LISTING_KIND, advanceStoreListings, storeListingImage, handleListingImage, handleListingImageView, handleListingPage, imageKey, listingText };
