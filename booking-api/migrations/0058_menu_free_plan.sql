-- MΞNU free plan (stage 15 task 2, owner Nov 14, 2026: "Free plan, forever"). A preview that was made live for free
-- remembers its project, so a second confirm opens the same menu and the preview stays open for upgrading.
ALTER TABLE menu_previews ADD COLUMN free_project_id TEXT;
ALTER TABLE menu_previews ADD COLUMN free_claimed_at TEXT;
CREATE INDEX IF NOT EXISTS menu_previews_free ON menu_previews (free_claimed_at) WHERE free_project_id IS NOT NULL;
