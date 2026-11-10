// Private client quote pages (owner ask, Nov 9, 2026): a page only one client gets the link to, where they tick the
// items they want and check out for exactly that total. Prices live here, never in the page, so the page can't change
// what Stripe charges. Each quote is hand-fulfilled by the owner: no order rows, no producers. The Stripe session
// carries metadata.purpose = "client_quote", which the webhook passes over (no order_id).
//
// Routes (src/worker.js):
//   GET  /api/client-quote/<id>           the quote's items and prices for the page
//   POST /api/client-quote/<id>/checkout  { items: [code, ...] } -> { ok, url } a Stripe Checkout session
import { jsonResponse } from "../lib/http.js";
import { stripeRequest } from "../lib/stripe.js";

const SITE = "https://menu-made.com";

const QUOTES = Object.freeze({
  // Fahy's Fog & Barrel, fahyspub.com renewal for 2027 (letter of Nov 9, 2026). Every price is Menu-made's standard
  // pricing; the menu add-on is the two-service 10% off with the $144 menu setup free on yearly billing.
  "fahys-6ei9nqt74rzw": {
    client: "Jack O'Toole",
    business: "Fahy's Fog & Barrel",
    title: "Fahy's Fog & Barrel: your 2027 renewal",
    page: "/q/fahys-6ei9nqt74rzw",
    period: "Jan 9, 2027 to Jan 9, 2028",
    items: [
      { code: "WEBSITE_CARE_2027", group: "renewal", required: true, cents: 49000, regular_cents: 49000,
        name: "Website renewal for 2027 (Website Care)",
        detail: "fahyspub.com domain, hosting, security (SSL) and a daily check that the site is up; the Book an Event form kept working; your drink list refreshed now; site changes whenever you ask, each checked before it goes live; a monthly uptime report." },
      { code: "MENU_ONLINE_CARE", group: "add", cents: 21200, regular_cents: 43400,
        name: "Your full menu online + Menu Care",
        detail: "Your drink and food menu as a phone page, a QR code for every table, a print-ready PDF, a tri-fold, a table tent and a TV menu screen (up to 3 menu pages), plus menu changes any time with the same QR code and a monthly seasonal-special idea." },
      { code: "GOOGLE_VISIBILITY", group: "add", cents: 14900, regular_cents: 14900,
        name: "Google Visibility tune-up",
        detail: "A one-time tune-up of your Google profile on 11 checks, with a before-and-after report." },
      { code: "GUEST_APP", group: "add", cents: 58900, regular_cents: 58900,
        name: "Guest App (setup + first year)",
        detail: "Your own Fahy's app on guests' home screens: menu, specials, a rewards card and notifications for events. $299 setup plus $290 for the year." },
      { code: "SIDEWALK_SIGN", group: "extra", cents: 20000, regular_cents: 20000,
        name: "Sidewalk sign design",
        detail: "A print-ready design for your sidewalk sign. Printing not included." },
      { code: "COASTER_NAPKIN", group: "extra", cents: 20000, regular_cents: 20000,
        name: "Coaster / napkin design",
        detail: "A print-ready coaster or napkin design in the Fahy's look. Printing not included." },
      { code: "BUSINESS_CARDS", group: "extra", cents: 10000, regular_cents: 10000,
        name: "Business card design",
        detail: "A print-ready business card design. Printing not included." }
    ]
  }
});

class QuoteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function getQuote(id) {
  const quote = Object.prototype.hasOwnProperty.call(QUOTES, id) ? QUOTES[id] : null;
  if (!quote) throw new QuoteError("This page isn't available.", 404);
  return quote;
}

function publicQuote(id) {
  const quote = getQuote(id);
  return {
    id,
    title: quote.title,
    business: quote.business,
    client: quote.client,
    period: quote.period,
    items: quote.items.map(({ code, group, required, cents, regular_cents, name, detail }) =>
      ({ code, group, required: Boolean(required), cents, regular_cents, name, detail }))
  };
}

// The chosen items, in the quote's order, with every required item present and nothing unknown or repeated.
function selectItems(quote, codes) {
  if (!Array.isArray(codes) || codes.length === 0 || codes.length > quote.items.length) {
    throw new QuoteError("Choose at least one item.");
  }
  const wanted = new Set();
  for (const code of codes) {
    if (typeof code !== "string" || !quote.items.some(item => item.code === code)) throw new QuoteError("That item isn't on this page.");
    if (wanted.has(code)) throw new QuoteError("Each item can only be chosen once.");
    wanted.add(code);
  }
  for (const item of quote.items) {
    if (item.required && !wanted.has(item.code)) throw new QuoteError(`${item.name} is included with every choice.`);
  }
  return quote.items.filter(item => wanted.has(item.code));
}

function checkoutParams(id, quote, selected) {
  const totalCents = selected.reduce((sum, item) => sum + item.cents, 0);
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", `${SITE}${quote.page}?done=1`);
  params.append("cancel_url", `${SITE}${quote.page}`);
  params.append("submit_type", "auto");
  params.append("billing_address_collection", "auto");
  params.append("name_collection[business][enabled]", "true");
  params.append("name_collection[business][optional]", "true");
  selected.forEach((item, index) => {
    const prefix = `line_items[${index}]`;
    params.append(`${prefix}[quantity]`, "1");
    params.append(`${prefix}[price_data][currency]`, "usd");
    params.append(`${prefix}[price_data][unit_amount]`, String(item.cents));
    params.append(`${prefix}[price_data][product_data][name]`, item.name);
    params.append(`${prefix}[price_data][product_data][description]`, item.detail.slice(0, 500));
  });
  params.append("invoice_creation[enabled]", "true");
  params.append("invoice_creation[invoice_data][description]", `${quote.business}: ${selected.map(item => item.name).join(", ")} (${quote.period})`.slice(0, 1500));
  params.append("invoice_creation[invoice_data][footer]", "Menu-made · 706 Kearny St, San Francisco, CA 94108 · info@menu-made.com");
  params.append("metadata[purpose]", "client_quote");
  params.append("metadata[quote]", id);
  params.append("metadata[items]", selected.map(item => item.code).join(",").slice(0, 500));
  params.append("metadata[total_cents]", String(totalCents));
  params.append("payment_intent_data[description]", `${quote.business} — ${quote.period}`);
  params.append("payment_intent_data[metadata][purpose]", "client_quote");
  params.append("payment_intent_data[metadata][quote]", id);
  return { params, totalCents };
}

async function handleClientQuote(request, env, id, action) {
  try {
    if (!action && (request.method === "GET" || request.method === "HEAD")) {
      return jsonResponse({ ok: true, quote: publicQuote(id) });
    }
    if (action === "checkout" && request.method === "POST") {
      const quote = getQuote(id);
      const body = await request.json().catch(() => null);
      const selected = selectItems(quote, body?.items);
      const { params } = checkoutParams(id, quote, selected);
      const session = await stripeRequest(env, "live", "/v1/checkout/sessions", { method: "POST", params });
      return jsonResponse({ ok: true, url: session.url });
    }
    return jsonResponse({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof QuoteError) return jsonResponse({ ok: false, error: error.message }, error.status);
    console.error("Client quote checkout failed:", error?.message || error);
    return jsonResponse({ ok: false, error: "Checkout couldn't start. Please try again, or email info@menu-made.com." }, 502);
  }
}

export { QUOTES, QuoteError, checkoutParams, getQuote, handleClientQuote, publicQuote, selectItems };
