// The Menu-made prospect email: one gap, one link, plain text (Nov 16, 2026). Used by send.mjs.
// build(prospect) -> { subject, text, html: null }.
//
// Nov 10, 2026 (owner): every example in these emails is the current generator, never the old one-design rendering.
// A prospect's own preview is the menu generator (all MENU_DESIGNS) or the site generator (all website DESIGNS); with
// no preview of their own, the second button opens the same free generator on the site to try with their menu.
// The emails don't mention a missing call button.
import { MENU_DESIGNS } from "../../booking-api/src/producers/menu-qr/menu-designs.js";
import { DESIGNS as SITE_DESIGNS } from "../../booking-api/src/producers/website/templates/designs.js";
import { HOLIDAY_PRICING, holidayPrices } from "../../booking-api/src/checkout/holiday.js";

const MENU_COUNT = MENU_DESIGNS.length;
const SITE_COUNT = SITE_DESIGNS.length;
// Marketing plan v4 (Nov 3, 2026): Online Menu + QR has its own page; links from these emails are tagged so a sale
// that follows is counted against the outreach (funnel.js keeps the labels through checkout).
const WEBSITE = "https://menu-made.com/website-design?utm_source=outreach&utm_medium=email&utm_campaign=demo-website";
const ONLINE_MENU = "https://menu-made.com/online-menu?utm_source=outreach&utm_medium=email&utm_campaign=demo-menu";
// Menus: a $149 setup, then MΞNU Plus from $19.99/mo, Pro $39 or Max $79 with no setup (owner, Nov 19, 2026: "no FREE");
// the website is $299 one time (Nov 6).
const OFFERS = {
  ONLINE_MENU_QR: { name: "Online Menu + QR", url: ONLINE_MENU },
  WEBSITE_PACKAGE: { name: "Your Website", url: WEBSITE }
};
OFFERS.CONVERSION_FIX = OFFERS.WEBSITE_PACKAGE; // prospects stored before Nov 6 still say CONVERSION_FIX
const FOOTER = "I found your business through its public listing. Reply \"no thanks\" and I won't write again. Menu-made, 706 Kearny St, San Francisco, CA 94108.";

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
    `I came across ${site} and noticed your menu opens as a PDF. That's hard to read on a phone, and Google can't see the dishes inside it, so people searching nearby may not find you.`];
  if (gaps.includes("menu_image")) return [`${name}'s menu is posted as images`,
    `I came across ${site} and noticed your menu is posted as images. They're hard to read on a phone, and Google can't see the dishes in them, so people searching nearby may not find you.`];
  if (gaps.includes("menu_missing")) return [`Guests can't find ${name}'s menu online`,
    `I came across ${site} and couldn't find your menu. It's the first thing most guests look for, and when it's missing many of them go somewhere else.`];
  if (gaps.includes("no_website")) return [`A website for ${name}`,
    `I couldn't find a website for ${name}. Most guests look a place up before visiting, and without a site all they see is what other people posted.`];
  if (gaps.includes("site_down")) return [`${name}'s website isn't loading`,
    `I tried to visit ${site} and it didn't load. Anyone tapping your website link on Google or Yelp right now lands on an error page.`];
  if (gaps.includes("no_phone_layout")) return [`${name}'s website on phone screens`,
    `I opened ${site} on my phone and it shows the full desktop page, shrunk down. Most visitors are on phones, and tiny text sends many of them back to their search results.`];
  return [`A fresh website for ${name}`,
    `I came across ${site} and wanted to show you what ${name} could look like as a modern, phone-friendly website.`];
}

// Nov 16, 2026 (owner: "Emails are getting no response"; 127 sent, 0 replies): the emails are now short plain-text
// notes from JP, not designed newsletters. Each one names the business, says what was noticed, gives ONE link (their
// own preview when there is one), leads with seeing it free, and ends on a question that's easy to answer. No logo, no
// buttons; one short price line for menus (no free plan since Nov 19). Plain text reads as a person
// writing and is far less likely to land in Promotions or junk. Subjects are fixed per preview kind so the follow-up
// threads under the first email as "Re:".
const WEBSITE_PRICE = "$299";
const builtFrom = (p) => (p.website ? "what's on your current site" : "your public listing");
const SIGNATURE = "JP Battaglia\nMenu-made, San Francisco\n(415) 937-0669";
const menuSubject = (p) => `${p.name}'s menu on a phone`;
const siteSubject = (p) => `A website for ${p.name}`;
const FREE_LINE = "Seeing it is free. To keep it live with its own link and QR code, it's a one-time $149 setup, then $19.99 a month, and you change prices or mark items sold out yourself.";
// Nov 25, 2026 (owner: "yes" to the outreach fixes after 266 emails, 0 replies): a first cold email asks only for a
// reply, never for money. Prices come in the follow-up and the reply; the preview page shows them too.
const FIRST_FREE_LINE = "Seeing it is free.";

