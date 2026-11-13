// Minimal Cloudflare D1 stand-in backed by node:sqlite, for local tests only.
// Run tests with: node --no-warnings --test
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const normalize = (value) => {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: undefined is not a supported bind value');
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

// Real D1 refuses a LIKE or GLOB pattern longer than 50 bytes ("LIKE or GLOB pattern too complex"); node:sqlite allows
// 50,000, so a long bound pattern passed every test and failed live (Nov 13, 2026). A bound string that starts or ends
// with % and is over 50 bytes, in a statement that uses LIKE or GLOB, is refused here the same way.
const D1_LIKE_PATTERN_LIMIT = 50;
const checkPatterns = (sql, args) => {
  if (!/\b(LIKE|GLOB)\b/i.test(sql)) return;
  for (const a of args) if (typeof a === 'string' && /^%|%$/.test(a) && Buffer.byteLength(a) > D1_LIKE_PATTERN_LIMIT)
    throw new Error('D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR');
};

export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({
    bind(...values) { const args = values.map(normalize); checkPatterns(sql, args); return statement(sql, args); },
    async first(column) {
      const row = db.prepare(sql).get(...args);
      if (!row) return null;
      const plain = { ...row };
      return column ? plain[column] : plain;
    },
    async all() { return { results: db.prepare(sql).all(...args).map(r => ({ ...r })), success: true }; },
    async run() {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) { return Promise.all(statements.map(s => s.run())); },
    raw: db,
  };
}

export function createR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, options = {}) {
      const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
      objects.set(key, { data, httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {} });
    },
    async get(key) {
      const entry = objects.get(key);
      if (!entry) return null;
      return {
        body: new Blob([entry.data]).stream(),
        httpMetadata: entry.httpMetadata,
        size: entry.data.byteLength,
        async arrayBuffer() { return entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + entry.data.byteLength); },
        async text() { return new TextDecoder().decode(entry.data); },
        async json() { return JSON.parse(new TextDecoder().decode(entry.data)); },
      };
    },
    async delete(key) { objects.delete(key); },
  };
}
