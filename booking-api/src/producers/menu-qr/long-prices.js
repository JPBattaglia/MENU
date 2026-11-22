// Size prices (Nov 21, 2026). A price like "SINGLE $3.50 / DOUBLE $3.75 / TRIPLE $4.00" was kept on one line
// (.price is nowrap), so on a phone the row ran off the screen and the whole menu slid sideways (My Happy Donut's
// drinks, owner: "It can move to the left"). Each "/"-separated price now sits on its own line, right-aligned, and
// drops under the item name when it doesn't fit beside it (names are never broken mid-word). Applied when a menu or preview page is served, so menus saved before this are fixed too.
const STYLE = `<style id="mm-size-prices">.price.mm-sizes{display:inline-flex;flex-direction:column;align-items:flex-end;text-align:right}.price.mm-sizes>span{white-space:nowrap}.row:has(.mm-sizes){flex-wrap:wrap}.price.mm-sizes{margin-left:auto}</style>`;

function stackSizePrices(html) {
  if (typeof html !== "string" || html.includes('id="mm-size-prices"')) return html;
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
