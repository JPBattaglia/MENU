// The sample business the how-to videos use: Bella Luna Cafe, an invented cafe. Nothing here is a real business.
import { buildDesignedMenuHtml } from '../../booking-api/src/producers/menu-qr/design.js';

export const SAMPLE = { business: 'Bella Luna Cafe', email: 'hello@bellaluna.example', slug: 'bella-luna-cafe-demo' };

export const SAMPLE_MENU = {
  sections: [
    { name: 'Breakfast', items: [
      { name: 'Buttermilk Pancakes', description: 'Maple syrup, whipped butter', price: '12' },
      { name: 'Avocado Toast', description: 'Sourdough, chili flakes, lemon', price: '13' },
      { name: 'Veggie Omelet', description: 'Spinach, mushroom, feta, toast', price: '14' },
      { name: 'Breakfast Burrito', description: 'Eggs, potato, cheddar, salsa', price: '13' }] },
    { name: 'Sandwiches', items: [
      { name: 'Turkey Club', description: 'Bacon, lettuce, tomato, aioli', price: '15' },
      { name: 'Caprese Panini', description: 'Mozzarella, tomato, basil pesto', price: '14' },
      { name: 'Grilled Cheese', description: 'Cheddar and gruyere on sourdough', price: '11' }] },
    { name: 'Salads', items: [
      { name: 'Harvest Salad', description: 'Greens, apple, walnuts, goat cheese', price: '13' },
      { name: 'Chicken Caesar', description: 'Romaine, parmesan, croutons', price: '15' }] },
    { name: 'Drinks', items: [
      { name: 'Latte', description: 'Oat or whole milk', price: '5' },
      { name: 'Fresh Orange Juice', description: '', price: '6' },
      { name: 'Iced Tea', description: 'Black or hibiscus', price: '4' }] }
  ],
  notes: 'Gluten-free bread available.',
  unreadable: '',
  colors: ['#2f4a3a', '#f4ecd8'],
  style: { background: 'light', font: 'serif', layout: 'single_column' }
};

export const HOLIDAY_MENU = {
  sections: [
    { name: 'Starters', items: [
      { name: 'Roasted Chestnut Soup', description: 'Cream, sage, toasted brioche', price: '11' },
      { name: 'Winter Citrus Salad', description: 'Blood orange, fennel, pomegranate', price: '12' }] },
    { name: 'Christmas Dinner', items: [
      { name: 'Herb Roast Turkey', description: 'Cranberry relish, gravy, stuffing', price: '28' },
      { name: 'Braised Short Rib', description: 'Red wine, horseradish mash', price: '32' },
      { name: 'Wild Mushroom Wellington', description: 'Puff pastry, chestnut, thyme', price: '24' }] },
    { name: 'Desserts', items: [
      { name: 'Gingerbread Pudding', description: 'Brandy caramel, vanilla cream', price: '10' },
      { name: 'Yule Log', description: 'Chocolate, espresso, meringue mushrooms', price: '11' }] },
    { name: 'Holiday Drinks', items: [
      { name: 'Mulled Wine', description: 'Orange, clove, cinnamon', price: '12' },
      { name: 'Peppermint Hot Chocolate', description: '', price: '7' }] }
  ],
  notes: 'Christmas Eve and Christmas Day, 4pm to 9pm.',
  unreadable: '',
  colors: ['#7a1f2b', '#f4ecd8'],
  style: { background: 'light', font: 'serif', layout: 'single_column' }
};

const ES = {
  Breakfast: 'Desayuno', Sandwiches: 'Sándwiches', Salads: 'Ensaladas', Drinks: 'Bebidas', Menu: 'Menú', 'Dinner Menu': 'Menú de la cena',
  'Buttermilk Pancakes': 'Panqueques de suero de leche', 'Maple syrup, whipped butter': 'Jarabe de arce, mantequilla batida',
  'Avocado Toast': 'Tostada de aguacate', 'Sourdough, chili flakes, lemon': 'Pan de masa madre, chile en hojuelas, limón',
  'Veggie Omelet': 'Omelet de verduras', 'Spinach, mushroom, feta, toast': 'Espinaca, champiñones, feta, pan tostado',
  'Breakfast Burrito': 'Burrito de desayuno', 'Eggs, potato, cheddar, salsa': 'Huevos, papa, cheddar, salsa',
  'Turkey Club': 'Club de pavo', 'Bacon, lettuce, tomato, aioli': 'Tocino, lechuga, tomate, alioli',
  'Caprese Panini': 'Panini caprese', 'Mozzarella, tomato, basil pesto': 'Mozzarella, tomate, pesto de albahaca',
  'Grilled Cheese': 'Sándwich de queso a la plancha', 'Cheddar and gruyere on sourdough': 'Cheddar y gruyère en pan de masa madre',
  'Harvest Salad': 'Ensalada de la cosecha', 'Greens, apple, walnuts, goat cheese': 'Hojas verdes, manzana, nueces, queso de cabra',
  'Chicken Caesar': 'César con pollo', 'Romaine, parmesan, croutons': 'Lechuga romana, parmesano, crutones',
  Latte: 'Latte', 'Oat or whole milk': 'Leche de avena o entera', 'Fresh Orange Juice': 'Jugo de naranja natural',
  'Iced Tea': 'Té helado', 'Black or hibiscus': 'Negro o de jamaica', 'Gluten-free bread available.': 'Pan sin gluten disponible.'
};
export const SAMPLE_TRANSLATIONS = { Spanish: ES };

