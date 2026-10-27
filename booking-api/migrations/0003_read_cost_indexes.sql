-- D1 read-cost fix (Oct 27, 2026): the scheduled handler runs every 5 minutes (288 times a day) and several of its
-- queries scanned whole tables, which exhausted the free-tier daily read limit and stopped checkout, the runner,
-- self-tests and the shirt shop. These indexes are additive only (no table or row changes) and every one matches a
-- query the worker already runs, written exactly as the worker writes it.
--
--   runner step selection (workflow_steps WHERE status = 'QUEUED')      -> idx_workflow_steps_status
--   daily subscription pass check (business_events by event_type)       -> idx_business_events_type_created
--   owner digest + auto-release (approvals OWNER_RELEASE / PENDING)      -> idx_approvals_owner_pending
--   extra-pages reminders (projects with page_billing PAYMENT_REQUIRED)  -> idx_projects_payment_required
--
-- Apply once to menu-made-db before or after the worker deploy; the worker works the same with or without them.

CREATE INDEX IF NOT EXISTS idx_workflow_steps_status
  ON workflow_steps (status, workflow_run_id);

CREATE INDEX IF NOT EXISTS idx_business_events_type_created
  ON business_events (event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_approvals_owner_pending
  ON approvals (requested_at)
  WHERE approval_type = 'OWNER_RELEASE' AND status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_projects_payment_required
  ON projects (id)
  WHERE json_extract(metadata_json, '$.page_billing.status') = 'PAYMENT_REQUIRED';
