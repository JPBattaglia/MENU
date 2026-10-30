-- Stage 11 part 2 known gap: a rebuild of a Store App that is already in the stores needs a higher version string
-- (Apple refuses a second release of 1.0.0). live_version = the version string that last went live in both stores;
-- the build config asks for the next patch version (null -> 1.0.0, 1.0.0 -> 1.0.1, ...).
-- Apply to menu-made-db before pushing the code that uses it. NOT safe to apply twice (SQLite has no
-- ADD COLUMN IF NOT EXISTS): a second run fails with "duplicate column name" and changes nothing.
ALTER TABLE store_app_listings ADD COLUMN live_version TEXT;
-- Apps that went live before this column existed went live as 1.0.0 (the build config always said 1.0.0).
UPDATE store_app_listings SET live_version = '1.0.0' WHERE live_at IS NOT NULL AND live_version IS NULL;
