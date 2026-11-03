-- Marketing plan v4 (Nov 3, 2026): a private phone-menu preview built from a prospect's own published menu, linked
-- from that prospect's outreach email (src/marketing/demo-menu.js). The page itself lives in R2 under
-- prospect-demos/<token>.html; this row tracks it. Previews are unlisted, noindex, and expire.
CREATE TABLE IF NOT EXISTS prospect_demos (
  token TEXT PRIMARY KEY,            -- random, unguessable; the page address is /api/menu-preview/<token>
  prospect_id TEXT NOT NULL,
  status TEXT NOT NULL,              -- READY | FAILED
  error TEXT,
  item_count INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  first_opened_at TEXT,
  last_opened_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS prospect_demos_prospect ON prospect_demos (prospect_id, created_at DESC);
-- Day-3 follow-up drafts (one per prospect, ever).
ALTER TABLE prospects ADD COLUMN followup_drafted_at TEXT;
