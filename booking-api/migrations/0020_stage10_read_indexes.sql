-- Stage 10 read-cost indexes (Oct 28, 2026). The hourly design-brief reminder and staff merch tracking passes read
-- only the few projects they care about instead of scanning projects (D1 free-plan read limit).
CREATE INDEX IF NOT EXISTS idx_projects_awaiting_inputs
  ON projects (workflow_key, created_at)
  WHERE status = 'AWAITING_INPUTS';
CREATE INDEX IF NOT EXISTS idx_projects_merch_delivered
  ON projects (created_at)
  WHERE workflow_key = 'STAFF_MERCH_V1' AND status = 'DELIVERED';
