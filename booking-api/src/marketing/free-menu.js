// MΞNU free plan (stage 15 task 2, owner Nov 14, 2026: "Free plan, forever: one design (Classic), live menu link and
// QR, the owner edits it themselves, a small 'Made with MΞNU' badge. Paid unlocks the other designs, the print set,
// the website and Google menu sync.")
//
// From any regular menu preview (the website generator bar and the MΞNU app's generator screen), "Start free" emails
// a confirm link to the preview's address (the preview's email is typed, never checked, so the live menu waits for
// that click). Confirming makes, with no owner approval and no AI call:
//   - a customer account (or the existing one for that email) and a new business, signed in on that browser;
//   - an Online Menu + QR project (MENU_QR_V1, metadata free_plan) with the usual hosted address and QR code, so the
//     menu editor, translations (paid plans only), the account page and the live menu route all treat it as a menu;
//   - the menu in the Classic design with the preview's customizing and edited items, as the FINAL menu page;
//   - the QR code (SVG) as a delivery on the account.
// No print set, no other design, no hosting year: menuHostingState says "free_plan" and the menu never goes
// offline; the live route adds the badge. Upgrading is the same preview's "Make it live" (the preview stays open for
// a business that has a free menu) and the paid order keeps the free menu's address and QR (menu-inputs.js).
//
//   POST /api/menu-preview/free/<token>          -> page "check your email" | JSON { ok, sent_to } (the app)
//   GET  /api/menu-free/confirm/<token>?t=…      -> a button (email scanners open links), POST makes the menu live
//
// Cost guard: the AI read already happened (and was capped) when the preview was made; this adds storage only.
// FREE_PER_DAY menus a day in total and FREE_PER_EMAIL per address keep a runaway loop or a bad actor small.
import QRCode from "qrcode/lib/browser.js";
import { qrScanUrl } from "./menu-stats.js";
import { nowIso, parseJsonOrNull, simplePage } from "../lib/http.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { DELIVERY_LINK_TTL_DAYS, ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { sha256Hex } from "../lib/util.js";
import { createMenuQrInputs } from "../onboarding/menu-inputs.js";
import { SESSION_DAYS, cookieHeader, createSession } from "../account/account.js";
import { loadPreviewLogo, renderMenuDesign } from "./public-preview.js";
import { isOccasion } from "../checkout/holiday.js";
import { pausedForSale } from "../lib/switches.js";
import { wantsJson, preflight } from "./framed.js";

const KIND = "menu-free";
const LINK_DAYS = 7;
const FREE_DESIGN = "classic";
const FREE_PER_DAY = 60;
const FREE_PER_EMAIL = 3;
const OFFER_ID = "offer_menu_free";
const OFFER_VERSION_ID = "ov_menu_free_1";
const START_LABEL = "Start free: Classic design";
const START_NOTE = "Free forever: the Classic design, your live menu link and QR code, edit it yourself, with a small Made with MΞNU badge.";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
const mask = (email) => String(email).replace(/^(.)[^@]*(@.*)$/, (_, a, b) => `${a}•••${b}`);

async function previewRow(env, token) {
  if (!/^[a-f0-9]{36}$/.test(String(token || "")) || !env.DB) return null;
  return env.DB.prepare(`SELECT token, request_id, email, business, status, created_at, expires_at, campaign, occasion, free_project_id FROM menu_previews WHERE token = ?`).bind(token).first();
}

// Which previews can start free: a finished regular menu preview (holiday menus are paid specials), still open
// or within the 14 days its "Make it live" works, made for a real business address.
function startable(env, row, now) {
  if (!row || row.status !== "READY") return "This preview isn't available.";
  if (isOccasion(row.occasion)) return "Holiday menus aren't part of the free plan.";
  if (String(row.email || "").toLowerCase() === String(ownerEmailAddress(env)).toLowerCase()) return "Make a new preview with the business's own email address to start it free.";
  const open = row.free_project_id || row.expires_at > new Date(now).toISOString() || Date.parse(row.created_at) >= now - (row.campaign === "prospect" ? 22 : 14) * 86400000;
  return open ? null : "This preview has ended. Make a new one to start free.";
}

const freeUrl = (env, token) => `${publicBaseUrl(env)}/api/menu-preview/free/${token}`;

