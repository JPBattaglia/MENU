-- Nov 6, 2026 (owner): simpler offers.
-- 1. The two care plans get their own names: Website Care ($49/mo, websites Menu-made built) and Mobile App Care
--    ($99/mo, the store app's notifications, rewards, content and yearly rebuilds). Codes and prices are unchanged.
-- 2. Conversion Fix is folded into the Website Package: its selling switch is off, so live checkout refuses it
--    (test-mode checkouts and the self-tests are untouched). The workflow stays for any order already placed.
UPDATE offers SET name = 'Website Care', description = 'Website Care monthly plan: hosting and changes for a website Menu-made built', updated_at = '2026-11-06T20:00:00.000Z' WHERE code = 'WEBSITE_CARE';
UPDATE offers SET name = 'Mobile App Care', updated_at = '2026-11-06T20:00:00.000Z' WHERE code = 'STORE_APP_CARE';
UPDATE offers SET description = 'Pro Plan: Menu Care, Review Replies, Accessibility Monitoring, Google Profile Care, Social Posts, Website Care', updated_at = '2026-11-06T20:00:00.000Z' WHERE code = 'BUNDLE_PRO';
INSERT OR REPLACE INTO worker_settings (key, value, updated_at) VALUES ('switch:sell:CONVERSION_FIX', 'off', '2026-11-06T20:00:00.000Z');
