// Google Visibility (stage 5, one-time $149): the profile audit. Pure functions, no network or database.
// Each check has a weight; the score is the share of applicable weight that passes (0-100). A check can be
// "not applicable" (no menu link attribute for this kind of business, no public holiday in the next weeks), and is then
// left out of the total. planFixes() turns failed checks into the changes we can make ourselves, and only from facts
// the business gave Menu-Made (its website, hosted menu, logo and photos, the phone and story from its website form).
// Everything else becomes plain advice in the report.

const DESCRIPTION_MIN = 250;
const DESCRIPTION_MAX = 750; // Google's limit
const PHOTOS_TARGET = 10;
const PHOTOS_PER_ORDER = 5;
const HOLIDAY_WINDOW_DAYS = 45;
const MENU_ATTRIBUTE = "attributes/url_menu";

const CHECKS = [
  { key: "category_primary", label: "Main business category", weight: 10 },
  { key: "category_additional", label: "Extra categories", weight: 5 },
  { key: "description", label: "Business description", weight: 15 },
  { key: "phone", label: "Phone number", weight: 10 },
  { key: "website", label: "Website link", weight: 10 },
  { key: "address", label: "Address or service area", weight: 10 },
  { key: "hours", label: "Opening hours", weight: 15 },
  { key: "holiday_hours", label: "Holiday hours", weight: 5 },
  { key: "menu_link", label: "Menu link", weight: 5 },
  { key: "logo", label: "Logo", weight: 5 },
  { key: "photos", label: `At least ${PHOTOS_TARGET} photos`, weight: 10 }
];

const DAY = 864e5;
const ymd = (d) => d.toISOString().slice(0, 10);

function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month, 1));
  return new Date(Date.UTC(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7));
}

function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return new Date(Date.UTC(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)));
}

// US days restaurants often change their hours for.
function usHolidays(year) {
  return [
    ["New Year's Day", new Date(Date.UTC(year, 0, 1))],
    ["Memorial Day", lastWeekday(year, 4, 1)],
    ["Independence Day", new Date(Date.UTC(year, 6, 4))],
    ["Labor Day", nthWeekday(year, 8, 1, 1)],
    ["Thanksgiving", nthWeekday(year, 10, 4, 4)],
    ["Christmas Eve", new Date(Date.UTC(year, 11, 24))],
    ["Christmas Day", new Date(Date.UTC(year, 11, 25))],
    ["New Year's Eve", new Date(Date.UTC(year, 11, 31))]
  ].map(([name, date]) => ({ name, date: ymd(date) }));
}

function upcomingHolidays(now, days = HOLIDAY_WINDOW_DAYS) {
  const from = ymd(now);
  const to = ymd(new Date(now.getTime() + days * DAY));
  return [...usHolidays(now.getUTCFullYear()), ...usHolidays(now.getUTCFullYear() + 1)].filter((h) => h.date >= from && h.date <= to);
}

const dateOf = (d) => (d?.year ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : "");

// Holidays in the window with no special hours set on Google.
function holidaysWithoutHours(location, now) {
  const periods = location?.specialHours?.specialHourPeriods || [];
  return upcomingHolidays(now).filter((h) => !periods.some((p) => {
    const start = dateOf(p.startDate);
    const end = dateOf(p.endDate) || start;
    return start && h.date >= start && h.date <= end;
  }));
}

function photoCounts(media) {
  const items = media?.mediaItems || [];
  const total = Number(media?.totalMediaItemCount ?? items.length) || 0;
  return { total, logo: items.some((m) => m?.locationAssociation?.category === "LOGO") };
}

// facts: { location, attributes: Set of attribute ids set on the profile, available: Set of attribute ids Google offers
//          (null when unknown), media: listMedia result (null when unknown), reviews: { count, average, unanswered } }
function auditProfile({ location = {}, attributes = new Set(), available = null, media = null, reviews = null }, now = new Date()) {
  const description = String(location.profile?.description || "").trim();
  const photos = media ? photoCounts(media) : null;
  const holidays = location.storefrontAddress?.regionCode && location.storefrontAddress.regionCode !== "US" ? [] : upcomingHolidays(now);
  const missingHolidays = holidays.length ? holidaysWithoutHours(location, now) : [];
  const menuAvailable = available ? available.has(MENU_ATTRIBUTE) : attributes.has(MENU_ATTRIBUTE);
  const results = {
    category_primary: { ok: Boolean(location.categories?.primaryCategory?.name), detail: location.categories?.primaryCategory?.displayName || "" },
    category_additional: { ok: (location.categories?.additionalCategories || []).length > 0,
      detail: (location.categories?.additionalCategories || []).map((c) => c.displayName).filter(Boolean).join(", ") },
    description: { ok: description.length >= DESCRIPTION_MIN, detail: description ? `${description.length} characters` : "None" },
    phone: { ok: Boolean(location.phoneNumbers?.primaryPhone), detail: location.phoneNumbers?.primaryPhone || "" },
    website: { ok: Boolean(location.websiteUri), detail: location.websiteUri || "" },
    address: { ok: Boolean(location.storefrontAddress?.addressLines?.length || location.serviceArea?.places?.placeInfos?.length || location.serviceArea?.regionCode) },
    hours: { ok: (location.regularHours?.periods || []).length > 0 },
    holiday_hours: { applicable: holidays.length > 0, ok: missingHolidays.length === 0, detail: missingHolidays.map((h) => `${h.name} (${h.date})`).join(", "), missing: missingHolidays },
    menu_link: { applicable: menuAvailable, ok: attributes.has(MENU_ATTRIBUTE) },
    logo: { applicable: Boolean(photos), ok: Boolean(photos?.logo) },
    photos: { applicable: Boolean(photos), ok: (photos?.total || 0) >= PHOTOS_TARGET, detail: photos ? `${photos.total} on the profile` : "", count: photos?.total || 0 }
  };
  const checks = CHECKS.map((c) => ({ ...c, applicable: results[c.key].applicable !== false, ...results[c.key] }));
  const notes = [];
  if (location.openInfo?.status === "CLOSED_PERMANENTLY") notes.push("Google shows this business as permanently closed.");
  if (location.openInfo?.status === "CLOSED_TEMPORARILY") notes.push("Google shows this business as temporarily closed.");
  if (location.metadata?.hasGoogleUpdated) notes.push("Google has suggested changes to some details. Review them in your Business Profile so wrong suggestions don't go live.");
  if (location.metadata?.hasPendingEdits) notes.push("Some edits are still waiting for Google's review.");
  if (reviews?.unanswered) notes.push(`${reviews.unanswered} of your latest reviews have no reply from the business.`);
  return { checks, score: scoreOf(checks), notes, reviews: reviews || null, mapsUri: location.metadata?.mapsUri || null, title: location.title || "" };
}

