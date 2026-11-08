// The owner's own Mobile Apps (owner decision Nov 6, 2026): Menu-made and Nino's shirt shop go through the real Mobile
// App pipeline as its live test, published on the owner's accounts (his Apple developer account and Menu-made's Google
// Play account) instead of a buyer's. No charge, no Stripe session, so nothing is treated as a test order: approved
// listings go to the real App Store and Google Play.
//
// What's different from a bought Mobile App (store_apps.own_app = 1, migration 0040):
//   - created here by the 5-minute tick (once; skipped when the bundle id already has a row), not by checkout
//   - keys: the owner's (scope 'owner'), like the Sample Cafe test app; no buyer store-account step
//   - the owner's hands-on email lists only the steps for his own accounts (store-flow.js ownSteps)
// Content is the Guest App content (business_type shop / services, see guest-app/build.js); changes afterwards go
// through the normal update link in the monthly email. The logo is fetched once from the business's own website.
import { ownerEmailAddress } from "../lib/config.js";
import { nowIso } from "../lib/http.js";
import { sha256Hex } from "../lib/util.js";
import { refreshOnboardingState } from "../onboarding/onboarding.js";
import { sniffImage } from "../producers/website/intake.js";

const WORKFLOW = "STORE_APP_SETUP_V1";
const MAX_LOGO = 1_500_000;

const OWN_APPS = [
  {
    key: "menumade",
    business: "MENU-MADE",
    slug: "menumade",
    bundle: "com.menumade.menumade",
    logoUrl: "https://menu-made.com/MENU%3D.png",
    data: {
      app_name: "MENU-MADE",
      short_name: "MENU-MADE",
      business_type: "services",
      // The app is the whole website (owner decision Nov 6: "Whole site in an app"); menu below is only a fallback.
      site_url: "https://menu-made.com/",
      site_screens: ["/", "/plans.html", "/online-menu.html"],
      menu: [
        "# Plans",
        "Starter | Menu Care, Review Replies and Accessibility Monitoring | $79/mo",
        "Growth | Everything in Starter, plus Google Profile Care | $169/mo",
        "Pro | Everything in Growth, plus Social Posts and Website Care | $279/mo",
        "# One-time services",
        "Online Menu + QR | Your menu as a phone page, a QR code for every table and a print-ready PDF | $144",
        "Website Package | A new website of up to 5 pages, with 3 months of Website Care | $499",
        "Google Visibility | A one-time tune-up of your Google profile, with a before-and-after report | $149",
        "# Apps",
        "Guest App | An app guests add to their home screen: menu, specials, rewards and notifications | $299 + $29/mo",
        "Mobile App | Your own app in the App Store and Google Play | $999",
        "# Monthly services",
        "Menu Care | We update your online menu whenever you ask | $29/mo",
        "Google Profile Care | Weekly Google posts, photos, review replies and a monthly report | $149/mo",
        "Social Posts | 12 posts a month, written and designed | $129/mo",
        "Website Care | Hosting and changes for a website Menu-made built | $49/mo",
        "Accessibility Monitoring | A monthly check that your website works for every guest | $39/mo"
      ].join("\n"),
      specials: "See your own menu or website free before you checkout: upload your menu and get a preview in minutes.",
      phone: "",
      address: "",
      hours: "",
      order_url: "https://menu-made.com/plans.html",
      reserve_url: "",
      loyalty_reward: "",
      loyalty_visits: "",
      push_specials: "yes",
      brand_color: "#013f45"
    }
  },
  {
    key: "nino",
    business: "Nino Battaglia",
    slug: "ninos-ts",
    bundle: "com.menumade.ninobattaglia",
    logoUrl: "https://menu-made.com/assets/own-apps/nino-logo.png", // NinoLogo2024OB.png at 1024 px (the original is over 1.5 MB)
    data: {
      app_name: "Nino Battaglia",
      short_name: "Nino's Ts",
      business_type: "shop",
      site_url: "https://ninobattaglia.com/shop.html",
      site_screens: ["/shop.html", "/shirts/skull-wave.html", "/"],
      // Nino's own designs only (no third-party names in a store listing). Prices from the shop: $25, 2XL $27.
      menu: [
        "# Nino's Picks",
        "Yin Yang Ouroboros | Original artwork tee | $25",
        "Skull Wave | A blue ocean wave curling into a skull | $25",
        "North Beach SF | Original artwork for the neighborhood | $25",
        "Motopsycho | Nino's helmet skull over crossed wrenches | $25",
        "Artificial Intel | Original sci-fi artwork tee | $25",
        "Grumpy Frog | Original artwork tee | $25",
        "People Face | Original artwork tee | $25",
        "Bullshido | Graphic tee | $25",
        "Dark Mode | Graphic tee | $25"
      ].join("\n"),
      specials: "Every shirt is printed to order with Nino's artwork. Sizes S to 2XL, from $25. See the whole collection in the shop.",
      phone: "",
      address: "",
      hours: "",
      order_url: "https://ninobattaglia.com/shop.html",
      reserve_url: "",
      loyalty_reward: "",
      loyalty_visits: "",
      push_specials: "yes",
      brand_color: "#200705"
    }
  }
];

