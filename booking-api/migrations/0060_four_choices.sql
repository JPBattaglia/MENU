-- Four choices (owner, Nov 15, 2026: "The pricing and plans and services are a bit convoluted", then "Yes do it"):
-- Free, MΞNU Plus ($12), MΞNU Premium ($79/mo, $790/yr; owner named it "Menu Premium", 8:09 am) and Your Website ($299 + Website Care $49/mo).
-- MΞNU Premium = everything in Plus + Menu Care + Google Profile Care + Review Replies + Accessibility Monitoring
-- (Growth's services plus Plus). Live Stripe product prod_VdMY9xwhyaSX6W, prices made Nov 15, 2026.
-- Off sale (is_public 0; nothing deleted, any subscription on them keeps working and mapping): Starter, Growth, Pro,
-- Menu Care, Review Replies, Google Profile Care, Social Posts, Accessibility Monitoring, Guest App, Google
-- Visibility and your own plan. Kept: Plus, MΞNU Premium, Your Website, Website Care, Holiday Menu, Online Menu + QR
-- (made by Plus and Premium checkouts), the Mobile App as a separate add-on (owner, 8:09 am), staff merch and
-- Nino's design services. Safe to apply twice.
INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, sort_order, is_public, is_featured, short_description, cta_text)
  VALUES ('offer_bundle_premium', '2026-11-15T16:00:00.000Z', '2026-11-15T16:00:00.000Z', 'BUNDLE_PREMIUM', 'MΞNU Premium', 'CARE_PLAN', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 0, 'SUBSCRIPTION_BUNDLE', 'menu-premium',
    'Everything in MΞNU Plus, and we do the work: your menu changes, your Google profile kept current, replies to your reviews, accessibility checks of your website', 9, 1, 1,
    'Everything in Plus, and we do the work: menu changes, Google profile, review replies', 'Choose MΞNU Premium');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv1_bundle_premium', 'offer_bundle_premium', 1, '2026-11-15T16:00:00.000Z', '2026-11-15T16:00:00.000Z', 'ACTIVE', 7900, 'USD', 'MONTH',
    '{"kind":"BUNDLE","plan":"BUNDLE_PREMIUM","includes":["MENU_PLUS","MENU_CARE","GOOGLE_PROFILE_CARE","REVIEW_REPLIES","ACCESSIBILITY_MONITORING"]}', 'price_1Uc5pUHw7f6jhUv81JiD0dBZ', 'prod_VdMY9xwhyaSX6W');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv2_bundle_premium', 'offer_bundle_premium', 2, '2026-11-15T16:00:00.000Z', '2026-11-15T16:00:00.000Z', 'ACTIVE', 79000, 'USD', 'YEAR',
    '{"kind":"BUNDLE","plan":"BUNDLE_PREMIUM","includes":["MENU_PLUS","MENU_CARE","GOOGLE_PROFILE_CARE","REVIEW_REPLIES","ACCESSIBILITY_MONITORING"]}', 'price_1Uc5pWHw7f6jhUv8yyomxUS8', 'prod_VdMY9xwhyaSX6W');
UPDATE offers SET is_public = 0, updated_at = '2026-11-15T16:00:00.000Z'
  WHERE code IN ('BUNDLE_STARTER', 'BUNDLE_GROWTH', 'BUNDLE_PRO', 'MENU_CARE', 'REVIEW_REPLIES', 'GOOGLE_PROFILE_CARE', 'SOCIAL_POSTS',
                 'ACCESSIBILITY_MONITORING', 'GUEST_APP', 'GUEST_APP_SETUP', 'GOOGLE_VISIBILITY', 'CUSTOM_PLAN');
