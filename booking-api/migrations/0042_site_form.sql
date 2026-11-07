-- Nov 6, 2026 (owner): a contact form on every generated website's Contact page. Messages are emailed to the buyer
-- (producers/site-files/site-form.js); this table only counts them for the limits (5 an hour per network, 40 a day
-- per site). Safe to apply twice.
CREATE TABLE IF NOT EXISTS site_form_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_form_messages_project ON site_form_messages (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_site_form_messages_ip ON site_form_messages (ip_hash, created_at);
