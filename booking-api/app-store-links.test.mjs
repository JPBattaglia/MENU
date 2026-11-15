// The site's "Get the app" links (owner, Nov 15, 2026): an app already on the App Store stays linked while Apple
// reviews an update, even though the newest version's state reads WAITING_FOR_REVIEW.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appStoreLinks } from './src/store-app/hybrid.js';

const envWith = (apple, google = { live: true }) => ({
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ apple_json: JSON.stringify(apple), google_json: JSON.stringify(google) }) }) }) }
});
const lookup = (found) => async (url) => {
  assert.match(String(url), /^https:\/\/itunes\.apple\.com\/lookup\?id=\d+/);
  return { ok: true, json: async () => found ? { resultCount: 1, results: [{ trackId: 6832434029 }] } : { resultCount: 0, results: [] } };
};
const waiting = { appId: '6832434029', state: 'WAITING_FOR_REVIEW', live: false };

test('an update in review keeps the App Store link when Apple lists the app', async () => {
  const links = await appStoreLinks(envWith(waiting), 'menumade', { fetchImpl: lookup(true) });
  assert.equal(links.apple, 'https://apps.apple.com/app/id6832434029');
  assert.match(links.google, /play\.google\.com/);
});

test('a first submission Apple has not published yet has no App Store link', async () => {
  const links = await appStoreLinks(envWith(waiting), 'menumade', { fetchImpl: lookup(false) });
  assert.equal(links.apple, null);
});

test('the public flag carried across a resubmission is enough, without asking Apple', async () => {
  const links = await appStoreLinks(envWith({ ...waiting, public: true }), 'menumade', { fetchImpl: async () => { throw new Error('not called'); } });
  assert.equal(links.apple, 'https://apps.apple.com/app/id6832434029');
});
