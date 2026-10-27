-- Stage 6, Menu Care: customers send menu changes through a signed link; each request becomes its own production run.
-- Additive only. The workflow definition gains an owner approval on DELIVER and one automatic regeneration from PRODUCE.
CREATE TABLE IF NOT EXISTS menu_change_requests (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  project_id TEXT,
  request_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'FORM',
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_menu_change_requests_subscription ON menu_change_requests (subscription_id, created_at);
UPDATE workflow_definitions
  SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]'
  WHERE workflow_key = 'MENU_CARE_V1' AND version = 1;