function scoreOf(checks) {
  const applicable = checks.filter((c) => c.applicable);
  const total = applicable.reduce((n, c) => n + c.weight, 0);
  const passed = applicable.filter((c) => c.ok).reduce((n, c) => n + c.weight, 0);
  return total ? Math.round((passed / total) * 100) : 100;
}

// The changes Menu-Made can make itself. sources: { website, menu, phone, logoAssetId, photoAssetIds } (see sources.js).
// Returns [{ kind, ref, value, assetId }]; the description's text is written later by the AI step.
function planFixes(audit, sources = {}) {
  const failed = new Set(audit.checks.filter((c) => c.applicable && !c.ok).map((c) => c.key));
  const fixes = [];
  if (failed.has("description")) fixes.push({ kind: "DESCRIPTION", ref: "profile.description" });
  if (failed.has("phone") && sources.phone) fixes.push({ kind: "PHONE", ref: "phoneNumbers", value: sources.phone });
  if (failed.has("website") && sources.website) fixes.push({ kind: "WEBSITE", ref: "websiteUri", value: sources.website });
  if (failed.has("menu_link") && sources.menu) fixes.push({ kind: "MENU_LINK", ref: MENU_ATTRIBUTE, value: sources.menu });
  if (failed.has("logo") && sources.logoAssetId) fixes.push({ kind: "LOGO", ref: sources.logoAssetId, assetId: sources.logoAssetId });
  if (failed.has("photos")) {
    const have = audit.checks.find((c) => c.key === "photos")?.count || 0;
    const room = Math.min(PHOTOS_PER_ORDER, Math.max(0, PHOTOS_TARGET - have));
    for (const id of (sources.photoAssetIds || []).slice(0, room)) fixes.push({ kind: "PHOTO", ref: id, assetId: id });
  }
  return fixes;
}

const FIX_CHECK = { DESCRIPTION: "description", PHONE: "phone", WEBSITE: "website", MENU_LINK: "menu_link", LOGO: "logo", PHOTO: "photos" };

// The audit after the fixes Google accepted. Photos pass only when the profile now has enough of them.
function auditAfter(audit, applied) {
  const done = new Set(applied.filter((f) => f.kind !== "PHOTO").map((f) => FIX_CHECK[f.kind]));
  const added = applied.filter((f) => f.kind === "PHOTO").length;
  const checks = audit.checks.map((c) => {
    if (c.key === "photos" && c.applicable) {
      const count = (c.count || 0) + added;
      return { ...c, count, ok: count >= PHOTOS_TARGET, detail: `${count} on the profile`, fixed: added > 0 && !c.ok };
    }
    return done.has(c.key) && !c.ok ? { ...c, ok: true, fixed: true } : c;
  });
  return { ...audit, checks, score: scoreOf(checks) };
}

// What the business should do itself for each check that still fails.
const ADVICE = {
  category_primary: "Pick the main category that best says what you are (for example \"Italian restaurant\" rather than \"Restaurant\"). It's the biggest signal Google uses to decide which searches you show up in.",
  category_additional: "Add 2 or 3 extra categories for what else you are (for example \"Pizza restaurant\", \"Takeout restaurant\", \"Wine bar\"). Only add ones that are true.",
  description: "Add a description of at least 250 characters: what you serve, what makes you different, and the neighborhood.",
  phone: "Add the phone number guests should call.",
  website: "Add your website so people can tap through from Google.",
  address: "Add your street address, or the area you serve if you don't have a storefront.",
  hours: "Add your opening hours for every day. Profiles without hours are shown less and guests can't tell if you're open.",
  holiday_hours: "Set your hours for the coming holidays, even if they don't change, so Google can show \"Hours confirmed\".",
  menu_link: "Add a link to your menu so guests can read it from Google.",
  logo: "Upload your logo so your profile looks finished.",
  photos: `Add photos until you have at least ${PHOTOS_TARGET}: your food, the room, the outside and your team. Profiles with photos get more direction requests and website clicks.`
};

export { CHECKS, ADVICE, DESCRIPTION_MIN, DESCRIPTION_MAX, PHOTOS_TARGET, MENU_ATTRIBUTE, usHolidays, upcomingHolidays, auditProfile, planFixes, auditAfter, scoreOf };
