-- Stage 5, Google Profile Care: what each weekly run publishes on the customer's Google profile besides review replies
-- (those stay in review_replies). kind POST = the weekly Google post (content = the post text, asset_id = its photo if
-- any); PHOTO = a library photo added to the profile (ref = asset id); REPORT = the monthly performance report
-- (deliverable on the project). status: DRAFTED -> PUBLISHED (on Google, google_name set), PROBED (self-test only: the
-- real call reached Google and was refused for the synthetic location), SKIPPED, FAILED (error says why).
CREATE TABLE IF NOT EXISTS profile_care_items (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('POST', 'PHOTO', 'REPORT')),
  ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFTED', 'PUBLISHED', 'PROBED', 'SKIPPED', 'FAILED')),
  content TEXT,
  asset_id TEXT,
  google_name TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_profile_care_items_subscription ON profile_care_items (subscription_id, kind);

-- Same routing as Review Replies: publishing is automatic, 1-3 star review replies carry their own owner flag, and one
-- automatic redraft of those replies when the owner requests changes.
UPDATE workflow_definitions
SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"auto","regenerate_from":"PRODUCE"}]',
    updated_at = '2026-10-28T00:00:00.000Z'
WHERE workflow_key = 'GOOGLE_PROFILE_CARE_V1' AND version = 1;