export function build(p, demoUrl = null, demoKind = "menu") {
  const [, observed] = finding(p);
  if (demoUrl && demoKind === "website") {
    return render(p, siteSubject(p), ["Hi there,", observed,
      `So I built ${p.name} a phone-friendly website from ${builtFrom(p)}. Have a look, there are ${SITE_COUNT} designs to flip through:`,
      demoUrl,
      FIRST_FREE_LINE,
      "Worth a look?"]);
  }
  const offer = OFFERS[p.offer_code];
  if (!offer) return null;
  const [subject] = finding(p);
  if (demoUrl && p.offer_code === "ONLINE_MENU_QR") {
    return render(p, menuSubject(p), ["Hi there,", observed,
      "So I turned it into a phone menu for you. Here it is:",
      demoUrl,
      FIRST_FREE_LINE,
      "Want me to switch it on for you?"]);
  }
  if (p.offer_code === "ONLINE_MENU_QR") {
    return render(p, subject, ["Hi there,", observed,
      "If you upload the menu you have (a PDF or photos), you'll see it as a phone menu in a few seconds:",
      `${ONLINE_MENU}#try-free`,
      "Want me to set it up for you instead? Just reply with the menu attached."]);
  }
  return render(p, subject, ["Hi there,", observed,
    "Upload your menu and you'll see your business as a phone-friendly website in a few seconds, free:",
    `${WEBSITE}#try-free`,
    `There are ${SITE_COUNT} designs to flip through. Worth a look?`]);
}

// Follow-up (marketing plan v4): only for owners who opened their preview and haven't replied. One per business, ever.
export function buildFollowup(p) {
  if (p.demo_kind === "website") {
    return render(p, `Re: ${siteSubject(p)}`, ["Hi again,",
      `Following up on the website I built for ${p.name}. It's still here for a little while longer:`,
      p.url,
      `If one of the designs works for you, it's ${WEBSITE_PRICE} one time and yours to keep, and I can host it on your own web address too. Anything you'd want changed first?`]);
  }
  return render(p, `Re: ${menuSubject(p)}`, ["Hi again,",
    `Following up on the phone menu I made for ${p.name}. It's still here for a little while longer:`,
    p.url,
    "To keep it live: a one-time $149 setup, then $19.99 a month with MΞNU Plus (your link, QR code, print menu and TV menu). For other languages, a tri-fold and table tents it's $39 a month, or $79 a month and I make every change for you with no setup fee.",
    "Anything you'd want changed first?"]);
}

// Follow-up for prospects emailed before previews existed (Nov 5, 2026). With demoUrl it carries their preview.
export function buildFirstFollowup(p, demoUrl = null, _price = null, demoKind = "menu") {
  if (demoUrl && demoKind === "website") {
    return render(p, siteSubject(p), ["Hi there,",
      `I wrote a little while ago about ${p.name}'s website. Rather than describe it, I built you one from ${builtFrom(p)}:`,
      demoUrl,
      `Seeing it is free. If you'd like one live, it's ${WEBSITE_PRICE} one time and yours to keep. Worth a look?`]);
  }
  const offer = OFFERS[p.offer_code];
  if (!offer) return null;
  if (demoUrl && p.offer_code === "ONLINE_MENU_QR") {
    return render(p, menuSubject(p), ["Hi there,",
      `I wrote a little while ago about ${p.name}'s menu. Rather than describe it, I turned it into a phone menu for you:`,
      demoUrl,
      FREE_LINE,
      "Want me to switch it on for you?"]);
  }
  const [subject] = finding(p);
  return render(p, `Re: ${subject}`, ["Hi there,",
    p.offer_code === "ONLINE_MENU_QR"
      ? `Following up on my note about ${p.name}'s menu. You can see yours as a phone menu, free, in a few seconds here:`
      : `Following up on my note about ${p.name}'s website. You can see your business as a website, free, in a few seconds here:`,
    p.offer_code === "ONLINE_MENU_QR" ? `${ONLINE_MENU}#try-free` : `${WEBSITE}#try-free`,
    "If it's not a fit, no problem at all."]);
}


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
const holidayNote = () => `Doing a Christmas or New Year's Eve menu? I can put that online too, with its own QR code. Just reply.`;

