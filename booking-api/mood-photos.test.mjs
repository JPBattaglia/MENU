// Mood photos (owner, Nov 6, 2026): a business that gives no photos gets free-licence photos that suit its menu,
// marked sample, replaced by its own. Run: node --no-warnings --test booking-api/mood-photos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { addMoodPhotos, moodCategories, pickMood, MOOD_LIBRARY } = await import('./src/producers/website/mood.js');
const { readme } = await import('./src/producers/site-files/files-step.js');

const CATS = ['pizza', 'wine', 'burgers', 'coffee', 'tea', 'restaurant', 'food'];
const INDEX = CATS.flatMap((cat) => [1, 2, 3].map((n) => ({ file: `${cat}-${n}.jpg`, cat, source: 'stocksnap', license: 'cc0' })));
const JPG = new Uint8Array(2000).fill(7); JPG.set([0xff, 0xd8, 0xff, 0xe0]);

function library(index = INDEX) {
  const asked = [];
  const fetcher = async (input) => {
    const url = String(input?.url || input);
    asked.push(url);
    if (url === `${MOOD_LIBRARY}index.json`) return Response.json(index);
    if (url.startsWith(MOOD_LIBRARY) && url.endsWith('.jpg')) return new Response(JPG, { headers: { 'Content-Type': 'image/jpeg' } });
    return new Response('no', { status: 404 });
  };
  return { fetcher, asked };
}

test('the menu picks the category; a weak side match (iced tea at a burger place) does not take the second photo', () => {
  const pizza = { name: "Tony's Pizza", offerings: 'Margherita pizza | $15\nPepperoni | $17\nChianti by the glass | $12\nCabernet | $14\nPinot noir | $13\nIced tea | $3' };
  assert.deepEqual(moodCategories(pizza).slice(0, 2), ['pizza', 'wine']);
  assert.deepEqual(pickMood(INDEX, pizza).map((e) => e.cat), ['pizza', 'wine', 'pizza'], 'a real wine list earns the second photo');
  const burgers = { name: 'Big Al', offerings: 'Cheeseburger | $12\nFries | $5\nMilkshake | $6\nIced tea | $3' };
  assert.deepEqual(pickMood(INDEX, burgers).map((e) => e.cat), ['burgers', 'burgers', 'burgers']);
  const plain = { name: 'Golden Gate Grill', offerings: 'Chicken plate | $14\nRice bowl | $11' };
  assert.deepEqual(pickMood(INDEX, plain).map((e) => e.cat), ['restaurant', 'restaurant', 'restaurant'], 'no match: general restaurant photos');
  assert.equal(new Set(pickMood(INDEX, burgers).map((e) => e.file)).size, 3, 'three different photos');
  assert.deepEqual(pickMood(INDEX, burgers), pickMood(INDEX, { ...burgers }), 'the same business gets the same photos');
  assert.equal(moodCategories({ name: 'Granola Bar Cafe', offerings: 'Latte | $5\nGranola bar | $4' })[0], 'coffee', '"granola bar" is not a cocktail bar');
  // Only CC0 / public domain files, with safe names.
  assert.deepEqual(pickMood([{ file: 'pizza-1.jpg', cat: 'pizza', license: 'by' }, { file: '../x.jpg', cat: 'pizza', license: 'cc0' }], pizza), []);
});

test('photos are copied beside the preview and marked sample; services and failures get none', async () => {
  const env = { ASSETS: createR2() };
  const { fetcher } = library();
  const photos = await addMoodPhotos(env, 'tok', { name: 'Big Al', kind: 'restaurant', offerings: 'Cheeseburger, fries' }, { fetcher });
  assert.deepEqual(photos.map((p) => p.path), ['img/mood-1.jpg', 'img/mood-2.jpg', 'img/mood-3.jpg']);
  assert.ok(photos.every((p) => p.sample && /^burgers-\d\.jpg$/.test(p.mood)));
  assert.ok(await env.ASSETS.get('website-previews/tok/img/mood-1.jpg'));
  assert.deepEqual(await addMoodPhotos(env, 'tok', { name: 'Fixit', kind: 'services', offerings: 'Repairs' }, { fetcher }), []);
  assert.deepEqual(await addMoodPhotos(env, 'tok', { name: 'Big Al', offerings: 'Fries' }, { fetcher: async () => { throw new Error('down'); } }), []);
  const notJpeg = async (u) => (String(u).endsWith('.json') ? Response.json(INDEX) : new Response('<html>'));
  assert.deepEqual(await addMoodPhotos(env, 'tok2', { name: 'Big Al', offerings: 'Fries' }, { fetcher: notJpeg }), [], 'a non-JPEG answer is never stored');
});

