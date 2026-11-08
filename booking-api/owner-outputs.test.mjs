// Owner "Latest outputs" page (owner, Nov 7, 2026). Run: node --no-warnings --test booking-api/owner-outputs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { runOwnerOutputsLink } = await import('./src/admin/outputs.js');

test('a requested link is emailed to the owner; the page lists the newest file per service with working links', async (t) => {
  const env = { DB: createD1(), ASSETS: createR2(), RESEND_API_KEY: 're_test', PRODUCTION_RUNNER_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@menu-made.example' };
  const call = (path) => worker.fetch(new Request(path.startsWith('http') ? path : `https://menu-made.com${path}`), env, { waitUntil() {} });
  const db = env.DB.raw;
  db.exec(`PRAGMA foreign_keys = OFF`);
  db.prepare(`INSERT INTO customers (id, email, created_at, updated_at) VALUES ('c1', 'delivered@resend.dev', 'x', 'x')`).run();
  const add = (n, wf, type, at) => {
    db.prepare(`INSERT INTO projects (id, order_id, order_item_id, business_id, customer_id, project_type, workflow_key, created_at, updated_at) VALUES (?, 'o', 'i', 'b', 'c1', 'x', ?, 'x', 'x')`).run(`p${n}`, wf);
    db.prepare(`INSERT INTO assets (id, asset_type, storage_key, mime_type, original_filename, size_bytes, uploaded_at) VALUES (?, 'DELIVERABLE', ?, 'text/plain', ?, 1, 'x')`).run(`a${n}`, `k/${n}`, `file-${n}.txt`);
    db.prepare(`INSERT INTO deliverables (id, project_id, asset_id, deliverable_type, status, created_at) VALUES (?, ?, ?, ?, 'DRAFT', ?)`).run(`00000000-0000-4000-8000-00000000000${n}`, `p${n}`, `a${n}`, type, at);
  };
  add(1, 'SOCIAL_POSTS_V1', 'SOCIAL_PACK', '2026-11-01T00:00:00Z');
  add(2, 'SOCIAL_POSTS_V1', 'SOCIAL_PACK', '2026-11-07T00:00:00Z');
  add(3, 'REVIEW_REPLIES_V1', 'REVIEW_REPLY_DRAFTS', '2026-11-07T00:00:00Z');
  await env.ASSETS.put('k/2', new TextEncoder().encode('newest pack'));

  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => { if (String(input?.url || input) === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return Response.json({ id: 'e' }); } throw new Error('unexpected'); };
  t.after(() => { globalThis.fetch = original; });

  assert.equal(await runOwnerOutputsLink(env), 0, 'nothing requested');
  db.prepare(`INSERT INTO self_tests (id, kind, status, created_at, updated_at) VALUES ('r1', 'OWNER_OUTPUTS_LINK', 'REQUESTED', 'x', 'x')`).run();
  assert.equal(await runOwnerOutputsLink(env), 1);
  assert.equal(db.prepare(`SELECT status FROM self_tests WHERE id = 'r1'`).get().status, 'PASSED');
  const link = /https:\/\/menu-made\.com\/api\/owner\/outputs\?t=[^"\s<]+/.exec(sent[0].text)[0];

  const page = await (await call(link)).text();
  assert.match(page, /Social Posts/); assert.match(page, /Review Replies/);
  assert.ok(page.includes('file-2.txt') && !page.includes('file-1.txt'), 'only the newest per service');
  const open = /file-2\.txt[\s\S]*?href="(https:\/\/menu-made\.com\/api\/delivery\/[^"]+)"/.exec(page)[1].replace(/&amp;/g, '&');
  assert.equal(await (await call(open)).text(), 'newest pack', 'the Open link serves a draft file');
  assert.equal((await call('/api/owner/outputs?t=bad.token')).status, 403);
});
