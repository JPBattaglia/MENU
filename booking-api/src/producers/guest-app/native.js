// Stage 11 part 2: what the Store App (the native iOS / Android app in app-shell/) reads from a restaurant's live app.
//   GET <app>/api/content   the live app's public content as JSON: name, address, phone, quick links, specials, menu,
//                           hours, brand colour, icon and the rewards settings. Only what the live app page already
//                           shows; nothing private. Answers 404 until the owner has approved the app.
// The native app runs its screens from its own origin (capacitor://localhost on iPhone, https://localhost on
// Android), so these answers carry CORS headers for those two origins. Content is public, so GET also allows any
// origin; POSTs (rewards) are limited in engage.js to the app's own page and the two native origins.
// Read cost: one D1 row + one R2 object per answer, cached at the edge for CONTENT_TTL seconds.
import { parseHours, parseOfferings } from "../website/build.js";
import { brandOf } from "./build.js";
import { loadLiveApp } from "./app-step.js";
import { NATIVE_ORIGINS, engagementSettings, nativeCors } from "./engage.js";

const CONTENT_TTL = 60;
const digits = (phone) => String(phone || "").replace(/[^\d+]/g, "");
const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const httpsOrEmpty = (value) => (/^https:\/\/[^\s]+$/i.test(String(value || "").trim()) ? String(value).trim() : "");

const corsHeaders = (origin) => ({ ...nativeCors(origin), "Access-Control-Allow-Origin": NATIVE_ORIGINS.has(origin) ? origin : "*" });

// The JSON the native app renders. Pure, so it is tested without a database.
function contentOf(live, appBaseUrl) {
  const data = live.data || {};
  const address = clean(data.address, 200);
  const hasIcon = (live.build?.icons || []).some((i) => i.path === "icons/icon-192.png");
  return {
    ok: true,
    name: clean(data.app_name, 60),
    address,
    phone: clean(data.phone, 40),
    tel: digits(data.phone),
    map_url: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "",
    order_url: httpsOrEmpty(data.order_url),
    reserve_url: httpsOrEmpty(data.reserve_url),
    specials: clean(data.specials, 2000),
    menu: parseOfferings(data.menu),
    hours: parseHours(data.hours),
    brand_color: brandOf(data),
    icon_url: hasIcon ? new URL("icons/icon-192.png", appBaseUrl).toString() : "",
    loyalty: engagementSettings(data).loyalty,
    updated_at: live.updated_at || null
  };
}

const jsonWith = (data, status, extra) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", ...extra }
});

// Preflight for the native app's POSTs (only the two native origins get one).
function handleNativePreflight(request) {
  const origin = request.headers.get("Origin") || "";
  if (!NATIVE_ORIGINS.has(origin)) return new Response(null, { status: 404 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

async function handleAppContent(request, env, slug, { cacheStore = globalThis.caches?.default } = {}) {
  const origin = request.headers.get("Origin") || "";
  const cors = corsHeaders(origin);
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  if (cacheStore) {
    const hit = await cacheStore.match(cacheKey).catch(() => null);
    if (hit) { const out = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) out.headers.set(k, v); return out; }
  }
  let live;
  try { live = await loadLiveApp(env, { slug }); } catch { return jsonWith({ ok: false, error: "Temporarily unavailable" }, 503, { ...cors, "Cache-Control": "no-store" }); }
  if (!live?.build) return jsonWith({ ok: false, error: "Not found" }, 404, { ...cors, "Cache-Control": "no-store" });
  const appBase = new URL("../", request.url).toString(); // <app>/api/content -> <app>/
  const response = jsonWith(contentOf(live, appBase), 200, { ...cors, "Cache-Control": `public, max-age=${CONTENT_TTL}` });
  if (cacheStore) await cacheStore.put(cacheKey, response.clone()).catch(() => null);
  return response;
}

export { CONTENT_TTL, NATIVE_ORIGINS, contentOf, corsHeaders, handleAppContent, handleNativePreflight };
