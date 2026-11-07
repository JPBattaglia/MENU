// Auto-fill from public info (owner, Nov 6, 2026): the site generator asks only for a name, email and menu. With the
// business's city we look up its public OpenStreetMap listing (Nominatim) for the address, phone, opening hours and
// website, and use them only where the buyer left a field blank. A listing is used only when its name matches the
// business and it is in the city given, so a near-namesake is never put on someone's site.
// Nominatim policy: identify the app, one request per preview (well under 1 a second), results not resold.

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const UA = "MENU-MADE site generator (https://menu-made.com; info@menu-made.com)";
const DAYS = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };

const words = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
  .filter((w) => w && !["the", "and", "a", "of", "restaurant", "cafe", "bar", "llc", "inc"].includes(w));

// Same business: every word of the shorter name is in the longer one (ignoring filler words).
function sameName(a, b) {
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.includes(w));
}

function time(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]) % 24; const min = m[2];
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}${min === "00" ? "" : `:${min}`}${ap}`;
}

// OSM opening_hours ("Mo-Fr 11:00-21:00; Sa,Su 12:00-22:00") -> the builder's lines ("Mon-Fri: 11am-9pm").
// Anything it can't read (holidays, week numbers, comments) gives "" so nothing wrong is shown.
function osmHours(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === "24/7") return "Mon-Sun: Open 24 hours";
  const lines = [];
  for (const rule of text.split(";").map((r) => r.trim()).filter(Boolean)) {
    const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(off|closed|(?:\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:,\s*)?)+)$/.exec(rule);
    if (!m) return "";
    const days = m[1].replace(/Mo|Tu|We|Th|Fr|Sa|Su/g, (d) => DAYS[d]).replace(/,/g, ", ");
    if (m[2] === "off" || m[2] === "closed") { lines.push(`${days}: Closed`); continue; }
    const spans = m[2].split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const [a, b] = s.split("-").map(time);
      return a && b ? `${a}-${b}` : null;
    });
    if (spans.some((s) => !s)) return "";
    lines.push(`${days}: ${spans.join(", ")}`);
  }
  return lines.join("\n").slice(0, 400);
}

function addressOf(a = {}) {
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const town = a.city || a.town || a.village || a.suburb || "";
  const region = [a.state, a.postcode].filter(Boolean).join(" ");
  return street && town ? [street, town, region].filter(Boolean).join(", ").slice(0, 160) : "";
}

const inCity = (a = {}, city) => {
  const want = words(city).join(" ");
  return Boolean(want) && [a.city, a.town, a.village, a.suburb, a.municipality, a.county].some((v) => v && words(v).join(" ") === want);
};

// { address, phone, hours, website, cuisine } from the public listing, or null when there is no clear match.
async function lookupListing(name, city, { fetcher = fetch } = {}) {
  if (!name || !city) return null;
  const url = `${ENDPOINT}?${new URLSearchParams({ q: `${name}, ${city}`, format: "jsonv2", addressdetails: "1", extratags: "1", limit: "5" })}`;
  const res = await fetcher(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const list = await res.json().catch(() => []);
  const hit = (Array.isArray(list) ? list : []).find((r) => sameName(r.name || r.namedetails?.name || "", name) && inCity(r.address, city));
  if (!hit) return null;
  const t = hit.extratags || {};
  const site = t.website || t["contact:website"] || "";
  return {
    address: addressOf(hit.address),
    phone: String(t.phone || t["contact:phone"] || "").split(";")[0].trim().slice(0, 30),
    hours: osmHours(t.opening_hours),
    website: /^https?:\/\//i.test(site) ? site.slice(0, 300) : "",
    cuisine: String(t.cuisine || "").split(";")[0].replace(/_/g, " ").slice(0, 40)
  };
}

export { lookupListing, osmHours, sameName };
