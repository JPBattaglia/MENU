// Size prices (Nov 21, 2026). A price like "SINGLE $3.50 / DOUBLE $3.75 / TRIPLE $4.00" was kept on one line
// (.price is nowrap), so on a phone the row ran off the screen and the whole menu slid sideways (My Happy Donut's
// drinks, owner: "It can move to the left"). Each "/"-separated price now sits on its own line, right-aligned, and
// drops under the item name when it doesn't fit beside it (names are never broken mid-word). Applied when a menu or preview page is served, so menus saved before this are fixed too.
const STYLE = `<style id="mm-size-prices">.price.mm-sizes{display:inline-flex;flex-direction:column;align-items:flex-end;text-align:right}.price.mm-sizes>span{white-space:nowrap}.row:has(.mm-sizes){flex-wrap:wrap}.price.mm-sizes{margin-left:auto}</style>`;

// Prices cut at the old 40-character limit (before Nov 21, 2026) end in a bare "$4." (the cents lost). A price can't
// end in a dot, so "$4." is shown as "$4.00" (My Happy Donut's drinks; owner: no more editing it by hand).
const fixCutCents = (text) => text.replace(/(\$\d+)\.(?=\s*$)/, "$1.00");

// Sticky section bar (owner, Nov 21, 2026: "less transparent ... so the sections are more legible"). Dark designs
// had a 35% black bar the menu showed through; pages saved before the fix in style.js get the same solid bar here.
const OLD_DARK_BAR = ".jump { background: rgba(0,0,0,.35); border-bottom-color: var(--rule); }";
const NEW_DARK_BAR = ".jump { background: color-mix(in srgb, var(--paper) 96%, transparent); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); border-bottom-color: var(--rule); }";

function stackSizePrices(html) {
  if (typeof html !== "string") return html;
  if (html.includes(OLD_DARK_BAR)) html = html.split(OLD_DARK_BAR).join(NEW_DARK_BAR);
  html = html.replace(/<span class="price">([^<]*\$\d+\.)\s*<\/span>/g, (m, text) => `<span class="price">${fixCutCents(text)}</span>`);
  if (html.includes('id="mm-size-prices"')) return html;
  let changed = false;
  const out = html.replace(/<span class="price">([^<]*?\s\/\s[^<]*?)<\/span>/g, (match, text) => {
    const parts = text.split(/\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return match;
    changed = true;
    return `<span class="price mm-sizes">${parts.map((p) => `<span>${p}</span>`).join("")}</span>`;
  });
  if (!changed) return html;
  return out.includes("</head>") ? out.replace("</head>", () => `${STYLE}</head>`) : `${STYLE}${out}`;
}

export { stackSizePrices };
