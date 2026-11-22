import test from "node:test";
import assert from "node:assert/strict";
import { stackSizePrices } from "./src/producers/menu-qr/long-prices.js";

test("size prices stack, one per line, and the style is added once", () => {
  const html = '<html><head></head><body><div class="row"><span class="item">Espresso</span><span class="leader"></span><span class="price">SINGLE $3.50 / DOUBLE $3.75 / TRIPLE $4.00</span></div><span class="price">$9</span></body></html>';
  const out = stackSizePrices(html);
  assert.match(out, /<span class="price mm-sizes"><span>SINGLE \$3\.50<\/span><span>DOUBLE \$3\.75<\/span><span>TRIPLE \$4\.00<\/span><\/span>/);
  assert.match(out, /<span class="price">\$9<\/span>/, "single prices are left alone");
  assert.equal((out.match(/id="mm-size-prices"/g) || []).length, 1);
  assert.equal(stackSizePrices(out), out, "running twice changes nothing");
});

test("a page with no size prices is returned unchanged", () => {
  const html = '<html><head></head><body><span class="price">$12.50</span></body></html>';
  assert.equal(stackSizePrices(html), html);
});

test("no 40-character price limit is left anywhere", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["src/producers/menu-care/menu-edit.js", "src/producers/menu-qr/design.js", "src/producers/menu-qr/claude-reader.js"]) {
    assert.doesNotMatch(readFileSync(new URL(`./${f}`, import.meta.url), "utf8"), /price[^\n]{0,20}\b40\b/, f);
  }
});

test("a price cut after its dollar sign and dot gets its cents back", () => {
  const out = stackSizePrices('<head></head><span class="price">SINGLE $3.50 / DOUBLE $3.75 / TRIPLE $4.</span><span class="price">$9.</span><span class="price">$9.50</span>');
  assert.match(out, /<span>TRIPLE \$4\.00<\/span>/);
  assert.match(out, /<span class="price">\$9\.00<\/span>/);
  assert.match(out, /<span class="price">\$9\.50<\/span>/);
});

test("a saved dark menu gets the solid section bar", () => {
  const out = stackSizePrices('<head><style>.jump { background: rgba(0,0,0,.35); border-bottom-color: var(--rule); }</style></head><span class="price">$9</span>');
  assert.doesNotMatch(out, /rgba\(0,0,0,\.35\)/);
  assert.match(out, /\.jump \{ background: color-mix\(in srgb, var\(--paper\) 96%, transparent\)/);
});
