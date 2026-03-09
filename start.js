// menu-checkout Worker (Cloudflare)
// Handles: POST /api/create-checkout-session
// Returns: { url } for Stripe Checkout

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- CORS (so your site can call this endpoint) ----
    const allowedOrigins = new Set([
      "https://menu-made.com",
      "http://127.0.0.1:5500",
      "http://localhost:5500"
    ]);

    const origin = request.headers.get("Origin") || "";
    const allowOrigin = allowedOrigins.has(origin) ? origin : "https://menu-made.com";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    if (url.pathname !== "/api/create-checkout-session") {
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    }

    // ---- Validate Stripe key exists ----
    if (!env.STRIPE_SECRET_KEY) {
      return json({ error: "Missing STRIPE_SECRET_KEY in Worker environment variables." }, 500, corsHeaders);
    }

    // ---- Read payload ----
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400, corsHeaders);
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (items.length === 0) {
      return json({ error: "Cart is empty." }, 400, corsHeaders);
    }

    // ---- Map your service keys to Stripe Price IDs ----
    const PRICE_MAP = {
      menu: "price_1T6OzbHw7f6jhUv8Epy5oYMf",
      conversion: "price_1T6P5tHw7f6jhUv8zQ7pGEoJ",
      google: "price_1T6iC6Hw7f6jhUv8iYYYZK0T",
      accessibility: "price_1T6j0xHw7f6jhUv8Ci1ZQ9qS"
    };

    // ---- Build Stripe line_items ----
    const line_items = [];
    for (const it of items) {
      const key = String(it?.key || "");
      const qty = Number(it?.qty || 1);

      if (!key || !Number.isFinite(qty) || qty < 1) continue;

      const price = PRICE_MAP[key];
      if (!price) {
        return json({ error: `No Stripe Price ID configured for key: ${key}` }, 400, corsHeaders);
      }

      line_items.push({ price, quantity: Math.floor(qty) });
    }

    if (line_items.length === 0) {
      return json({ error: "No valid items." }, 400, corsHeaders);
    }

    // ---- Create Checkout Session ----
    const successUrl = "https://menu-made.com/checkoutsuccess.html?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl = "https://menu-made.com/checkoutcancel.html";

    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", successUrl);
    body.set("cancel_url", cancelUrl);

    line_items.forEach((li, idx) => {
      body.set(`line_items[${idx}][price]`, li.price);
      body.set(`line_items[${idx}][quantity]`, String(li.quantity));
    });

    body.set("customer_creation", "always");

    let stripeResp;
    try {
      stripeResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    } catch (e) {
      return json({ error: "Failed to reach Stripe." }, 502, corsHeaders);
    }

    const stripeJson = await stripeResp.json();

    if (!stripeResp.ok) {
      return json({ error: "Stripe error", details: stripeJson }, 400, corsHeaders);
    }

    return json({ url: stripeJson.url }, 200, corsHeaders);
  },
};

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}