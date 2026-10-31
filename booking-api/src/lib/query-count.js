// Stage 12, task 8: how many D1 queries one 5-minute tick makes. Workers Free allows 50 D1 queries per invocation
// (Workers Paid 1,000), and the tick's work grows with customers, so the real number is measured in production:
// the scheduled handler runs on a counting copy of env.DB and stores the last tick's count in worker_settings
// ("tick:queries" = { at, queries, refused }). refused counts queries D1 turned down for too many in one invocation.
function countingDb(db) {
  const stats = { queries: 0, refused: 0 };
  const note = (error) => { if (/too many/i.test(String(error?.message || error))) stats.refused++; throw error; };
  const wrap = (statement) => ({
    bind: (...values) => wrap(statement.bind(...values)),
    first: (...a) => { stats.queries++; return statement.first(...a).catch(note); },
    all: (...a) => { stats.queries++; return statement.all(...a).catch(note); },
    run: (...a) => { stats.queries++; return statement.run(...a).catch(note); },
    raw: (...a) => { stats.queries++; return statement.raw(...a).catch(note); },
    _inner: statement
  });
  const counted = Object.create(db);
  counted.prepare = (sql) => wrap(db.prepare(sql));
  counted.batch = (statements) => { stats.queries += statements.length; return db.batch(statements.map((s) => s?._inner || s)).catch(note); };
  return { db: counted, stats };
}

async function saveTickCount(db, stats, at = new Date().toISOString()) {
  await db.prepare(`INSERT INTO worker_settings (key, value, updated_at) VALUES ('tick:queries', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(JSON.stringify({ at, queries: stats.queries, refused: stats.refused }), at).run();
}

export { countingDb, saveTickCount };
