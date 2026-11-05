-- Free Website Package previews (owner, Nov 5, 2026): a buyer (or a prospect email, or JP in rep mode) sees their own
-- business as a phone-friendly website before paying. Pages live in R2 under website-previews/<token>/<file>.
-- source: public | rep | prospect. Prospect previews are also tracked in prospect_demos (kind 'website') for follow-ups.
CREATE TABLE IF NOT EXISTS website_previews (
  token TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  prospect_id TEXT,
  request_id TEXT,
  email TEXT,
  business TEXT NOT NULL,
  ip_hash TEXT,
  campaign TEXT,
  status TEXT NOT NULL,              -- BUILDING | READY | FAILED
  error TEXT,
  facts_json TEXT,                   -- what the site was built from (prefills the intake after purchase)
  page_count INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  open_count INTEGER NOT NULL DEFAULT 0,
  first_opened_at TEXT
);
CREATE INDEX IF NOT EXISTS website_previews_email ON website_previews (email, created_at DESC);
CREATE INDEX IF NOT EXISTS website_previews_created ON website_previews (created_at);
ALTER TABLE prospect_demos ADD COLUMN kind TEXT NOT NULL DEFAULT 'menu';
