import { resolveActiveOffer } from "./catalog.js";
import { productForCode, quoteMenuDesign } from "../producers/nino-design/products.js";

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

// autoTax: the session has Stripe automatic tax on (a taxed item is in the cart). Stripe then requires a tax behavior on
// EVERY line item, so untaxed items are sent inline and marked non-taxable (txcd_00000000) instead of being skipped.
function appendCheckoutLineItem(params, item, index, environment, { autoTax = false } = {}) {
  const prefix = `line_items[${index}]`;
  if (item.menuPackage || item.inlinePrice || environment === "sandbox" || autoTax) {
    params.append(`${prefix}[price_data][currency]`, item.currency.toLowerCase());
    params.append(`${prefix}[price_data][unit_amount]`, String(item.priceCents));
    params.append(`${prefix}[price_data][product_data][name]`, item.menuPackage
      ? `${item.offerName} — ${item.menuPackage.menu_pages} menu pages + first-year hosting`
      : item.ninoDesign ? `Nino Battaglia design: ${item.offerName}${item.extraMetadata?.design_pages ? ` (${item.extraMetadata.design_pages} pages)` : ""}`
      : item.offerName);
    if (item.taxCode) {
      params.append(`${prefix}[price_data][tax_behavior]`, "exclusive");
      params.append(`${prefix}[price_data][product_data][tax_code]`, item.taxCode);
    } else if (autoTax) {
      params.append(`${prefix}[price_data][tax_behavior]`, "exclusive");
      params.append(`${prefix}[price_data][product_data][tax_code]`, "txcd_00000000");
    }
    if (item.ninoDesign) {
      params.append(`${prefix}[price_data][product_data][description]`, "Designed by Nino Battaglia's studio. After payment you'll get a short brief form; you see the result before it's final.");
    }
    if (item.menuPackage) {
      params.append(`${prefix}[price_data][product_data][description]`, "$129 setup includes up to 3 pages and two revisions; $20 per additional page; $15 first-year hosting. After the first year, hosting continues with Menu Care; without it the menu goes offline 30 days later.");
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
    // Nino design services (stage 10) are charged with inline prices on the menu-made account (no Stripe price IDs).
    const ninoDesign = productForCode(catalogRow.offer_code);
    let ninoPrice = null;
    let ninoMetadata = null;
    if (ninoDesign) {
      if (item.qty !== undefined && item.qty !== 1) throw new CheckoutValidationError("One of each design service per order.");
      quantity = 1;
      ninoPrice = Number(catalogRow.price_cents);
      if (ninoDesign.code === "NINO_MENU_DESIGN") {
        const quote = quoteMenuDesign(Number(checkoutOptions.design_pages ?? ninoDesign.includedPages));
        if (!quote) throw new CheckoutValidationError(`Choose a page count from 1 to ${ninoDesign.maxPages}.`);
        if (ninoPrice !== ninoDesign.priceCents) throw new CheckoutValidationError("Menu Redesign pricing is being updated. Please try again later.", 503);
        ninoPrice = quote.total_cents;
        ninoMetadata = { design_pages: quote.pages };
      }
    }
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
      priceCents: menuPackage ? menuPackage.total_cents : ninoPrice ?? Number(
        catalogRow.price_cents
      ),
      currency: String(
        catalogRow.currency || "USD"
      ).toUpperCase(),
      stripePriceId: catalogRow.stripe_price_id || null,
      stripeProductId: catalogRow.stripe_product_id || null,
      ...(menuPackage ? { menuPackage } : {}),
      ...(ninoDesign ? { inlinePrice: true, ninoDesign: true, taxCode: ninoDesign.taxCode || null, extraMetadata: { nino_design: true, ...(ninoMetadata || {}) } } : {})
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
