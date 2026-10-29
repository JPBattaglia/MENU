// Staff merch pricing (stage 10, owner decisions Oct 28, 2026): each shirt costs what it costs in Nino's shop,
// plus $5 when the business's logo is added; one order of 12 or more shirts gets 10% off the shirts, 24 or more 15%.
// Delivery is Printful's rate for the address, passed on at cost.
const LOGO_FEE_CENTS = 500;
const DISCOUNTS = Object.freeze([{ min: 24, percent: 15 }, { min: 12, percent: 10 }]);

function discountFor(totalShirts) {
  return DISCOUNTS.find((d) => totalShirts >= d.min)?.percent || 0;
}

// lines: [{ unit_price_cents, quantity, ... }] from the Nino quote. Returns per-line prices the buyer pays.
function priceMerch(lines, { logo = false } = {}) {
  const shirts = lines.reduce((n, l) => n + Number(l.quantity), 0);
  const percent = discountFor(shirts);
  const priced = lines.map((l) => {
    const base = Number(l.unit_price_cents) + (logo ? LOGO_FEE_CENTS : 0);
    const unit = Math.round(base * (100 - percent) / 100);
    return { ...l, list_unit_cents: base, unit_cents: unit, line_cents: unit * Number(l.quantity) };
  });
  const listSubtotal = priced.reduce((s, l) => s + l.list_unit_cents * Number(l.quantity), 0);
  const subtotal = priced.reduce((s, l) => s + l.line_cents, 0);
  return { lines: priced, shirts, discount_percent: percent, logo_fee_cents: logo ? LOGO_FEE_CENTS : 0, list_subtotal_cents: listSubtotal, discount_cents: listSubtotal - subtotal, subtotal_cents: subtotal };
}

export { DISCOUNTS, LOGO_FEE_CENTS, discountFor, priceMerch };
