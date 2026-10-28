-- Stage 8, Guest App: an installable web app (PWA) for a business's guests, served at <slug>.menu-made.com/app/.
-- One row per business app. data_json holds the owner's latest answers (the setup form, and later the update form);
-- what is live is the newest FINAL, customer-visible APP_BUILD deliverable whose metadata slug matches.
-- Slugs share one namespace with website_sites: a business with a website keeps its slug (site at /, app at /app/).
CREATE TABLE IF NOT EXISTS guest_apps (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  business_id TEXT,
  customer_id TEXT,
  data_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_apps_project ON guest_apps (project_id);
CREATE INDEX IF NOT EXISTS idx_guest_apps_business ON guest_apps (business_id);
-- Setup: the owner approves the app before it is live. Monthly refresh: delivered automatically.
UPDATE workflow_definitions
  SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]'
  WHERE workflow_key = 'GUEST_APP_SETUP_V1' AND version = 1;
UPDATE workflow_definitions
  SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"auto"}]'
  WHERE workflow_key = 'GUEST_APP_V1' AND version = 1;
