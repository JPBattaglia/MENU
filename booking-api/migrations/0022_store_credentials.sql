-- Stage 11 part 2: App Store / Google Play keys for Store App builds and native push.
-- Apply to menu-made-db before pushing the code that uses it. Safe to apply twice.
-- scope = 'owner' for Menu-made's own accounts (the test restaurant), else a business id.
-- sealed = the key file, AES-GCM sealed with a key derived from PRODUCTION_RUNNER_SECRET (src/store-app/keys.js);
-- never stored or logged in plain text. check_* = the live check run when it was saved.
CREATE TABLE IF NOT EXISTS store_credentials (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('APPLE_API_KEY', 'APPLE_PUSH_KEY', 'GOOGLE_PLAY_ACCOUNT', 'FIREBASE_ACCOUNT')),
  key_id TEXT,
  issuer_id TEXT,
  team_id TEXT,
  sealed TEXT NOT NULL,
  check_status TEXT NOT NULL CHECK (check_status IN ('VERIFIED', 'FAILED', 'UNVERIFIED')),
  check_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scope, kind)
);