// For the generator's state (the MΞNU app) and the preview page: the third button. null when it doesn't apply.
function freeButton(env, row, now = Date.now()) {
  if (!row || isOccasion(row.occasion) || startable(env, row, now)) return null;
  return { label: row.free_project_id ? "Your free menu is live" : START_LABEL, url: freeUrl(env, row.token), note: START_NOTE, live: Boolean(row.free_project_id) };
}

// The preview page's form, added when the page is served (pages stored before this get it too).
function addFreeButton(env, page, row, now = Date.now()) {
  const button = freeButton(env, row, now);
  if (!button || page.includes('class="mm-gen-free"') || !page.includes('class="mm-gen-pick"')) return page;
  const css = `<style>.mm-gen-free{display:contents}.mm-gen-free button{flex:none;padding:12px 18px;border:0;border-radius:8px;background:#ffffff1f;color:#fff;box-shadow:inset 0 0 0 2px #00d6e6;font:700 15px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}@media (max-width:600px){.mm-gen-free button{padding:10px 12px;font-size:14px}}</style>`;
  const form = `<form class="mm-gen-free" method="post" action="${escapeHtml(button.url)}"><button type="submit" title="${escapeHtml(button.note)}">${escapeHtml(button.label)}</button></form>`;
  return page.replace("</head>", () => `${css}</head>`).replace(/(<a class="mm-gen-pick"[^>]*>[^<]*<\/a>)/, (m) => `${m}\n  ${form}`);
}

async function ensureOffer(env, t) {
  await env.DB.prepare(`
      INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key, is_public)
      VALUES (?, ?, ?, 'MENU_FREE', 'MΞNU free menu', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 0, 'MENU_QR_V1', 0)
    `).bind(OFFER_ID, t, t).run();
  await env.DB.prepare(`
      INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json)
      VALUES (?, ?, 1, ?, ?, 'ACTIVE', 0, ?)
    `).bind(OFFER_VERSION_ID, OFFER_ID, t, t, JSON.stringify({ design: FREE_DESIGN, badge: true, print_set: false })).run();
}

