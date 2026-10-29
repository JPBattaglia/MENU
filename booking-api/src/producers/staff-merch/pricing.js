// Staff merch pricing (owner decisions, Oct 28, 2026):
//   - logo products (shirts, aprons, hats, mugs, coasters...): Printful's price x 2, rounded to end in .99
//   - Nino-design shirts: Nino shop price, +$5 when the business's logo is added on the back
//   - one order of 12 or more items gets 10% off the items, 24 or more 15%
//   - embroidery set-up that Printful charges (digitizing the logo) is passed on x 2 as its own line
//   - delivery at Printful's rate; sales tax added at checkout by Stripe Tax
const LOGO_FEE_CENTS = 500;
const MARKUP = 2;
const DISCOUNTS = Object.freeze([{ min: 24, percent: 15 }, { min: 12, percent: 10 }]);

const discountFor = (count) => DISCOUNTS.find((d) => count >= d.min)?.percent || 0;
// $24.94 -> $24.99, $25.00 -> $25.99: the next price ending in .99.
const to99 = (cents) => Math.floor(cents / 100) * 100 + 99;
const logoListPrice = (baseCents) => to99(Math.round(Number(baseCents) * MARKUP));

// ninoLines: [{ unit_price_cents, quantity }]; logoLines: [{ base_cents, quantity }]; costs: Printful estimate (optional).
function priceMerch(ninoLines, { logo = false, logoLines = [], costs = null } = {}) {
  const count = [...ninoLines, ...logoLines].reduce((n, l) => n + Number(l.quantity), 0);
  const percent = discountFor(count);
  const disc = (c) => Math.round(c * (100 - percent) / 100);
  const lines = ninoLines.map((l) => {
    const base = Number(l.unit_price_cents) + (logo ? LOGO_FEE_CENTS : 0);
    const unit = disc(base);
    return { ...l, kind: "nino", list_unit_cents: base, unit_cents: unit, line_cents: unit * Number(l.quantity) };
  });
  const logo_lines = logoLines.map((l) => {
    const base = logoListPrice(l.base_cents);
    const unit = disc(base);
    return { ...l, kind: "logo", list_unit_cents: base, unit_cents: unit, line_cents: unit * Number(l.quantity) };
  });
  const setup = costs?.digitization_cents ? Number(costs.digitization_cents) * MARKUP : 0;
  const all = [...lines, ...logo_lines];
  const listSubtotal = all.reduce((s, l) => s + l.list_unit_cents * Number(l.quantity), 0);
  const itemsSubtotal = all.reduce((s, l) => s + l.line_cents, 0);
  return {
    lines, logo_lines, shirts: count, items: count, discount_percent: percent, logo_fee_cents: logo && ninoLines.length ? LOGO_FEE_CENTS : 0,
    list_subtotal_cents: listSubtotal, discount_cents: listSubtotal - itemsSubtotal, setup_cents: setup, subtotal_cents: itemsSubtotal + setup
  };
}

export { DISCOUNTS, LOGO_FEE_CENTS, MARKUP, discountFor, logoListPrice, priceMerch, to99 };
