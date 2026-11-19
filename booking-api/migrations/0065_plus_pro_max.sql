-- New pricing (owner, Nov 19, 2026): "Charge set up fee of $149 then monthly at $19.99 for (plus) basic online menu,
-- TV menu and QR code, then $29 for languages, trifold, table tents. Then $79 for Pro (done for you) no FREE", then
-- "just make it plus pro max in that order", Pro "$39" (14:42), setup "waived at max", print menu with Plus,
-- holiday menus "Free with any plan".
--   MΞNU Plus  MENU_PLUS       $19.99/mo, $199.90/yr  online menu, QR code, print menu, TV menu, any design
--   MΞNU Pro   MENU_PRO        $39/mo, $390/yr        + languages, tri-fold, table tent (entitlement MENU_PRO)
--   MΞNU Max   BUNDLE_PREMIUM  $79/mo, $790/yr        + Menu Care and the done-for-you services; no setup fee
--   Online Menu + QR  $149 setup (up to 3 pages, $20 each after), no paid first year: the plan hosts the menu.
-- Live Stripe prices made Nov 19, 2026: Plus price_1Ude34Hw7f6jhUv82b3RTNVb / price_1Ude35Hw7f6jhUv8u0BDt48t on
-- prod_VdBOOOXzWHurOM; Pro product prod_VexzACspdraXFH with price_1Ude3GHw7f6jhUv8SypYBuas /
-- price_1Ude3HHw7f6jhUv8SizfXJ2g; Max keeps prod_VdMY9xwhyaSX6W (renamed) and its prices. The $12/$120 Plus prices
-- stay ACTIVE with an end date, so anything bought on them still maps to Plus. Safe to apply twice.
UPDATE offer_versions SET effective_to = '2026-11-19T22:30:00.000Z'
  WHERE id IN ('offerv1_menu_plus', 'offerv2_menu_plus') AND effective_to IS NULL;
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv3_menu_plus', 'offer_menu_plus', 3, '2026-11-19T22:30:00.000Z', '2026-11-19T22:30:00.000Z', 'ACTIVE', 1999, 'USD', 'MONTH',
    '{"kind":"PLAN","plan":"MENU_PLUS","includes":["MENU_PLUS"]}', 'price_1Ude34Hw7f6jhUv82b3RTNVb', 'prod_VdBOOOXzWHurOM');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv4_menu_plus', 'offer_menu_plus', 4, '2026-11-19T22:30:00.000Z', '2026-11-19T22:30:00.000Z', 'ACTIVE', 19990, 'USD', 'YEAR',
    '{"kind":"PLAN","plan":"MENU_PLUS","includes":["MENU_PLUS"]}', 'price_1Ude35Hw7f6jhUv8u0BDt48t', 'prod_VdBOOOXzWHurOM');
UPDATE offers SET updated_at = '2026-11-19T22:30:00.000Z', sort_order = 20,
    description = 'MΞNU Plus: your online menu in any design, with its link and QR code, the print menu and TV menu',
    short_description = 'Your menu online in any design, its QR code, the print menu and TV menu'
  WHERE code = 'MENU_PLUS';

INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, sort_order, is_public, is_featured, short_description, cta_text)
  VALUES ('offer_menu_pro', '2026-11-19T22:30:00.000Z', '2026-11-19T22:30:00.000Z', 'MENU_PRO', 'MΞNU Pro', 'MENU', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 0, 'MENU_PRO_V1', 'menu-pro',
    'MΞNU Pro: everything in Plus, your menu in other languages, a tri-fold menu and QR table tents', 21, 1, 0,
    'Everything in Plus, plus other languages, a tri-fold and QR table tents', 'Choose MΞNU Pro');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv1_menu_pro', 'offer_menu_pro', 1, '2026-11-19T22:30:00.000Z', '2026-11-19T22:30:00.000Z', 'ACTIVE', 3900, 'USD', 'MONTH',
    '{"kind":"PLAN","plan":"MENU_PRO","includes":["MENU_PLUS","MENU_PRO"]}', 'price_1Ude3GHw7f6jhUv8SypYBuas', 'prod_VexzACspdraXFH');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv2_menu_pro', 'offer_menu_pro', 2, '2026-11-19T22:30:00.000Z', '2026-11-19T22:30:00.000Z', 'ACTIVE', 39000, 'USD', 'YEAR',
    '{"kind":"PLAN","plan":"MENU_PRO","includes":["MENU_PLUS","MENU_PRO"]}', 'price_1Ude3HHw7f6jhUv8SizfXJ2g', 'prod_VexzACspdraXFH');

UPDATE offers SET name = 'MΞNU Max', cta_text = 'Choose MΞNU Max', updated_at = '2026-11-19T22:30:00.000Z',
    description = 'Everything in MΞNU Pro, no setup fee, and we do the work: your menu changes, your Google profile kept current, replies to your reviews, accessibility checks of your website',
    short_description = 'Everything in Pro, no setup fee, and we do the work: menu changes, Google profile, review replies'
  WHERE code = 'BUNDLE_PREMIUM';
UPDATE offer_versions SET scope_json = '{"kind":"BUNDLE","plan":"BUNDLE_PREMIUM","includes":["MENU_PLUS","MENU_PRO","MENU_CARE","GOOGLE_PROFILE_CARE","REVIEW_REPLIES","ACCESSIBILITY_MONITORING"]}'
  WHERE id IN ('offerv1_bundle_premium', 'offerv2_bundle_premium');

-- The menu line is the $149 setup; checkout/quote.js checks this price against MENU_PACKAGE_PRICING.setupCents.
UPDATE offer_versions SET price_cents = 14900 WHERE id = 'offerv1_online_menu_qr';
