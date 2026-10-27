// Stage 5 (Google-free part): the shared AI step and producer quality checks. Mocked Anthropic API, real SQLite schema.
// Run: node --no-warnings --test booking-api/ai-step.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';
import { AiCapError, generate, tokensUsedThisMonth } from './src/ai/generate.js';
import { checkLength, findRepeatedReviewerDetails, findUnsupportedFacts, qualityCheck } from './src/ai/quality.js';

const migrations = ['0003_read_cost_indexes.sql', '0004_ai_usage_index.sql']
  .map((name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8'));
const SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, tone: { type: 'string' } }, required: ['reply'] };
const scope = { entityType: 'SUBSCRIPTION', entityId: 'sub_1', correlationId: 'run_1' };
const NOW = new Date('2026-11-10T12:00:00Z');

function setup() {
  const DB = createD1();
  for (const sql of migrations) DB.raw.exec(sql);
  return { DB, ANTHROPIC_API_KEY: 'sk-ant-test' };
}

// A fake Anthropic API: replies come from a queue; each is { status, input, usage } or a thrown network error.
function fakeApi(queue) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    const status = next.status || 200;
    const json = status === 200
      ? { model: 'claude-sonnet-5-5', content: next.input === undefined ? [] : [{ type: 'tool_use', name: 'record_output', input: next.input }], usage: next.usage || { input_tokens: 100, output_tokens: 50 } }
      : { error: { message: `status ${status}` } };
    return { ok: status === 200, status, json: async () => json };
  };
  return { fetch, calls };
}
const deps = (api) => ({ fetch: api.fetch, sleep: async () => {}, now: NOW });
const options = { purpose: 'review_reply', prompt: 'Reply to this review', schema: SCHEMA, scope };

test('returns schema-shaped output, sends the tool schema, and logs token usage', async () => {
  const env = setup();
  const api = fakeApi([{ input: { reply: 'Thank you!' } }]);
  const result = await generate(env, options, deps(api));
  assert.deepEqual(result.output, { reply: 'Thank you!' });
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 50 });
  assert.equal(api.calls[0].body.tools[0].input_schema, undefined === 1 ? null : api.calls[0].body.tools[0].input_schema);
  assert.deepEqual(api.calls[0].body.tools[0].input_schema.required, ['reply']);
  assert.equal(api.calls[0].headers['x-api-key'], 'sk-ant-test');
  assert.equal(await tokensUsedThisMonth(env, scope, NOW), 150);
});

test('retries rate limits and server errors, then succeeds; usage is logged once', async () => {
  const env = setup();
  const api = fakeApi([{ status: 429 }, { status: 529 }, { input: { reply: 'ok' } }]);
  const result = await generate(env, options, deps(api));
  assert.equal(result.attempts, 3);
  assert.equal(api.calls.length, 3);
  const events = env.DB.raw.prepare("SELECT COUNT(*) AS n FROM business_events WHERE event_type = 'AI_USAGE'").get();
  assert.equal(Number(events.n), 1);
});

test('does not retry a client error such as a bad request', async () => {
  const env = setup();
  const api = fakeApi([{ status: 400 }, { input: { reply: 'never reached' } }]);
  await assert.rejects(generate(env, options, deps(api)), /status 400/);
  assert.equal(api.calls.length, 1);
});

test('retries a network failure, and gives up with the last error after 3 attempts', async () => {
  const env = setup();
  const api = fakeApi([new Error('connection reset'), new Error('connection reset'), new Error('connection reset')]);
  await assert.rejects(generate(env, options, deps(api)), /connection reset/);
  assert.equal(api.calls.length, 3);
});

test('a malformed answer is retried; spent tokens are still logged', async () => {
  const env = setup();
  const api = fakeApi([{ input: { tone: 'warm' } }, { input: { reply: 'fixed' } }]);
  const result = await generate(env, options, deps(api));
  assert.equal(result.output.reply, 'fixed');
  assert.equal(result.attempts, 2);
  assert.equal(await tokensUsedThisMonth(env, scope, NOW), 300);
});

