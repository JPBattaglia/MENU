-- Stage 7, Website Care: customers send website changes through a signed link; each request becomes its own production run
-- and, once the owner approves it, a new SITE_BUILD that replaces the live site. A daily health check records whether
-- the live site answered and how fast, and the monthly email reports it. Additive only.
CREATE TABLE IF NOT EXISTS site_change_requests (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  site_slug TEXT NOT NULL,
  project_id TEXT,
  request_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'FORM',
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_change_requests_subscription ON site_change_requests (subscription_id, created_at);
CREATE TABLE IF NOT EXISTS site_health_checks (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status INTEGER,
  ms INTEGER,
  bytes INTEGER,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_health_slug_time ON site_health_checks (slug, checked_at);
INSERT OR IGNORE INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at)
  VALUES ('wd_website_care_v1', 'WEBSITE_CARE_V1', 1, 'ACTIVE',
    '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]',
    '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
UPDATE workflow_definitions
  SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]'
  WHERE workflow_key = 'WEBSITE_CARE_V1' AND version = 1;
