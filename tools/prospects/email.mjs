// The Menu-made prospect email: one gap, one offer, the same branding as the customer emails. Used by drafts.mjs.
// build(prospect) -> { subject, html, text }. The logo is attached inline as cid:logo@menu-made.

const SERVICES = "https://menu-made.com/services.html";
const SAMPLES = "https://menu-made.com/api/samples";
// Marketing plan v4 (Nov 3, 2026): Online Menu + QR has its own page; links from these emails are tagged so a sale
// that follows is counted against the outreach (funnel.js keeps the labels through checkout).
const WEBSITE = "https://menu-made.com/website-design?utm_source=outreach&utm_medium=email&utm_campaign=demo-website#try-free";
const ONLINE_MENU = "https://menu-made.com/online-menu?utm_source=outreach&utm_medium=email&utm_campaign=demo-menu";
// Dark mode (Nov 1, 2026): Apple Mail recoloured the header light while the logo kept a baked-in navy box. The logo
// is now transparent and the email asks mail apps to keep its light design.
// Copy revised Nov 1, 2026 (owner): plain wording, accurate to each offer as services.html describes it.
const OFFERS = {
  // Price corrected Nov 3, 2026: $129 setup + $15 first-year hosting = $144 (checkout/quote.js), up to 3 pages.
  ONLINE_MENU_QR: { name: "Online Menu + QR", url: ONLINE_MENU, sample: ["See a real example", `${SAMPLES}/menu`],
    offer: "Menu-made can turn the menu you already have into a clean, mobile-friendly menu page that Google can read, along with a printable QR code for your tables and front window. It's $144 for the first year, which covers up to 3 menu pages, hosting and two rounds of changes.",
    how: "All we need is your current menu as a PDF or photos. We build the page, check it, and email you the link and QR code." },
  // Nov 6, 2026 (owner): Conversion Fix is folded into the Website Package; links go to the website page's free preview.
  WEBSITE_PACKAGE: { name: "Website Package", url: WEBSITE, sample: ["See a real example", `${SAMPLES}/website/`],
    offer: "Menu-made builds simple, mobile-friendly websites for food and drink businesses: up to five pages with your menu, hours, map, photos and contact details, on your own domain. It's $499 one time, and the first three months of updates are included.",
    how: "You can see your business as a website before paying anything: the button below builds a private preview in a few seconds. If you like it, one short form after checkout and we take it from there." }
};
OFFERS.CONVERSION_FIX = OFFERS.WEBSITE_PACKAGE; // prospects stored before Nov 6 still say CONVERSION_FIX
const FOOTER = "You're receiving this one-time note because your business is listed publicly online. Reply \"no thanks\" and we won't contact you again. Menu-made, 706 Kearny St, San Francisco, CA 94108.";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function finding(p) {
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
  return [`${name}'s website has no call button`,
    `I came across ${site} and noticed there's no tap-to-call button on phone screens. A guest who wants to call ahead or place an order has to copy your number by hand, and some won't bother.`];
}

// demoUrl (marketing plan v4): the prospect's own menu as a private phone page, or (Nov 5, 2026) their business as a
// private website preview (demoKind "website"), built by the worker. With it, the email leads with the preview.
const WEBSITE_PRICE = "$499";
const builtFrom = (p) => (p.website ? "what's on your current site" : "your public listing");

export function build(p, demoUrl = null, demoKind = "menu") {
  if (demoUrl && demoKind === "website") {
    const offer = OFFERS.WEBSITE_PACKAGE;
    const [subject, observed] = finding(p);
    const paras = ["Hi there,", observed,
      `So you can see the difference, I went ahead and built ${p.name} a phone-friendly website from ${builtFrom(p)}. It's private: only you have the link, and it stays up for three weeks.`,
      offer.offer, "If you'd like it live, the button below shows what's included. If not, no problem at all."];
    return render(p, subject, paras, [["See your website preview", demoUrl, true], [`See ${offer.name}`, offer.url, false]]);
  }
  const offer = OFFERS[p.offer_code];
  if (!offer) return null;
  const [subject, observed] = finding(p);
  const demo = demoUrl && p.offer_code === "ONLINE_MENU_QR";
  const paras = demo
    ? ["Hi there,", observed, "So you can see the difference, I went ahead and turned the menu on your site into a phone page. It's private: only you have the link, and it stays up for three weeks.", offer.offer, "If you'd like it live, the button below shows what's included. If not, no problem at all."]
    : ["Hi there,", observed, offer.offer, offer.how, "If it would help, the details and a real example are below. If not, no problem at all."];
  const buttons = demo
    ? [["See your menu as a phone page", demoUrl, true], [`See ${offer.name}`, offer.url, false]]
    : [[`See ${offer.name}`, offer.url, true], [offer.sample[0], offer.sample[1], false]];
  return render(p, subject, paras, buttons);
}