// POST /api/menu-preview/free/<token>
async function handleFreeStart(request, env, token, { now = Date.now() } = {}) {
  if (request.method === "OPTIONS") return preflight();
  const app = wantsJson(request);
  const fail = (status, text) => app ? json({ ok: false, error: text }, status) : simplePage(status, "Your free menu", `<p>${escapeHtml(text)}</p>`);
  if (!env.DB || !env.ASSETS) return fail(503, "This isn't available right now. Please try again in a minute.");
  if (await pausedForSale(env, ["ONLINE_MENU_QR"]).catch(() => null)) return fail(409, "Online menus are paused right now. Please try again later.");
  const row = await previewRow(env, token);
  const why = startable(env, row, now);
  if (why) return fail(410, why);
  if (row.free_project_id) {
    const text = "Your free menu is already live. Sign in to your account with this email to edit it.";
    return app ? json({ ok: true, live: true, message: text }) : simplePage(200, "Your free menu is live", `<p>${escapeHtml(text)}</p><p><a class="btn" href="/account.html">Your account</a></p>`);
  }
  const link = `${publicBaseUrl(env)}/api/menu-free/confirm/${token}?t=${encodeURIComponent(await signLinkToken(env, { kind: KIND, id: token, ttlDays: LINK_DAYS }))}`;
  // One email per preview every 10 minutes: pressing the button again doesn't flood the inbox.
  const sent = await sendTransactionalEmail(env, {
    to: row.email,
    subject: `Make ${row.business}'s free menu live`,
    html: brandedEmailHtml({
      preheader: "One tap and your menu is live, free, with its own QR code.",
      eyebrow: "MΞNU free plan",
      heading: "Make your free menu live",
      paragraphs: [
        escapeHtml(`Tap the button to put ${row.business}'s menu online in the Classic design, with its own link and QR code. It's free for as long as you keep it, and you can change prices, mark items sold out and add specials yourself.`),
        "The free menu shows a small “Made with MΞNU” badge. The other designs, the print set (PDF menu, table tent, TV menu) and translations come with a paid plan, whenever you want them.",
        "If you didn't ask for this, ignore this email and nothing happens."
      ],
      buttons: [{ label: "Make my menu live", url: link, primary: true }]
    }),
    text: `Make ${row.business}'s free menu live (Classic design, its own link and QR code, free for as long as you keep it):\n${link}\n\nIf you didn't ask for this, ignore this email.`,
    idempotencyKey: `menu-free/${token}/${Math.floor(now / 600000)}`,
    purpose: "MENU_FREE_CONFIRM",
    templateKey: "menu_free_confirm_v1",
    context: {}
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  if (sent?.ok === false) return fail(502, "We couldn't send the email just now. Please try again in a minute.");
  const message = `We sent a link to ${mask(row.email)}. Open it on this phone or computer to make your menu live.`;
  if (app) return json({ ok: true, sent_to: mask(row.email), message });
  return simplePage(200, "Check your email", `<p>${escapeHtml(message)}</p><p style="font-size:14px">Nothing there after a minute? Check spam, or go back and press <strong>${escapeHtml(START_LABEL)}</strong> again.</p>`);
}

// GET shows a button; POST makes the menu live and signs the browser in.
async function handleFreeConfirm(request, env, token, { now = Date.now() } = {}) {
  const url = new URL(request.url);
  const form = request.method === "POST" ? await request.formData().catch(() => null) : null;
  const t = form ? form.get("t") : url.searchParams.get("t");
  const ended = () => simplePage(410, "This link has expired", `<p>Links to start a free menu work for ${LINK_DAYS} days. Open your preview again and press <strong>${escapeHtml(START_LABEL)}</strong>, or make a new preview at <a href="/online-menu">menu-made.com/online-menu</a>.</p>`);
  const payload = await verifyLinkToken(env, String(t || ""), [KIND], token).catch(() => null);
  if (!payload || payload.expired || !env.DB || !env.ASSETS) return ended();
  const row = await previewRow(env, token);
  const why = startable(env, row, now);
  if (why) return simplePage(410, "Your free menu", `<p>${escapeHtml(why)}</p>`);
  if (request.method !== "POST") {
    return simplePage(200, row.free_project_id ? "Your free menu is live" : "Make your free menu live",
      `<p>${row.free_project_id ? "It's already live. Press the button to open it in your account." : `<strong>${escapeHtml(row.business)}</strong>: the Classic design, its own link and QR code, free for as long as you keep it.`}</p><form method="post"><input type="hidden" name="t" value="${escapeHtml(String(t))}"><button type="submit">${row.free_project_id ? "Open my menu" : "Make my menu live"}</button></form>`);
  }
  const out = await createFreeMenu(env, row, { now }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  if (!out.ok) {
    if (out.error && !out.user) console.error("Free menu failed:", out.error);
    return simplePage(out.status || 500, "Your free menu", `<p>${escapeHtml(out.user ? out.error : "Something went wrong making your menu live. Please try again in a minute, or reply to any email from Menu-Made.")}</p>`);
  }
  const session = await createSession(env, out.customerId);
  return new Response(null, { status: 303, headers: {
    Location: `${publicBaseUrl(env)}/menu-editor.html?business=${encodeURIComponent(out.businessId)}&welcome=free`,
    "Set-Cookie": cookieHeader(session.cookie, SESSION_DAYS * 86400), "Cache-Control": "no-store" } });
}

async function findOrCreateCustomer(env, email, t) {
  const found = await env.DB.prepare(`SELECT id FROM customers WHERE lower(email) = lower(?) ORDER BY created_at ASC LIMIT 1`).bind(email).first();
  if (found) return found.id;
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, status, marketing_consent, lifetime_value_cents) VALUES (?, ?, ?, ?, 'ACTIVE', 0, 0)`)
    .bind(id, t, t, email).run();
  return id;
}

// Makes the free menu live. Safe to call twice for one preview: the preview row is claimed first.
async function createFreeMenu(env, row, { now = Date.now() } = {}) {
  const t = new Date(now).toISOString();
  const projectId = crypto.randomUUID();
  if (row.free_project_id) {
    const p = await env.DB.prepare(`SELECT business_id, customer_id FROM projects WHERE id = ?`).bind(row.free_project_id).first();
    if (p) return { ok: true, existing: true, projectId: row.free_project_id, businessId: p.business_id, customerId: p.customer_id };
  }
  const dayAgo = new Date(now - 86400000).toISOString();
  const today = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM menu_previews WHERE free_project_id IS NOT NULL AND free_claimed_at > ?`).bind(dayAgo).first())?.n || 0);
  if (today >= FREE_PER_DAY) return { ok: false, user: true, status: 429, error: "We've made a lot of free menus today. Please try again tomorrow." };
  const mine = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM menu_previews WHERE lower(email) = lower(?) AND free_project_id IS NOT NULL`).bind(row.email).first())?.n || 0);
  if (mine >= FREE_PER_EMAIL) return { ok: false, user: true, status: 429, error: `The free plan covers ${FREE_PER_EMAIL} businesses per email address. Sign in to your account to edit the ones you have.` };
  const data = parseJsonOrNull(await (await env.ASSETS.get(`menu-previews/${row.token}/data.json`))?.text());
  if (!data?.menu?.sections?.length) return { ok: false, user: true, status: 410, error: "This preview's menu is no longer available. Make a new preview to start free." };
  const claimed = await env.DB.prepare(`UPDATE menu_previews SET free_project_id = ?, free_claimed_at = ? WHERE token = ? AND free_project_id IS NULL`).bind(projectId, t, row.token).run();
  if (!claimed.meta?.changes) {
    const again = await previewRow(env, row.token);
    return createFreeMenu(env, again, { now });
  }
  try {
    await ensureOffer(env, t);
    const email = String(row.email).toLowerCase();
    const customerId = await findOrCreateCustomer(env, email, t);
    const name = String(data.custom?.name || data.business || row.business).slice(0, 150);
    const businessId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name, email, business_status, notes) VALUES (?, ?, ?, ?, ?, 'ACTIVE_CUSTOMER', ?)`)
      .bind(businessId, t, t, name, email, "MΞNU free plan").run();
    await env.DB.prepare(`INSERT OR IGNORE INTO customer_businesses (customer_id, business_id, role, is_primary, created_at) VALUES (?, ?, 'CUSTOMER', 1, ?)`).bind(customerId, businessId, t).run();
    const orderId = crypto.randomUUID();
    const order = { id: orderId, customer_id: customerId, business_id: businessId };
    await env.DB.prepare(`
        INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, placed_at, notes)
        VALUES (?, ?, ?, ?, ?, 'COMPLETED', 'USD', 0, 0, 0, 0, 'PAID', ?, ?)
      `).bind(orderId, t, t, customerId, businessId, t, `MΞNU free plan. Preview ref: ${row.token}`).run();
    const itemId = crypto.randomUUID();
    await env.DB.prepare(`
        INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents, metadata_json)
        VALUES (?, ?, ?, ?, 0, 0, ?)
      `).bind(itemId, orderId, OFFER_ID, OFFER_VERSION_ID, JSON.stringify({ environment: "live", free_plan: true })).run();
    await env.DB.prepare(`
        INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, 'MENU', 'DELIVERED', 'MENU_QR_V1', 1, ?, ?, ?)
      `).bind(projectId, orderId, itemId, businessId, customerId, t, t, JSON.stringify({ free_plan: { preview: row.token, design: FREE_DESIGN, started_at: t } })).run();
    await createMenuQrInputs(projectId, order, t, env);
    const destination = (await env.DB.prepare(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = 'qr_destination'`).bind(projectId).first())?.value_text;
    if (!destination) throw new Error("No menu address was made");

    const html = renderMenuDesign(data, FREE_DESIGN, await loadPreviewLogo(env, row.token, data.custom).catch(() => null));
    const menu = await storeDeliverable(env, { projectId, orderId, customerId, businessId, t, type: "MENU_DRAFT", ext: "html", mime: "text/html; charset=utf-8", bytes: new TextEncoder().encode(html), name: `${name}-menu.html`, meta: { free_plan: true, design: FREE_DESIGN } });
    const svg = await QRCode.toString(qrScanUrl(destination, env), { type: "svg", errorCorrectionLevel: "H", margin: 4, width: 1024 });
    const qr = await storeDeliverable(env, { projectId, orderId, customerId, businessId, t, type: "QR_CODE", ext: "svg", mime: "image/svg+xml", bytes: new TextEncoder().encode(svg), name: `${name}-qr.svg`, meta: { free_plan: true, destination_url: destination } });
    await sendLiveEmail(env, { email, name, destination, qrDeliverableId: qr, businessId, customerId, orderId, projectId, token: row.token });
    return { ok: true, projectId, businessId, customerId, menuDeliverableId: menu, qrDeliverableId: qr, destination };
  } catch (error) {
    // Let the buyer try again: the claim is released (rows already written stay; nothing points at them).
    await env.DB.prepare(`UPDATE menu_previews SET free_project_id = NULL, free_claimed_at = NULL WHERE token = ? AND free_project_id = ?`).bind(row.token, projectId).run().catch(() => {});
    throw error;
  }
}

async function storeDeliverable(env, { projectId, orderId, customerId, businessId, t, type, ext, mime, bytes, name, meta }) {
  const assetId = crypto.randomUUID();
  const deliverableId = crypto.randomUUID();
  const key = ["customers", customerId, "projects", projectId, "deliverables", type === "QR_CODE" ? "qr" : "menu", "v1", `${assetId}.${ext}`].join("/");
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: mime }, customMetadata: { assetId, projectId, orderId, customerId, businessId, deliverableType: type, version: "1" } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, 'DELIVERABLE', 'R2', ?, ?, ?, ?, ?, 'VALID', ?, ?, 1, 0, 1, ?)
    `).bind(assetId, businessId, customerId, projectId, key, name.replace(/[^\w.-]+/g, "-").slice(0, 120), mime.split(";")[0], bytes.byteLength, await sha256Hex(bytes), t, t,
    JSON.stringify({ generated_by: "MENU_MADE_AUTOMATION", deliverable_type: type, deliverable_version: 1, ...meta })).run();
  await env.DB.prepare(`
      INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at)
      VALUES (?, ?, ?, ?, 1, 'FINAL', 1, ?, ?)
    `).bind(deliverableId, projectId, assetId, type, t, t).run();
  return deliverableId;
}

