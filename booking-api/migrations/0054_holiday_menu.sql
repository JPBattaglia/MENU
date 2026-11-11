-- Holiday Menu (owner, Nov 10, 2026): a Christmas or New Year's Eve online menu, $59 ($30 for a second one this
-- season). Produced by the Online Menu + QR workflow (MENU_QR_V1); priced in code (src/checkout/holiday.js), so the
-- version carries no Stripe price. menu_previews.occasion marks a holiday preview (the holiday designs).
-- ADD COLUMN is not safe to run twice; apply once.
ALTER TABLE menu_previews ADD COLUMN occasion TEXT;
ALTER TABLE prospects ADD COLUMN holiday_drafted_at TEXT;
INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, sort_order, is_public, is_featured, cta_text)
  VALUES ('offer_holiday_menu', '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 'HOLIDAY_MENU', 'Holiday Menu', 'MENU', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 1, 'MENU_QR_V1', 'holiday-menu', 'A Christmas or New Year''s Eve online menu with its own link, QR code, print PDF and table tent, live through the holiday', 2, 1, 0, 'Make it live');
INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json, stripe_price_id, stripe_product_id)
  VALUES ('offerv1_holiday_menu', 'offer_holiday_menu', 1, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 'ACTIVE', 5900, 'USD', NULL, '{"kind":"HOLIDAY_MENU","pages":3,"second_cents":3000}', NULL, NULL);