// A Bella Luna Cafe account on MΞNU Plus with its menu live, so the video can show the account's menu editor and
// the languages section (paid plans only). Returns the signed-in cookie for the browser.
export async function seedPlusAccount(local) {
  const { env, emails, worker } = local;
  const sql = (q, ...a) => env.DB.raw.prepare(q).run(...a);
  const t = new Date(Date.now() - 20 * 864e5).toISOString();
  const BIZ = '5a1e0000-0000-4000-8000-0000000000b1', PROJECT = '5a1e0000-0000-4000-8000-0000000000a1';
  const hosted = `https://menu-made.com/api/menu/${SAMPLE.slug}`;
  sql(`INSERT INTO customers (id, created_at, updated_at, email, first_name) VALUES ('demo-cust', ?, ?, ?, 'Luna')`, t, t, SAMPLE.email);
  sql(`INSERT INTO businesses (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)`, BIZ, t, t, SAMPLE.business);
  sql(`INSERT INTO orders (id, created_at, updated_at, customer_id, business_id, status, subtotal_cents, total_cents, payment_status) VALUES ('demo-o1', ?, ?, 'demo-cust', ?, 'COMPLETED', 0, 0, 'PAID')`, t, t, BIZ);
  sql(`INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('demo-offer-m', ?, ?, 'MENU_QR', 'Online Menu + QR', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 'MENU_QR_V1')`, t, t);
  sql(`INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, default_workflow_key) VALUES ('demo-offer-p', ?, ?, 'MENU_PLUS', 'MΞNU Plus', 'MENU', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 'MENU_CARE_V1')`, t, t);
  const offer = (code) => env.DB.raw.prepare(`SELECT id FROM offers WHERE code = ?`).get(code).id;
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('demo-ov-m', ?, 99, ?, ?, 'ACTIVE', 0, '{}')`, offer('MENU_QR'), t, t);
  sql(`INSERT INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, scope_json) VALUES ('demo-ov-p', ?, 99, ?, ?, 'ACTIVE', 1999, '{}')`, offer('MENU_PLUS'), t, t);
  sql(`INSERT INTO order_items (id, order_id, offer_id, offer_version_id, unit_price_cents, line_total_cents) VALUES ('demo-i1', 'demo-o1', ?, 'demo-ov-m', 0, 0)`, offer('MENU_QR'));
  sql(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, status, workflow_key, workflow_version, created_at, updated_at) VALUES (?, 'demo-o1', 'demo-i1', ?, 'demo-cust', 'MENU', 'DELIVERED', 'MENU_QR_V1', 1, ?, ?)`, PROJECT, BIZ, t, t);
  sql(`INSERT INTO project_inputs (id, project_id, input_key, input_type, status, value_text, created_at, updated_at) VALUES ('demo-pi1', ?, 'qr_destination', 'URL', 'VALID', ?, ?, ?)`, PROJECT, hosted, t, t);
  const menu = { sections: SAMPLE_MENU.sections, notes: SAMPLE_MENU.notes };
  await env.ASSETS.put('demo/menu-v1.html', new TextEncoder().encode(buildDesignedMenuHtml({ businessName: SAMPLE.business, brandColors: '#2f4a3a', menu, style: null, subtitle: 'Menu' })));
  sql(`INSERT INTO assets (id, business_id, customer_id, project_id, asset_type, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum, status, uploaded_at) VALUES ('demo-a1', ?, 'demo-cust', ?, 'DELIVERABLE', 'R2', 'demo/menu-v1.html', 'menu.html', 'text/html', 10, 'x', 'VALID', ?)`, BIZ, PROJECT, t);
  sql(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, version, status, customer_visible, delivered_at, created_at) VALUES ('demo-d1', ?, 'demo-a1', 'MENU_DRAFT', 1, 'FINAL', 1, ?, ?)`, PROJECT, t, t);
  sql(`INSERT INTO subscriptions (id, customer_id, business_id, offer_id, offer_version_id, provider_subscription_id, provider_customer_id, status, billing_interval, amount_cents, started_at, created_at, updated_at) VALUES ('demo-sub1', 'demo-cust', ?, ?, 'demo-ov-p', 'sub_demo', 'cus_demo', 'ACTIVE', 'MONTH', 1200, ?, ?, ?)`, BIZ, offer('MENU_PLUS'), t, t, t);
  sql(`INSERT INTO entitlements (id, customer_id, business_id, subscription_id, entitlement_type, status, starts_at, created_at, updated_at) VALUES ('demo-ent1', 'demo-cust', ?, 'demo-sub1', 'MENU_CARE', 'ACTIVE', ?, ?, ?)`, BIZ, t, t, t);

  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (path, init) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, ctx);
  await call('/api/account/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAMPLE.email }) });
  const link = new URL('https://menu-made.com' + /https:\/\/menu-made\.com(\/api\/account\/open\/[^\s"]+)/.exec(emails.at(-1).text)[1]);
  const opened = await call(link.pathname, { method: 'POST', body: new URLSearchParams({ t: link.searchParams.get('t') }) });
  const [pair] = opened.headers.get('Set-Cookie').split(';');
  const [name, ...rest] = pair.split('=');
  return { business: BIZ, hosted, cookie: { name, value: rest.join('='), domain: 'menu-made.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' } };
}
