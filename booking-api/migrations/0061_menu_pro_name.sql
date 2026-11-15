-- Owner, Nov 15, 2026, 8:54 am: "Change it to "Pro" instead of "Premium"". The third level is shown as MΞNU Pro.
-- The offer code stays BUNDLE_PREMIUM (internal; Stripe prices and the billing page config already point at it).
UPDATE offers SET name = 'MΞNU Pro', cta_text = 'Choose MΞNU Pro', updated_at = '2026-11-15T17:00:00.000Z',
  description = 'Everything in MΞNU Plus, and we do the work: your menu changes, your Google profile kept current, replies to your reviews, accessibility checks of your website'
  WHERE code = 'BUNDLE_PREMIUM';
