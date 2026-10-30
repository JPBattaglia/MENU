-- Stage 11 part 2: each Store App's store listing, the owner's approval, and what Apple and Google said
-- (src/store-app/store-listing.js). Apply to menu-made-db before pushing the code that uses it. Safe to apply twice.
-- images_json = which listing pictures the build sent ({ name: { w, h, at } }; files in R2 at store-app/<id>/listing/).
-- apple_json / google_json = the last submission result and review state. One row per store app.
CREATE TABLE IF NOT EXISTS store_app_listings (
  store_app_id TEXT PRIMARY KEY,
  listing_json TEXT,
  images_json TEXT NOT NULL DEFAULT '{}',
  preview_sent_at TEXT,
  approved_at TEXT,
  submitted_at TEXT,
  submit_error TEXT,
  apple_json TEXT,
  google_json TEXT,
  last_poll_at TEXT,
  live_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- The tick reads apps waiting for listing approval or in review.
CREATE INDEX IF NOT EXISTS idx_store_apps_review ON store_apps (status, updated_at) WHERE status IN ('WAITING_SUBMIT_APPROVAL', 'IN_REVIEW');
