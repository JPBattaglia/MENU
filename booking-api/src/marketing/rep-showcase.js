// Rep showcase (owner, Nov 19, 2026): "take a pic of a menu and then show them all that it generates in just the rep
// mode". On a walk-in, after rep mode has made a business's preview, every format the paid Online Menu + QR delivers
// can be shown on the spot, in the design on screen: the QR code, the table tent, the tri-fold, the print menu and the
// TV screen. Nothing waits for owner approval, because nothing is delivered: every page carries the preview watermark,
// can't be printed, and the QR code opens the preview itself, which ends with it.
// Only previews made in rep mode (campaign 'rep') have a showcase; public previews don't, so it gives nothing away.
// Cost: none beyond the preview. The pages are drawn as HTML on request (no AI read, no headless browser, no PDF).
//   GET /api/menu-preview/showcase/<token>/<design>           the list of formats
//   GET /api/menu-preview/showcase/<token>/<design>/<format>  one format: qr | tent | trifold | print | tv (?p=2 for TV screen 2)
import QRCode from "qrcode/lib/browser.js";
import { parseJsonOrNull, simplePage } from "../lib/http.js";
import { escapeHtml } from "../lib/email.js";
import { buildPrintHtml } from "../producers/menu-qr/print-html.js";
import { buildTvMenuHtml, qrModulesToSvg } from "../producers/menu-qr/tv-menu.js";
import { parseMenuHtml } from "../producers/menu-care/menu-edit.js";
import { menuDesignFor } from "../producers/menu-qr/menu-designs.js";

const SITE = "https://menu-made.com";
const FORMATS = [
  { key: "qr", label: "QR code", blurb: "For tables, the window and the counter. Scan it with your phone now." },
  { key: "tent", label: "Table tent", blurb: "Folds to stand on each table, with the QR code and how to use it." },
  { key: "trifold", label: "Tri-fold", blurb: "A folded takeout menu, both sides." },
  { key: "print", label: "Print menu", blurb: "The whole menu on letter pages, with the QR code." },
  { key: "tv", label: "TV screen", blurb: "The menu for a TV or display, long menus rotate through screens." }
];
const PRINT_FORMAT = { tent: "table-tent.pdf", trifold: "tri-fold.pdf", print: "print.pdf" };

const showcaseUrl = (token, design, format = "") => `/api/menu-preview/showcase/${token}/${design}${format ? `/${format}` : ""}`;
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

const MARK = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><text x="130" y="90" text-anchor="middle" transform="rotate(-24 130 80)" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#071f2c" fill-opacity=".13">PREVIEW · NOT LIVE</text></svg>`);

// The bar at the top of every showcase page, the watermark over everything, and no printing.
function chrome(token, design, title) {
  const css = `<style>
  .mm-show { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 14px; background: #071f2c; color: #e8f6f7; font: 600 15px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  .mm-show a { padding: 10px 16px; border-radius: 8px; background: #ffffff1f; box-shadow: inset 0 0 0 2px #ffffff66; color: #fff; text-decoration: none; font-weight: 700; }
  .mm-show span { flex: 1; min-width: 0; }
  body::after { content: ""; position: fixed; inset: 0; z-index: 19; pointer-events: none; background-image: url("data:image/svg+xml,${MARK}"); }
  @media print { body > * { display: none !important; } body::before { content: "This is a preview from menu-made.com and can't be printed."; display: block; padding: 40px; font: 18px system-ui, sans-serif; } }
</style>`;
  const bar = `<nav class="mm-show" aria-label="Formats"><a href="${escapeHtml(showcaseUrl(token, design))}">All formats</a><span>${escapeHtml(title)} · preview</span></nav>`;
  return { css, bar };
}

