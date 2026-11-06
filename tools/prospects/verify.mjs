// Re-check a prospect's gaps in a real browser at phone size before an email states them (Nov 1, 2026: the plain-HTTP
// finder flagged JavaScript-built menus as photos, old PDFs as the menu, and a web host's address as the contact).
// verify(browser, prospect) -> { gaps, offer_code, email } with only confirmed gaps, or null when nothing holds up.
const PLATFORMS = /(^|\.)(toasttab\.com|squareup\.com|square\.site|chownow\.com|clover\.com|popmenu\.com|bentobox\.com|spothopper\.com|olo\.com|doordash\.com|ubereats\.com|grubhub\.com|menufy\.com|order\.online|slicelife\.com|beyondmenu\.com|owner\.com|getbento\.com)$/i;
const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|me|msn|comcast|sbcglobal|att|live)\.(com|net)$/i;
const PRICE = /\$\s?\d{1,3}(\.\d{2})?\b|\b\d{1,2}\.\d{2}\b/g;
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const sameSite = (a, b) => { const x = host(a), y = host(b); return x && y && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)); };

async function open(page, url) {
  try { const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }); await page.waitForTimeout(2500); return r; } catch { return null; }
}

export async function verify(browser, p) {
  const email = String(p.email || "").toLowerCase();
  const domain = email.split("@")[1] || "";
  // The contact must be the business's own: its site's domain, or a personal mailbox (gmail etc.).
  if (!email || !(FREE_MAIL.test(email) || (p.website && (sameSite(`https://${domain}`, p.website))))) return null;
  const listed = JSON.parse(p.gaps_json || "[]");
  if (listed.includes("no_website")) return { gaps: ["no_website"], offer_code: "WEBSITE_PACKAGE", email };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const page = await context.newPage();
  try {
    const res = await open(page, p.website.startsWith("http") ? p.website : `https://${p.website}`);
    if (!res || res.status() >= 400) {
      // Down twice in a row (the finder and now) before an email says so.
      return listed.includes("site_down") && (!res || [404, 410, 500, 502, 504].includes(res.status())) ? { gaps: ["site_down"], offer_code: "WEBSITE_PACKAGE", email } : null;
    }
    if (PLATFORMS.test(host(page.url()))) return null;
    const home = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const links = [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || "").trim().toLowerCase() }));
      return { wide: document.documentElement.scrollWidth > vw + 8, viewport: !!document.querySelector('meta[name="viewport"]'),
        tel: links.some((l) => l.href.startsWith("tel:")), links, text: document.body.innerText || "" };
    });
    const gaps = [];
    if (!home.viewport && home.wide) gaps.push("no_phone_layout");
    if (!home.tel) gaps.push("no_tap_to_call");
    if (home.links.some((l) => PLATFORMS.test(host(l.href)))) { /* ordering platform: their menu works */ }
    else {
      // The site's own main menu link: text "menu", "menus", "food", "our menu", "food & drink" ...
      const main = home.links.find((l) => /^(our |the |view |see |food )?menus?$|^food( (&|and) drinks?)?$|^eat$|^dinner$/.test(l.text) && (sameSite(l.href, page.url()) || /\.pdf(\?|$)/i.test(l.href)));
      if (main && /\.pdf(\?|$)/i.test(main.href)) gaps.push("menu_pdf");
      else if (main) {
        await open(page, main.href);
        const menu = await page.evaluate(() => {
          const imgs = [...document.images].filter((i) => i.getBoundingClientRect().width >= 250);
          const pdf = [...document.querySelectorAll("a[href]")].some((a) => /\.pdf(\?|$)/i.test(a.href) && /menu|food|dinner|lunch|brunch|drink/i.test(a.href + (a.innerText || "")));
          const frames = document.querySelectorAll("iframe").length;
          return { text: document.body.innerText || "", bigImages: imgs.length, pdf, frames };
        });
        const prices = (menu.text.match(/\$\s?\d{1,3}(\.\d{2})?\b|\b\d{1,2}\.\d{2}\b/g) || []).length;
        if (prices < 5 && menu.frames === 0) {
          if (menu.pdf) gaps.push("menu_pdf");
          else if (menu.bigImages >= 1) gaps.push("menu_image");
        }
      } else if ((home.text.match(PRICE) || []).length < 5 && !home.links.some((l) => /menu/i.test(l.text + l.href))) gaps.push("menu_missing");
    }
    const offer_code = gaps.some((g) => g.startsWith("menu_")) ? "ONLINE_MENU_QR" : gaps.includes("no_phone_layout") ? "WEBSITE_PACKAGE" : gaps.includes("no_tap_to_call") ? "WEBSITE_PACKAGE" : null;
    return offer_code ? { gaps, offer_code, email } : null;
  } finally { await context.close(); }
}
