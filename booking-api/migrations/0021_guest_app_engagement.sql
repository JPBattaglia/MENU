-- Stage 11 part 1: push notifications and a loyalty program inside the Guest App (included in the Guest App plan).
-- Apply to menu-made-db before pushing the code that uses it. Safe to apply twice.

-- Small key/value store for values the worker makes itself (the Web Push VAPID key pair, sealed with a key derived
-- from PRODUCTION_RUNNER_SECRET).
CREATE TABLE IF NOT EXISTS worker_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per phone (or browser) that turned on notifications in a Guest App. GONE = the push service said the
-- subscription no longer exists (404/410) or the guest turned notifications off.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'GONE')),
  failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_app ON push_subscriptions (app_id, status, id);

-- One row per notification a restaurant sends (by its signed link, or automatically when it publishes a special).
-- The 5-minute schedule sends QUEUED/SENDING messages in batches, keeping its place in `cursor` (subscription id).
-- HELD is only used by the self-test, which sends its own message to a captured endpoint.
CREATE TABLE IF NOT EXISTS push_messages (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('MANUAL', 'SPECIAL', 'SELFTEST')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'HELD')),
  cursor TEXT NOT NULL DEFAULT '',
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  gone_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_messages_app ON push_messages (app_id, created_at);
CREATE INDEX IF NOT EXISTS idx_push_messages_pending ON push_messages (created_at) WHERE status IN ('QUEUED', 'SENDING');

-- Loyalty card holders. id = SHA-256 of the app id and the random card key kept on the guest's phone; no name, email
-- or phone number is collected.
CREATE TABLE IF NOT EXISTS loyalty_members (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  rewards_redeemed INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  failed_window TEXT,
  last_earn_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_app ON loyalty_members (app_id);

-- Every visit collected and reward used. One per card, kind and counter-code minute, so a code can't be replayed.
CREATE TABLE IF NOT EXISTS loyalty_events (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('EARN', 'REDEEM')),
  points INTEGER NOT NULL,
  code_window INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (member_id, kind, code_window)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_events_app ON loyalty_events (app_id, created_at);
