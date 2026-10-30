-- Stage 11 part 2: the Store App as a product. Apply to menu-made-db before pushing the code that uses it.
-- Safe to apply twice. Prices decided by the owner Oct 28-29 (Stripe products made Oct 30 in the menu-made account).
-- Not public (is_public = 0) until the stage 11 exit passes.

-- Store App Setup: $999 one time. Its PRODUCE step is the Guest App build (the native app shows the same content),
-- approved by the owner; then the store steps in store_apps below take over.
INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, sort_order, is_public, is_featured, cta_text)
  VALUES ('offer_store_app_setup', '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z', 'STORE_APP_SETUP', 'Store App Setup', 'APP', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 0, 'STORE_APP_SETUP_V1', 'store-app-setup', 'Your own app in the App Store and Google Play (one-time setup)', 33, 0, 0, 'Get Started');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv1_store_app_setup', 'offer_store_app_setup', 1, '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z', 'ACTIVE', 99900, 'USD', NULL, '{"kind":"SETUP","setup":"STORE_APP_SETUP","includes_trial":{"months":3,"plan":"STORE_APP_CARE"}}', 'price_1UWAUVHw7f6jhUv8RCyjWwVi', 'prod_VXEy8Xu5g51CHT');

-- Website & App Care, app tier: $99/mo or $990/yr, starts with a 90-day trial after the setup.
INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, sort_order, is_public, is_featured, cta_text)
  VALUES ('offer_store_app_care', '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z', 'STORE_APP_CARE', 'Website & App Care (app tier)', 'APP', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 0, 'STORE_APP_CARE_V1', 'store-app-care', 'Keeps your store app current: notifications, rewards, store upkeep and yearly rebuilds', 34, 0, 0, 'Get Started');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv1_store_app_care', 'offer_store_app_care', 1, '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z', 'ACTIVE', 9900, 'USD', 'MONTH', '{"kind":"PLAN","plan":"STORE_APP_CARE","includes":["STORE_APP_CARE"],"requires_setup":"STORE_APP_SETUP"}', 'price_1UWAUXHw7f6jhUv8hHMfHHCU', 'prod_VXEyspzuP4ZnSY');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv2_store_app_care', 'offer_store_app_care', 2, '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z', 'ACTIVE', 99000, 'USD', 'YEAR', '{"kind":"PLAN","plan":"STORE_APP_CARE","includes":["STORE_APP_CARE"],"requires_setup":"STORE_APP_SETUP"}', 'price_1UWAUfHw7f6jhUv80MHBgFgY', 'prod_VXEyspzuP4ZnSY');

INSERT OR IGNORE INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at)
  VALUES ('wd_store_app_setup_v1', 'STORE_APP_SETUP_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]', '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z');
INSERT OR IGNORE INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at)
  VALUES ('wd_store_app_care_v1', 'STORE_APP_CARE_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"auto"}]', '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z');

-- One row per Store App purchase, after its app content is approved. The 5-minute tick moves it along:
-- WAITING_APP (content not approved yet) -> WAITING_STORE_ACCESS (buyer emailed the store-account checklist; signed Done
-- link) -> WAITING_OWNER_SETUP (owner emailed the hands-on checklist; signed Done link) -> READY_TO_BUILD -> BUILDING ->
-- WAITING_SUBMIT_APPROVAL -> IN_REVIEW -> LIVE (or REJECTED, CANCELLED).
CREATE TABLE IF NOT EXISTS store_apps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  business_id TEXT,
  customer_id TEXT,
  bundle_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('WAITING_APP', 'WAITING_STORE_ACCESS', 'WAITING_OWNER_SETUP', 'READY_TO_BUILD', 'BUILDING', 'WAITING_SUBMIT_APPROVAL', 'IN_REVIEW', 'LIVE', 'REJECTED', 'CANCELLED')),
  buyer_done_at TEXT,
  owner_done_at TEXT,
  last_email_at TEXT,
  reminders INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_store_apps_open ON store_apps (status, updated_at) WHERE status IN ('WAITING_APP', 'WAITING_STORE_ACCESS', 'WAITING_OWNER_SETUP');