async function fetchLogo(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { headers: { "User-Agent": "MenuMadeBot/1.0" } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type || type.mime === "image/webp" || bytes.length > MAX_LOGO) return null;
    return { bytes, type };
  } catch { return null; }
}

// The logo as the intake form stores one (app_image = logo), so the build draws the icons from it.
async function attachLogo(env, spec, { customerId, businessId, projectId }, fetchImpl) {
  const logo = env.ASSETS ? await fetchLogo(spec.logoUrl, fetchImpl) : null;
  if (!logo) return false;
  const t = nowIso();
  const assetId = crypto.randomUUID();
  const key = ["customers", customerId, "projects", projectId, "app-images", `logo-${assetId}.${logo.type.ext}`].join("/");
  await env.ASSETS.put(key, logo.bytes, { httpMetadata: { contentType: logo.type.mime } });
  await env.DB.prepare(`
      INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at, validated_at, approved_for_use, is_customer_supplied, rights_confirmed, metadata_json)
      VALUES (?, ?, ?, ?, 'LOGO', 'R2', ?, ?, ?, ?, ?, 'VALID', ?, ?, 1, 1, 1, ?)
    `).bind(assetId, businessId, customerId, projectId, key, spec.logoUrl.split("/").pop().slice(0, 100), logo.type.mime, logo.bytes.length, await sha256Hex(logo.bytes), t, t, JSON.stringify({ app_image: "logo" })).run();
  return true;
}

