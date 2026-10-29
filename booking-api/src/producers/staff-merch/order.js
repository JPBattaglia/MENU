// Staff merch (stage 10): businesses order staff shirts with Nino's designs on menu-made.com/staff-merch.html,
// optionally with their own logo on the back. Owner decisions (Oct 28, 2026): every Nino shop design; logo allowed,
// each logo order waits for the owner's one-click approval of the proof (placement and rights); pricing in pricing.js.
//
// Money goes through Menu-made (its Stripe account and order engine). Printful is reached only through the Nino
// shop's private NinoMerch entrypoint (service binding env.MERCH), which holds the Printful token and re-checks every
// shirt against Printful. Nino's own shop checkout, Stripe account and database stay separate (locked decision).
//
// Routes (public, CORS like the rest of /api):
//   POST /api/merch/logo       multipart "logo" (PNG/JPG) -> { logo_id }        stored before payment so the proof can show it
//   POST /api/merch/quote      { items, recipient, logo_id?, environment? }      -> { quote_id, lines, rates, pricing }
//   POST /api/merch/checkout   { quote_id, rate_id, customer }                   -> { url } (Stripe Checkout)
//   GET  /api/merch-logo/<project>?t=                                            the logo, for Printful to download
import { ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, isCustomerEmail, looksLikeEmail, sendTransactionalEmail } from "../../lib/email.js";
import { jsonResponse, normalizeName, nowIso, parseJsonOrNull } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";
import { stripeRequest } from "../../lib/stripe.js";
import { insertFunnelEvent } from "../../checkout/funnel.js";
import { resolveActiveOffer } from "../../checkout/catalog.js";
import { createPendingOrder } from "../../checkout/orders.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { refreshOnboardingState } from "../../onboarding/onboarding.js";
import { sniffImage } from "../website/intake.js";
import { priceMerch } from "./pricing.js";

const WORKFLOW = "STAFF_MERCH_V1";
// Stripe tax codes: clothing (the Nino shirt shop uses the same one) and general tangible goods (mugs, coasters,
// totes, stickers).
const CLOTHING_TAX_CODE = "txcd_30011000";
const GOODS_TAX_CODE = "txcd_99999999";
const CLOTHING_KEYS = new Set(["tee", "hoodie", "polo", "apron", "cap", "beanie"]);
const UPLOAD_LINK_KIND = "merchupload";

// Pixel size of a PNG or JPG (the logo's shape decides where it sits on each product).
function imageSize(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}
const QUOTE_TTL_MINUTES = 30;
const MAX_LOGO_BYTES = 5_000_000;
const LOGO_LINK_KIND = "merchlogo";
const STATUS_KIND = "merchstatus";

const fail = (status, error) => jsonResponse({ ok: false, error }, status);
const externalIdFor = (orderId) => `mm${String(orderId).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 30)}`;
const environmentOf = (value) => (value === "sandbox" || value === "test" ? "sandbox" : "live");

async function merchService(env, method, args) {
  if (!env.MERCH || typeof env.MERCH[method] !== "function") return { ok: false, status: 503, error: "merch_unavailable", message: "Staff merch is not available right now." };
  try { return await env.MERCH[method](args); }
  catch (error) { return { ok: false, status: 503, error: "merch_unavailable", message: String(error?.message || error).slice(0, 200) }; }
}

