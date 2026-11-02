-- Marketing (Nov 1, 2026): food and drink businesses in San Francisco and nearby cities, found weekly from
-- OpenStreetMap by .github/workflows/prospects.yml, with what each one's website is missing (tools/prospects/find.mjs).
-- Kept here, not in the public repo, so contact details stay private. status tracks outreach so nobody is emailed
-- twice: NEW -> DRAFTED (a Gmail draft exists) -> SENT -> REPLIED / OPTED_OUT, or SKIPPED.
CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY,               -- OpenStreetMap element, e.g. node/123456
  name TEXT NOT NULL,
  kind TEXT,                         -- restaurant, cafe, bar, pub, bakery, ...
  cuisine TEXT,
  city TEXT,
  address TEXT,
  phone TEXT,
  website TEXT,
  email TEXT,
  email_source TEXT,                 -- osm, mailto, page
  gaps_json TEXT NOT NULL DEFAULT '[]',
  menu_url TEXT,
  offer_code TEXT,                   -- the one offer the email leads with
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NEW',
  notes TEXT,
  found_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  drafted_at TEXT,
  sent_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prospects_status_score ON prospects (status, score DESC);
CREATE INDEX IF NOT EXISTS prospects_email ON prospects (email);
