-- Stage 6, Conversion Fix: a one-time order is audited and written up automatically; the owner approves the report,
-- and "request changes" redoes it once from PRODUCE. Additive: only a workflow definition.
INSERT OR IGNORE INTO workflow_definitions (id, workflow_key, version, status, steps_json, created_at, updated_at)
  VALUES ('wd_conversion_fix_v1', 'CONVERSION_FIX_V1', 1, 'ACTIVE',
    '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]',
    '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
UPDATE workflow_definitions
  SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]'
  WHERE workflow_key = 'CONVERSION_FIX_V1' AND version = 1;