// Print layouts are sized in inches for paper; on a tablet they're scaled down to the screen's width.
function onScreen(html, token, design, title, extraCss = "") {
  const { css, bar } = chrome(token, design, title);
  const fit = `<script>(function(){function f(){var b=document.querySelector(".mm-paper");if(!b)return;b.style.zoom=1;var w=b.scrollWidth;b.style.zoom=Math.min(1,(window.innerWidth-16)/w);}window.addEventListener("load",f);window.addEventListener("resize",f);})();</script>`;
  return html
    .replace("</head>", () => `${css}<style>body{width:auto!important;height:auto!important;min-height:0!important;overflow:visible!important;background:#e9eef0}.mm-paper{width:max-content;margin:12px auto;background:#fff;box-shadow:0 6px 24px rgba(0,0,0,.18)}${extraCss}</style>${fit}</head>`)
    .replace(/<body([^>]*)>/, (m, attrs) => `<body${attrs}>${bar}<div class="mm-paper">`)
    .replace("</body>", () => `</div></body>`);
}

function hubPage(token, design, business) {
  const { css, bar } = chrome(token, design, business || "Your menu");
  const cards = [`<a class="card" href="${escapeHtml(`${SITE}/api/menu-preview/view/${token}/${design}`)}"><b>Phone menu</b><small>What guests see when they scan.</small></a>`,
    ...FORMATS.map((f) => `<a class="card" href="${escapeHtml(showcaseUrl(token, design, f.key))}"><b>${escapeHtml(f.label)}</b><small>${escapeHtml(f.blurb)}</small></a>`)].join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Everything you get</title>${css}
<style>body{margin:0;background:#0b2532;color:#e8f6f7;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:900px;margin:0 auto;padding:22px 16px 40px}h1{margin:0 0 6px;font-size:26px}p{margin:0 0 18px;opacity:.85}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}.card{display:grid;gap:6px;padding:20px;border-radius:14px;background:#123848;color:#fff;text-decoration:none;box-shadow:inset 0 0 0 2px #00a7b555}.card b{font-size:20px}.card small{font-size:14px;opacity:.85}.card:active{background:#00a7b5}</style></head>
<body>${bar.replace(/<a [^>]*>All formats<\/a>/, "")}<main><h1>Everything ${escapeHtml(business || "your business")} gets</h1><p>One menu, made once, in every format. Tap any of them.</p><div class="grid">${cards}</div></main></body></html>`;
}

function qrPage(token, design, business, qrSvg, qrUrl) {
  const { css, bar } = chrome(token, design, "QR code");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>QR code</title>${css}
<style>body{margin:0;background:#fff;color:#071f2c;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{display:grid;justify-items:center;gap:14px;padding:28px 16px 40px;text-align:center}main svg{width:min(70vw,60vh,420px);height:auto;background:#fff;fill:#000}h1{margin:0;font-size:28px}p{margin:0;max-width:520px}small{color:#557}</style></head>
<body>${bar}<main><h1>${escapeHtml(business || "Your menu")}</h1>${qrSvg}<p><b>Scan it with your phone's camera.</b> It opens your menu, made from the photo a minute ago.</p><small>On the live version this code goes on your tables, window and receipts, and never changes when the menu does.</small></main></body></html>`;
}

function tvPage(token, design, screen, pageNumber) {
  const { css, bar } = chrome(token, design, "TV screen");
  const pages = screen.pages > 1
    ? `<div class="tvp">${Array.from({ length: screen.pages }, (_, i) => `<a href="${escapeHtml(`${showcaseUrl(token, design, "tv")}?p=${i + 1}`)}"${i + 1 === pageNumber ? ' aria-current="page"' : ""}>Screen ${i + 1}</a>`).join("")}<small>On a TV these rotate every 12 seconds.</small></div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>TV screen</title>${css}
<style>body{margin:0;background:#1c1c1c;color:#eee;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}.tv{display:block;width:min(100vw - 24px,(100vh - 140px) * 16 / 9);aspect-ratio:16/9;margin:14px auto 10px;border:10px solid #000;border-radius:10px;background:#000}.tvp{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;padding:0 12px 20px}.tvp a{padding:8px 14px;border-radius:8px;background:#333;color:#fff;text-decoration:none}.tvp a[aria-current]{background:#00a7b5}.tvp small{width:100%;text-align:center;opacity:.7}</style></head>
<body>${bar}<iframe class="tv" title="TV screen" sandbox srcdoc="${escapeHtml(screen.html)}"></iframe>${pages}</body></html>`;
}

async function handleRepShowcase(request, env, token, design, format, { now = Date.now(), loadLogo, renderDesign } = {}) {
  const gone = () => simplePage(410, "Not available", "<p>This preview has ended, or it wasn't made in rep mode.</p>");
  if (!/^[a-f0-9]{36}$/.test(token) || !env.DB || !env.ASSETS || !menuDesignFor(design)) return gone();
  if (format && !FORMATS.some((f) => f.key === format)) return gone();
  const row = await env.DB.prepare(`SELECT status, expires_at, campaign FROM menu_previews WHERE token = ?`).bind(token).first();
  if (!row || row.campaign !== "rep" || row.status !== "READY" || row.expires_at <= new Date(now).toISOString()) return gone();
  const data = parseJsonOrNull(await (await env.ASSETS.get(`menu-previews/${token}/data.json`))?.text());
  if (!data?.menu) return gone();
  const business = data.custom?.name || data.business || "";
  if (!format) return new Response(hubPage(token, design, business), { status: 200, headers: HEADERS });

  const designHtml = renderDesign(data, design, await loadLogo(env, token, data.custom));
  const qrUrl = `${SITE}/api/menu-preview/view/${token}/${design}`;
  const qrSvg = qrModulesToSvg(QRCode.create(qrUrl, { errorCorrectionLevel: "M" }).modules);
  const title = FORMATS.find((f) => f.key === format).label;
  const sorry = (text) => {
    const { css, bar } = chrome(token, design, title);
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${css}</head><body style="margin:0;font:17px/1.5 system-ui,sans-serif">${bar}<p style="padding:24px">${escapeHtml(text)}</p></body></html>`, { status: 200, headers: HEADERS });
  };

  if (format === "qr") return new Response(qrPage(token, design, business, qrSvg, qrUrl), { status: 200, headers: HEADERS });
  if (format === "tv") {
    const parsed = (() => { try { return parseMenuHtml(designHtml); } catch { return null; } })();
    if (!parsed) return sorry("This menu can't be shown as a TV screen automatically.");
    const pageNumber = Number(new URL(request.url).searchParams.get("p")) || 1;
    const screen = buildTvMenuHtml({ ...parsed, qrSvg, page: pageNumber, pageHref: (n) => `${showcaseUrl(token, design, "tv")}?p=${n}` });
    return new Response(tvPage(token, design, screen, screen.page), { status: 200, headers: HEADERS });
  }
  const html = buildPrintHtml(PRINT_FORMAT[format], { pageHtml: designHtml, qrSvg, qrUrl });
  if (!html) return sorry(`This menu can't be laid out as a ${title.toLowerCase()} automatically. The phone menu and print menu still work.`);
  // The table tent's top half is printed upside down so it reads right once folded; on screen, show one face.
  const extra = format === "tent" ? ".face:first-child{display:none!important}body{height:auto!important}.face{height:5.5in!important}" : "";
  return new Response(onScreen(html, token, design, title, extra), { status: 200, headers: HEADERS });
}

// The button on a rep preview's bar, beside Generate menu and Customize.
function addShowcaseButton(page, token, design) {
  if (page.includes('class="mm-gen-all"') || !page.includes('class="mm-gen-next"')) return page;
  const css = `<style>.mm-gen-all{flex:none;padding:12px 18px;border-radius:8px;background:#f2b705;color:#071f2c!important;font:700 15px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-decoration:none}@media (max-width:600px){.mm-gen-all{padding:10px 12px;font-size:14px}}</style>`;
  const link = `<a class="mm-gen-all" href="${escapeHtml(showcaseUrl(token, design))}">All formats</a>`;
  return page.replace("</head>", () => `${css}</head>`).replace(/(<a class="mm-gen-next")/, (m) => `${link}\n  ${m}`);
}

export { handleRepShowcase, addShowcaseButton, FORMATS as SHOWCASE_FORMATS };
