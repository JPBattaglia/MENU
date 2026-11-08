-- Domain renewal reminders (handbook NEXT, Nov 7, 2026). Domains are registered with auto-renew off, so nothing renews
-- unpaid. About 45 days before expires_at the buyer is emailed a pay link (renewal_cents = Cloudflare's cost + $5); once
-- paid, auto-renew is switched on until Cloudflare has renewed, then switched off again for the next year.
-- One renewal cycle is keyed by renewal_for (the expires_at it renews). See src/producers/website/domain-renewal.js.
-- ADD COLUMN is not safe to run twice; apply once.
ALTER TABLE domain_registrations ADD COLUMN renewal_for TEXT;
ALTER TABLE domain_registrations ADD COLUMN renewal_status TEXT;
ALTER TABLE domain_registrations ADD COLUMN renewal_emails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domain_registrations ADD COLUMN renewal_owner_alerted_at TEXT;
ALTER TABLE domain_registrations ADD COLUMN renewal_checkout_url TEXT;
ALTER TABLE domain_registrations ADD COLUMN renewal_checkout_expires_at TEXT;
ALTER TABLE domain_registrations ADD COLUMN renewal_session_id TEXT;
ALTER TABLE domain_registrations ADD COLUMN renewal_paid_at TEXT;
ALTER TABLE domain_registrations ADD COLUMN renewal_paid_cents INTEGER;
