-- Nov 6, 2026 (owner): Growth drops from $179 to $169 a month ($1,690 a year), so it stays cheaper than building the
-- same services as "Your own plan" (Menu Care + Google Profile Care + Accessibility Monitoring = $173/mo there).
-- New versions 3 (month) and 4 (year) on the new live Stripe prices; versions 1 and 2 end today but stay ACTIVE so
-- subscriptions already on the old prices still map back to Growth by price ID. Safe to apply twice.
UPDATE offer_versions SET effective_to = '2026-11-06T21:00:00.000Z' WHERE id IN ('offerv1_bundle_growth', 'offerv2_bundle_growth') AND effective_to IS NULL;
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  SELECT 'offerv3_bundle_growth', offer_id, 3, '2026-11-06T21:00:00.000Z', '2026-11-06T21:00:00.000Z', 'ACTIVE', 16900, 'USD', 'MONTH', scope_json, 'price_1UYuSPHw7f6jhUv8FJPdUNRq', 'prod_VVKb8E54P6cyhq'
  FROM offer_versions WHERE id = 'offerv1_bundle_growth';
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  SELECT 'offerv4_bundle_growth', offer_id, 4, '2026-11-06T21:00:00.000Z', '2026-11-06T21:00:00.000Z', 'ACTIVE', 169000, 'USD', 'YEAR', scope_json, 'price_1UYuSRHw7f6jhUv8x9I0cJxe', 'prod_VVKb8E54P6cyhq'
  FROM offer_versions WHERE id = 'offerv2_bundle_growth';
