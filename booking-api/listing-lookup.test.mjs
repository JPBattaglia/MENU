// Auto-fill from public info: the site generator's listing lookup (OpenStreetMap Nominatim).
// Run: node --no-warnings --test booking-api/listing-lookup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { lookupListing, osmHours, sameName } = await import('./src/marketing/listing-lookup.js');

test('OSM opening hours become the builder\'s lines; anything unusual gives nothing', () => {
  assert.equal(osmHours('Mo-Fr 11:00-21:00; Sa,Su 12:00-22:30'), 'Mon-Fri: 11am-9pm\nSat, Sun: 12pm-10:30pm');
  assert.equal(osmHours('Tu-Th 11:30-14:30,17:00-21:00; Mo off'), 'Tue-Thu: 11:30am-2:30pm, 5pm-9pm\nMon: Closed');
  assert.equal(osmHours('24/7'), 'Mon-Sun: Open 24 hours');
  assert.equal(osmHours('Mo-Fr 11:00-21:00; PH off'), '');
  assert.equal(osmHours(''), '');
});

test('only a listing with the same name in the same city is used', async () => {
  assert.ok(sameName('Oliva Kitchen', 'The Oliva Kitchen'));
  assert.ok(!sameName('Oliva Kitchen', 'Olive Garden'));
  const results = [
    { name: 'Oliva Kitchen', address: { house_number: '512', road: 'Columbus Ave', city: 'Oakland', state: 'CA' }, extratags: { phone: '+1 510 555 0100' } },
    { name: 'Oliva Kitchen', address: { house_number: '512', road: 'Columbus Avenue', city: 'San Francisco', state: 'California', postcode: '94133' },
      extratags: { phone: '+1 415 555 0142', opening_hours: 'Tu-Su 11:00-21:00', website: 'https://oliva.example', cuisine: 'italian;pizza' } }
  ];
  let asked;
  const fetcher = async (url, init) => { asked = { url, init }; return Response.json(results); };
  const hit = await lookupListing('Oliva Kitchen', 'San Francisco', { fetcher });
  assert.deepEqual(hit, { address: '512 Columbus Avenue, San Francisco, California 94133', phone: '+1 415 555 0142', hours: 'Tue-Sun: 11am-9pm', website: 'https://oliva.example', cuisine: 'italian' });
  assert.match(asked.url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  assert.match(asked.init.headers['User-Agent'], /MENU-MADE/);
  assert.equal(await lookupListing('Oliva Kitchen', 'Berkeley', { fetcher }), null, 'not in that city');
  assert.equal(await lookupListing('Olive Garden', 'San Francisco', { fetcher }), null, 'a different name');
  assert.equal(await lookupListing('Oliva Kitchen', '', { fetcher }), null);
});
