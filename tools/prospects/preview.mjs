// Which private preview a prospect's email carries (marketing plan v4, Nov 3; websites added Nov 5, 2026, owner):
//   menu file on their site (Online Menu + QR prospects)        -> their menu as a phone page       (/demo)
//   no website, or a site that's poor on phones / no call button -> their business as a website     (/site-demo)
//      Conversion Fix prospects with a website preview are pitched the Website Package instead.
// Returns { url, kind: "menu" | "website", offer_code } or null (the email then goes out without a preview).
const MENU_GAPS = new Set(["menu_pdf", "menu_image"]);
const SITE_GAPS = new Set(["no_website", "no_phone_layout", "no_tap_to_call", "site_down"]);

export async function makePreview(api, p, gaps = JSON.parse(p.gaps_json || "[]")) {
  if (p.offer_code === "ONLINE_MENU_QR" && gaps.some((g) => MENU_GAPS.has(g))) {
    const demo = await api("demo", { id: p.id }).catch(() => null);
    return demo?.ok ? { url: demo.url, kind: "menu", offer_code: "ONLINE_MENU_QR" } : null;
  }
  if ((p.offer_code === "WEBSITE_PACKAGE" || p.offer_code === "CONVERSION_FIX") && gaps.some((g) => SITE_GAPS.has(g))) {
    const demo = await api("site-demo", { id: p.id }).catch(() => null);
    return demo?.ok ? { url: demo.url, kind: "website", offer_code: "WEBSITE_PACKAGE" } : null;
  }
  return null;
}
