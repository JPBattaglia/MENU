// TV menu screen (owner, Nov 5, 2026): the live menu laid out for a landscape TV or display running a browser.
//   buildTvMenuHtml({ businessName, primary, accent, logoDataUri, menu, qrSvg, page, pageUrl }) -> { html, pages, page }
// Three columns sized in viewport units, at the largest type that fits one screen. A menu too long for one screen
// is split into screens that rotate every 12 seconds; a single screen reloads every 5 minutes, so Menu Care
// changes show up on the TV without anyone touching it. No scripts: the server sends a Refresh header.
import { escapeHtml2 as esc } from "../../lib/util.js";
import { markItems, markLabel } from "./dietary.js";
import { FONTS, mix, styleCss, toStyle } from "./style.js";

const SIZES = [3.4, 3.1, 2.8, 2.6, 2.4, 2.2, 2.0, 1.85];
const PAGED_SIZE = 2.4;
const COLS = 3;
const COLUMN_VH = 74; // screen height left for the menu, in vh, under the header and above the footer
const COLUMN_VW = 29.5; // one column's width in vw

// Estimated height in "lines of item names" for one item, for a type size in vh on a 16:9 screen.
function itemLines(item, size) {
  const widthVh = COLUMN_VW * (16 / 9);
  const nameChars = widthVh / (size * 0.56);
  const descChars = widthVh / (size * 0.78 * 0.47);
  const nameLines = Math.max(1, Math.ceil((item.name.length + (item.price ? item.price.length + 4 : 0) + item.marks.length * 3) / nameChars));
  const descLines = item.description ? Math.ceil(item.description.length / descChars) * 0.78 : 0;
  return nameLines + descLines + 0.45;
}

// Splits the menu into screens of three columns. Each unit is a section heading or an item; a heading stays with
// its first item.
function paginate(sections, size, limit = Infinity) {
  const perColumn = COLUMN_VH / (size * 1.32);
  const perScreen = Math.min(perColumn * COLS * 0.93, limit);
  const screens = [[]];
  let used = 0;
  for (const section of sections) {
    section.items.forEach((item, index) => {
      let screen = screens.at(-1);
      let group = screen.at(-1);
      const needsHeading = !group || group.source !== section;
      const cost = itemLines(item, size) + (needsHeading ? 2.1 : 0);
      if (used + cost > perScreen && used > 0) {
        screen = [];
        screens.push(screen);
        used = 0;
        group = null;
      }
      if (!group || group.source !== section) {
        group = { source: section, name: section.name, items: [], continued: index > 0 };
        screen.push(group);
        used += 2.1;
      }
      group.items.push(item);
      used += itemLines(item, size);
    });
  }
  return screens;
}

