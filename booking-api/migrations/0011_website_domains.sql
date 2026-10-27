-- Stage 7: when a custom domain was requested, so a domain that never validates can be given up on after 14 days.
ALTER TABLE website_sites ADD COLUMN domain_requested_at TEXT;
