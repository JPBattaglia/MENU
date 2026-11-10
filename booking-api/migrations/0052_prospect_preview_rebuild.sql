-- Nov 10, 2026 (owner): previews already emailed to prospects are rebuilt in place with the current generator designs
-- (src/marketing/website-preview.js rebuildProspectSites). rebuilt_at marks a website preview as done.
-- ADD COLUMN is not safe to run twice; apply once.
ALTER TABLE website_previews ADD COLUMN rebuilt_at TEXT;