// The chosen design on the TV screen (owner, Nov 12, 2026: the other formats "should all match the exact same style
// and theme as the online menu that was chosen"): its paper, text and heading colours, its fonts, its heading case
// and its background pattern, over the screen's own layout. Empty for a menu with no stored design.
function designCss(style) {
  const s = toStyle(style);
  if (!s) return "";
  const band = s.dark ? mix(s.paper, "#000000", 0.28) : s.heading;
  const bandText = s.dark ? s.heading : "#ffffff";
  const texture = /body \{ background-image: url\("data:image\/svg\+xml[^}]*\}/.exec(styleCss(s))?.[0] || "";
  const upper = s.headingCase === "upper" ? "uppercase" : "none";
  return `
  html, body { background-color: ${s.paper}; color: ${s.text}; font-family: ${FONTS[s.bodyFont]}; }
  ${texture}
  header { background: ${band}; color: ${bandText}; }
  h1 { font-family: ${FONTS[s.titleFont]}; }
  main { column-rule-color: ${s.rule}; }
  h2 { color: ${s.heading}; border-bottom-color: ${s.accent}; font-family: ${FONTS[s.headingFont]}; text-transform: ${upper}; }
  h2 small { color: ${s.muted}; }
  .nm { color: ${s.item}; }
  .ld { border-bottom-color: ${s.rule}; }
  .pr { color: ${s.price}; }
  .it p { color: ${s.muted}; }
  .mk { background: transparent; border-color: ${s.accent}; color: ${s.accent}; }
  footer { background: ${s.paper}; color: ${s.muted}; border-top-color: ${s.rule}; }
  footer .qr { color: ${s.heading}; }
  footer .qr svg { padding: .5vh; }`;
}

function buildTvMenuHtml({ businessName, primary, accent, logoDataUri, menu, qrSvg, page = 1, style = null, hideName = false, pageHref = null }) {
  const marked = markItems(menu);
  const sections = (marked.menu.sections || []).map((section) => ({
    name: String(section.name || "Menu"),
    items: (section.items || []).filter((item) => item?.name).map((item) => ({ name: String(item.name), description: String(item.description || ""), price: String(item.price || ""), marks: item.marks || [] }))
  })).filter((section) => section.items.length);
  let size = PAGED_SIZE;
  let screens = null;
  for (const candidate of SIZES) {
    const tried = paginate(sections, candidate);
    if (tried.length === 1) { size = candidate; screens = tried; break; }
  }
  if (!screens) {
    // Spread the menu evenly over the screens it needs, so the last one isn't a few leftover items.
    screens = paginate(sections, PAGED_SIZE);
    const total = sections.reduce((sum, section) => sum + 2.1 + section.items.reduce((s2, item) => s2 + itemLines(item, PAGED_SIZE), 0), 0);
    for (const slack of [1.04, 1.08, 1.12, 1.18]) {
      const even = paginate(sections, PAGED_SIZE, (total / screens.length) * slack);
      if (even.length === screens.length) { screens = even; break; }
    }
  }
  const total = Math.max(screens.length, 1);
  const current = Math.min(Math.max(1, Number(page) || 1), total);
  const groups = screens[current - 1] || [];
  const used = marked.used.filter((code) => groups.some((g) => g.items.some((item) => item.marks.includes(code))));
  const primaryColor = /^#[0-9a-f]{6}$/i.test(primary || "") ? primary : "#1f2a2e";
  const accentColor = /^#[0-9a-f]{6}$/i.test(accent || "") ? accent : "#b8902b";
  const badge = (code) => `<span class="mk${code === "HOT" ? " hot" : ""}" title="${esc(markLabel(code))}">${esc(code)}</span>`;
  const body = groups.map((group) => `
      <section>
        <h2>${esc(group.name)}${group.continued ? ' <small>continued</small>' : ""}</h2>
        ${group.items.map((item) => `
        <div class="it">
          <div class="row"><span class="nm">${esc(item.name)}${item.marks.map(badge).join("")}</span>${item.price ? `<span class="ld"></span><span class="pr">${esc(item.price)}</span>` : ""}</div>
          ${item.description ? `<p>${esc(item.description)}</p>` : ""}
        </div>`).join("")}
      </section>`).join("");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(businessName || "Menu")} — Menu screen</title>
<style>
  :root { --primary: ${primaryColor}; --accent: ${accentColor}; --s: ${size}vh; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #fbf8f3; color: #1d1d1b; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { height: 13vh; display: flex; align-items: center; gap: 2vw; padding: 0 3vw; background: var(--primary); color: #fff; }
  header img { height: 9vh; max-width: 18vw; object-fit: contain; }
  h1 { margin: 0; font: 600 6vh/1 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; letter-spacing: .05em; }
  header .label { margin-left: auto; font-size: 2vh; letter-spacing: .5em; opacity: .85; }
  main { height: 77vh; padding: 2.5vh 3vw 0; column-count: ${COLS}; column-gap: 3.5vw; column-rule: 1px solid #e6dfd3; column-fill: balance; font-size: var(--s); }
  section { break-inside: auto; }
  h2 { margin: 0 0 .5em; padding-bottom: .25em; border-bottom: .12em solid var(--accent); color: var(--primary); font: 600 1.15em/1.2 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; letter-spacing: .06em; text-transform: uppercase; break-after: avoid; }
  h2 small { font-size: .55em; letter-spacing: .1em; color: #8a847a; text-transform: none; }
  section + section h2 { margin-top: .9em; }
  .it { break-inside: avoid; padding: .18em 0 .38em; }
  .row { display: flex; align-items: baseline; gap: .35em; }
  .nm { font-weight: 650; }
  .ld { flex: 1; min-width: 1em; border-bottom: .1em dotted #b9b2a6; transform: translateY(-.25em); }
  .pr { font-weight: 700; color: var(--primary); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .it p { margin: .1em 0 0; color: #5d5a55; font-size: .78em; line-height: 1.25; }
  .mk { display: inline-block; margin-left: .35em; padding: .05em .3em; border: .08em solid var(--accent); border-radius: .25em; color: var(--accent); background: #fff; font-size: .5em; font-weight: 700; vertical-align: .25em; letter-spacing: .03em; }
  .mk.hot { background: #bf291f; border-color: #bf291f; color: #fff; }
  footer { position: fixed; left: 0; right: 0; bottom: 0; height: 10vh; display: flex; align-items: center; gap: 2vw; padding: 0 3vw; border-top: 1px solid #e6dfd3; background: #fbf8f3; color: #5d5a55; font-size: 1.8vh; }
  footer .key { display: flex; flex-wrap: wrap; gap: .4em 1.4em; font-size: 2vh; }
  footer .key .mk { margin: 0 .3em 0 0; font-size: .8em; vertical-align: .1em; }
  footer .qr { margin-left: auto; display: flex; align-items: center; gap: 1vw; font-size: 2vh; font-weight: 600; color: var(--primary); }
  footer .qr svg { height: 8.4vh; width: 8.4vh; background: #fff; }
  footer .pg { font-size: 1.8vh; letter-spacing: .1em; }
  footer .pg a { display: inline-block; min-width: 4.4vh; padding: .2vh 1vh; margin: 0 .6vh; border: 1px solid currentColor; border-radius: 99px; color: inherit; text-align: center; text-decoration: none; font-size: 2.6vh; line-height: 1.2; }
  footer .pg small { display: block; margin-top: .4vh; font-size: 1.4vh; letter-spacing: .04em; opacity: .8; }
  .turn { position: fixed; left: 0; bottom: 10vh; height: .5vh; width: 100%; background: var(--primary); transform-origin: left; animation: turn 12s linear forwards; }
  @keyframes turn { from { transform: scaleX(0); } to { transform: scaleX(1); } }${designCss(style)}
</style>
</head>
<body>
  <header>
    ${logoDataUri ? `<img src="${esc(logoDataUri)}" alt="">` : ""}
    ${hideName && logoDataUri ? "" : `<h1>${esc(businessName || "Menu")}</h1>`}
    <span class="label">MENU</span>
  </header>
  <main>${body}
  </main>
  <footer>
    ${used.length ? `<div class="key">${used.map((code) => `<span>${badge(code)}${esc(markLabel(code))}</span>`).join("")}</div>` : ""}
    ${total > 1 ? (typeof pageHref === "function"
      // Owner, Nov 12, 2026: "TV menu says 1/4 but I don't see how to see other 3 pages". The screens still turn by
      // themselves every 12 seconds; the arrows let anyone step through them, and the bar shows the next turn coming.
      ? `<span class="pg"><a href="${esc(pageHref((current + total - 2) % total + 1))}" aria-label="Previous screen">&#8249;</a> Screen ${current} of ${total} <a href="${esc(pageHref(current % total + 1))}" aria-label="Next screen">&#8250;</a><small>Next screen in 12 seconds</small></span><span class="turn" aria-hidden="true"></span>`
      : `<span class="pg">${current} / ${total}</span>`) : ""}
    ${qrSvg ? `<div class="qr"><span>Scan for this menu on your phone</span>${qrSvg}</div>` : ""}
  </footer>
</body>
</html>`;
  return { html, pages: total, page: current };
}

// The QR code as a small inline SVG, from the qrcode package's module matrix.
function qrModulesToSvg(modules) {
  if (!modules?.size) return "";
  const n = modules.size;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (modules.get(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
}

export { buildTvMenuHtml, qrModulesToSvg };
