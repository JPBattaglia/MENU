-- One reminder email about 2 days into a free website preview that hasn't become an order (owner, Nov 7, 2026).
-- See runWebsitePreviewReminders in src/marketing/website-preview.js. ADD COLUMN is not safe to run twice; apply once.
ALTER TABLE website_previews ADD COLUMN reminder_sent_at TEXT;
