-- Stage 11 catalog task: Website Care is renamed Website & App Care (website tier). Prices, codes and
-- workflows are unchanged (WEBSITE_CARE, $49/mo, $490/yr); the app tier is STORE_APP_CARE.
UPDATE offers SET name = 'Website & App Care (website tier)', description = 'Website & App Care monthly plan (website tier)', updated_at = '2026-10-30T15:30:00.000Z' WHERE code = 'WEBSITE_CARE';
UPDATE offers SET description = 'Pro Plan: Menu Care, Review Replies, Accessibility Monitoring, Google Profile Care, Social Posts, Website & App Care (website tier)', updated_at = '2026-10-30T15:30:00.000Z' WHERE code = 'BUNDLE_PRO';
