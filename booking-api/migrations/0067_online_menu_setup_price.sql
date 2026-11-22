-- Online Menu + QR setup is $149 since Nov 19, 2026 (0065_plus_pro_max.sql), but the line still pointed at the old
-- $129 live Stripe price, so MONEY_PATHS failed ("Stripe charges 12900, the catalog says 14900"). Checkout was never
-- affected: the menu line is sent with price_data at MENU_PACKAGE_PRICING.setupCents. Nov 22, 2026: new live price
-- price_1UecyPHw7f6jhUv82srJTeI9 ($149, one-time, tax exclusive) made the product's default; the $129 price archived.
-- Safe to apply twice.
UPDATE offer_versions SET stripe_price_id = 'price_1UecyPHw7f6jhUv82srJTeI9'
  WHERE id = 'offerv1_online_menu_qr' AND stripe_price_id = 'price_1T6OzbHw7f6jhUv8Epy5oYMf';
