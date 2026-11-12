// The Menu-made prospect email: one gap, one offer, the same branding as the customer emails. Used by drafts.mjs.
// build(prospect) -> { subject, html, text }. The logo is attached inline as cid:logo@menu-made.
//
// Nov 10, 2026 (owner): every example in these emails is the current generator, never the old one-design rendering.
// A prospect's own preview is the menu generator (all MENU_DESIGNS) or the site generator (all website DESIGNS); with
// no preview of their own, the second button opens the same free generator on the site to try with their menu.
// The emails don't mention a missing call button.
import { MENU_DESIGNS } from "../../booking-api/src/producers/menu-qr/menu-designs.js";
import { DESIGNS as SITE_DESIGNS } from "../../booking-api/src/producers/website/templates/designs.js";
import { HOLIDAY_PRICING } from "../../booking-api/src/checkout/holiday.js";

const MENU_COUNT = MENU_DESIGNS.length;
const SITE_COUNT = SITE_DESIGNS.length;
// Marketing plan v4 (Nov 3, 2026): Online Menu + QR has its own page; links from these emails are tagged so a sale
// that follows is counted against the outreach (funnel.js keeps the labels through checkout).
const WEBSITE = "https://menu-made.com/website-design?utm_source=outreach&utm_medium=email&utm_campaign=demo-website";
const ONLINE_MENU = "https://menu-made.com/online-menu?utm_source=outreach&utm_medium=email&utm_campaign=demo-menu";
// Dark mode: the logo is transparent and the email declares a dark colour scheme, so mail apps keep its colours.
// Copy revised Nov 1, 2026 (owner): plain wording, accurate to each offer as services.html describes it.
const OFFERS = {
  // Price corrected Nov 3, 2026: $129 setup + $15 first-year hosting = $144 (checkout/quote.js), up to 3 pages.
  ONLINE_MENU_QR: { name: "Online Menu + QR", url: ONLINE_MENU, sample: [`Try it free with your menu`, `${ONLINE_MENU}#try-free`],
    offer: "Menu-made can turn the menu you already have into a clean, mobile-friendly menu page that Google can read, along with a printable QR code for your tables and front window. It's $144 for the first year, which covers up to 3 menu pages, hosting and two rounds of changes.",
    how: `Upload your current menu as a PDF or photos and you'll see it as a phone menu in ${MENU_COUNT} designs, free, before you decide. Pick the one you like and we build it, check it, and email you the link and QR code.` },
  // Nov 6, 2026 (owner): Conversion Fix is folded into the Website Package, which is the site generator ($299 for the
  // whole site, Website Care $49 a month to host it). Links go to the website page's free generator.
  WEBSITE_PACKAGE: { name: "Your Website", url: WEBSITE, sample: [`Try it free with your menu`, `${WEBSITE}#try-free`],
    offer: `Menu-made makes phone-friendly websites for food and drink businesses, with your menu, hours, map, photos and contact details, in ${SITE_COUNT} designs to choose from. It's $299 one time for the whole site, or add Website Care at $49 a month and we host it on your own domain and look after it.`,
    how: `You can see your business as a website before checking out: upload your menu and you'll see it in all ${SITE_COUNT} designs in a few seconds, then customize the one you like with your logo, photos and colours.` }
};
OFFERS.CONVERSION_FIX = OFFERS.WEBSITE_PACKAGE; // prospects stored before Nov 6 still say CONVERSION_FIX
const FOOTER = "You're receiving this one-time note because your business is listed publicly online. Reply \"no thanks\" and we won't contact you again. Menu-made, 706 Kearny St, San Francisco, CA 94108.";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// New openings (owner, Nov 8, 2026): a business that registered its location with the city in the last 120 days gets
// a congratulations line ahead of what we noticed. Its subject stays the finding.
function opening(p, now = Date.now()) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(p.opened_on || "") ? Date.parse(`${p.opened_on}T12:00:00Z`) : NaN;
  return Number.isFinite(day) && day <= now && now - day <= 120 * 86400000 ? `Congratulations on opening ${p.name}! ` : "";
}

function finding(p) {
  const [subject, observed] = findingOnly(p);
  return [subject, opening(p) + observed];
}

