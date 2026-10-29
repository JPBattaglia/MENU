-- Stage 10 (Oct 28, 2026): Nino link, staff merch, cross-sell.
-- Additive. Every new offer starts is_public = 0 (automation rule): sandbox checkout can buy them; live checkout
-- cannot until each passes its self-test, then is_public is flipped to 1.
-- Owner decisions: Nino design services sold on ninobattaglia.com (checkout through this engine, menu-made Stripe
-- account, inline prices), each result owner-approved; staff merch on menu-made.com, logo orders owner-approved.
INSERT OR IGNORE INTO offers (id, created_at, updated_at, code, name, category, status, billing_type, fulfillment_type, requires_approval, requires_assets, default_workflow_key, public_slug, description, short_description, sort_order, is_public, is_featured, cta_text) VALUES
  ('offer_nino_social_pack', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'NINO_SOCIAL_PACK', 'Social Graphics Pack', 'DESIGN', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 0, 'NINO_SOCIAL_PACK_V1', 'nino-social-pack', 'Nino Battaglia design: 9 branded social graphics (feed and story) with captions', '9 branded graphics with captions', 60, 0, 0, 'Order'),
  ('offer_nino_flyer', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'NINO_FLYER', 'Flyer', 'DESIGN', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 0, 'NINO_FLYER_V1', 'nino-flyer', 'Nino Battaglia design: print-ready letter flyer plus a square social version', 'A print-ready flyer', 61, 0, 0, 'Order'),
  ('offer_nino_menu_design', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'NINO_MENU_DESIGN', 'Menu Redesign', 'DESIGN', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 1, 'NINO_MENU_DESIGN_V1', 'nino-menu-design', 'Nino Battaglia design: your menu redesigned as print-ready pages (4 included, $25 per extra page)', 'Your menu, redesigned for print', 62, 0, 0, 'Order'),
  ('offer_nino_logo', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'NINO_LOGO', 'Logo (wordmark)', 'DESIGN', 'ACTIVE', 'ONE_TIME', 'DIGITAL', 1, 0, 'NINO_LOGO_V1', 'nino-logo', 'Nino Battaglia design: 6 typographic logo options with final files', '6 wordmark options, final files', 63, 0, 0, 'Order'),
  ('offer_staff_merch', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'STAFF_MERCH', 'Staff Merch', 'MERCH', 'ACTIVE', 'ONE_TIME', 'PHYSICAL', 0, 0, 'STAFF_MERCH_V1', 'staff-merch', 'Staff shirts with Nino Battaglia designs, optionally with your logo, printed and shipped by Printful', 'Staff shirts with Nino designs', 64, 0, 0, 'Order');

INSERT OR IGNORE INTO offer_versions (id, offer_id, version_number, created_at, effective_from, status, price_cents, currency, billing_interval, scope_json) VALUES
  ('offerv1_nino_social_pack', 'offer_nino_social_pack', 1, '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'ACTIVE', 14900, 'USD', NULL, '{"kind":"NINO_DESIGN","site":"ninobattaglia.com"}'),
  ('offerv1_nino_flyer', 'offer_nino_flyer', 1, '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'ACTIVE', 7900, 'USD', NULL, '{"kind":"NINO_DESIGN","site":"ninobattaglia.com"}'),
  ('offerv1_nino_menu_design', 'offer_nino_menu_design', 1, '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'ACTIVE', 19900, 'USD', NULL, '{"kind":"NINO_DESIGN","site":"ninobattaglia.com","included_pages":4,"extra_page_cents":2500,"max_pages":12}'),
  ('offerv1_nino_logo', 'offer_nino_logo', 1, '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'ACTIVE', 24900, 'USD', NULL, '{"kind":"NINO_DESIGN","site":"ninobattaglia.com"}'),
  ('offerv1_staff_merch', 'offer_staff_merch', 1, '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'ACTIVE', 0, 'USD', NULL, '{"kind":"STAFF_MERCH","pricing":"per_order","logo_fee_cents":500,"discounts":[{"min":12,"percent":10},{"min":24,"percent":15}]}');

INSERT OR IGNORE INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at) VALUES
  ('wd_nino_social_pack_v1', 'NINO_SOCIAL_PACK_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
  ('wd_nino_flyer_v1', 'NINO_FLYER_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
  ('wd_nino_menu_design_v1', 'NINO_MENU_DESIGN_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
  ('wd_nino_logo_v1', 'NINO_LOGO_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
  -- Staff merch: the offer is automatic; a proof with a logo tightens itself to owner approval (asset metadata).
  ('wd_staff_merch_v1', 'STAFF_MERCH_V1', 1, 'ACTIVE', '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20}]', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z');

-- Staff merch quotes: what the buyer reviewed on the merch page (Nino-verified shirts, Printful delivery rates, our
-- prices). A checkout must use an unexpired, unused quote, so the charged amount is exactly what was shown.
CREATE TABLE IF NOT EXISTS merch_quotes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('live', 'sandbox')),
  recipient_json TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  rates_json TEXT NOT NULL,
  pricing_json TEXT NOT NULL,
  logo_key TEXT,
  order_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_merch_quotes_order ON merch_quotes (order_id);
