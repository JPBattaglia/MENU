-- Stage 15 task 5 (Nov 17, 2026): a phone in the MΞNU app linked to its owner's account (confirmed from an emailed link),
-- for the weekly menu numbers push. Apply to menu-made-db with 0062 before pushing the code.
ALTER TABLE native_push_devices ADD COLUMN customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_native_push_devices_customer ON native_push_devices (customer_id) WHERE customer_id IS NOT NULL;
