import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('./meta-pixel.js', import.meta.url), 'utf8');
const run = ({ id = '', gpc = false, host = 'menu-made.com', search = '' } = {}) => {
  const appended = [];
  const window = {};
  const ctx = { window, navigator: { globalPrivacyControl: gpc, doNotTrack: '0' }, location: { hostname: host, search },
    URLSearchParams, document: { createElement: () => ({}), head: { appendChild: s => appended.push(s) } } };
  vm.runInNewContext(src.replace("const PIXEL_ID = '';", `const PIXEL_ID = '${id}';`), ctx);
  return { window, appended };
};

test('meta pixel: does nothing until an ID is set, and mmMeta is always callable', () => {
  const { window, appended } = run();
  assert.equal(appended.length, 0);
  assert.equal(typeof window.mmMeta, 'function');
  assert.equal(window.fbq, undefined);
});

test('meta pixel: honours Global Privacy Control, other hosts and test sessions', () => {
  for (const opts of [{ gpc: true }, { host: 'localhost' }, { search: '?mm_measurement=test' }]) {
    const { window, appended } = run({ id: '1234567890123456', ...opts });
    assert.equal(appended.length, 0, JSON.stringify(opts));
    assert.equal(window.fbq, undefined);
  }
});

test('meta pixel: loads on menu-made.com with an ID and sends PageView', () => {
  const { window, appended } = run({ id: '1234567890123456' });
  assert.equal(appended.length, 1);
  assert.deepEqual([...window.fbq.queue.map(a => [...a])], [['init', '1234567890123456'], ['track', 'PageView']]);
});

test('every page with the Google tag also loads the Meta pixel', () => {
  for (const f of readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.html'))) {
    const html = readFileSync(new URL('./' + f, import.meta.url), 'utf8');
    if (html.includes('googletagmanager.com/gtag')) assert.ok(html.includes('/meta-pixel.js'), f);
  }
});
