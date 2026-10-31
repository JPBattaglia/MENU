// Stage 13: the alert runbook. Every owner alert in the code has a runbook entry, the entry and its one action reach the
// email, and no entry asks for a token, a refund or a paid Cloudflare plan.
// Run: node --no-warnings --test booking-api/runbook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RUNBOOK, RUNBOOK_BY_TEMPLATE, runbookEntry, withRunbook } from './src/lib/runbook.js';
import { brandedEmailHtml } from './src/lib/email.js';

const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });

test('every alert template in the code has its own runbook entry', () => {
  const missing = [];
  for (const f of files(new URL('./src', import.meta.url).pathname)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/AUTOMATION_ALERT/g)) {
      const win = src.slice(Math.max(0, m.index - 1500), m.index + 400);
      const keys = [...win.matchAll(/templateKey:\s*["`]([a-z0-9_]+)["`]/g)].map((k) => k[1]);
      if (!keys.length) continue; // the email sender itself
      const key = keys.at(-1);
      if (!RUNBOOK_BY_TEMPLATE[key]) missing.push(`${f.split('/src/')[1]}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
  for (const code of Object.values(RUNBOOK_BY_TEMPLATE)) assert.ok(RUNBOOK[code], code);
});

test('entries never ask for a token, a refund or a paid plan', () => {
  for (const [code, e] of Object.entries(RUNBOOK)) {
    assert.doesNotMatch(e.action, /\brefund\b(?! is due)|Workers Paid|upgrade|paste .*token|ADMIN_API_TOKEN/i, code);
    assert.ok(e.title && e.happened && e.action, code);
  }
});

test('the alert email carries its entry and one action, once; unknown alerts get R0', () => {
  const html = brandedEmailHtml({ eyebrow: 'AUTOMATION ALERT', heading: 'Automation stopped on an order', paragraphs: ['x'] });
  const once = withRunbook(html, 'Automation stopped.', 'automation_failure_v1');
  assert.match(once.html, /Runbook R1: An order stopped/);
  assert.match(once.html, /One action:<\/strong> Forward this email to Claude/);
  assert.match(once.text, /Runbook R1: An order stopped\n.+\nOne action: Forward this email to Claude/);
  const twice = withRunbook(once.html, once.text, 'automation_failure_v1');
  assert.equal(twice.html.split('Runbook R1').length, 2, 'added once');
  assert.equal(runbookEntry('something_new_v1').code, 'R0');
});

test('alerts sent by the worker carry a signed 7-day "Pause a service" link to the switch page', async () => {
  const { sendTransactionalEmail } = await import('./src/lib/email.js');
  const { verifyLinkToken } = await import('./src/lib/links.js');
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ id: 'em_1' }); };
  try {
    const env = { RESEND_API_KEY: 're_test', PRODUCTION_RUNNER_SECRET: 'runner-secret' };
    await sendTransactionalEmail(env, { to: 'info@menu-made.com', subject: 'Automation stopped on an order', html: '<p>x</p>', text: 'x', idempotencyKey: 'k1', purpose: 'AUTOMATION_ALERT', templateKey: 'automation_failure_v1' });
    const link = /https:\/\/menu-made\.com\/api\/switches\?t=([^\s"]+)/.exec(sent[0].text);
    assert.ok(link, sent[0].text);
    assert.ok(await verifyLinkToken(env, decodeURIComponent(link[1]), ['switches'], 'owner'), 'the switch page accepts it');
    assert.match(sent[0].html, /Pause a service/);
    await sendTransactionalEmail(env, { to: 'joe@example.com', subject: 'Your menu', html: '<p>x</p>', text: 'x', idempotencyKey: 'k2', purpose: 'ORDER_DELIVERY', templateKey: 'delivery_menu_v1' });
    assert.doesNotMatch(sent[1].text, /Pause a service|Runbook/, 'only owner alerts');
  } finally { globalThis.fetch = real; }
});
