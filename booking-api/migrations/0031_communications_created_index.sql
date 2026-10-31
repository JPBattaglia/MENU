-- Stage 12, tasks 6-7: the daily EMAIL_HEALTH check reads recent communications by time.
CREATE INDEX IF NOT EXISTS idx_communications_created_at ON communications (created_at);
