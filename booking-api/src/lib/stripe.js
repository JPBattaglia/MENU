// Small Stripe REST helper. `environment` is "live" or "sandbox" and picks the key; nothing else does.
function stripeKey(env, environment) {
  const key = environment === "live" ? env.STRIPE_SECRET_KEY : env.STRIPE_SECRET_KEY_TEST;
  if (!key) throw new Error(`Stripe ${environment === "live" ? "live" : "sandbox"} secret key is not configured`);
  return key;
}

class StripeError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// params: URLSearchParams, a plain object, or an array of [key, value] pairs.
async function stripeRequest(env, environment, path, { method = "GET", params = null, idempotencyKey = null } = {}) {
  const body = params ? new URLSearchParams(params).toString() : null;
  const url = method === "GET" && body ? `https://api.stripe.com${path}?${body}` : `https://api.stripe.com${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey(env, environment)}`,
      ...(method !== "GET" && body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    ...(method !== "GET" && body ? { body } : {})
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new StripeError(`Stripe ${method} ${path.split("?")[0]}: ${data?.error?.message || response.status}`, response.status, data);
  }
  return data;
}

export { stripeKey, stripeRequest, StripeError };
