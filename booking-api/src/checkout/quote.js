import { resolveActiveOffer } from "./catalog.js";

// Keep the quoted menu scope with its existing offer/order item, so prepaid
// hosting and extra pages do not create unrelated fulfillment projects.
const MENU_PACKAGE_PRICING = Object.freeze({
  setupCents: 12900,
  hostingFirstYearCents: 1500,
  includedPages: 3,
  additionalPageCents: 2000,
  maxPages: 50
});

class CheckoutValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function quoteMenuPackage(menuPages) {
  if (!Number.isInteger(menuPages) || menuPages < 1 || menuPages > MENU_PACKAGE_PRICING.maxPages) {
    throw new CheckoutValidationError("Choose a menu page count from 1 to 50.");
  }
  const additionalPages = Math.max(0, menuPages - MENU_PACKAGE_PRICING.includedPages);
  return {
    pricing_version: "menu-first-year-2026-10-15",
    menu_pages: menuPages,
    included_pages: MENU_PACKAGE_PRICING.includedPages,
    included_revisions: 2,
    setup_cents: MENU_PACKAGE_PRICING.setupCents,
    additional_pages: additionalPages,
    additional_page_cents: MENU_PACKAGE_PRICING.additionalPageCents,
    additional_pages_cents: additionalPages * MENU_PACKAGE_PRICING.additionalPageCents,
    hosting_first_year_cents: MENU_PACKAGE_PRICING.hostingFirstYearCents,
    total_cents: MENU_PACKAGE_PRICING.setupCents + MENU_PACKAGE_PRICING.hostingFirstYearCents + additionalPages * MENU_PACKAGE_PRICING.additionalPageCents,
    currency: "USD",
    hosting_renewal_cents: 1500,
    hosting_renewal_automatic: false
  };
}

function appendCheckoutLineItem(params, item, index, environment) {
  const prefix = `line_items[${index}]`;
  if (item.menuPackage || environment === "sandbox") {
    params.append(`${prefix}[price_data][currency]`, item.currency.toLowerCase());
    params.append(`${prefix}[price_data][unit_amount]`, String(item.priceCents));
    params.append(`${prefix}[price_data][product_data][name]`, item.menuPackage
      ? `${item.offerName} — ${item.menuPackage.menu_pages} menu pages + first-year hosting`
      : item.offerName);
    if (item.menuPackage) {
      params.append(`${prefix}[price_data][product_data][description]`, "$129 setup includes up to 3 pages and two revisions; $20 per additional page; $15 first-year hosting. Hosting renewal is $15/year, arranged separately; no automatic subscription.");
    }
  } else {
    params.append(`${prefix}[price]`, item.stripePriceId);
  }
  params.append(`${prefix}[quantity]`, String(item.quantity));
}

async function normalizeCheckoutItems(itemsInput, env, checkoutOptions = {}, { requirePublic = true } = {}) {
  const normalizedItems = [];
  let menuSelected = false;
  for (const item of itemsInput) {
    const identifier = item?.offer_id || item?.code || item?.slug || item?.key;
    if (!identifier) {
      continue;
    }
    const catalogRow = await resolveActiveOffer(
      identifier,
      env,
      { requirePublic }
    );
    if (!catalogRow) {
      continue;
    }
    let quantity = Number(item?.qty) > 0 ? Math.floor(
      Number(item.qty)
    ) : 1;
    const isMenu = String(catalogRow.offer_code).toUpperCase() === "ONLINE_MENU_QR";
    let menuPackage;
    if (isMenu) {
      if (menuSelected || (item.qty !== undefined && item.qty !== 1)) {
        throw new CheckoutValidationError("One menu package per order. Use the page count for additional menu pages.");
      }
      menuSelected = true;
      menuPackage = quoteMenuPackage(checkoutOptions.menu_pages);
      // A catalog change requires a matching quote update, rather than silently
      // advertising one amount and charging another.
      if (Number(catalogRow.price_cents) !== MENU_PACKAGE_PRICING.setupCents || String(catalogRow.currency).toUpperCase() !== "USD") {
        throw new CheckoutValidationError("Menu package pricing is being updated. Please contact us before purchasing.", 503);
      }
      quantity = 1;
    }
    normalizedItems.push({
      key: identifier,
      quantity,
      offerId: catalogRow.offer_id,
      offerCode: catalogRow.offer_code,
      offerName: catalogRow.offer_name,
      offerVersionId: catalogRow.offer_version_id,
      priceCents: menuPackage ? menuPackage.total_cents : Number(
        catalogRow.price_cents
      ),
      currency: String(
        catalogRow.currency || "USD"
      ).toUpperCase(),
      stripePriceId: catalogRow.stripe_price_id || null,
      stripeProductId: catalogRow.stripe_product_id || null,
      ...(menuPackage ? { menuPackage } : {})
    });
  }
  if (!menuSelected && checkoutOptions.menu_pages !== undefined) {
    throw new CheckoutValidationError("A menu page count requires an Online Menu + QR package.");
  }
  return normalizedItems;
}

export {
  MENU_PACKAGE_PRICING,
  CheckoutValidationError,
  quoteMenuPackage,
  appendCheckoutLineItem,
  normalizeCheckoutItems
};
