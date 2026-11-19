// "Get the app" buttons follow the visitor's device (owner, Nov 15, 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('./app-links.js', import.meta.url), 'utf8');
function el(tag) {
  return { tag, children: [], style: {}, attrs: {}, hidden: true, textContent: '', className: '',
    appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.unshift(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, get firstChild() { return this.children[0]; } };
}
async function run(ua, links, touch = 0) {
  const slot = el('div'), section = el('section'), foot = el('footer');
  section.querySelector = () => slot;
  const document = { createElement: el, querySelector: (q) => q === 'footer' ? foot : null, querySelectorAll: () => [section] };
  let done; const p = new Promise(r => { done = r; });
  const ctx = { document, location: { search: '' }, sessionStorage: { getItem: () => null, setItem() {} },
    navigator: { userAgent: ua, maxTouchPoints: touch },
    fetch: async () => { setTimeout(done, 0); return { ok: true, json: async () => links }; } };
  ctx.window = ctx;
  vm.runInNewContext(code, ctx);
  await p; await new Promise(r => setTimeout(r, 0));
  return { shown: !section.hidden, buttons: slot.children.map(b => `${b.tag}:${b.textContent}`) };
}
const both = { apple: 'https://apps.apple.com/app/id1', google: 'https://play.google.com/x' };
const googleOnly = { apple: null, google: 'https://play.google.com/x' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9)';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)';

test('iPhone sees only the App Store, Android only Google Play, a computer both', async () => {
  assert.deepEqual((await run(IPHONE, both)).buttons, ['a:Apple']);
  assert.deepEqual((await run(ANDROID, both)).buttons, ['a:Android']);
  assert.deepEqual((await run(MAC, both)).buttons, ['a:Apple', 'a:Android']);
  assert.deepEqual((await run(MAC, both, 5)).buttons, ['a:Apple'], 'an iPad says Macintosh but has touch');
});

test('while Apple is still reviewing, iPhones see "coming soon", never Google Play', async () => {
  assert.deepEqual((await run(IPHONE, googleOnly)).buttons, ['span:Apple: coming soon']);
  assert.deepEqual((await run(ANDROID, googleOnly)).buttons, ['a:Android']);
  assert.deepEqual((await run(MAC, googleOnly)).buttons, ['span:Apple: coming soon', 'a:Android']);
});

test('before either store has the app nothing shows', async () => {
  for (const ua of [IPHONE, ANDROID, MAC]) assert.equal((await run(ua, { apple: null, google: null })).shown, false);
});
