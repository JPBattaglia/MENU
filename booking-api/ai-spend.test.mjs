// Claude API spend tracking (owner, Nov 19, 2026: the API credit ran out without warning). Run:
// node --no-warnings --test booking-api/ai-spend.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';

const { costUsd, monthKey, readAiSpend, recordAiSpend, topPurposes } = await import('./src/lib/ai-spend.js');

function setup(extra = {}) {
  const DB = createD1();
  DB.raw.exec(readFileSync(new URL('./migrations/0021_guest_app_engagement.sql', import.meta.url), 'utf8'));
  // No RESEND_API_KEY: the alert email is built and logged as not sent, which is all these tests need.
  const env = { DB, OWNER_EMAIL: 'owner@example.com', ...extra };
  return { env, DB };
}

test('prices: Sonnet $2/$10, Haiku $0.10/$0.50 per million tokens, web search 1 cent', () => {
  assert.equal(costUsd({ model: 'claude-sonnet-5-5', input_tokens: 1e6, output_tokens: 1e6 }), 12);
  assert.equal(costUsd({ model: 'claude-haiku-5-5', input_tokens: 1e6, output_tokens: 1e6 }), 0.6);
  assert.equal(costUsd({ model: 'claude-sonnet-5-5', web_searches: 3 }), 0.03);
});

test('the month key is the Pacific month', () => {
  assert.equal(monthKey(Date.parse('2026-12-01T07:00:00Z')), '2026-11');
  assert.equal(monthKey(Date.parse('2026-12-01T09:00:00Z')), '2026-12');
});

test('calls add up by purpose, and the owner is emailed once at 50% and once at 80% of the budget', async () => {
  const { env } = setup({ AI_MONTHLY_BUDGET_USD: '10' });
  const now = Date.parse('2026-11-20T18:00:00Z');
  const call = (purpose) => recordAiSpend(env, { purpose, model: 'claude-sonnet-5-5', input_tokens: 0, output_tokens: 200000 }, now); // $2 each
  await call('menu_read');
  await call('menu_read');
  const spend = await readAiSpend(env, '2026-11');
  assert.equal(spend.calls, 2);
  assert.equal(Math.round(spend.usd * 100), 400);
  assert.equal(topPurposes(spend.by), 'menu_read $4.00');
  const alerts = () => env.DB.raw.prepare(`SELECT key FROM worker_settings WHERE key LIKE 'ai_spend_alert:%' ORDER BY key`).all().map((r) => r.key);
  assert.deepEqual(alerts(), [], 'under 50%: no email');
  await call('website_copy'); // $6 = 60%
  assert.deepEqual(alerts(), ['ai_spend_alert:2026-11:50']);
  await call('website_copy'); // $8 = 80%
  await call('website_copy'); // $10
  assert.deepEqual(alerts(), ['ai_spend_alert:2026-11:50', 'ai_spend_alert:2026-11:80'], 'each step emails once');
});

test('tracking never throws and never counts a free (cached) read', async () => {
  assert.equal(await recordAiSpend({}, { purpose: 'x', model: 'claude-sonnet-5-5', input_tokens: 10 }), null, 'no database');
  const { env } = setup();
  assert.equal(await recordAiSpend(env, { purpose: 'menu_read', model: 'claude-sonnet-5-5' }), null, 'zero tokens is zero cost');
  const broken = { DB: { prepare: () => { throw new Error('boom'); } } };
  assert.equal(await recordAiSpend(broken, { purpose: 'x', model: 'claude-sonnet-5-5', input_tokens: 10 }), null);
});
