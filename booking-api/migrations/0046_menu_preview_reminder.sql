-- One reminder email about 2 days into a free menu preview that hasn't become an order (owner, Nov 7, 2026).
-- See runPreviewReminders in src/marketing/public-preview.js. ADD COLUMN is not safe to run twice; apply once.
ALTER TABLE menu_previews ADD COLUMN reminder_sent_at TEXT;