export function buildHoliday(p, demoUrl = null) {
  const one = usd(holidayPrices().first_cents);
  const both = usd(holidayPrices().both_cents);
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

// Holiday push (owner, Nov 17, 2026, "do all"): from Nov 1 to Dec 20 the auto-sent emails lead with the Holiday Menu.
// Same plain-text note from JP, one link, today's price (early bird through Nov 30), free with any plan, and a plain
// deadline. demoUrl: their current menu shown in the holiday designs (holiday-outreach.js) when it could be read;
// otherwise the link opens the holiday generator to try with their holiday menu.
const HOLIDAY_DEADLINE = "Order by December 10 and it's online with plenty of time before Christmas.";
function holidayPriceLine(now = Date.now()) {
  const h = holidayPrices(now);
  return h.early_bird
    ? `It's ${usd(h.first_cents)} if you order by ${h.early_bird_ends} (then ${usd(h.regular_first_cents)}), ${usd(h.both_cents)} for Christmas and New Year's Eve, or free with any MΞNU plan (from $19.99 a month).`
    : `It's ${usd(h.first_cents)} per holiday, ${usd(h.both_cents)} for both, or free with any MΞNU plan (from $19.99 a month).`;
}
export const holidaySubject = (p) => `${p.name}'s holiday menu`;
export function buildHolidayLead(p, demoUrl = null, now = Date.now()) {
  // Nov 25, 2026: a first email to a new business is short and asks only for a reply (no price, no deadline). The
  // second and last email to a business already contacted keeps today's price and the deadline.
  const first = !p.contacted;
  const paras = ["Hi there,",
    first
      ? `${opening(p, now)}I'm JP with Menu-made, here in the Bay Area. I put food and drink menus online.`
      : `I wrote a little while ago about ${p.name}'s menu. With the holidays close, one more idea and then I'll leave you be.`,
    first
      ? "Are you doing a Christmas or New Year's Eve menu this year? I can put it online as its own phone menu, with a QR code for the tables, a print PDF and a table tent."
      : "Are you doing a Christmas or New Year's Eve menu this year? I can put it online as its own phone menu with a QR code for the tables, plus a print-ready PDF and a table tent. It sits beside your regular menu, and after the holiday the QR code sends guests back to it.",
    // Nov 25, 2026 (owner): their regular menu in holiday colours isn't enough on its own, so the email says they can
    // flip designs, customize it themselves, and try the generator with any menu of their own (a PDF or a photo).
    ...(demoUrl
      ? ["Here's your current menu in our holiday designs. Tap Generate menu to flip through them, and Customize to add your logo and colors or change any dish and price:",
        demoUrl,
        "Have your holiday menu already? Try the same generator with it, or with any menu you like (a PDF or a photo), free:",
        `${HOLIDAY}#try-free`]
      : ["Upload your holiday menu (a PDF or a photo) and you'll see it in six holiday designs in a few seconds, free. You can flip through the designs and customize the logo, colors, dishes and prices yourself:", `${HOLIDAY}#try-free`]),
    ...(first ? [] : [`${holidayPriceLine(now)} ${HOLIDAY_DEADLINE}`]),
    first ? "Want one? Just reply and I'll set it up." : "Want me to set it up for you? Just reply with the menu attached."];
  // A follow-up to a holiday first email threads under it; a holiday second email after a regular first one gets its own subject.
  return render({}, p.holiday_followup ? `Re: ${holidaySubject(p)}` : p.contacted ? `A holiday menu for ${p.name}` : holidaySubject(p), paras);
}

// Plain text only (Nov 16, 2026). In the holiday season one P.S. offers the Holiday Menu, answered by reply, so the
// email still has a single link. The footer keeps the opt-out and the mailing address.
function render(p, subject, paras, buttons = null, footer = FOOTER) {
  if (buttons) paras = [...paras, ...buttons.map(([l, u]) => `${l}: ${u}`)];
  if (p?.holiday_note && footer !== HOLIDAY_FOOTER) paras = [...paras, `P.S. ${holidayNote()}`];
  const text = `${paras.join("\n\n")}\n\n${SIGNATURE}\n\n--\n${footer}`;
  return { subject, text, html: null };
}
