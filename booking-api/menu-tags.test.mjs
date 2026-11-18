// Stage 15 "AI menu details" (Nov 17, 2026): diet and allergen marks as data on menu items.
// Run: node --no-warnings --test booking-api/menu-tags.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalizeTags, tagItem, tagMenu, markItems } = await import('./src/producers/menu-qr/dietary.js');
const { buildDesignedMenuHtml } = await import('./src/producers/menu-qr/design.js');
const { parseMenuHtml, cleanMenu, diffMenus, describeDiff, checkChange } = await import('./src/producers/menu-care/menu-edit.js');
const { translateMenuHtml } = await import('./src/producers/menu-qr/translate.js');
const { MENU_EXTRACTION_TOOL } = await import('./src/producers/menu-qr/claude-reader.js');
const { MENU_DESIGNS, HOLIDAY_DESIGNS, designStyle } = await import('./src/producers/menu-qr/menu-designs.js');

const MENU = {
  sections: [{ name: 'Salads', items: [
    { name: 'Garden Salad (V, GF)', description: 'Greens, herbs', price: '$11' },
    { name: 'Thai Noodles', description: 'Peanut sauce [spicy]', price: '$15', tags: ['n'] },
    { name: 'Burger', description: 'Beef', price: '$16' }
  ] }],
  notes: ''
};

test('normalizeTags keeps known codes in order, no repeats', () => {
  assert.deepEqual(normalizeTags(['gf', 'V', 'X', 'GF', ' hot ']), ['V', 'GF', 'HOT']);
  assert.deepEqual(normalizeTags(null), []);
});

test('tagMenu moves bracketed marks out of names into tags and joins the reader tags', () => {
  const menu = tagMenu(MENU);
  const [salad, noodles, burger] = menu.sections[0].items;
  assert.equal(salad.name, 'Garden Salad');
  assert.deepEqual(salad.tags, ['V', 'GF']);
  assert.equal(noodles.description, 'Peanut sauce');
  assert.deepEqual(noodles.tags, ['N', 'HOT']);
  assert.equal('tags' in burger, false);
  assert.deepEqual(tagItem({ name: 'Fries (6 pieces)', description: '', price: '' }), { name: 'Fries (6 pieces)', description: '', price: '' });
});

test('the reader asks for tags from the menu only', () => {
  const item = MENU_EXTRACTION_TOOL.input_schema.properties.sections.items.properties.items.items;
  assert.deepEqual(item.properties.tags.items.enum, ['V', 'VG', 'GF', 'DF', 'N', 'HOT']);
  assert.match(item.properties.tags.description, /Never guess/);
});

test('the live page shows the marks with a key, and reads them back', () => {
  const menu = tagMenu(MENU);
  const html = buildDesignedMenuHtml({ businessName: 'Leaf Cafe', menu });
  assert.match(html, /<span class="tags" data-tags="V GF"><abbr title="Vegetarian">V<\/abbr><abbr title="Gluten-free">GF<\/abbr><\/span>/);
  assert.match(html, /<p class="tag-key">/);
  assert.match(html, /Ask staff about allergies before you order\./);
  const page = parseMenuHtml(html);
  assert.deepEqual(page.menu.sections[0].items.map((i) => i.tags || []), [['V', 'GF'], ['N', 'HOT'], []]);
  // No marks, no key.
  assert.doesNotMatch(buildDesignedMenuHtml({ businessName: 'Plain', menu: { sections: [{ name: 'Menu', items: [{ name: 'Tea', description: '', price: "$3" }] }] } }), /<p class="tag-key">/);
});

test('every design keeps the marks', () => {
  for (const design of [...MENU_DESIGNS, ...HOLIDAY_DESIGNS]) {
    const menu = tagMenu(MENU);
    const html = buildDesignedMenuHtml({ businessName: 'Leaf Cafe', menu, style: designStyle(design.key, menu) });
    assert.match(html, /data-tags="V GF"/, design.key);
  }
});

test('the editor keeps marks, and a mark change is a change', () => {
  const before = tagMenu(MENU);
  const { menu: after } = cleanMenu({ sections: [{ name: 'Salads', items: [
    { name: 'Garden Salad', description: 'Greens, herbs', price: '$11', tags: ['V', 'GF', 'VG', 'bogus'] },
    { name: 'Thai Noodles', description: 'Peanut sauce', price: '$15', tags: ['N', 'HOT'] },
    { name: 'Burger', description: 'Beef', price: '$16' }
  ] }] });
  assert.deepEqual(after.sections[0].items[0].tags, ['V', 'VG', 'GF']);
  const diff = diffMenus(before, after);
  assert.equal(diff.length, 1);
  assert.match(describeDiff(diff)[0], /marks V, GF → V, VG, GF/);
});

test('Menu Care may not change marks the request did not ask about', () => {
  const before = tagMenu(MENU);
  const after = JSON.parse(JSON.stringify(before));
  after.sections[0].items[2].tags = ['GF'];
  after.sections[0].items[2].price = '$17';
  const diff = diffMenus(before, after);
  assert.ok(checkChange({ before, after, requestText: 'Burger is now $17', diff }).some((p) => /marks on Burger/.test(p)));
  assert.equal(checkChange({ before, after, requestText: 'Burger is now $17 and gluten free', diff }).filter((p) => /marks/.test(p)).length, 0);
});

test('print and TV marks take item tags too', () => {
  const { used } = markItems(tagMenu(MENU));
  assert.deepEqual(used, ['V', 'GF', 'N', 'HOT']);
});

test('the key is translated with the menu', () => {
  const html = buildDesignedMenuHtml({ businessName: 'Leaf Cafe', menu: tagMenu(MENU) });
  const row = { strings: { es: { Vegetarian: 'Vegetariano', 'Ask staff about allergies before you order.': 'Pregunte por alergias antes de pedir.' } } };
  const es = translateMenuHtml(html, { lang: 'es', chosen: ['es'], row, hostedUrl: 'https://menu-made.com/api/menu/leaf' });
  assert.match(es, /<span class="key-label">Vegetariano<\/span>/);
  assert.match(es, /Pregunte por alergias/);
});
