// Print layouts made from the menu page itself (owner, Nov 12, 2026: the PDFs "should all match the exact same style
// and theme as the online menu that was chosen"). Each takes the stored menu page, keeps its own stylesheet, so the
// design's colours, fonts, pattern and decorations come along unchanged, and lays the same header and sections out
// for paper. A headless browser turns the result into a PDF (browser-pdf.js); print-pdf.js stays as the fallback.
//   buildPrintHtml(format, { pageHtml, qrSvg, qrUrl }) -> string | null
//   format: "print.pdf" (letter, as many pages as needed) | "tri-fold.pdf" (letter landscape, two sides)
//           | "table-tent.pdf" (letter, folds across the middle)
// Returns null when the page is not one buildDesignedMenuHtml made.
import { escapeHtml2 } from "../../lib/util.js";

const pick = (html, re) => re.exec(html)?.[0] || "";

function parts(pageHtml) {
  const html = String(pageHtml || "");
  const head = pick(html, /<head>[\s\S]*?<\/head>/);
  const header = pick(html, /<header>[\s\S]*?<\/header>/);
  const content = pick(html, /<section class="menu-content"[\s\S]*<\/section>(?=\s*(?:<p class="notes">|<\/main>))/);
  const notes = pick(html, /<p class="notes">[\s\S]*?<\/p>/);
  if (!head || !header || !content) return null;
  return { head, header, content, notes };
}

// Shared by every layout: exact colours on paper, no section links, nothing split awkwardly.
const BASE = `
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; }
  .jump { display: none !important; }
  .menu-section { scroll-margin-top: 0; }
  li, h2, .notes, .scan { break-inside: avoid; }
  h2 { break-after: avoid; }
  .scan svg { display: block; background: #fff; fill: #000; }
  .scan b { color: var(--primary); }
  .scan small, .by { color: var(--muted); }
  .by { font-size: 7pt; letter-spacing: .04em; }
  header h1 { overflow-wrap: anywhere; }`;

