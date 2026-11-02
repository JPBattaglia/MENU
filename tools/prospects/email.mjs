// The Menu-made prospect email: one gap, one offer, the same branding as the customer emails. Used by drafts.mjs.
// build(prospect) -> { subject, html, text }. The logo is attached inline as cid:logo@menu-made.

const SERVICES = "https://menu-made.com/services.html";
const OFFERS = {
  ONLINE_MENU_QR: { name: "Online Menu + QR", price: "$129 one time", url: `${SERVICES}#online-menu`,
    what: "We turn the menu you already have (PDF or photos is fine) into a fast menu page that reads well on any phone, plus a QR code for your tables and windows. First year of hosting included.",
    sample: ["See a sample menu", "https://menu-made.com/sample-menu.html"] },
  WEBSITE_PACKAGE: { name: "Website Package", price: "$499 one time, with 3 months of upkeep included", url: `${SERVICES}#website-package`,
    what: "We build a clean, phone-first website with your menu, hours, map, photos and tap-to-call, on your own domain." },
  CONVERSION_FIX: { name: "Conversion Fix", price: "$299 one time", url: `${SERVICES}#conversion-fix`,
    what: "We fix the spots on your current site where guests drop off: tap-to-call, directions, hours and the menu, all one tap away on a phone." }
};
const FOOTER = "You're getting this one-time note because your business is listed publicly online. Reply \"no thanks\" and you won't hear from us again. Menu-made, 706 Kearny St, San Francisco, CA 94108.";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function finding(p) {
  const gaps = JSON.parse(p.gaps_json || "[]");
  const name = p.name;
  const site = String(p.website || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (gaps.includes("menu_pdf")) return [`${name}'s menu opens as a PDF on phones`,
    `I was looking at ${site} and the menu opens as a PDF. On a phone that means pinching and zooming, and Google can't read what's in it, so people searching for a dish near you don't see that you serve it.`];
  if (gaps.includes("menu_image")) return [`${name}'s menu is a photo Google can't read`,
    `I was looking at ${site} and the menu is shown as images. They're hard to read on a phone, and Google can't read text inside a picture, so people searching for a dish near you don't see that you serve it.`];
  if (gaps.includes("menu_missing")) return [`Guests can't find ${name}'s menu online`,
    `I was looking at ${site} and couldn't find a menu. The menu is the first thing most guests look for before they visit, and when it isn't there many pick a place where it is.`];
  if (gaps.includes("no_website")) return [`A website for ${name}`,
    `I couldn't find a website for ${name}. Most guests look a place up on their phone before they go, and without a site they only see what others have posted.`];
  if (gaps.includes("site_down")) return [`${name}'s website isn't loading`,
    `I tried to open ${site} and it didn't load. Anyone who taps your website link on Google or Yelp right now gets an error page.`];
  if (gaps.includes("no_phone_layout")) return [`${name}'s website on a phone`,
    `I opened ${site} on a phone and it shows the desktop layout, shrunk down. Most of your visitors are on phones, and tiny text and buttons send them back to search.`];
  return [`One tap to call ${name}`,
    `I was looking at ${site} on a phone and there's no tap-to-call button, so a guest who wants to book or order has to copy your number by hand.`];
}

export function build(p) {
  const offer = OFFERS[p.offer_code];
  if (!offer) return null;
  const [subject, observed] = finding(p);
  const paras = ["Hi there,", observed,
    `${offer.what} It's ${offer.price}, and the whole thing is done for you: you send what you have and approve it before it goes live.`,
    "If it's useful, the link below has the details. If not, no problem at all."];
  const buttons = [[`See ${offer.name}`, offer.url, true], ...(offer.sample ? [[offer.sample[0], offer.sample[1], false]] : [])];
  const pHtml = paras.map((x) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#26434f;">${esc(x)}</p>`).join("");
  const bHtml = buttons.map(([l, u, prim]) => `<tr><td style="padding:0 0 12px;"><a href="${esc(u)}" style="display:inline-block;background-color:${prim ? "#00a7b5" : "#071f2c"};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 22px;border-radius:6px;">${esc(l)}</a></td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#edf3f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#edf3f5;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dce8ec;">
<tr><td style="background-color:#071f2c;padding:28px 32px;border-bottom:4px solid #00d6e6;"><a href="https://menu-made.com" style="text-decoration:none;"><img src="cid:logo@menu-made" width="220" alt="MENU-MADE" style="display:block;width:220px;max-width:100%;height:auto;border:0;"></a></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 12px;font-size:12px;font-weight:bold;letter-spacing:1px;color:#08747b;">FOR ${esc(p.name.toUpperCase())}</p>
${pHtml}
<table role="presentation" cellspacing="0" cellpadding="0" border="0">${bHtml}</table>
<p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#26434f;">JP Battaglia<br>Menu-made, San Francisco</p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#071f2c;"><p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#e8f6f7;"><a href="https://menu-made.com" style="color:#5ff2ff;">menu-made.com</a> &nbsp;&middot;&nbsp; <a href="mailto:info@menu-made.com" style="color:#5ff2ff;">info@menu-made.com</a></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#9fb8c1;">${esc(FOOTER)}</p></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${paras.join("\n\n")}\n\n${buttons.map(([l, u]) => `${l}: ${u}`).join("\n")}\n\nJP Battaglia\nMenu-made, San Francisco\nhttps://menu-made.com\n\n${FOOTER}`;
  return { subject, html, text };
}
