// Nov 9, 2026: CI signing filled Apple's certificate limit; only development certificates made by the API key go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRevocable } from './scripts/asc-free-cert-slot.mjs';

test('only development certificates made through the API key are revoked', () => {
  const cert = (certificateType, name) => ({ attributes: { certificateType, name } });
  assert.equal(isRevocable(cert('DEVELOPMENT', 'Apple Development: Created via API')), true);
  assert.equal(isRevocable(cert('IOS_DEVELOPMENT', 'iOS Development: Created via API')), true);
  assert.equal(isRevocable(cert('DEVELOPMENT', 'Apple Development: JP Battaglia')), false, "a person's own certificate stays");
  assert.equal(isRevocable(cert('DISTRIBUTION', 'Apple Distribution: Created via API')), false, 'distribution certificates stay');
  assert.equal(isRevocable({}), false);
});

test('the App Store Connect token is a valid ES256 JWT', async () => {
  const { generateKeyPairSync, verify } = await import('node:crypto');
  const { writeFileSync } = await import('node:fs');
  const { token } = await import('./scripts/asc-free-cert-slot.mjs');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const path = `${process.env.TMPDIR || '/tmp'}/asc-test-${process.pid}.p8`;
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const jwt = await token(path, 'KEY123', 'issuer-1');
  const [h, b, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
  assert.equal(JSON.parse(Buffer.from(b, 'base64url')).aud, 'appstoreconnect-v1');
  assert.ok(verify('sha256', Buffer.from(`${h}.${b}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});