// ---------- Logo upload (before payment) ----------
async function handleMerchLogoUpload(request, env) {
  if (!env.ASSETS) return fail(503, "Uploads are not available right now.");
  let form;
  try { form = await request.formData(); } catch { return fail(400, "Send the logo as a form upload."); }
  const file = form.get("logo");
  if (!file || typeof file === "string") return fail(400, "Choose a logo file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return fail(400, "The logo must be under 5 MB.");
  const type = sniffImage(bytes);
  if (!type || type.mime === "image/webp") return fail(400, "The logo must be a PNG or JPG image.");
  const size = imageSize(bytes);
  if (!size?.width || !size?.height) return fail(400, "That image could not be read. Please upload a PNG or JPG.");
  if (Math.max(size.width, size.height) < 300) return fail(400, "The logo is too small to print well. Please upload one at least 300 pixels wide.");
  const id = crypto.randomUUID();
  await env.ASSETS.put(`merch-uploads/${id}.${type.ext}`, bytes, { httpMetadata: { contentType: type.mime }, customMetadata: { uploaded_at: nowIso(), width: String(size.width), height: String(size.height) } });
  return jsonResponse({ ok: true, logo_id: `${id}.${type.ext}`, width: size.width, height: size.height });
}

// The products and their mockup templates, for the page (cached at the edge for an hour; the Nino shop keeps a
// daily copy, so a page load costs at most one small database read there).
async function handleMerchProducts(request, env, ctx) {
  const cache = globalThis.caches?.default;
  const key = new Request("https://menu-made.com/api/merch/products?v=2");
  const hit = cache && await cache.match(key).catch(() => null);
  if (hit) return hit;
  const result = await merchService(env, "products", {});
  if (!result.ok) return fail(result.status || 503, result.message || "Merch products are not available right now.");
  const response = jsonResponse({ ok: true, products: result.products });
  response.headers.set("Cache-Control", "public, max-age=3600");
  if (cache) ctx?.waitUntil?.(cache.put(key, response.clone()).catch(() => null));
  return response;
}

// A signed address for an uploaded logo, so Printful can read it for the cost estimate before payment.
async function uploadUrlFor(env, logoId) {
  const token = await signLinkToken(env, { kind: UPLOAD_LINK_KIND, id: logoId, ttlDays: 2 });
  return `${publicBaseUrl(env)}/api/merch-upload/${logoId}?t=${token}`;
}
async function handleMerchUpload(request, env, logoId) {
  const payload = await verifyLinkToken(env, new URL(request.url).searchParams.get("t") || "", [UPLOAD_LINK_KIND], logoId);
  if (!payload || payload.expired) return new Response("Not found", { status: 404 });
  const object = await env.ASSETS.get(`merch-uploads/${logoId}`);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(request.method === "HEAD" ? null : object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

// ---------- Quote ----------
async function handleMerchQuote(request, env) {
  if (!env.DB) return fail(503, "Database unavailable");
  let data;
  try { data = await request.json(); } catch { return fail(400, "Invalid JSON body"); }
  const environment = environmentOf(data?.environment);
  const logoId = data?.logo_id ? String(data.logo_id) : null;
  const head = logoId && /^[0-9a-f-]{36}\.(png|jpg)$/.test(logoId) ? await env.ASSETS.head(`merch-uploads/${logoId}`) : null;
  if (logoId && !head) return fail(400, "Upload the logo again.");
  // Embroidery threads matched to the logo's colours by the page (the Nino shop keeps only Printful's thread colours).
  const threads = Array.isArray(data?.thread_colors) ? data.thread_colors.slice(0, 6).map((c) => String(c).slice(0, 7)) : [];
  const logo = head ? { url: await uploadUrlFor(env, logoId), width: Number(head.customMetadata?.width) || 1000, height: Number(head.customMetadata?.height) || 1000, thread_colors: threads } : null;
  const ninoItems = Array.isArray(data?.items) ? data.items : [];
  const logoItems = Array.isArray(data?.logo_items) ? data.logo_items : [];
  const quote = await merchService(env, "quote", { items: ninoItems, logo_items: logoItems, logo, recipient: data?.recipient });
  if (!quote.ok) return fail(quote.status || 502, quote.message || quote.error);
  const pricing = priceMerch(quote.lines || [], { logo: Boolean(logoId), logoLines: quote.logo_lines || [], costs: quote.costs });
  const id = crypto.randomUUID();
  const t = nowIso();
  const expires = new Date(Date.now() + QUOTE_TTL_MINUTES * 60000).toISOString();
  await env.DB.prepare(`INSERT INTO merch_quotes (id, created_at, expires_at, environment, recipient_json, lines_json, rates_json, pricing_json, logo_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, t, expires, environment, JSON.stringify(quote.recipient), JSON.stringify(pricing.lines), JSON.stringify(quote.rates),
      JSON.stringify({ ...pricing, lines: undefined, logo: logo ? { width: logo.width, height: logo.height, thread_colors: logo.thread_colors } : null }), logoId ? `merch-uploads/${logoId}` : null).run();
  const strip = ({ fingerprint, catalog_variant_id, ...l }) => l;
  return jsonResponse({ ok: true, quote_id: id, expires_at: expires, environment, lines: [...pricing.lines, ...pricing.logo_lines].map(strip), rates: quote.rates, pricing: { ...pricing, lines: undefined, logo_lines: undefined } });
}

// ---------- Checkout ----------
async function handleMerchCheckout(request, env) {
  if (!env.DB) return fail(503, "Database unavailable");
  let data;
  try { data = await request.json(); } catch { return fail(400, "Invalid JSON body"); }
  const quote = await env.DB.prepare(`SELECT * FROM merch_quotes WHERE id = ?`).bind(String(data?.quote_id || "")).first();
  if (!quote) return fail(404, "That quote was not found. Please review your order again.");
  if (Date.parse(quote.expires_at) < Date.now()) return fail(409, "That quote has expired. Please review your order again.");
  if (quote.order_id) return fail(409, "That quote was already used. Please review your order again.");
  const environment = quote.environment;
  if (environment === "live" ? !env.STRIPE_SECRET_KEY : !env.STRIPE_SECRET_KEY_TEST) return fail(500, "Payments are not configured");
  const rate = (parseJsonOrNull(quote.rates_json) || []).find((r) => r.id === String(data?.rate_id || ""));
  if (!rate) return fail(400, "Choose a delivery option.");
  const business = normalizeName(data?.customer?.business);
  if (!business) return fail(400, "Business name is required.");
  const offer = await resolveActiveOffer("STAFF_MERCH", env, { requirePublic: environment === "live" });
  if (!offer) return fail(409, "Staff merch is not on sale yet.");
  const lines = parseJsonOrNull(quote.lines_json) || [];
  const pricing = parseJsonOrNull(quote.pricing_json) || {};
  const total = pricing.subtotal_cents + rate.amount_cents;
  const recipient = parseJsonOrNull(quote.recipient_json);
  const logoLines = pricing.logo_lines || [];
  const merch = { lines, logo_lines: logoLines, logo: pricing.logo || null, rate, recipient, logo_key: quote.logo_key, pricing: { ...pricing, logo_lines: undefined }, quote_id: quote.id };
  const orderItem = {
    offerId: offer.offer_id, offerVersionId: offer.offer_version_id, offerCode: "STAFF_MERCH", offerName: offer.offer_name,
    quantity: 1, priceCents: total, currency: "USD", extraMetadata: { staff_merch: merch }
  };
  const pending = await createPendingOrder({ ...data, customer: { ...data.customer, business } }, [orderItem], env, environment);
  if (!pending.ok) return fail(pending.status, pending.error);
  const claimed = await env.DB.prepare(`UPDATE merch_quotes SET order_id = ? WHERE id = ? AND order_id IS NULL`).bind(pending.orderId, quote.id).run();
  if (!Number(claimed.meta?.changes)) return fail(409, "That quote was already used. Please review your order again.");

  // Sales tax (owner decision Oct 28, 2026): staff shirts are physical goods, so Stripe Tax adds sales tax on top
  // (menu-made account, California registration). Stripe Tax uses the delivery address on the Stripe customer; it
  // refuses automatic tax together with payment_intent_data[shipping] (same as the Nino shop, Oct 28).
  let customer;
  try {
    const c = new URLSearchParams();
    c.append("email", pending.email);
    if (pending.name) c.append("name", pending.name);
    c.append("shipping[name]", recipient.name);
    c.append("shipping[address][line1]", recipient.address1);
    if (recipient.address2) c.append("shipping[address][line2]", recipient.address2);
    c.append("shipping[address][city]", recipient.city);
    if (recipient.state_code) c.append("shipping[address][state]", recipient.state_code);
    c.append("shipping[address][postal_code]", recipient.zip);
    c.append("shipping[address][country]", recipient.country_code);
    c.append("metadata[order_id]", pending.orderId);
    customer = await stripeRequest(env, environment, "/v1/customers", { method: "POST", params: c, idempotencyKey: `merch-customer/${pending.orderId}` });
  } catch (error) {
    await env.DB.prepare(`UPDATE orders SET status = 'FAILED', payment_status = 'FAILED', updated_at = ? WHERE id = ?`).bind(nowIso(), pending.orderId).run();
    return jsonResponse({ ok: false, order_id: pending.orderId, error: "Payment could not be started. Please try again.", stripe_error: error?.body || error?.message }, error?.status || 502);
  }

  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", `https://menu-made.com/checkoutsuccess.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(pending.orderId)}`);
  params.append("cancel_url", "https://menu-made.com/staff-merch.html");
  params.append("customer", customer.id);
  params.append("automatic_tax[enabled]", "true");
  params.append("metadata[order_id]", pending.orderId);
  params.append("metadata[environment]", environment);
  params.append("metadata[business]", pending.businessName);
  params.append("metadata[email]", pending.email);
  params.append("metadata[services]", "Staff merch");
  params.append("payment_intent_data[metadata][order_id]", pending.orderId);
  const stripeLines = [
    ...lines.map((line) => ({ name: `Staff shirt: ${line.title} (${[line.color, line.size].filter(Boolean).join(", ")})`, description: `Nino Battaglia design${quote.logo_key ? ", your logo on the back" : ""}${pricing.discount_percent ? `, ${pricing.discount_percent}% team discount` : ""}. Printed and shipped by Printful.`, unit: line.unit_cents, quantity: line.quantity, taxCode: CLOTHING_TAX_CODE })),
    ...logoLines.map((line) => ({ name: `${line.title} with your logo (${[line.color, line.size].filter((x) => x && x !== "One size").join(", ") || "one size"})`, description: `Made to order${pricing.discount_percent ? `, ${pricing.discount_percent}% team discount` : ""}. Printed and shipped by Printful.`, unit: line.unit_cents, quantity: line.quantity, taxCode: CLOTHING_KEYS.has(line.key) ? CLOTHING_TAX_CODE : GOODS_TAX_CODE })),
    ...(pricing.setup_cents ? [{ name: "Embroidery set-up (one-time)", description: "Digitizing your logo for embroidery.", unit: pricing.setup_cents, quantity: 1, taxCode: GOODS_TAX_CODE }] : [])
  ];
  stripeLines.forEach((line, i) => {
    params.append(`line_items[${i}][price_data][currency]`, "usd");
    params.append(`line_items[${i}][price_data][tax_behavior]`, "exclusive");
    params.append(`line_items[${i}][price_data][product_data][tax_code]`, line.taxCode);
    params.append(`line_items[${i}][price_data][unit_amount]`, String(line.unit));
    params.append(`line_items[${i}][price_data][product_data][name]`, line.name.slice(0, 250));
    params.append(`line_items[${i}][price_data][product_data][description]`, line.description);
    params.append(`line_items[${i}][quantity]`, String(line.quantity));
  });
  params.append("shipping_options[0][shipping_rate_data][display_name]", rate.name.slice(0, 100));
  params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  params.append("shipping_options[0][shipping_rate_data][tax_behavior]", "exclusive");
  params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(rate.amount_cents));
  params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
  params.append("custom_text[submit][message]", "Shirts ship to the address you entered on menu-made.com.");
  let session;
  try {
    session = await stripeRequest(env, environment, "/v1/checkout/sessions", { method: "POST", params });
  } catch (error) {
    await env.DB.prepare(`UPDATE orders SET status = 'FAILED', payment_status = 'FAILED', updated_at = ? WHERE id = ?`).bind(nowIso(), pending.orderId).run();
    return jsonResponse({ ok: false, order_id: pending.orderId, error: "Payment could not be started. Please try again.", stripe_error: error?.body || error?.message }, error?.status || 502);
  }
  // Stripe adds the tax; what we priced (shirts and delivery) must match exactly.
  if (Number(session.amount_subtotal) !== pricing.subtotal_cents || Number(session.total_details?.amount_shipping ?? rate.amount_cents) !== rate.amount_cents || session.automatic_tax?.enabled !== true) {
    await stripeRequest(env, environment, `/v1/checkout/sessions/${session.id}/expire`, { method: "POST" }).catch(() => null);
    await env.DB.prepare(`UPDATE orders SET status = 'FAILED', payment_status = 'FAILED', updated_at = ? WHERE id = ?`).bind(nowIso(), pending.orderId).run();
    return fail(500, "The total did not match. Please try again.");
  }
  await env.DB.prepare(`UPDATE orders SET stripe_checkout_session_id = ?, updated_at = ? WHERE id = ?`).bind(session.id, nowIso(), pending.orderId).run();
  await insertFunnelEvent(env, { event_type: "CHECKOUT_STARTED", offer_id: offer.offer_id, offer_version_id: offer.offer_version_id, order_id: pending.orderId, metadata: { environment, stripe_checkout_session_id: session.id, staff_merch: true } }).catch(() => null);
  return jsonResponse({ ok: true, order_id: pending.orderId, url: session.url, environment });
}

// ---------- After payment ----------
async function merchOf(env, context) {
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(context.id).first();
  return parseJsonOrNull(project?.metadata_json)?.merch || null;
}

// Called by the checkout webhook: the order already says exactly what to make, so it goes straight to production.
async function startStaffMerch(env, { projectId }) {
  const context = await loadDeliveryContext(projectId, env);
  if (!context || context.workflow_key !== WORKFLOW) return { started: false };
  const item = await env.DB.prepare(`SELECT metadata_json FROM order_items WHERE id = ?`).bind(context.order_item_id).first();
  const meta = parseJsonOrNull(item?.metadata_json) || {};
  const merch = meta.staff_merch;
  if (!merch?.lines?.length) {
    await sendTransactionalEmail(env, {
      to: ownerEmailAddress(env), subject: "[Staff merch] paid order without its shirt list",
      html: brandedEmailHtml({ eyebrow: "AUTOMATION ALERT", heading: "A staff merch order has no shirt list", paragraphs: [`Order ${escapeHtml(context.order_id)} was paid, but the shirts could not be read, so nothing was ordered from Printful.`] }),
      text: `Order ${context.order_id} was paid, but the shirts could not be read, so nothing was ordered from Printful.`,
      idempotencyKey: `merch-missing/${projectId}`, purpose: "AUTOMATION_ALERT", templateKey: "merch_missing_v1"
    }).catch(() => null);
    return { started: false };
  }
  // The order holds shirts + delivery; the sales tax Stripe charged on top is recorded from the payment.
  const order = await env.DB.prepare(`SELECT subtotal_cents FROM orders WHERE id = ?`).bind(context.order_id).first();
  const payment = await env.DB.prepare(`SELECT amount_cents FROM payments WHERE order_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1`).bind(context.order_id).first();
  const preTax = Number(order?.subtotal_cents || 0);
  const taxCents = payment ? Math.max(0, Number(payment.amount_cents) - preTax) : 0;
  if (payment) await env.DB.prepare(`UPDATE orders SET tax_cents = ?, total_cents = ?, updated_at = ? WHERE id = ?`).bind(taxCents, preTax + taxCents, nowIso(), context.order_id).run();
  // Printful may cost at most what the buyer paid for shirts and delivery (the tax is owed to the state, not spendable).
  const record = { ...merch, environment: meta.environment || "live", external_id: externalIdFor(context.order_id), paid_total_cents: preTax, tax_cents: taxCents };
  await env.DB.prepare(`UPDATE projects SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.merch', json(?)), updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(record), nowIso(), projectId).run();
  await refreshOnboardingState(projectId, context.order_id, context.customer_id, WORKFLOW, env);
  return { started: true };
}

async function logoUrlFor(env, projectId) {
  const token = await signLinkToken(env, { kind: LOGO_LINK_KIND, id: projectId, ttlDays: 30 });
  return `${publicBaseUrl(env)}/api/merch-logo/${projectId}?t=${token}`;
}

// Printful downloads the logo from here when it prints the order.
async function handleMerchLogo(request, env, projectId) {
  const payload = await verifyLinkToken(env, new URL(request.url).searchParams.get("t") || "", [LOGO_LINK_KIND], projectId);
  if (!payload || payload.expired) return new Response("Not found", { status: 404 });
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ? AND workflow_key = ?`).bind(projectId, WORKFLOW).first();
  const key = parseJsonOrNull(project?.metadata_json)?.merch?.logo_key;
  const object = key ? await env.ASSETS.get(key) : null;
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(request.method === "HEAD" ? null : object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

// Places the Printful order for a paid (and, with a logo, approved) merch project. Idempotent: Printful finds the
// order by its external id, so a retry never prints twice. Sandbox orders only ever make a draft.
async function placePrintfulOrder(env, context) {
  const merch = await merchOf(env, context);
  if (!merch) throw new Error("Staff merch details are missing from the project");
  if (merch.printful_order_id && merch.printful_status && merch.printful_status !== "draft") return merch;
  const sandbox = merch.environment === "sandbox" || String(context.stripe_checkout_session_id || "").startsWith("cs_test_");
  const result = await merchService(env, "placeOrder", {
    external_id: merch.external_id,
    lines: merch.lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity, title: l.title, retail_cents: l.unit_cents, fingerprint: l.fingerprint })),
    logo_lines: (merch.logo_lines || []).map((l) => ({ key: l.key, variant_id: l.variant_id, quantity: l.quantity, retail_cents: l.unit_cents })),
    logo: merch.logo_key && merch.logo ? { url: await logoUrlFor(env, context.id), width: merch.logo.width, height: merch.logo.height, thread_colors: merch.logo.thread_colors || [] } : null,
    recipient: merch.recipient, email: context.customer_email, shipping_method: merch.rate.id,
    logo_url: merch.logo_key ? await logoUrlFor(env, context.id) : null,
    // Printful may never cost more than the buyer paid for the shirts and delivery.
    max_cost_cents: merch.paid_total_cents || (merch.pricing.subtotal_cents + merch.rate.amount_cents),
    confirm: !sandbox
  });
  if (!result.ok) {
    const error = new Error(`Printful order not placed (${result.error}): ${result.message || ""}`);
    error.review = result.status === 409;
    throw error;
  }
  const t = nowIso();
  await env.DB.prepare(`UPDATE projects SET metadata_json = json_set(metadata_json, '$.merch.printful_order_id', ?, '$.merch.printful_status', ?, '$.merch.printful_cost_cents', ?, '$.merch.ordered_at', ?), updated_at = ? WHERE id = ?`)
    .bind(result.printful_order_id, result.status, result.cost_cents, t, t, context.id).run();
  return { ...merch, printful_order_id: result.printful_order_id, printful_status: result.status, printful_cost_cents: result.cost_cents, sandbox };
}

// ---------- Tracking (hourly) ----------
// Once Printful ships a merch order, the buyer gets one email with the tracking link.
async function emailMerchTracking(env, now = new Date()) {
  if (!env.DB || !env.MERCH || now.getUTCMinutes() >= 5) return null;
  const since = new Date(now.getTime() - 45 * 864e5).toISOString();
  const rows = (await env.DB.prepare(`
      SELECT id FROM projects WHERE workflow_key = 'STAFF_MERCH_V1' AND status = 'DELIVERED' AND created_at > ?
        AND json_extract(metadata_json, '$.merch.printful_order_id') IS NOT NULL
        AND json_extract(metadata_json, '$.merch.tracking_emailed_at') IS NULL
        AND COALESCE(json_extract(metadata_json, '$.merch.environment'), 'live') = 'live'
      LIMIT 10
    `).bind(since).all()).results || [];
  let sent = 0;
  for (const row of rows) {
    const context = await loadDeliveryContext(row.id, env);
    const merch = context && await merchOf(env, context);
    if (!merch) continue;
    const status = await merchService(env, "orderStatus", { external_id: merch.external_id });
    const shipments = (status.ok && status.shipments || []).filter((s) => s.tracking_url || s.tracking_number);
    if (!shipments.length || !isCustomerEmail(context.customer_email, "ORDER_SHIPPED", env)) continue;
    const r = await sendTransactionalEmail(env, {
      to: context.customer_email,
      subject: "Your staff shirts are on the way",
      html: brandedEmailHtml({
        preheader: "Tracking for your staff merch order.", eyebrow: "STAFF MERCH", heading: "Your shirts have shipped",
        paragraphs: [`Hi ${escapeHtml(context.first_name || "there")}, your ${escapeHtml(context.business_name || "")} staff shirts are on their way.`],
        rows: shipments.map((s) => [s.carrier || "Carrier", s.tracking_number || ""]),
        buttons: shipments.filter((s) => s.tracking_url).slice(0, 2).map((s, i) => ({ label: shipments.length > 1 ? `Track parcel ${i + 1}` : "Track your parcel", url: s.tracking_url, primary: i === 0 })),
        footnote: "Questions? Reply to this email."
      }),
      text: `Your staff shirts have shipped.\n${shipments.map((s) => `${s.carrier || ""} ${s.tracking_number || ""} ${s.tracking_url || ""}`.trim()).join("\n")}`,
      idempotencyKey: `merch-shipped/${row.id}`, purpose: "ORDER_SHIPPED", templateKey: "merch_shipped_v1",
      context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: row.id }
    }).catch(() => null);
    if (r?.ok) {
      sent++;
      await env.DB.prepare(`UPDATE projects SET metadata_json = json_set(metadata_json, '$.merch.tracking_emailed_at', ?) WHERE id = ?`).bind(nowIso(), row.id).run();
    }
  }
  return { sent };
}

export { handleMerchProducts, handleMerchUpload, imageSize, LOGO_LINK_KIND, STATUS_KIND, WORKFLOW as STAFF_MERCH_WORKFLOW, emailMerchTracking, externalIdFor, handleMerchCheckout, handleMerchLogo, handleMerchLogoUpload, handleMerchQuote, logoUrlFor, merchOf, merchService, placePrintfulOrder, startStaffMerch };