const link = (qrUrl) => escapeHtml2(String(qrUrl || "").replace(/^https?:\/\//, ""));

// Letter pages: the menu page as it is, in two columns, with the QR code at the end.
function printPage({ head, header, content, notes }, qrSvg, qrUrl) {
  // A design with a ruled frame keeps it, close to the paper's edge; the page's own side margins are not added twice.
  const framed = /outline-offset: 5px/.test(head);
  const box = framed
    ? "main { max-width: none; margin: 0.12in 0.38in 0.38in !important; padding: 0.12in 0.3in 0.22in !important; }"
    : "main { max-width: none; padding: 0 0.5in 0.32in; }";
  return `<!doctype html>
<html lang="en">
${head.replace("</head>", `<style>${BASE}
  @page { size: letter; margin: 0; }
  body { font-size: var(--fs, 11.5px) !important; width: 8.5in; min-height: 11in; }
  header { padding: 20px 0.5in 12px !important; }
  header img { max-height: 76px; margin-bottom: 8px; }
  h1 { font-size: 34px !important; }
  header p { margin-top: 4px; }
  ${box}
  .menu-content { column-count: 2; column-gap: 0.4in; }
  .menu-section:first-child { padding-top: .5em; }
  main, .menu-content, li, .row { font-size: 1em; }
  .menu-section { padding-top: 1.4em; }
  h2 { font-size: 1.3em !important; margin-bottom: .5em; padding-bottom: .4em; }
  li { padding-top: .5em; padding-bottom: .5em; }
  ul { grid-template-columns: 1fr !important; gap: .6em; }
  .desc { font-size: .88em !important; margin-top: .15em; }
  .scan .notes { margin: 0 0 6px; padding: .7em .9em; font-size: .88em; text-align: left; }
  .scan .left { flex: 1; min-width: 0; margin-right: 0.3in; text-align: left; }
  .scan { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--rule); text-align: right; }
  .scan svg { width: 0.95in; height: 0.95in; flex: none; }
  .scan b { display: block; font-size: 12px; }
  .scan small { display: block; font-size: 8.5px; margin-top: 3px; }
  .scan .by { display: block; }
  header img, header:has(h1.name-hidden) img { max-height: 0.95in; }
  body.one { min-height: 0; }
  body.one .leaf { overflow: hidden; display: flex; flex-direction: column; }
  body.one main { flex: 1; display: flex; flex-direction: column; }
  body.one .menu-content { margin-top: auto; margin-bottom: auto; }
  body.one .scan { margin-top: 14px; }
</style></head>`)}
<body>
  <div class="leaf">
  ${header}
  <main>
    ${content}
    <div class="scan"><div class="left">${notes}<span class="by">Menu by MENU-MADE</span></div><div><b>${qrSvg ? "Scan for our menu online" : "See our menu online"}</b><small>${link(qrUrl)}</small></div>${qrSvg}</div>
  </main>
  </div>
  <script>
    // A short menu gets the largest type that still fits one page; a long one keeps the reading size and runs on.
    // Measured at the paper's own width (body is 8.5in wide whatever window the browser has) and measured again
    // once the logo has loaded: before that the logo has no height, the type was chosen too large and the page
    // ran onto a second sheet (owner, Nov 12, 2026: "still bleeding onto a second page ... it could be the logo").
    // A menu that fits is then held in a box exactly one sheet tall, so nothing can spill.
    (function () {
      var body = document.body, leaf = document.querySelector(".leaf"), end = document.querySelector(".scan");
      function fit() {
        var sheet = 11 * 96 - (body.offsetHeight - body.clientHeight), page = sheet - 20;
        body.className = ""; leaf.style.height = "";
        function height() { return end.getBoundingClientRect().bottom - leaf.getBoundingClientRect().top + 34; }
        for (var s = 19; s >= 9.5; s -= 0.5) { body.style.setProperty("--fs", s + "px"); if (height() <= page) { body.className = "one"; leaf.style.height = sheet + "px"; return; } }
        body.style.setProperty("--fs", "11.5px");
      }
      fit();
      window.addEventListener("load", fit);
      Array.prototype.forEach.call(document.images, function (img) { if (!img.complete) img.addEventListener("load", fit); });
    })();
  </script>
</body>
</html>`;
}

// Tri-fold: outside = flap (notes) | back (QR code) | cover (the page header); inside = the menu in three panels.
// The type is the largest that fits the three panels; the script finds it in the browser, where the real fonts are.
function triFold({ head, header, content, notes }, qrSvg, qrUrl) {
  // The chalkboard's wooden frame belongs to each side of the sheet, not to the scrolling page.
  const frame = /border: 16px ridge/.test(head) ? `
  .sheet { border: 14px ridge #74492a; box-shadow: inset 0 0 0 3px #3a2414, inset 0 0 70px rgba(0,0,0,.55); }
  .panel { width: calc(100% / 3); height: 100%; }` : "";
  const note = notes.replace(/^<p class="notes">/, "").replace(/<\/p>$/, "");
  return `<!doctype html>
<html lang="en">
${head.replace("</head>", `<style>${BASE}
  @page { size: 11in 8.5in; margin: 0; }
  .sheet { width: 11in; height: 8.5in; display: flex; overflow: hidden; break-after: page; }
  .panel { width: calc(11in / 3); height: 8.5in; padding: 0.36in; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .cover { padding: 0; }
  .cover header { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0.36in !important; margin: 0 !important; border-radius: 0 !important; }
  .cover header img { max-width: 80%; max-height: 1.7in; }
  .cover h1 { font-size: 30px !important; }
  .flap p { margin: 0; font-size: 13px; line-height: 1.5; font-style: italic; color: var(--ink); }
  .flap p::before, .flap p::after { content: ""; display: block; width: 60px; height: 1.5px; margin: 16px auto; background: var(--accent); }
  .back .scan { display: flex; flex-direction: column; align-items: center; gap: 10px; margin: auto 0; }
  .back .scan svg { width: 1.7in; height: 1.7in; }
  .back .scan b { font-size: 14px; }
  .back .scan small { font-size: 8.5px; }
  .inside { display: block; }
  body { border: 0 !important; box-shadow: none !important; min-height: 0 !important; }
  .inside main { max-width: none; margin: 0 !important; border: 0 !important; outline: 0 !important; background: transparent !important; width: 100%; height: 100%; padding: 0.36in; font-size: var(--fs, 12px); }${frame}
  .inside main::before { display: none !important; }
  .inside .menu-content { height: 100%; column-count: 3; column-gap: 0.72in; column-fill: balance; display: block !important; }
  .inside .menu-section { padding-top: 0; margin: 0 0 1.3em; break-inside: avoid; display: block !important; }
  .inside h2 { font-size: 1.3em !important; margin: 0 0 .5em; padding-bottom: .35em; }
  .inside li { padding-top: .42em; padding-bottom: .42em; font-size: 1em; }
  .inside ul { grid-template-columns: 1fr !important; gap: .5em; }
  .inside .row { font-size: 1em; }
  .inside .desc { font-size: .88em !important; margin-top: .15em; line-height: 1.35; }
  .inside.split .menu-section { break-inside: auto; }
  .inside .menu-content.paned { display: flex !important; column-count: auto; gap: 0.72in; }
  .inside .pane { flex: 1 1 0; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: center; }
  .inside .pane .menu-section:last-child { margin-bottom: 0; }
</style></head>`)}
<body>
  <div class="sheet outside">
    <div class="panel flap">${note ? `<p>${note}</p>` : ""}</div>
    <div class="panel back"><div class="scan">${qrSvg}<b>${qrSvg ? "Scan for our menu online" : "See our menu online"}</b><small>${link(qrUrl)}</small></div><span class="by">Menu by MENU-MADE</span></div>
    <div class="panel cover">${header}</div>
  </div>
  <div class="sheet inside"><main>${content}</main></div>
  <script>
    (function () {
      var main = document.querySelector(".inside main"), box = document.querySelector(".inside .menu-content"), sheet = document.querySelector(".inside");
      function fits(size) { main.style.setProperty("--fs", size + "px"); return box.scrollWidth <= box.clientWidth + 1 && box.scrollHeight <= box.clientHeight + 1; }
      function largest() { for (var s = 19; s >= 7.5; s -= 0.5) if (fits(s)) return s; return 0; }
      // Whole sections per panel when that costs little; sections split between panels only for a long menu.
      var whole = largest();
      sheet.classList.add("split");
      var split = largest();
      if (whole && split - whole <= 3) { sheet.classList.remove("split"); fits(whole); }
      else if (!split) fits(7.5);
      // Each panel's dishes sit in the middle of that panel (owner, Nov 12, 2026: "center everything in each section
      // of the trifold"): the browser's columns become three panes, each holding what landed in its column.
      var left = box.getBoundingClientRect().left, step = (box.clientWidth + 0.72 * 96) / 3;
      function col(el) { return Math.max(0, Math.min(2, Math.round((el.getBoundingClientRect().left - left) / step))); }
      var panes = [0, 1, 2].map(function () { var d = document.createElement("div"); d.className = "pane"; return d; });
      var plan = [];
      box.querySelectorAll(".menu-section").forEach(function (sec) {
        var h = sec.querySelector("h2"), list = sec.querySelector("ul"), parts = {};
        Array.prototype.forEach.call(list.children, function (li) { var c = col(li); (parts[c] = parts[c] || []).push(li); });
        var hc = h ? col(h) : -1;
        [0, 1, 2].forEach(function (c) {
          if (!parts[c] && hc !== c) return;
          plan.push({ c: c, sec: sec, list: list, h: hc === c ? h : null, items: parts[c] || [] });
        });
      });
      plan.forEach(function (p) {
        var sec = p.sec.cloneNode(false), list = p.list.cloneNode(false);
        if (!p.h) { sec.removeAttribute("id"); sec.removeAttribute("aria-labelledby"); }
        if (p.h) sec.appendChild(p.h);
        p.items.forEach(function (li) { list.appendChild(li); });
        if (p.items.length) sec.appendChild(list);
        panes[p.c].appendChild(sec);
      });
      box.textContent = "";
      panes.forEach(function (d) { box.appendChild(d); });
      box.classList.add("paned");
    })();
  </script>
</body>
</html>`;
}

// Table tent: two faces, the top one upside down so it reads the right way once folded.
function tableTent({ head, header }, qrSvg, qrUrl) {
  if (!qrSvg) return null;
  const face = `<div class="face">${header}<div class="scan">${qrSvg}<div><span>Scan for</span><b>our menu</b><ol><li>Open your phone's camera</li><li>Point it at the code</li><li>Tap the link that appears</li></ol><small>${link(qrUrl)}</small></div></div><span class="by">Menu by MENU-MADE</span></div>`;
  return `<!doctype html>
<html lang="en">
${head.replace("</head>", `<style>${BASE}
  @page { size: letter; margin: 0; }
  body { width: 8.5in; height: 11in; overflow: hidden; }
  .face { height: 50%; display: flex; flex-direction: column; align-items: center; overflow: hidden; position: relative; }
  .face:first-child { transform: rotate(180deg); border-top: 1px dashed var(--rule); }
  .face header { width: 100%; padding: 22px 0.5in 14px !important; margin: 0 !important; border-radius: 0 !important; }
  .face header img { max-height: 0.9in; }
  .face h1 { font-size: 30px !important; }
  .face header p { display: none; }
  /* The code and its instructions sit in a double-line box in the design's accent colour, like the framed menu
     page (owner, Nov 12, 2026). */
  .scan { margin: auto; display: flex; align-items: center; justify-content: center; gap: 0.4in; text-align: left; padding: 0.28in 0.4in; border: 1px solid var(--accent); outline: 1px solid var(--accent); outline-offset: 5px; }
  .scan svg { width: 2.3in; height: 2.3in; flex: none; }
  .scan span { display: block; font-size: 22px; color: var(--ink); }
  .scan b { display: block; font-size: 42px; line-height: 1.05; font-family: inherit; }
  .scan ol { margin: 14px 0 12px; padding-left: 18px; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .scan ol li { display: list-item; padding: 0; border: 0; border-radius: 0; background: none; text-align: left; }
  .scan small { font-size: 9px; }
  .by { position: absolute; bottom: 10px; left: 0; right: 0; text-align: center; }
</style></head>`)}
<body>
  ${face}
  ${face}
</body>
</html>`;
}

function buildPrintHtml(format, { pageHtml, qrSvg = "", qrUrl = "" } = {}) {
  const found = parts(pageHtml);
  if (!found) return null;
  if (format === "print.pdf") return printPage(found, qrSvg, qrUrl);
  if (format === "tri-fold.pdf") return triFold(found, qrSvg, qrUrl);
  if (format === "table-tent.pdf") return tableTent(found, qrSvg, qrUrl);
  return null;
}

export { buildPrintHtml };
