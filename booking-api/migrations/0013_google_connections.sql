-- Stage 5, Google connection: one row per subscription that has connected a Google Business Profile, plus one row
-- for the owner's own profile (subscription_id 'owner'), which the daily GOOGLE_API_HEALTH self-test uses.
-- refresh_token_enc is AES-GCM encrypted with a key derived from PRODUCTION_RUNNER_SECRET (src/google/oauth.js);
-- the plain refresh token is never stored. account_name / location_name are Google resource names
-- ("accounts/123", "locations/456"). candidates_json holds the profiles found when the Google account has several,
-- until the customer picks one (status PENDING_LOCATION).
CREATE TABLE IF NOT EXISTS google_connections (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL UNIQUE,
  business_id TEXT,
  customer_id TEXT,
  status TEXT NOT NULL,
  refresh_token_enc TEXT,
  scope TEXT,
  account_name TEXT,
  location_name TEXT,
  location_title TEXT,
  candidates_json TEXT,
  last_error TEXT,
  connected_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_google_connections_status ON google_connections (status);
