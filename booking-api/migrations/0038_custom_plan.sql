-- Nov 6, 2026 (owner): "Your own plan". A buyer ticks the monthly services they want on the plans page and pays one
-- price for exactly those: the separate prices added up, 10% off for two services, 20% off for three or more, rounded
-- down to whole dollars (src/subscriptions/plans.js resolveCustomPlan). The services ride on the subscription's
-- metadata (includes), so the price on these versions is a placeholder: every checkout sends its own price_data under
-- the live Stripe product prod_Va4E3Gdb78NP0r (metadata plan_code = CUSTOM_PLAN).
-- is_public = 0 keeps it out of /api/catalog's offer list; checkout resolves it directly. Safe to apply twice.
INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, sort_order, is_public, is_featured, cta_text)
  VALUES ('offer_custom_plan', '2026-11-06T00:00:00.000Z', '2026-11-06T00:00:00.000Z', 'CUSTOM_PLAN', 'Your own plan', 'CARE_PLAN', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 0, 'SUBSCRIPTION_BUNDLE', 'custom-plan', 'The monthly services you picked, 10% off for two and 20% off for three or more', 13, 0, 0, 'Get Started');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv1_custom_plan', 'offer_custom_plan', 1, '2026-11-06T00:00:00.000Z', '2026-11-06T00:00:00.000Z', 'ACTIVE', 0, 'USD', 'MONTH', '{"kind":"CUSTOM","plan":"CUSTOM_PLAN"}', NULL, 'prod_Va4E3Gdb78NP0r');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv2_custom_plan', 'offer_custom_plan', 2, '2026-11-06T00:00:00.000Z', '2026-11-06T00:00:00.000Z', 'ACTIVE', 0, 'USD', 'YEAR', '{"kind":"CUSTOM","plan":"CUSTOM_PLAN"}', NULL, 'prod_Va4E3Gdb78NP0r');
