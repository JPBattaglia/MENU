-- Stage 6: per-subscription settings that plans need (Accessibility Monitoring's website, Social Posts' voice and specials).
-- Additive. Accessibility Monitoring reports go straight to the customer (no owner step), as the service spec says.
CREATE TABLE IF NOT EXISTS subscription_settings (
  subscription_id TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  value_text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, setting_key)
);
UPDATE workflow_definitions
  SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"auto"}]'
  WHERE workflow_key = 'ACCESSIBILITY_MONITORING_V1' AND version = 1;
