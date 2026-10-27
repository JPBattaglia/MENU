-- Stage 5: the shared AI step checks each subscription's monthly token cap with one query over its AI_USAGE rows.
-- This partial index holds only those rows, so the check never scans the rest of business_events. Additive only.
CREATE INDEX IF NOT EXISTS idx_business_events_ai_usage
  ON business_events (entity_id, created_at)
  WHERE event_type = 'AI_USAGE';
