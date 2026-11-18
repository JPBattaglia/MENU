-- Stage 15 task 5 (Nov 17, 2026): owner stats for live menus. Apply to menu-made-db before pushing the code.
--
-- One row per business per Pacific day: views of the live menu page, and how many of them came from the QR code
-- (QR codes made from now on open the menu with ?s=qr). Bots and link previews aren't counted.
CREATE TABLE IF NOT EXISTS menu_stats_daily (
  business_id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  qr_scans INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, day)
);

-- The weekly numbers push: a phone in the MΞNU app linked to its owner's account (confirmed from an emailed link),
-- a notification meant for one owner's phones only (the phone's link is 0063).
ALTER TABLE push_messages ADD COLUMN target_customer_id TEXT;