async function sendLiveEmail(env, { email, name, destination, qrDeliverableId, businessId, customerId, orderId, projectId, token }) {
  const base = publicBaseUrl(env);
  const qrLink = `${base}/api/delivery/${qrDeliverableId}?t=${encodeURIComponent(await signLinkToken(env, { kind: "deliver", id: qrDeliverableId, ttlDays: DELIVERY_LINK_TTL_DAYS }))}`;
  const editor = `${base}/menu-editor.html?business=${encodeURIComponent(businessId)}`;
  const upgrade = `${base}/api/menu-preview/view/${token}`;
  return sendTransactionalEmail(env, {
    to: email,
    subject: `${name}'s menu is live`,
    html: brandedEmailHtml({
      preheader: "Your free menu and QR code are ready.",
      eyebrow: "MΞNU free plan",
      heading: "Your menu is live",
      paragraphs: [
        escapeHtml(`${name}'s menu is online in the Classic design. Print the QR code for your tables, door or window; it always opens the newest version of your menu.`),
        "Change a price, mark an item sold out or add a special any time from your account. It updates at once, at the same link and QR code.",
        "Want another design, the print set (PDF menu, table tent, TV menu), translations or no badge? Open your preview, pick a design and press Make it live. Your link and QR code stay the same."
      ],
      rows: [["Your menu", destination]],
      buttons: [{ label: "Open your menu", url: destination, primary: true }, { label: "Download your QR code", url: qrLink }, { label: "Edit your menu", url: editor }, { label: "See every design", url: upgrade }]
    }),
    text: `${name}'s menu is live: ${destination}\n\nQR code: ${qrLink}\nEdit your menu: ${editor}\nOther designs and the print set: ${upgrade}`,
    idempotencyKey: `menu-free-live/${projectId}`,
    purpose: "MENU_FREE_LIVE",
    templateKey: "menu_free_live_v1",
    context: { customerId, businessId, orderId, projectId }
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
}

export { FREE_DESIGN, FREE_PER_DAY, FREE_PER_EMAIL, START_LABEL, addFreeButton, createFreeMenu, freeButton, handleFreeConfirm, handleFreeStart };
