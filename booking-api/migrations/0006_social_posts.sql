-- Stage 6, Social Posts: the owner approves each month's posts, and "request changes" redoes the month once from PRODUCE.
-- Additive: only the workflow definition changes.
UPDATE workflow_definitions
  SET steps_json = '[{"key":"PRODUCE","order":10},{"key":"DELIVER","order":20,"approval":"owner","regenerate_from":"PRODUCE"}]'
  WHERE workflow_key = 'SOCIAL_POSTS_V1' AND version = 1;
