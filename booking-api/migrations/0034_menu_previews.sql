-- Free Online Menu + QR preview for anyone (Nov 4, 2026; src/marketing/public-preview.js). The page lives in R2 under
-- menu-previews/<token>.html; this row tracks it. Previews are unlisted, noindex, watermarked, and end after 72 hours
-- or 25 opens. request_id is the stored upload (mm_booking_requests), which checkout reuses on "Make it live".
CREATE TABLE IF NOT EXISTS menu_previews (
  token TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  email TEXT NOT NULL,
  business TEXT NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  campaign TEXT,
  status TEXT NOT NULL,              -- BUILDING | READY | FAILED
  error TEXT,
  item_count INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  first_opened_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS menu_previews_email ON menu_previews (email, created_at DESC);
CREATE INDEX IF NOT EXISTS menu_previews_created ON menu_previews (created_at);
CREATE INDEX IF NOT EXISTS menu_previews_ip ON menu_previews (ip_hash, created_at);
