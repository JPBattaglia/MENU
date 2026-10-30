-- Stage 11 part 2: native push for the Store App (iOS now; Android joins with Firebase).
-- Apply to menu-made-db before pushing the code that uses it. Safe to apply twice.
--
-- Cloudflare Workers can't send to Apple (APNs speaks HTTP/2 only), so the worker hands each notification to a
-- GitHub Actions job (.github/workflows/native-push.yml) that sends it and posts the results back.
-- Details: booking-api/src/store-app/native-push.js.

-- One row per phone that turned on notifications in a Store App. token = the APNs device token (hex).
-- GONE = Apple said the token no longer works (410, BadDeviceToken, Unregistered) or it failed 5 times running.
CREATE TABLE IF NOT EXISTS native_push_devices (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('IOS', 'ANDROID')),
  token TEXT NOT NULL UNIQUE,
  bundle_id TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production', 'sandbox')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'GONE')),
  failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_native_push_devices_app ON native_push_devices (app_id, platform, status, id);

-- One row per push_messages row that has native phones to reach (made when the message is queued).
-- QUEUED = waiting for the GitHub job; SENDING = a job claimed a batch (claim_id) and hasn't reported yet;
-- SENT = every device reached; FAILED = Apple refused the push key (owner alerted once).
CREATE TABLE IF NOT EXISTS native_push_jobs (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  app_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('IOS', 'ANDROID')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
  cursor TEXT NOT NULL DEFAULT '',
  batch_end TEXT,
  batch_full INTEGER NOT NULL DEFAULT 0,
  claim_id TEXT,
  claimed_at TEXT,
  dispatched_at TEXT,
  dispatch_status INTEGER,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  gone_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  alerted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_native_push_jobs_pending ON native_push_jobs (created_at) WHERE status IN ('QUEUED', 'SENDING');
