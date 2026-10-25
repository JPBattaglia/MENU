// Minimal Cloudflare D1 stand-in backed by node:sqlite, for local tests only.
// Run tests with: node --no-warnings --test
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const normalize = (value) => {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: undefined is not a supported bind value');
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({
    bind(...values) { return statement(sql, values.map(normalize)); },
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
      };
    },
    async delete(key) { objects.delete(key); },
  };
}
