// Owner comp (Nov 21, 2026, owner: "Comp it under my account"): an owner-made preview goes live free, in any design,
// with no badge, no renewal emails and no end. Run: node --no-warnings --test booking-api/menu-comp.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, createR2 } from './test-support/d1.mjs';

const { default: worker } = await import('./src/worker.js');
const { menuHostingState, remindMenuHostingRenewals } = await import('./src/producers/menu-qr/hosting-renewal.js');

const OWNER = 'owner@menu-made.example';
const MENU = { sections: [{ name: 'Donuts', items: [{ name: 'Glazed', description: '', price: '$2' }, { name: 'Maple Bar', description: '', price: '$3' }] }], notes: '', unreadable: '', colors: [] };

function setup(t) {
  const env = { DB: createD1(), ASSETS: createR2(), ANTHROPIC_API_KEY: 'sk-ant-test', RESEND_API_KEY: 're_test', PRODUCTION_RUNNER_SECRET: 'test-runner-secret', OWNER_EMAIL: OWNER };
  for (const m of ['0007_plan_settings.sql', '0009_website_package.sql', '0017_customer_accounts.sql', '0018_menu_hosting_index.sql']) env.DB.raw.exec(readFileSync(new URL(`./migrations/${m}`, import.meta.url), 'utf8'));
  const call = (path, init = {}) => worker.fetch(new Request(`https://menu-made.com${path}`, init), env, { waitUntil() {} });
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url === 'https://api.anthropic.com/v1/messages') return Response.json({ model: 'claude-test', content: [{ type: 'tool_use', name: 'record_menu', input: MENU }], usage: { input_tokens: 1, output_tokens: 1 } });
    if (url === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return Response.json({ id: `em_${sent.length}` }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  const preview = async (email) => {
    const id = crypto.randomUUID();
    const storageKey = `private/inquiries/${id}/abc`;
    await env.ASSETS.put(storageKey, new Uint8Array([37, 80, 68, 70]));
    env.DB.raw.prepare(`INSERT INTO mm_booking_requests (id, payload, ip_hash, created_at) VALUES (?, ?, ?, ?)`).run(id,
      JSON.stringify({ type: 'inquiry', purpose: 'checkout', email, name: 'Donut', document: { storageKey, contentType: 'application/pdf', name: `menu-${id}.pdf`, size: 4 } }), `net-${id}`, Math.floor(Date.now() / 1000));
    const res = await call('/api/menu-preview/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: id, email, business: 'My Happy Donut' }) });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    return out.token;
  };
  return { env, call, sent, preview, sql: (q, ...a) => env.DB.raw.prepare(q).all(...a) };
}

test('Owner comp: the owner inbox gets the link, and the chosen design goes live free with no badge and no end', async (t) => {
  const f = setup(t);
  const token = await f.preview(OWNER);
  const start = await f.call(`/api/menu-preview/comp/${token}?design=diner`, { method: 'POST' });
  assert.equal(start.status, 200, await start.clone().text());
  const mail = f.sent.at(-1);
  assert.deepEqual([mail.to].flat(), [OWNER]);
  assert.match(mail.subject, /Comp My Happy Donut's menu \(Diner\)/);
  assert.equal(f.sql(`SELECT COUNT(*) AS n FROM projects`)[0].n, 0, 'nothing goes live before the link is pressed');

  const link = new URL(/https:\/\/menu-made\.com(\/api\/menu-comp\/confirm\/[a-f0-9]{36}\?[^\s"]+)/.exec(mail.text)[1], 'https://menu-made.com');
  assert.match(await (await f.call(link.pathname + link.search)).text(), /<form method="post">/, 'a button first, so email scanners do nothing');
  // A tampered design fails the signature.
  const bad = await f.call(link.pathname, { method: 'POST', body: new URLSearchParams({ t: link.searchParams.get('t'), d: 'modern' }) });
  assert.equal(bad.status, 410);
  const done = await f.call(link.pathname, { method: 'POST', body: new URLSearchParams({ t: link.searchParams.get('t'), d: 'diner' }) });
  assert.equal(done.status, 303);

  const [project] = f.sql(`SELECT id, business_id, metadata_json FROM projects`);
  const meta = JSON.parse(project.metadata_json);
  assert.equal(meta.comp.design, 'diner');
  assert.equal(meta.free_plan, undefined);
  assert.match(f.sent.at(-1).subject, /My Happy Donut's menu is live \(owner comp\)/);

  const url = f.sql(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = 'qr_destination'`, project.id)[0].value_text;
  const menu = await (await f.call(new URL(url).pathname)).text();
  assert.match(menu, /Maple Bar/);
  assert.doesNotMatch(menu, /mm-made-with/, 'no badge on a comp');

  const later = new Date(Date.now() + 1000 * 864e5);
  assert.deepEqual(await menuHostingState(f.env, project.business_id, later), { live: true, reason: 'comp' });
  const reminders = await remindMenuHostingRenewals(f.env, { now: new Date(Date.now() + 340 * 864e5), projectIds: [project.id] });
  assert.equal(reminders.sent, 0, 'no renewal emails');
  assert.equal(f.sql(`SELECT SUM(total_cents) AS c FROM orders`)[0].c, 0, 'nothing billed');
});

test('Only previews made with the owner address can be comped, and only in a regular design', async (t) => {
  const f = setup(t);
  const theirs = await f.preview('someone@cafe.example');
  assert.equal((await f.call(`/api/menu-preview/comp/${theirs}?design=classic`, { method: 'POST' })).status, 403);
  const mine = await f.preview(OWNER);
  assert.equal((await f.call(`/api/menu-preview/comp/${mine}?design=evergreen`, { method: 'POST' })).status, 400);
  assert.equal((await f.call(`/api/menu-preview/comp/${mine}?design=nope`, { method: 'POST' })).status, 400);
  assert.equal(f.sent.filter((m) => /Comp /.test(m.subject)).length, 0);
});
