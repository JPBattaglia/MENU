-- Stage 9 part 2 (Oct 28, 2026): the daily pass reminds Online Menu + QR buyers before their first year of hosting
-- ends. It looks for approved menu pages delivered 335-365 days ago; this partial index holds only approved,
-- customer-visible menu pages, so that lookup reads a date range instead of scanning projects and deliverables.
-- Additive only. Apply once to menu-made-db before pushing the code that uses it.
CREATE INDEX IF NOT EXISTS idx_deliverables_menu_final_delivered
  ON deliverables (delivered_at, project_id)
  WHERE deliverable_type = 'MENU_DRAFT' AND status = 'FINAL' AND customer_visible = 1;
