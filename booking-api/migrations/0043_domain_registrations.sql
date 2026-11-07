-- Domains bought at checkout with a hosted website (owner, Nov 7, 2026). One row per domain; the row is the lock that
-- stops a domain from ever being paid for twice. See src/producers/website/domain-purchase.js for the statuses.
CREATE TABLE IF NOT EXISTS domain_registrations (
  domain TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  project_id TEXT,
  business_id TEXT,
  customer_id TEXT,
  slug TEXT,
  environment TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  price_cents INTEGER,
  cost_cents INTEGER,
  renewal_cents INTEGER,
  registrant TEXT,
  zone_id TEXT,
  expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_check_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_domain_registrations_status ON domain_registrations (status, next_check_at);
CREATE INDEX IF NOT EXISTS idx_domain_registrations_order ON domain_registrations (order_id);
