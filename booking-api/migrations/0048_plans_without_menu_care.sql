-- Nov 8, 2026 (owner): Menu Care is no longer part of Starter, Growth or Pro; it is an add-on bought with Online Menu + QR
-- or added to any plan as "Your own plan". Every bundle version drops MENU_CARE from scope_json (no live bundle
-- subscriptions exist; all bundle rows are CANCELLED test ones). Pro drops from $299 to $279 a month ($2,790 a year) so
-- it stays below the same services as Your own plan ($292). New Pro versions 3 (month) and 4 (year) on the new live
-- Stripe prices; versions 1 and 2 end today but stay ACTIVE so old prices still map back to Pro. Safe to apply twice.
UPDATE offer_versions SET scope_json = '{"kind":"BUNDLE","plan":"BUNDLE_STARTER","includes":["REVIEW_REPLIES","ACCESSIBILITY_MONITORING"]}'
  WHERE offer_id = 'offer_bundle_starter';
UPDATE offer_versions SET scope_json = '{"kind":"BUNDLE","plan":"BUNDLE_GROWTH","includes":["REVIEW_REPLIES","ACCESSIBILITY_MONITORING","GOOGLE_PROFILE_CARE"]}'
  WHERE offer_id = 'offer_bundle_growth';
UPDATE offer_versions SET scope_json = '{"kind":"BUNDLE","plan":"BUNDLE_PRO","includes":["REVIEW_REPLIES","ACCESSIBILITY_MONITORING","GOOGLE_PROFILE_CARE","SOCIAL_POSTS","WEBSITE_CARE"]}'
  WHERE offer_id = 'offer_bundle_pro';
UPDATE offer_versions SET effective_to = '2026-11-08T09:00:00.000Z' WHERE id IN ('offerv1_bundle_pro', 'offerv2_bundle_pro') AND effective_to IS NULL;
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  SELECT 'offerv3_bundle_pro', offer_id, 3, '2026-11-08T09:00:00.000Z', '2026-11-08T09:00:00.000Z', 'ACTIVE', 27900, 'USD', 'MONTH', scope_json, 'price_1UZS5EHw7f6jhUv8ugqPaNA2', 'prod_VVKbx3bkMst6Cz'
  FROM offer_versions WHERE id = 'offerv1_bundle_pro';
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  SELECT 'offerv4_bundle_pro', offer_id, 4, '2026-11-08T09:00:00.000Z', '2026-11-08T09:00:00.000Z', 'ACTIVE', 279000, 'USD', 'YEAR', scope_json, 'price_1UZS5GHw7f6jhUv8g3LN6Vex', 'prod_VVKbx3bkMst6Cz'
  FROM offer_versions WHERE id = 'offerv2_bundle_pro';
