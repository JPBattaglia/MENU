-- Nov 9, 2026: D1 free-plan read limit hit at 12:00 UTC. The account summary (GET /api/account/me) read the whole
-- entitlements table once per plan (3.4M rows by noon UTC, ~225 rows a call) and every website_sites row once per
-- business (0.8M rows). These two indexes make both lookups read only the rows they return.
CREATE INDEX IF NOT EXISTS idx_entitlements_subscription ON entitlements (subscription_id, entitlement_type);
CREATE INDEX IF NOT EXISTS idx_website_sites_business ON website_sites (business_id, updated_at);
