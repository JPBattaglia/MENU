-- MΞNU Plus (stage 15 task 3, owner Nov 14, 2026): "$12 a month or $120 a year: all designs, self-editing, print
-- set, Google menu sync, translations, stats. It replaces the $59 first year and Menu Care as hosting." Menu Care
-- ($29) stays as "we make the changes for you". Live Stripe product prod_VdBOOOXzWHurOM, prices made Nov 15, 2026
-- (UTC). MENU_PLUS_V1 is not a real workflow: Plus does no work each period (periods.js skips it); its entitlement (MENU_PLUS) keeps the menu online, takes the
-- badge off, and unlocks translations; the menu itself is made by the Online Menu + QR line in the same checkout,
-- whose $144 first year is free with Plus. Safe to apply twice.
INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, sort_order, is_public, is_featured, short_description, cta_text)
  VALUES ('offer_menu_plus', '2026-11-15T04:30:00.000Z', '2026-11-15T04:30:00.000Z', 'MENU_PLUS', 'MΞNU Plus', 'MENU', 'ACTIVE', 'RECURRING', 'DIGITAL', 0, 0, 'MENU_PLUS_V1', 'menu-plus',
    'MΞNU Plus: your online menu in any design, the print set, edit it yourself, translations, no badge', 20, 1, 0,
    'Your menu in any design, the print set, edits, translations, no badge', 'Get MΞNU Plus');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv1_menu_plus', 'offer_menu_plus', 1, '2026-11-15T04:30:00.000Z', '2026-11-15T04:30:00.000Z', 'ACTIVE', 1200, 'USD', 'MONTH',
    '{"kind":"PLAN","plan":"MENU_PLUS","includes":["MENU_PLUS"]}', 'price_1Ubv1wHw7f6jhUv88ldXfPwZ', 'prod_VdBOOOXzWHurOM');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv2_menu_plus', 'offer_menu_plus', 2, '2026-11-15T04:30:00.000Z', '2026-11-15T04:30:00.000Z', 'ACTIVE', 12000, 'USD', 'YEAR',
    '{"kind":"PLAN","plan":"MENU_PLUS","includes":["MENU_PLUS"]}', 'price_1Ubv1xHw7f6jhUv8xdua2159', 'prod_VdBOOOXzWHurOM');
