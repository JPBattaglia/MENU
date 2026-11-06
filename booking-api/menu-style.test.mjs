// The phone menu takes on the look of the customer's own printed menu (owner, Nov 5, 2026).
// Run: node --no-warnings --test booking-api/menu-style.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalizeStyle, contrast } = await import('./src/producers/menu-qr/style.js');
const { buildDesignedMenuHtml } = await import('./src/producers/menu-qr/design.js');
const { parseMenuHtml } = await import('./src/producers/menu-care/menu-edit.js');
const { MENU_EXTRACTION_TOOL } = await import('./src/producers/menu-qr/claude-reader.js');

const MENU = { sections: [{ name: 'Antipasti', items: [{ name: 'BRUSCHETTA', description: 'Toasted bread, tomatoes, basil', price: '9' }] }], notes: '' };
const CREAM = { paper: '#f2e2b3', text: '#3a3a3a', heading: '#333333', item: '#b8312f', price: '#3a3a3a', accent: '#b8312f', title_font: 'classic-serif', heading_font: 'classic-serif', body_font: 'classic-serif', heading_case: 'title', item_case: 'upper', heading_align: 'center', divider: 'none', item_layout: 'inline' };

test('the reader is asked for the menu style', () => {
  const style = MENU_EXTRACTION_TOOL.input_schema.properties.style;
  assert.ok(style.properties.paper && style.properties.heading_font && style.properties.item_layout);
});

test('style colours are forced to readable contrast and unknown values fall back', () => {
  const s = normalizeStyle({ paper: '#ffffff', text: '#eeeeee', item: '#ffff00', heading_font: 'comic-sans', body_font: 'script' });
  assert.ok(contrast(s.text, s.paper) >= 7);
  assert.ok(contrast(s.item, s.paper) >= 4.5);
  assert.equal(s.headingFont, 'classic-serif');
  assert.equal(s.bodyFont, 'classic-serif', 'no script for long text');
  const dark = normalizeStyle({ paper: '#111111', text: '#222222' });
  assert.ok(dark.dark && contrast(dark.text, dark.paper) >= 7);
  assert.equal(normalizeStyle(null), null);
});

test('a menu with a style renders in its colours, fonts and capitals, and Menu Care keeps the style', () => {
  const html = buildDesignedMenuHtml({ businessName: 'Mangia Tutti', brandColors: null, menu: { ...MENU, style: CREAM }, logoDataUri: null });
  assert.match(html, /--paper: #f2e2b3/);
  assert.match(html, /\.item \{ color: var\(--item\); text-transform: uppercase/, 'item names in capitals, as printed');
  assert.match(html, /<meta name="mm-style" content="/);
  const live = parseMenuHtml(html);
  assert.equal(live.style.paper, '#f2e2b3');
  assert.equal(live.style.layout, 'inline');
  const updated = buildDesignedMenuHtml({ businessName: live.businessName, brandColors: [live.primary, live.accent].join(', '), menu: live.menu, logoDataUri: null, style: live.style });
  assert.match(updated, /--paper: #f2e2b3/, 'an update keeps the look');
  assert.equal(parseMenuHtml(updated).menu.sections[0].items[0].name, 'BRUSCHETTA');
});

test('without a style the page is the standard design', () => {
  const html = buildDesignedMenuHtml({ businessName: 'Plain Cafe', brandColors: null, menu: MENU, logoDataUri: null });
  assert.doesNotMatch(html, /mm-style|--item:/);
  assert.equal(parseMenuHtml(html).style, null);
});