function findingOnly(p) {
  const gaps = JSON.parse(p.gaps_json || "[]");
  const name = p.name;
  const site = String(p.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  if (gaps.includes("menu_pdf")) return [`${name}'s menu opens as a PDF`,
    `I came across ${site} and noticed your menu opens as a PDF. PDFs are difficult to read on phone screens, and Google can't read the dishes inside them, so people nearby searching for food you serve may never find you.`];
  if (gaps.includes("menu_image")) return [`${name}'s menu is posted as images`,
    `I came across ${site} and noticed your menu is posted as images. They're difficult to read on phone screens, and Google can't read the text inside them, so people nearby searching for food you serve may never find you.`];
  if (gaps.includes("menu_missing")) return [`Guests can't find ${name}'s menu online`,
    `I came across ${site} and couldn't find your menu. It's the first thing most guests look for when deciding where to eat, and when it's missing, many of them choose somewhere else.`];
  if (gaps.includes("no_website")) return [`A website for ${name}`,
    `I couldn't find a website for ${name}. Most guests look a place up on their phone before visiting, and without a site, all they see is what other people have posted.`];
  if (gaps.includes("site_down")) return [`${name}'s website isn't loading`,
    `I tried to visit ${site} and it didn't load. Anyone tapping your website link on Google or Yelp right now lands on an error page.`];
  if (gaps.includes("no_phone_layout")) return [`${name}'s website on phone screens`,
    `I opened ${site} on my phone and it shows the full desktop page, shrunk down. Most of your visitors are on phones, and small text and tiny buttons send many of them back to their search results.`];
  return [`A fresh website for ${name}`,
    `I came across ${site} and wanted to show you what ${name} could look like as a modern, phone-friendly website.`];
}

// demoUrl (marketing plan v4): the prospect's own menu as a private phone page, or (Nov 5, 2026) their business as a
// private website preview (demoKind "website"), built by the worker. With it, the email leads with the preview.
const WEBSITE_PRICE = "$299";
const builtFrom = (p) => (p.website ? "what's on your current site" : "your public listing");

const MENU_DEMO_LINE = `So you can see the difference, I went ahead and turned the menu on your site into a phone menu, in ${MENU_COUNT} different designs. Tap Generate menu to flip through them and Customize to add your logo and colours. It's private: only you have the link, and it stays up for three weeks.`;
const MENU_BUTTON = `See your menu in ${MENU_COUNT} designs`;

export function build(p, demoUrl = null, demoKind = "menu") {
  if (demoUrl && demoKind === "website") {
    const offer = OFFERS.WEBSITE_PACKAGE;
    const [subject, observed] = finding(p);
    const paras = ["Hi there,", observed,
      `So you can see the difference, I went ahead and built ${p.name} a phone-friendly website from ${builtFrom(p)}, in ${SITE_COUNT} different designs. Tap Generate site to flip through them and Customize to add your logo, photos and colours. It's private: only you have the link, and it stays up for three weeks.`,
      offer.offer, "If you'd like it live, tap Choose this site on the design you like. If not, no problem at all."];
    return render(p, subject, paras, [[`See your website in ${SITE_COUNT} designs`, demoUrl, true], [`See ${offer.name}`, offer.url, false]]);
  }
  const offer = OFFERS[p.offer_code];
  if (!offer) return null;
  const [subject, observed] = finding(p);
  const demo = demoUrl && p.offer_code === "ONLINE_MENU_QR";
  const paras = demo
    ? ["Hi there,", observed, MENU_DEMO_LINE, offer.offer, "If you'd like it live, tap Make it live on the design you like. If not, no problem at all."]
    : ["Hi there,", observed, offer.offer, offer.how, "If it would help, the details and the free preview are below. If not, no problem at all."];
  const buttons = demo
    ? [[MENU_BUTTON, demoUrl, true], [`See ${offer.name}`, offer.url, false]]
    : [[`See ${offer.name}`, offer.url, true], [offer.sample[0], offer.sample[1], false]];
  return render(p, subject, paras, buttons);
}

// Day-3 follow-up (marketing plan v4): only for owners who opened their preview and haven't replied.
export function buildFollowup(p, price = "$144") {
  if (p.demo_kind === "website") {
    const offer = OFFERS.WEBSITE_PACKAGE;
    const paras = ["Hi there,",
      `Following up on the website preview I built for ${p.name} last week, in ${SITE_COUNT} designs. If you'd like one of them live, it's ${WEBSITE_PRICE} one time for the whole site, or add Website Care at $49 a month and we host it on your own web address.`,
      "Tap Choose this site on the design you like; after checkout there's one short form, already filled in from the preview, and we take it from there. Happy to answer anything first, just reply here.",
      "Your preview is still at the link below for a little while longer."];
    return render(p, `Your ${p.name} website preview`, paras, [[`See your website in ${SITE_COUNT} designs`, p.url, true], [`See ${offer.name}`, offer.url, false]]);
  }
  const subject = `Your ${p.name} phone menu`;
  const paras = ["Hi there,",
    `Following up on the phone version of your menu I sent over last week, in ${MENU_COUNT} designs. If you'd like one of them live, with a printable QR code for your tables and front window, it's ${price} for the first year, hosting included.`,
    "Tap Make it live on the design you like and we'll take it from there. Happy to answer anything first, just reply here.",
    "Your preview is still at the link below for a little while longer."];
  const buttons = [[MENU_BUTTON, p.url, true], ["See Online Menu + QR", ONLINE_MENU, false]];
  return render(p, subject, paras, buttons);
}

// Day-3 follow-up for prospects emailed before previews existed (Nov 5, 2026). With demoUrl, the follow-up carries
// their menu built as a phone page, or their business as a website; otherwise a short reminder of the first email's offer.
export function buildFirstFollowup(p, demoUrl = null, price = "$144", demoKind = "menu") {
  if (demoUrl && demoKind === "website") {
    const offer = OFFERS.WEBSITE_PACKAGE;
    const paras = ["Hi there,",
      `Following up on my note from earlier this week. Rather than describe it, I went ahead and built a phone-friendly website for ${p.name} from ${builtFrom(p)}, in ${SITE_COUNT} different designs, so you can see the difference. Tap Generate site to flip through them. It's private: only you have the link, and it stays up for three weeks.`,
      offer.offer, "Happy to answer anything first, just reply here."];
    return render(p, `A website preview for ${p.name}`, paras, [[`See your website in ${SITE_COUNT} designs`, demoUrl, true], [`See ${offer.name}`, offer.url, false]]);
  }
  const offer = OFFERS[p.offer_code];
  if (!offer) return null;
  if (demoUrl && p.offer_code === "ONLINE_MENU_QR") {
    const paras = ["Hi there,",
      `Following up on my note from earlier this week about your menu. Rather than describe it, I went ahead and turned the menu on your site into a phone menu, in ${MENU_COUNT} different designs, so you can see the difference. Tap Generate menu to flip through them. It's private: only you have the link, and it stays up for three weeks.`,
      `If you'd like one live, with a printable QR code for your tables and front window, it's ${price} for the first year, hosting included. Tap Make it live on the design you like and we'll take it from there.`,
      "Happy to answer anything first, just reply here."];
    return render(p, `Your ${p.name} menu as a phone page`, paras, [[MENU_BUTTON, demoUrl, true], ["See Online Menu + QR", ONLINE_MENU, false]]);
  }
  const [subject] = finding(p);
  const paras = ["Hi there,",
    `Following up on my note from earlier this week. ${offer.offer}`,
    offer.how,
    "Happy to answer anything first, just reply here. If it's not a fit, no problem at all."];
  return render(p, `Re: ${subject}`, paras, [[`See ${offer.name}`, offer.url, true], [offer.sample[0], offer.sample[1], false]]);
}

// Owner (Nov 9, 2026): no white in Menu-made emails. Same colours as the customer emails (booking-api lib/email.js
// MAIL): dark blue #003344 card, #00222d header, footer and page, white text, cyan highlights.
const MAIL = { page: "#00222d", card: "#003344", bar: "#00222d", line: "#0a6f80", text: "#ffffff", soft: "#d9f3f6", cyan: "#00d6e6", link: "#5ff2ff", ink: "#012f34" };

// Holiday Menu (owner, Nov 10, 2026): one holiday email per business through the season, to new prospects and to
// those already emailed (never to anyone who replied, opted out or bounced). demoUrl: their regular menu shown in the
// holiday designs (holiday-outreach.js); without one, the buttons open the Holiday Menu page.
const HOLIDAY = "https://menu-made.com/holiday-menu?utm_source=outreach&utm_medium=email&utm_campaign=holiday-menu";
const usd = (cents) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const HOLIDAY_FOOTER = "You're receiving this because your business is listed publicly online. Reply \"no thanks\" and we won't contact you again. Menu-made, 706 Kearny St, San Francisco, CA 94108.";

// Through the holiday season every other draft carries the offer too (owner, Nov 12, 2026: a follow-up draft was the
// only one of 25 without it): one closing paragraph and a button, added by render() when p.holiday_note is set.
export function holidaySeasonNow(now = Date.now()) {
  const year = new Date(now).getUTCFullYear();
  return now >= Date.parse(`${year}-11-01T00:00:00-07:00`) && now <= Date.parse(`${year}-12-20T23:59:59-08:00`);
}
const holidayNote = () => `One more thing for this time of year: if you're doing a Christmas or New Year's Eve menu, we can put that online too, with its own QR code, print PDF, tri-fold, table tent and TV screen. It's ${usd(HOLIDAY_PRICING.firstCents)} per holiday, or ${usd(HOLIDAY_PRICING.firstCents + HOLIDAY_PRICING.secondCents)} for both, and you can see your menu in the holiday designs free before you decide.`;

export function buildHoliday(p, demoUrl = null) {
  const one = usd(HOLIDAY_PRICING.firstCents);
  const both = usd(HOLIDAY_PRICING.firstCents + HOLIDAY_PRICING.secondCents);
  const subject = p.contacted ? `A holiday menu for ${p.name}` : `${p.name}'s holiday menu, online`;
  const paras = ["Hi there,",
    p.contacted
      ? "I wrote to you a little while ago about your menu. With the holidays close, one more idea and then I'll leave you be."
      : `${opening(p)}I'm JP with Menu-made, a small San Francisco studio that puts food and drink menus online.`,
    "If you're doing a Christmas or New Year's Eve menu this year, we can put it online as its own phone menu, with a QR code for the tables, a print-ready PDF, a tri-fold, a table tent and a TV screen. It sits beside the menu you already have, and after the holiday the link points guests back to your regular menu.",
    ...(demoUrl ? ["To show you the look, I put the menu from your site into our holiday designs. Tap Generate menu to flip through them. It's private: only you have the link."] : []),
    `It's ${one} per holiday, or ${both} for both. Upload your holiday menu and you'll see it in all six holiday designs, free, before you decide.`,
    "If it's not for you this year, no problem at all."];
  const buttons = demoUrl
    ? [["See your menu in the holiday designs", demoUrl, true], ["Make my holiday menu", `${HOLIDAY}#try-free`, false]]
    : [["See holiday menus", HOLIDAY, true], ["Try it free with your holiday menu", `${HOLIDAY}#try-free`, false]];
  return render(p, subject, paras, buttons, HOLIDAY_FOOTER);
}

// The head declares "light dark", not "dark" alone, the same as the customer emails (booking-api lib/email.js
// MAIL_HEAD): Apple Mail repaints a dark-only email with light backgrounds and dark text (owner saw it on a prospect
// draft Nov 12, 2026; the customer emails were fixed Nov 9 and this template was missed).
function render(p, subject, paras, buttons, footer = FOOTER) {
  if (p?.holiday_note && footer !== HOLIDAY_FOOTER) {
    paras = [...paras, holidayNote()];
    buttons = [...buttons, ["See holiday menus", HOLIDAY, false]];
  }
  const pHtml = paras.map((x) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${MAIL.text};">${esc(x)}</p>`).join("");
  const bHtml = buttons.map(([l, u, prim]) => `<tr><td style="padding:0 0 12px;"><a href="${esc(u)}" style="display:inline-block;${prim
    ? `background-color:${MAIL.cyan};color:${MAIL.ink};padding:13px 22px;`
    : `background-color:${MAIL.bar};color:${MAIL.text};padding:12px 21px;border:1px solid ${MAIL.cyan};`}text-decoration:none;font-size:15px;font-weight:bold;border-radius:6px;">${esc(l)}</a></td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark;}a{color:${MAIL.link};}</style><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:${MAIL.page};font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${MAIL.page};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:${MAIL.card};border:1px solid ${MAIL.line};">
<tr><td bgcolor="${MAIL.bar}" style="background-color:${MAIL.bar};padding:28px 32px;border-bottom:4px solid ${MAIL.cyan};"><a href="https://menu-made.com" style="text-decoration:none;"><img src="cid:logo@menu-made" width="220" alt="MENU-MADE" style="display:block;width:220px;max-width:100%;height:auto;border:0;"></a></td></tr>
<tr><td bgcolor="${MAIL.card}" style="padding:32px;background-color:${MAIL.card};">
<p style="margin:0 0 12px;font-size:12px;font-weight:bold;letter-spacing:1px;color:${MAIL.link};">FOR ${esc(p.name.toUpperCase())}</p>
${pHtml}
<table role="presentation" cellspacing="0" cellpadding="0" border="0">${bHtml}</table>
<p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:${MAIL.text};">JP Battaglia<br>Menu-made, San Francisco</p>
</td></tr>
<tr><td bgcolor="${MAIL.bar}" style="padding:24px 32px;background-color:${MAIL.bar};"><p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:${MAIL.soft};"><a href="https://menu-made.com" style="color:${MAIL.link};">menu-made.com</a> &nbsp;&middot;&nbsp; <a href="mailto:info@menu-made.com" style="color:${MAIL.link};">info@menu-made.com</a></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:${MAIL.soft};">${esc(footer)}</p></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${paras.join("\n\n")}\n\n${buttons.map(([l, u]) => `${l}: ${u}`).join("\n")}\n\nJP Battaglia\nMenu-made, San Francisco\nhttps://menu-made.com\n\n${footer}`;
  return { subject, html, text };
}