// Day-3 follow-up (marketing plan v4): only for owners who opened their preview and haven't replied.
export function buildFollowup(p, price = "$144") {
  if (p.demo_kind === "website") {
    const offer = OFFERS.WEBSITE_PACKAGE;
    const paras = ["Hi there,",
      `Following up on the website preview I built for ${p.name} last week. If you'd like it live on your own web address, with your photos and colours, it's ${WEBSITE_PRICE} one time, with three months of updates included.`,
      "After checkout there's one short form, already filled in from the preview, and we take it from there. Happy to answer anything first, just reply here.",
      "Your preview is still at the link below for a little while longer."];
    return render(p, `Your ${p.name} website preview`, paras, [["See your website preview", p.url, true], [`See ${offer.name}`, offer.url, false]]);
  }
  const subject = `Your ${p.name} phone menu`;
  const paras = ["Hi there,",
    `Following up on the phone version of your menu I sent over last week. If you'd like it live, with a printable QR code for your tables and front window, it's ${price} for the first year, hosting included.`,
    "You'd upload the same menu at checkout and we'd take it from there. Happy to answer anything first, just reply here.",
    "Your preview is still at the link below for a little while longer."];
  const buttons = [["See your menu as a phone page", p.url, true], ["See Online Menu + QR", ONLINE_MENU, false]];
  return render(p, subject, paras, buttons);
}

// Day-3 follow-up for prospects emailed before previews existed (Nov 5, 2026). With demoUrl, the follow-up carries
// their menu built as a phone page, or their business as a website; otherwise a short reminder of the first email's offer.
export function buildFirstFollowup(p, demoUrl = null, price = "$144", demoKind = "menu") {
  if (demoUrl && demoKind === "website") {
    const offer = OFFERS.WEBSITE_PACKAGE;
    const paras = ["Hi there,",
      `Following up on my note from earlier this week. Rather than describe it, I went ahead and built a phone-friendly website for ${p.name} from ${builtFrom(p)}, so you can see the difference. It's private: only you have the link, and it stays up for three weeks.`,
      offer.offer, "Happy to answer anything first, just reply here."];
    return render(p, `A website preview for ${p.name}`, paras, [["See your website preview", demoUrl, true], [`See ${offer.name}`, offer.url, false]]);
  }
  const offer = OFFERS[p.offer_code];
  if (!offer) return null;
  if (demoUrl && p.offer_code === "ONLINE_MENU_QR") {
    const paras = ["Hi there,",
      "Following up on my note from earlier this week about your menu. Rather than describe it, I went ahead and turned the menu on your site into a phone page so you can see the difference. It's private: only you have the link, and it stays up for three weeks.",
      `If you'd like it live, with a printable QR code for your tables and front window, it's ${price} for the first year, hosting included. You'd upload the same menu at checkout and we'd take it from there.`,
      "Happy to answer anything first, just reply here."];
    return render(p, `Your ${p.name} menu as a phone page`, paras, [["See your menu as a phone page", demoUrl, true], ["See Online Menu + QR", ONLINE_MENU, false]]);
  }
  const [subject] = finding(p);
  const paras = ["Hi there,",
    `Following up on my note from earlier this week. ${offer.offer}`,
    offer.how,
    "Happy to answer anything first, just reply here. If it's not a fit, no problem at all."];
  return render(p, `Re: ${subject}`, paras, [[`See ${offer.name}`, offer.url, true], [offer.sample[0], offer.sample[1], false]]);
}

function render(p, subject, paras, buttons) {
  const pHtml = paras.map((x) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#26434f;">${esc(x)}</p>`).join("");
  const bHtml = buttons.map(([l, u, prim]) => `<tr><td style="padding:0 0 12px;"><a href="${esc(u)}" style="display:inline-block;background-color:${prim ? "#00a7b5" : "#071f2c"};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 22px;border-radius:6px;">${esc(l)}</a></td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><style>:root{color-scheme:light only;supported-color-schemes:light only}</style><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#edf3f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#edf3f5;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dce8ec;">
<tr><td bgcolor="#071f2c" style="background-color:#071f2c;padding:28px 32px;border-bottom:4px solid #00d6e6;"><a href="https://menu-made.com" style="text-decoration:none;"><img src="cid:logo@menu-made" width="220" alt="MENU-MADE" style="display:block;width:220px;max-width:100%;height:auto;border:0;"></a></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 12px;font-size:12px;font-weight:bold;letter-spacing:1px;color:#08747b;">FOR ${esc(p.name.toUpperCase())}</p>
${pHtml}
<table role="presentation" cellspacing="0" cellpadding="0" border="0">${bHtml}</table>
<p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#26434f;">JP Battaglia<br>Menu-made, San Francisco</p>
</td></tr>
<tr><td bgcolor="#071f2c" style="padding:24px 32px;background-color:#071f2c;"><p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#e8f6f7;"><a href="https://menu-made.com" style="color:#5ff2ff;">menu-made.com</a> &nbsp;&middot;&nbsp; <a href="mailto:info@menu-made.com" style="color:#5ff2ff;">info@menu-made.com</a></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#9fb8c1;">${esc(FOOTER)}</p></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${paras.join("\n\n")}\n\n${buttons.map(([l, u]) => `${l}: ${u}`).join("\n")}\n\nJP Battaglia\nMenu-made, San Francisco\nhttps://menu-made.com\n\n${FOOTER}`;
  return { subject, html, text };
}
