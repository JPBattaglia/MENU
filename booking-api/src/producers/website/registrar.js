// Domain purchase at checkout, through the Cloudflare Registrar API (beta), billed at cost to Menu-made's Cloudflare card.
// Step 1 (this file so far): search and real-time check, priced for the customer at Cloudflare's cost + DOMAIN_MARKUP_CENTS.
//   GET /api/domains?q=joes pizza      -> suggestions (cached registry data, fast)
//   GET /api/domains?q=joespizza.com   -> that exact name checked live with the registry, plus suggestions
// The answer never carries Cloudflare's own cost, only the customer price.
// Everything is OFF until CF_REGISTRAR_TOKEN is set on the worker (Registrar Domains Admin, DNS Edit, Zone Read,
// Workers Routes Edit); without it the endpoint answers { enabled: false } and checkout shows no domain step.
// CF_ACCOUNT_ID is a plain variable in wrangler.jsonc (account ids are not secret).
const API = "https://api.cloudflare.com/client/v4";
const DOMAIN_MARKUP_CENTS = 500;
const SUGGESTIONS = 6;
const CACHE_SECONDS = 600;

function registrarConfig(env) {
  if (!env.CF_REGISTRAR_TOKEN || !env.CF_ACCOUNT_ID) return null;
  return { account: env.CF_ACCOUNT_ID, token: env.CF_REGISTRAR_TOKEN };
}

async function registrar(config, path, { method = "GET", body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${API}/accounts/${config.account}/registrar${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await response.json(); } catch { /* not JSON */ }
  const ok = response.ok && data?.success !== false;
  return { ok, status: response.status, data, errors: data?.errors || [] };
}

// Cloudflare's price string ("10.11") to whole cents, then the customer's price.
function costCents(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
function customerCents(cost) {
  const cents = costCents(cost);
  return cents === null ? null : cents + DOMAIN_MARKUP_CENTS;
}

// A full domain the customer typed ("www.JoesPizza.com/" -> "joespizza.com"), or null when it is not one.
function asDomain(input) {
  let value = String(input ?? "").trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "").replace(/^www\./, "");
  if (value.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(value)) return null;
  return value;
}

// Search words: letters, digits, spaces and hyphens only, short.
function asQuery(input) {
  return String(input ?? "").toLowerCase().replace(/[^a-z0-9 .-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

const REASONS = {
  domain_unavailable: "Already taken",
  extension_not_supported_via_api: "We can't register this ending yet",
  extension_not_supported: "We can't register this ending",
  extension_disallows_registration: "This ending can't be registered"
};

function present(entry) {
  const premium = entry?.tier && entry.tier !== "standard";
  const price = customerCents(entry?.pricing?.registration_cost);
  const renewal = customerCents(entry?.pricing?.renewal_cost);
  const available = entry?.registrable === true && !premium && price !== null && (entry?.pricing?.currency || "USD") === "USD";
  const out = { name: String(entry?.name || "").toLowerCase(), available };
  if (available) Object.assign(out, { price_cents: price, renewal_cents: renewal ?? price });
  else out.reason = premium ? "Premium name, not offered" : (REASONS[entry?.reason] || "Not available");
  return out;
}

async function checkDomains(env, names, { fetchImpl = fetch } = {}) {
  const config = registrarConfig(env);
  if (!config) throw new Error("Domain purchase is not set up (CF_REGISTRAR_TOKEN missing)");
  const list = [...new Set(names.map(asDomain).filter(Boolean))].slice(0, 20);
  if (!list.length) return [];
  const result = await registrar(config, "/domain-check", { method: "POST", body: { domains: list }, fetchImpl });
  if (!result.ok) throw new Error(`Cloudflare domain check failed (${result.status}): ${result.errors.map((e) => e.message).join("; ")}`);
  return (result.data?.result?.domains || []).map(present);
}

async function searchDomains(env, query, { fetchImpl = fetch, limit = SUGGESTIONS } = {}) {
  const config = registrarConfig(env);
  if (!config) throw new Error("Domain purchase is not set up (CF_REGISTRAR_TOKEN missing)");
  const q = asQuery(query);
  if (!q) return [];
  const result = await registrar(config, `/domain-search?q=${encodeURIComponent(q)}&limit=${limit}`, { fetchImpl });
  if (!result.ok) throw new Error(`Cloudflare domain search failed (${result.status}): ${result.errors.map((e) => e.message).join("; ")}`);
  return (result.data?.result?.domains || []).map(present);
}

// The checkout's lookup: an exact name is checked live and listed first; suggestions follow without repeats.
async function lookupDomains(env, input, { fetchImpl = fetch } = {}) {
  const exact = asDomain(input);
  const words = exact ? exact.split(".")[0] : asQuery(input);
  const [checked, suggested] = await Promise.all([
    exact ? checkDomains(env, [exact], { fetchImpl }) : Promise.resolve([]),
    words ? searchDomains(env, words, { fetchImpl }).catch(() => []) : Promise.resolve([])
  ]);
  const seen = new Set(checked.map((d) => d.name));
  return { exact, results: [...checked, ...suggested.filter((d) => d.name && !seen.has(d.name) && seen.add(d.name))] };
}

function json(body, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store"
    }
  });
}

async function handleDomainLookup(request, env, { fetchImpl = fetch, cache = globalThis.caches?.default } = {}) {
  if (!registrarConfig(env)) return json({ ok: true, enabled: false });
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").slice(0, 120);
  if (!asDomain(q) && asQuery(q).length < 2) return json({ ok: false, enabled: true, error: "Type a name or a domain, for example joespizza.com." }, 400);
  const key = new Request(`https://domain-lookup.cache/${encodeURIComponent(q.trim().toLowerCase())}`);
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }
  try {
    const { exact, results } = await lookupDomains(env, q, { fetchImpl });
    const response = json({ ok: true, enabled: true, exact, markup_cents: DOMAIN_MARKUP_CENTS, results }, 200, CACHE_SECONDS);
    if (cache) await cache.put(key, response.clone()).catch(() => {});
    return response;
  } catch (error) {
    console.error("domain lookup", error?.message);
    return json({ ok: false, enabled: true, error: "Domain search is not answering right now. Try again in a minute." }, 502);
  }
}

export { DOMAIN_MARKUP_CENTS, asDomain, asQuery, checkDomains, customerCents, handleDomainLookup, lookupDomains, registrarConfig, searchDomains };
