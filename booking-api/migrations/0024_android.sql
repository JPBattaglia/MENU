-- Stage 11 part 2: Android for the Store App (push through Firebase, signed builds for Google Play).
-- Apply to menu-made-db before pushing the code that uses it. Safe to apply twice.

-- One row per push_messages row that has Android phones to reach. The worker sends these itself from the 5-minute
-- schedule (Firebase Cloud Messaging is plain HTTPS, unlike Apple), keeping its place in `cursor` (device id).
-- FAILED = Google refused the Firebase key (owner alerted once). Android phones live in native_push_devices (0023).
CREATE TABLE IF NOT EXISTS android_push_jobs (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  app_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
  cursor TEXT NOT NULL DEFAULT '',
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  gone_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  alerted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_android_push_jobs_pending ON android_push_jobs (created_at) WHERE status IN ('QUEUED', 'SENDING');

-- The Android upload key (a Java keystore) for each scope, made by the first signed build and kept here so every later
-- build signs with the same key. sealed = JSON { jks (base64), password }, AES-GCM sealed like store_credentials.
-- Google Play App Signing holds the real app signing key, so a lost upload key can be reset in Play Console.
CREATE TABLE IF NOT EXISTS android_upload_keys (
  scope TEXT PRIMARY KEY,
  sealed TEXT NOT NULL,
  created_at TEXT NOT NULL
);
