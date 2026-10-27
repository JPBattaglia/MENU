-- Stage 7, Website Package: a generated small-business site is built from the buyer's intake, approved by the owner, and
-- served from R2 by slug. "Live" is simply the newest FINAL, customer-visible SITE_BUILD deliverable of the site's project.
CREATE TABLE IF NOT EXISTS website_sites (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  business_id TEXT,
  customer_id TEXT,
  style TEXT,
  custom_domain TEXT,
  domain_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_website_sites_project ON website_sites (project_id);
INSERT OR IGNORE INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at)
  VALUES ('wd_website_package_v1', 'WEBSITE_PACKAGE_V1', 1, 'ACTIVE',
    '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]',
    '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
UPDATE workflow_definitions
  SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]'
  WHERE workflow_key = 'WEBSITE_PACKAGE_V1' AND version = 1;
