// Holiday Menu (owner, Nov 10, 2026): a short-run online menu for Christmas or New Year's Eve, for businesses that
// may already have their regular menu online and are happy with it. Each order is one holiday menu, made in the
// holiday menu generator (marketing/public-preview.js with an occasion) and produced like Online Menu + QR (its own
// link, QR code, print PDF and table tent; owner approval before it goes live). It shows until the day after its
// holiday, then the page says the holiday menu has ended (delivery/delivery.js). No hosting fee, nothing renews.
//
// Owner's prices (Nov 10, 2026): $59 for one holiday menu, $89 for both: the second one this season, bought with the
// same email, is $30. Free for Menu Care customers (sent as a Menu Care update, approved by the owner as usual).

const HOLIDAY_PRICING = Object.freeze({
  firstCents: 5900,
  secondCents: 3000,
  includedPages: 3,
  additionalPageCents: 2000
});

const OCCASION_NAMES = { christmas: "Christmas", newyear: "New Year's Eve" };
const isOccasion = (value) => Object.prototype.hasOwnProperty.call(OCCASION_NAMES, value);

// The holiday season a moment belongs to: the year whose December it is (January belongs to the December before).
function seasonYear(now = Date.now()) {
  const pacific = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return pacific.getMonth() === 0 ? pacific.getFullYear() - 1 : pacific.getFullYear();
}

// Last day the menu shows (Pacific): Christmas through Dec 26, New Year's Eve through Jan 1.
function holidayEndsOn(occasion, now = Date.now()) {
  const year = seasonYear(now);
  return occasion === "christmas" ? `${year}-12-26` : `${year + 1}-01-01`;
}

// True once the end day (Pacific) is over.
function holidayEnded(endsOn, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(endsOn || ""))) return false;
  return now >= Date.parse(`${endsOn}T23:59:59-08:00`);
}

// A holiday menu can be bought until its holiday has passed: Christmas through Dec 25, New Year's Eve through Dec 31.
function holidayOnSale(occasion, now = Date.now()) {
  if (!isOccasion(occasion)) return false;
  const year = seasonYear(now);
  const last = occasion === "christmas" ? `${year}-12-25` : `${year}-12-31`;
  return now <= Date.parse(`${last}T23:59:59-08:00`);
}

// Price for this buyer: $30 when the same email already has a paid holiday menu this season, otherwise $59.
async function holidayPriceCents(env, email, now = Date.now()) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean || !env?.DB) return HOLIDAY_PRICING.firstCents;
  const since = `${seasonYear(now)}-07-01T00:00:00.000Z`;
  const row = await env.DB.prepare(`
      SELECT 1 AS found FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      JOIN offers f ON f.id = oi.offer_id
      WHERE lower(c.email) = ? AND f.code = 'HOLIDAY_MENU' AND o.payment_status = 'PAID' AND o.created_at >= ?
      LIMIT 1`).bind(clean, since).first().catch(() => null);
  return row ? HOLIDAY_PRICING.secondCents : HOLIDAY_PRICING.firstCents;
}

// Both holidays in one checkout (owner, Nov 12, 2026: "it should be possible to select both to secure the $89
// offer"; he chose one menu now, the other later). A buyer with no holiday menu yet this season who asks for both
// pays $89 once, and the item records the holiday still owed (both_other). Their order for that other holiday,
// made in the generator when its menu is ready, is then $0. Everything else is as before: $59 first, $30 second.
const otherOccasion = (occasion) => (occasion === "christmas" ? "newyear" : "christmas");
async function holidayQuote(env, email, occasion, { both = false, now = Date.now() } = {}) {
  const clean = String(email || "").trim().toLowerCase();
  let rows = [];
  if (clean && env?.DB) {
    const since = `${seasonYear(now)}-07-01T00:00:00.000Z`;
    const found = await env.DB.prepare(`
        SELECT oi.metadata_json AS meta FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN order_items oi ON oi.order_id = o.id
        JOIN offers f ON f.id = oi.offer_id
        WHERE lower(c.email) = ? AND f.code = 'HOLIDAY_MENU' AND o.payment_status = 'PAID' AND o.created_at >= ?`).bind(clean, since).all().catch(() => null);
    rows = found?.results || [];
  }
  if (!rows.length) {
    const other = otherOccasion(occasion);
    if (both === true && holidayOnSale(other, now)) return { price_cents: HOLIDAY_PRICING.firstCents + HOLIDAY_PRICING.secondCents, both_other: other };
    return { price_cents: HOLIDAY_PRICING.firstCents };
  }
  const owed = rows.map((row) => { try { return JSON.parse(row.meta || "{}")?.holiday_menu?.both_other || null; } catch { return null; } }).filter(Boolean);
  if (rows.length === 1 && owed[0] === occasion) return { price_cents: 0, prepaid: true };
  return { price_cents: HOLIDAY_PRICING.secondCents };
}

const dollars = (cents) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export { HOLIDAY_PRICING, OCCASION_NAMES, isOccasion, seasonYear, holidayEndsOn, holidayEnded, holidayOnSale, holidayPriceCents, holidayQuote, otherOccasion, dollars as holidayDollars };