test('the monthly cap blocks the call before it is made, per subscription', async () => {
  const env = setup();
  const api = fakeApi([{ input: { reply: 'a' }, usage: { input_tokens: 600, output_tokens: 400 } }, { input: { reply: 'b' } }]);
  await generate(env, { ...options, capTokens: 1000 }, deps(api));
  await assert.rejects(generate(env, { ...options, capTokens: 1000 }, deps(api)), (error) => error instanceof AiCapError && error.details.used === 1000);
  assert.equal(api.calls.length, 1, 'no API call once capped');
  // Another subscription is unaffected.
  const other = fakeApi([{ input: { reply: 'c' } }]);
  await generate(env, { ...options, scope: { ...scope, entityId: 'sub_2' }, capTokens: 1000 }, deps(other));
  assert.equal(other.calls.length, 1);
});

test('the cap resets with the calendar month', async () => {
  const env = setup();
  const api = fakeApi([{ input: { reply: 'a' }, usage: { input_tokens: 900, output_tokens: 200 } }, { input: { reply: 'b' } }]);
  await generate(env, { ...options, capTokens: 1000 }, deps(api));
  const december = { fetch: api.fetch, sleep: async () => {}, now: new Date('2026-12-01T00:00:01Z') };
  const result = await generate(env, { ...options, capTokens: 1000 }, december);
  assert.equal(result.output.reply, 'b');
});

test('the cap check reads through the AI usage index, not the whole events table', () => {
  const env = setup();
  const plan = env.DB.raw.prepare(`EXPLAIN QUERY PLAN SELECT payload_json FROM business_events
      WHERE event_type = ? AND entity_id = ? AND created_at >= ? AND created_at < ?`).all('AI_USAGE', 'sub_1', 'a', 'b');
  assert.ok(plan.some((row) => /idx_business_events_ai_usage/.test(row.detail)), JSON.stringify(plan));
});

test('requires the API key and a scope', async () => {
  await assert.rejects(generate({ DB: createD1() }, options, {}), /ANTHROPIC_API_KEY/);
  await assert.rejects(generate(setup(), { ...options, scope: {} }, {}), /scope\.entityId/);
});

// ---------- quality checks ----------

const SOURCE = 'Pizza Nina. Open daily 11am to 10pm. Call 313-555-0142. Margherita $15, Pepperoni $17.50. hello@pizzanina.com www.pizzanina.com';

test('facts that come from the buyer\'s own details pass', () => {
  const text = 'Come by any day from 11am to 10pm — our Margherita is $15 and our Pepperoni is $17.50. Call 313-555-0142 or email hello@pizzanina.com.';
  assert.deepEqual(findUnsupportedFacts(text, SOURCE), []);
});

test('invented prices, hours, phone numbers, emails and links are flagged', () => {
  const text = 'Margherita is only $12! Open until midnight, actually 9pm. Call 555-999-1234, write to boss@elsewhere.com or see www.other.com.';
  const kinds = findUnsupportedFacts(text, SOURCE).map((p) => `${p.kind}:${p.value}`);
  assert.deepEqual(kinds.sort(), ['email:boss@elsewhere.com', 'hours:9pm', 'phone:555-999-1234', 'price:$12', 'url:www.other.com'].sort());
});

test('hours match across spacing and case', () => {
  assert.deepEqual(findUnsupportedFacts('We open at 11 AM.', SOURCE), []);
  assert.equal(findUnsupportedFacts('We open at 11:30am.', SOURCE).length, 1);
});

test('length limits', () => {
  assert.equal(checkLength('ok', { min: 10 })[0].kind, 'too_short');
  assert.equal(checkLength('x'.repeat(1300))[0].kind, 'too_long');
  assert.deepEqual(checkLength('A friendly, sensible reply.', { min: 10, max: 100 }), []);
});

test('a reply must not repeat a reviewer\'s contact details', () => {
  const review = 'Terrible wait. Email me at angry.guest@mail.com or call 248-555-0199 for a refund.';
  const reply = 'We are sorry! We will write to angry.guest@mail.com and call 248 555 0199 today.';
  const kinds = findRepeatedReviewerDetails(reply, review).map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['reviewer_email', 'reviewer_phone']);
  assert.deepEqual(findRepeatedReviewerDetails('We are sorry — please contact us at hello@pizzanina.com.', review), []);
});

test('qualityCheck combines length, facts and privacy', () => {
  const good = qualityCheck('Thanks so much for visiting! Our kitchen is open 11am to 10pm.', { sourceText: SOURCE, min: 10, max: 300 });
  assert.equal(good.ok, true);
  const bad = qualityCheck('Free pizza for a year at www.freepizza.biz', { sourceText: SOURCE, min: 10, max: 300 });
  assert.equal(bad.ok, false);
  assert.equal(bad.problems[0].kind, 'url');
});
