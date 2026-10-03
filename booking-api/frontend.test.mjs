import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
class Element {
  constructor(value = '') { this.value = value; this.textContent = ''; this.disabled = false; this.handlers = {}; this.validity = { valid: true }; this.children = []; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  setAttribute() {}
  removeAttribute() {}
  replaceChildren() { this.children = []; }
  append(e) { this.children.push(e); }
  querySelectorAll() { return this.children; }
  querySelector() { return this.children[0]; }
  focus() {}
  reportValidity() { return true; }
}
function fixture(fetch) {
  const ids = Object.fromEntries(['bookingForm', 'bookingDate', 'bookingSession', 'bookingSlots', 'bookingSummary', 'bookingStatus', 'bookingSubmit', 'bookingTimezone', 'bookingName'].map(id => [id, new Element()]));
  ids.bookingForm.action = 'https://menu-made.com/api/booking';
  ids.bookingForm.children = [ids.bookingDate, ids.bookingSession, ids.bookingSubmit];
  ids.bookingSession.value = 'Menu + QR consultation (30 minutes)';
  const fields = { name: 'JP', email: 'jp@example.com', business: 'Cafe', notes: 'Menu', website: '' };
  class FormData { get(key) { return fields[key]; } }
  const context = { document: { getElementById: id => ids[id], createElement: () => new Element() }, Intl, Date, FormData, crypto, JSON, setTimeout, clearTimeout, AbortController, fetch, Error, TypeError };
  vm.runInNewContext(fs.readFileSync(new URL('../booking.js', import.meta.url), 'utf8'), context);
  ids.bookingDate.value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  ids.bookingDate.handlers.change();
  const submit = () => ids.bookingForm.handlers.submit({ preventDefault() {} });
  return { ids, fields, submit };
}
test('missing slot prevents network request', async () => {
  let calls = 0; const f = fixture(async () => { calls++; });
  await f.submit(); assert.equal(calls, 0); assert.match(f.ids.bookingStatus.textContent, /choose a preferred time/);
});
test('lost response preserves details and ID; receipt locks duplicate submission', async () => {
  const requests = []; let lose = true;
  const f = fixture(async (_url, options) => { const body = JSON.parse(options.body); requests.push(body); if (lose) { lose = false; throw new TypeError('Offline'); } return { ok: true, json: async () => ({ ok: true, requestId: body.requestId }) }; });
  f.ids.bookingSlots.children[0].handlers.click();
  await f.submit(); assert.equal(f.ids.bookingSubmit.disabled, false); assert.match(f.ids.bookingStatus.textContent, /Connection failed/);
  await f.submit(); assert.equal(requests[0].requestId, requests[1].requestId); assert.equal(f.ids.bookingSubmit.disabled, true); assert.match(f.ids.bookingStatus.textContent, /received/);
  await f.submit(); assert.equal(requests.length, 2);
});
test('invalid success response never displays received', async () => {
  const f = fixture(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  f.ids.bookingSlots.children[0].handlers.click(); await f.submit();
  assert.match(f.ids.bookingStatus.textContent, /could not confirm/); assert.equal(f.ids.bookingSubmit.disabled, false);
});
