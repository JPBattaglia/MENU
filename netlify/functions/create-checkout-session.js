// netlify/functions/create-checkout-session.js

const Stripe = require("stripe");

// HARDCODED KEY (removes Netlify env variable dependency)
const stripe = new Stripe("sk_live_51L18crHw7f6jhUv8UZey98pm0lBr7SqGNRkF
ffqEJya26Jsfll2Mhhh53decg6dIFnro9yRR7daDqzPFA
wJp3Int00j8KeRpwx");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" }),
      };
    }

    const { items, successUrl, cancelUrl } = JSON.parse(event.body || "{}");

    if (!Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing or invalid items[]" }),
      };
    }

    if (!successUrl || !cancelUrl) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing successUrl/cancelUrl" }),
      };
    }

    // Normalize items
    const normalizedItems = items.map((i) => ({
      priceId: String(i.priceId || "").trim(),
      quantity: Number.isFinite(i.quantity)
        ? i.quantity
        : parseInt(i.quantity, 10),
    }));

    for (const i of normalizedItems) {
      if (!i.priceId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid priceId in items[]" }),
        };
      }

      if (!Number.isInteger(i.quantity) || i.quantity < 1) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid quantity in items[]" }),
        };
      }
    }

    // Check if any price is recurring
    const priceLookups = await Promise.all(
      normalizedItems.map((i) => stripe.prices.retrieve(i.priceId))
    );

    const hasRecurring = priceLookups.some((p) => !!p.recurring);

    const session = await stripe.checkout.sessions.create({
      mode: hasRecurring ? "subscription" : "payment",
      line_items: normalizedItems.map((i) => ({
        price: i.priceId,
        quantity: i.quantity,
      })),
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: err && err.message ? err.message : "Unknown error",
      }),
    };
  }
};
