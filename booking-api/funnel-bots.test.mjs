// Nov 23, 2026: the daily site check (user agent MenuMadeSiteCheck) and other automated browsers must not be counted
// as Nino or Menu-made visitors. Run: node --no-warnings --test booking-api/funnel-bots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { recordFunnelEvent } = await import('./src/checkout/funnel.js');

function fakeEnv() {
  const inserted = [];
  return {
    inserted,
    DB: { prepare: () => ({ bind: (...args) => ({ run: async () => { inserted.push(args); return { success: true }; } }) }) }
  };
}
const visit = (agent) => new Request('https://menu-made.com/api/funnel-event', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain', ...(agent ? { 'User-Agent': agent } : {}) },
  body: JSON.stringify({ event_type: 'SITE_VISIT', source: 'direct', medium: 'none', landing_path: '/', metadata: { site: 'ninobattaglia.com' } })
});

test('automated browsers are answered ok but not counted', async () => {
  for (const agent of [
    'Mozilla/5.0 (Macintosh) MenuMadeSiteCheck/1.0 Chrome/130',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) MenuMadeSiteCheck/1.0 Mobile Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)',
    ''
  ]) {
    const env = fakeEnv();
    const res = await recordFunnelEvent(visit(agent), env);
    const body = await res.json();
    assert.equal(body.ok, true, agent);
    assert.equal(body.ignored, 'automated', agent);
    assert.equal(env.inserted.length, 0, agent);
  }
});

test('real phones and computers are still counted', async () => {
  for (const agent of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.38.109]'
  ]) {
    const env = fakeEnv();
    const body = await (await recordFunnelEvent(visit(agent), env)).json();
    assert.equal(body.ok, true, agent);
    assert.equal(body.ignored, undefined, agent);
    assert.equal(env.inserted.length, 1, agent);
  }
});

test('the site check never sends visit counts', () => {
  const check = readFileSync(new URL('../tools/site-check/check.mjs', import.meta.url), 'utf8');
  assert.equal((check.match(/context\.route\(\/\\\/api\\\/\(funnel-event\|measurement\)/g) || []).length, 2);
});
