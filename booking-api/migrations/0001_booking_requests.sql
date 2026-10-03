CREATE TABLE IF NOT EXISTS mm_booking_requests (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  owner_sent INTEGER NOT NULL DEFAULT 0,
  customer_sent INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mm_booking_ip_time ON mm_booking_requests (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS mm_booking_created ON mm_booking_requests (created_at);
