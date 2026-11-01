// Newsletter copy for the Nino shop (NinoWrite entrypoint). Mocked Anthropic API, real SQLite schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './test-support/d1.mjs';
import { writeNinoNewsletter } from './src/nino-write.js';

const migrations = ['0003_read_cost_indexes.sql', '0004_ai_usage_index.sql']
  .map((name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8'));
function setup() { const DB = createD1(); for (const sql of migrations) DB.raw.exec(sql); return { DB, ANTHROPIC_API_KEY: 'sk-ant-test' }; }
function api(input) {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'record_output', input }], usage: { input_tokens: 300, output_tokens: 80 } }) }; } };
}
const brief = { kind: 'holiday', designs: [{ title: 'Krampus Christmas', description: 'An ornate red Krampus head.' }], products: 'shirts from $25', offer: 'a free sticker with every order', ownerNote: 'mention stickers first' };

test('writes the four fields from facts it is given, and passes the owner note through', async () => {
  const fake = api({ subject: 'The Nino holiday drop is here', heading: 'Holiday cheer with a dark side', intro: 'Three designs.\nDrawn by Nino.', cta_label: 'Shop the drop' });
  const out = await writeNinoNewsletter(setup(), brief, { fetch: fake.fetch, sleep: async () => {} });
  assert.deepEqual(out, { subject: 'The Nino holiday drop is here', heading: 'Holiday cheer with a dark side', intro: 'Three designs. Drawn by Nino.', cta_label: 'Shop the drop' });
  const prompt = fake.calls[0].messages[0].content;
  assert.match(prompt, /holiday drop/); assert.match(prompt, /Krampus Christmas/); assert.match(prompt, /mention stickers first/);
  assert.match(fake.calls[0].system, /Never invent prices/);
});

test('refuses an empty brief before calling the API', async () => {
  const fake = api({});
  await assert.rejects(writeNinoNewsletter(setup(), { designs: [] }, { fetch: fake.fetch }), /no_designs/);
  assert.equal(fake.calls.length, 0);
});
