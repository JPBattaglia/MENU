-- Menu generator (owner, Nov 7, 2026): the design the buyer chose with "Make it live" (menu-designs.js key); NULL means
-- they went to checkout without choosing, and the paid menu uses their own printed menu's look as before.
-- ADD COLUMN is not safe to run twice; apply once.
ALTER TABLE menu_previews ADD COLUMN design TEXT;
