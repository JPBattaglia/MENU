-- Stage 11 part 2: each restaurant's Store App builds, started by the worker (src/store-app/store-build.js).
-- Apply to menu-made-db before pushing the code that uses it. Safe to apply twice.

-- One row per platform result the build workflow reports. outcome FIRST_UPLOAD = Google Play didn't know the app yet,
-- so the signed file was emailed to the owner to upload by hand (Google only takes a new app's first file that way).
CREATE TABLE IF NOT EXISTS store_app_builds (
  id TEXT PRIMARY KEY,
  store_app_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  outcome TEXT NOT NULL CHECK (outcome IN ('UPLOADED', 'FIRST_UPLOAD', 'FAILED')),
  version INTEGER,
  run_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_store_app_builds_app ON store_app_builds (store_app_id, created_at);

-- The tick reads apps waiting to build or building (the 0025 partial index covers only the setup steps).
CREATE INDEX IF NOT EXISTS idx_store_apps_building ON store_apps (status, updated_at) WHERE status IN ('READY_TO_BUILD', 'BUILDING');
