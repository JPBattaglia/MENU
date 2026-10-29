-- Stage 9 part 2, customer accounts. A buyer's account is their customers row (one per email, created at first
-- purchase), so nothing here duplicates customer data. Sign-in is by an emailed single-use link:
--   account_sign_ins  one row per emailed link; used_at makes it single-use (expires after 20 minutes)
--   account_sessions  one row per signed-in browser; the cookie carries a signed token for the row id, and
--                     revoked_at (sign out) ends it before its 30-day expiry
CREATE TABLE IF NOT EXISTS account_sign_ins (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_sign_ins_email ON account_sign_ins (email, created_at);

CREATE TABLE IF NOT EXISTS account_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_sessions_customer ON account_sessions (customer_id);
