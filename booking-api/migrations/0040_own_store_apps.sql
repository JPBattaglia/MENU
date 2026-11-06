-- Nov 6, 2026: the owner's own Mobile Apps (Menu-made, Nino's shirt shop) go through the Mobile App pipeline on his own
-- Apple and Google Play accounts (src/store-app/own-apps.js). own_app = 1: no buyer step, owner keys, created by the
-- tick with no charge. Apply to menu-made-db before pushing the code that uses it. NOT safe to apply twice (ADD COLUMN).
ALTER TABLE store_apps ADD COLUMN own_app INTEGER NOT NULL DEFAULT 0;