async function createOwnApp(env, spec, { fetchImpl = fetch } = {}) {
  const t = nowIso();
  const email = ownerEmailAddress(env);
  let customer = await env.DB.prepare(`SELECT id FROM customers WHERE email = ? LIMIT 1`).bind(email).first();
  if (!customer) {
    customer = { id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO customers (id, created_at, updated_at, email, first_name, last_name) VALUES (?, ?, ?, ?, 'JP', 'Battaglia')`).bind(customer.id, t, t, email).run();
  }
  const offer = await env.DB.prepare(`SELECT o.id AS offer_id, v.id AS version_id FROM offers o JOIN offer_versions v ON v.offer_id = o.id WHERE o.code = 'STORE_APP_SETUP' AND v.status = 'ACTIVE' ORDER BY v.version_number LIMIT 1`).first();
  if (!offer) throw new Error("The Mobile App Setup offer is not in the catalog");
  const ids = { businessId: crypto.randomUUID(), orderId: crypto.randomUUID(), itemId: crypto.randomUUID(), projectId: crypto.randomUUID(), appId: crypto.randomUUID(), storeAppId: crypto.randomUUID() };
  // The store_apps row goes in first: its unique bundle id is what keeps a second tick from making a second app.
  await env.DB.prepare(`INSERT INTO store_apps (id, project_id, business_id, customer_id, bundle_id, status, own_app, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'WAITING_APP', 1, ?, ?, ?)`)
    .bind(ids.storeAppId, ids.projectId, ids.businessId, customer.id, spec.bundle, `Owner's own app (${spec.business}), no charge`, t, t).run();
  await env.DB.prepare(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)`).bind(ids.businessId, t, t, spec.business).run();
  await env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, payment_status, placed_at, notes) VALUES (?, ?, ?, ?, ?, 'PAID', 'USD', 0, 0, 0, 0, 'PAID', ?, ?)`)
    .bind(ids.orderId, t, t, customer.id, ids.businessId, t, `Owner's own Mobile App (${spec.business}): no charge`).run();
  await env.DB.prepare(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, quantity, unit_price_cents, line_total_cents, fulfillment_status) VALUES (?, ?, ?, ?, 1, 0, 0, 'PENDING')`)
    .bind(ids.itemId, ids.orderId, offer.offer_id, offer.version_id).run();
  await env.DB.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'APP', 'AWAITING_INPUTS', ?, ?, ?)`)
    .bind(ids.projectId, ids.orderId, ids.itemId, ids.businessId, customer.id, WORKFLOW, t, t).run();
  await env.DB.prepare(`INSERT INTO guest_apps (id, slug, project_id, business_id, customer_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(ids.appId, spec.slug, ids.projectId, ids.businessId, customer.id, JSON.stringify(spec.data), t, t).run();
  // The answers as the intake form would have saved them (all valid), so the normal release starts production.
  for (const [key, value] of Object.entries(spec.data)) {
    await env.DB.prepare(`INSERT OR IGNORE INTO project_inputs (id, project_id, input_key, input_type, required, value_text, status, submitted_at, validated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'VALID', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), ids.projectId, key, key.endsWith("_url") ? "URL" : "TEXT", ["app_name", "menu"].includes(key) ? 1 : 0, String(value), t, t, t, t).run();
  }
  // Mobile App Care for the owner's own app: notifications and the update link, no subscription.
  await env.DB.prepare(`INSERT INTO entitlements (id, customer_id, business_id, order_item_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'STORE_APP_CARE', 'ACTIVE', ?, ?, ?)`)
    .bind(crypto.randomUUID(), customer.id, ids.businessId, ids.itemId, t, t, t).run();
  const logo = await attachLogo(env, spec, { customerId: customer.id, businessId: ids.businessId, projectId: ids.projectId }, fetchImpl);
  await refreshOnboardingState(ids.projectId, ids.orderId, customer.id, WORKFLOW, env);
  return { ...ids, logo };
}

// From the 5-minute tick, at most once an hour: one read when both apps exist.
async function ensureOwnStoreApps(env, { now = new Date(), force = false, fetchImpl = fetch, apps = OWN_APPS } = {}) {
  if (!env.DB) return { created: [] };
  if (!force && now.getUTCMinutes() >= 5) return { created: [] };
  const have = new Set(((await env.DB.prepare(`SELECT bundle_id FROM store_apps WHERE own_app = 1`).all()).results || []).map((r) => r.bundle_id));
  const created = [];
  // An own app whose logo couldn't be fetched when it was made gets it now, while its content isn't approved yet.
  const bare = (await env.DB.prepare(`
      SELECT s.bundle_id, s.project_id, s.business_id, s.customer_id FROM store_apps s
      WHERE s.own_app = 1 AND s.status = 'WAITING_APP'
        AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.project_id = s.project_id AND a.status = 'VALID' AND json_extract(a.metadata_json, '$.app_image') = 'logo')
    `).all()).results || [];
  for (const row of bare) {
    const spec = apps.find((a) => a.bundle === row.bundle_id);
    if (spec) await attachLogo(env, spec, { customerId: row.customer_id, businessId: row.business_id, projectId: row.project_id }, fetchImpl).catch(() => false);
  }
  for (const spec of apps) {
    if (have.has(spec.bundle)) continue;
    const taken = await env.DB.prepare(`SELECT 1 AS ok FROM guest_apps WHERE slug = ? UNION ALL SELECT 1 FROM website_sites WHERE slug = ? LIMIT 1`).bind(spec.slug, spec.slug).first();
    if (taken) { console.error(`Own app ${spec.key}: address ${spec.slug} is already taken`); continue; }
    try { created.push({ key: spec.key, ...(await createOwnApp(env, spec, { fetchImpl })) }); }
    catch (error) { console.error(`Own app ${spec.key} not created:`, error instanceof Error ? error.message : String(error)); }
  }
  return { created };
}

export { OWN_APPS, createOwnApp, ensureOwnStoreApps };