test('a preview with no photos shows sample mood photos; the buyer\'s own replace them; the zip README says what they are', async (t) => {
  const MENU = { sections: [{ name: 'Pizza', items: [{ name: 'Margherita pizza', description: 'Mozzarella and basil', price: '$15' }, { name: 'Pepperoni pizza', description: '', price: '$17' }] }], notes: '', unreadable: '' };
  const COPY = { tagline: 'Pizza with mozzarella and basil', intro: 'Sample Pizza serves Margherita and Pepperoni pizza. Call ahead or stop by.', about: ['Sample Pizza makes Margherita pizza with mozzarella and basil for guests who stop by or call ahead.'], meta_description: 'Sample Pizza: pizza, hours, address and phone number.', meta_about: 'About Sample Pizza and the pizza we make every day.' };
  const { fetcher } = library();
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url.startsWith(MOOD_LIBRARY)) return fetcher(input, init);
    if (url === 'https://api.anthropic.com/v1/messages') {
      const tool = JSON.parse(init.body).tools?.[0]?.name;
      return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: tool, input: tool === 'record_menu' ? MENU : COPY }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'em_1' });
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  const env = { DB: createD1(), ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-test', RESEND_API_KEY: 're_test' };
  const call = (path, init = {}) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, { waitUntil() {} });
  const id = crypto.randomUUID();
  await env.ASSETS.put(`private/inquiries/${id}/abc`, new Uint8Array([37, 80, 68, 70]));
  env.DB.raw.prepare(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at) VALUES (?, ?, ?, ?)`).run(id,
    JSON.stringify({ type: 'inquiry', purpose: 'checkout', email: 'owner@pizza.example', name: 'Pizza', document: { storageKey: `private/inquiries/${id}/abc`, contentType: 'application/pdf', name: 'menu.pdf', size: 4 } }), 'net-1', Math.floor(Date.now() / 1000));
  const out = await (await call('/api/website-preview/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: id, email: 'owner@pizza.example', business: 'Sample Pizza', phone: '(415) 555-0100' }) })).json();
  assert.ok(out.ok, JSON.stringify(out));
  const data = JSON.parse(await (await env.ASSETS.get(`website-previews/${out.token}/data.json`)).text());
  assert.deepEqual(data.site.photos.map((p) => [p.path, p.sample, p.mood.split('-')[0]]), [['img/mood-1.jpg', true, 'pizza'], ['img/mood-2.jpg', true, 'pizza'], ['img/mood-3.jpg', true, 'pizza']]);
  const page = await (await call(`/api/website-preview/view/${out.token}/d/trattoria/index.html`)).text();
  assert.ok(page.includes('img/mood-1.jpg'), 'the hero uses the mood photo');
  assert.ok(page.includes('Sample photos: add your own in Make it yours.'));
  assert.ok(page.includes('The photos are samples until you add yours.'));
  assert.doesNotMatch(page, /Using [^.]*photo/, 'samples are not counted as the buyer\'s photos');
  const img = await call(`/api/website-preview/view/${out.token}/d/trattoria/img/mood-1.jpg`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('Content-Type'), 'image/jpeg');
  // A logo only keeps the samples; the buyer's photos replace them.
  const post = (form) => call(`/api/website-preview/customize/${out.token}`, { method: 'POST', body: form });
  const logo = new FormData(); logo.set('design', 'bistro'); logo.set('logo', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])], 'l.png', { type: 'image/png' }));
  assert.equal((await post(logo)).status, 303);
  assert.ok(JSON.parse(await (await env.ASSETS.get(`website-previews/${out.token}/data.json`)).text()).site.photos.every((p) => p.sample));
  const mine = new FormData(); mine.set('design', 'bistro'); mine.append('photos', new File([JPG], 'a.jpg', { type: 'image/jpeg' }));
  assert.equal((await post(mine)).status, 303);
  const after = JSON.parse(await (await env.ASSETS.get(`website-previews/${out.token}/data.json`)).text());
  assert.deepEqual(after.site.photos.map((p) => [p.path, Boolean(p.sample)]), [['img/photo-1.jpg', false]]);
  const again = await (await call(`/api/website-preview/view/${out.token}/d/bistro/index.html`)).text();
  assert.doesNotMatch(again, /Sample photos/); assert.ok(again.includes('Using your logo, 1 photo'));
  // README in the zip.
  const design = { label: 'Trattoria' };
  assert.match(readme('Sample Pizza', design, false, true), /img\/mood-\*\.jpg sample photos[^]*CC0/);
  assert.doesNotMatch(readme('Sample Pizza', design, false, false), /mood/);
});

test('the library index on disk (once published) lists only CC0 / public-domain JPEGs that exist', () => {
  let index;
  try { index = JSON.parse(readFileSync(new URL('../assets/mood/index.json', import.meta.url), 'utf8')); } catch { return; }
  assert.ok(index.length >= 10);
  for (const e of index) {
    assert.ok(['cc0', 'pdm'].includes(e.license), `${e.file}: ${e.license}`);
    assert.match(e.file, /^[a-z]+-\d+\.jpg$/);
    const bytes = readFileSync(new URL(`../assets/mood/${e.file}`, import.meta.url));
    assert.ok(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.length < 600000, `${e.file} is a JPEG under 600 KB`);
  }
});
