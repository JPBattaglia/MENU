-- Stage 5, Review Replies: one row per Google review the producer has handled for a subscription.
-- review_name is Google's resource name (accounts/{a}/locations/{l}/reviews/{r}); a review is drafted at most once per
-- subscription (UNIQUE), so weekly runs never reply twice. route is AUTO (4-5 stars, checks passed: posted without the
-- owner) or OWNER (1-3 stars, no rating, or a draft that failed a quality check: waits for the owner's approval).
-- status: DRAFTED -> POSTED (reply is on Google), PROBED (self-test only: the real reply call reached Google and was
-- refused with 404 because the review is synthetic), SKIPPED (owner asked not to reply, or the business already replied
-- on Google), FAILED (Google refused the reply; error says why).
CREATE TABLE IF NOT EXISTS review_replies (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workflow_run_id TEXT,
  review_name TEXT NOT NULL,
  star_rating INTEGER NOT NULL DEFAULT 0,
  reviewer_name TEXT,
  review_text TEXT,
  review_time TEXT,
  draft_reply TEXT,
  route TEXT NOT NULL CHECK (route IN ('AUTO', 'OWNER')),
  route_reason TEXT,
  problems_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFTED', 'POSTED', 'PROBED', 'SKIPPED', 'FAILED')),
  posted_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (subscription_id, review_name)
);
CREATE INDEX IF NOT EXISTS idx_review_replies_project ON review_replies (project_id);

-- DELIVER posts the replies. Step-level "auto": 4-5 star replies need no owner; each 1-3 star reply carries its own
-- owner flag (route OWNER). One automatic redraft from PRODUCE when the owner requests changes.
UPDATE workflow_definitions
SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"auto","regenerate_from":"PRODUCE"}]',
    updated_at = '2026-10-28T00:00:00.000Z'
WHERE workflow_key = 'REVIEW_REPLIES_V1' AND version = 1;
