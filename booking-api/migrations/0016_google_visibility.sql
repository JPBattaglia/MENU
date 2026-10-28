-- Stage 5, Google Visibility (one-time $149): the changes a Google Visibility order makes on the customer's Google profile.
-- kind: DESCRIPTION (value = the new description), PHONE, WEBSITE (value = the number or address), MENU_LINK (value = the
-- hosted menu address), LOGO and PHOTO (asset_id = the customer's own image). status: PLANNED (waiting for the owner's
-- approval) -> APPLIED (Google accepted it), PROBED (self-test only: Google validated or refused a synthetic write),
-- FAILED (error says why). A redo after "request changes" replaces the PLANNED rows.
CREATE TABLE IF NOT EXISTS visibility_fixes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('DESCRIPTION', 'PHONE', 'WEBSITE', 'MENU_LINK', 'LOGO', 'PHOTO')),
  ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'APPLIED', 'PROBED', 'FAILED')),
  value TEXT,
  asset_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_visibility_fixes_asset ON visibility_fixes (asset_id);

-- The placeholder steps (PREPARE_INPUTS, EXECUTE_WORKFLOW, ...) never had code. PRODUCE audits and plans; DELIVER waits for
-- the owner when there are changes to publish (step setting "owner"), and request changes redoes PRODUCE once.
INSERT OR IGNORE INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at)
  VALUES ('wd_google_visibility_v1', 'GOOGLE_VISIBILITY_V1', 1, 'ACTIVE',
    '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]',
    '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z');
UPDATE workflow_definitions
SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]',
    updated_at = '2026-10-28T00:00:00.000Z'
WHERE workflow_key = 'GOOGLE_VISIBILITY_V1' AND version = 1;
