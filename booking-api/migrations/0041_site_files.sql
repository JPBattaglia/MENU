-- Nov 6, 2026 (owner): the site generator. Buyers shuffle nine designs ("Generate site"), choose one, pay $299 and get
-- the whole site as a zip; Website Care ($49/mo, existing) adds hosting and upkeep in the same checkout.
-- Live Stripe product prod_Va8OBmnYOJEyz4, price price_1UYy7lHw7f6jhUv8opUBpVFa (menu-made account).
-- is_public = 0 until it is proven end to end; then set to 1. Safe to apply twice.
INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, sort_order, is_public, is_featured, cta_text)
  VALUES ('offer_site_files', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', 'SITE_FILES', 'Your Website', 'WEBSITE', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 0, 0, 'SITE_FILES_V1', 'your-website', 'Your chosen website design with your menu and details, delivered as a zip of the complete site', 19, 0, 0, 'Choose this site');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv1_site_files', 'offer_site_files', 1, '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', 'ACTIVE', 29900, 'USD', NULL, '{"kind":"SETUP","setup":"SITE_FILES"}', 'price_1UYy7lHw7f6jhUv8opUBpVFa', 'prod_Va8OBmnYOJEyz4');
INSERT OR IGNORE INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at)
  VALUES ('wd_site_files_v1', 'SITE_FILES_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"auto"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
