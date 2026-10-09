import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('./document-upload.js', import.meta.url), 'utf8');
function setup(fetch) {
  const window = {};
  vm.runInNewContext(source, { window, document: { querySelectorAll: () => [] }, fetch,
    crypto: webcrypto, FormData, Uint8Array });
  return window.MenuMadeDocuments;
}

test('upload uses multipart and requires a matching durable receipt', async () => {
  const payload = { requestId: 'test-request' };
  const file = new File(['menu text'], 'menu.txt');
  let succeed = true;
  const api = setup(async (url, options) => {
    assert.equal(url, '/api/inquiry');
    assert.equal(options.headers, undefined); // browser supplies the multipart boundary
    assert.deepEqual(JSON.parse(options.body.get('payload')), payload);
    assert.equal(await options.body.get('document').text(), 'menu text');
    return Response.json({ ok: true, requestId: succeed ? payload.requestId : 'wrong-request' });
  });
  await api.send(payload, file);
  succeed = false;
  await assert.rejects(api.send(payload, file), /could not be confirmed/);
});

test('ordinary inquiries retain JSON transport and backend errors do not appear successful', async () => {
  const api = setup(async (_url, options) => {
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(JSON.parse(options.body).requestId, 'request');
    return Response.json({ ok: false }, { status: 503 });
  });
  await assert.rejects(api.send({ requestId: 'request' }), /could not be saved/);
});

test('invalid files never reach the endpoint and content changes change the retry fingerprint', async () => {
  const api = setup(() => { throw new Error('should not send'); });
  await assert.rejects(api.send({}, new File(['bad'], 'menu.exe')), /Choose a PDF/);
  await assert.rejects(api.send({}, new File([], 'menu.txt')), /non-empty/);
  await assert.rejects(api.send({}, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'menu.txt')), /5 MB/);
  assert.notEqual(await api.fingerprint(new File(['one'], 'menu.txt')), await api.fingerprint(new File(['two'], 'menu.txt')));
});
