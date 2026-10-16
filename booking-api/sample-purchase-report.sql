-- Anonymous sample-to-purchase funnel; read-only report, last 30 days.
WITH visits AS (
  SELECT session_id, source, medium, campaign, created_at,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at, id) AS position
  FROM funnel_events
  WHERE event_type = 'SITE_VISIT' AND session_id IS NOT NULL
    AND json_extract(metadata_json, '$.instrumentation') = 'mm_funnel_v1'
    AND COALESCE(json_extract(metadata_json, '$.is_test'), 0) = 0
    AND source <> 'internal-test'
), cohort AS (
  SELECT * FROM visits
  WHERE position = 1 AND datetime(created_at) >= datetime('now', '-30 days')
), actions AS (
  SELECT session_id,
    MAX(json_extract(metadata_json, '$.stage') = 'sample_menu_view') AS sample,
    MAX(json_extract(metadata_json, '$.stage') = 'start_clicked') AS started,
    MAX(json_extract(metadata_json, '$.stage') = 'checkout_attempt') AS attempted,
    MAX(json_extract(metadata_json, '$.stage') = 'checkout_error') AS checkout_error
  FROM funnel_events
  WHERE event_type = 'CTA_CLICK'
    AND json_extract(metadata_json, '$.instrumentation') = 'mm_funnel_v1'
    AND COALESCE(json_extract(metadata_json, '$.is_test'), 0) = 0
  GROUP BY session_id
), live_orders AS (
  SELECT DISTINCT f.session_id, f.order_id
  FROM funnel_events f JOIN orders o ON o.id = f.order_id
  WHERE f.event_type = 'CHECKOUT_STARTED'
    AND json_extract(f.metadata_json, '$.environment') = 'live'
    AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id
      AND json_extract(oi.metadata_json, '$.environment') = 'live')
), outcomes AS (
  SELECT l.session_id, COUNT(DISTINCT l.order_id) AS checkout_orders,
    COUNT(DISTINCT CASE WHEN o.payment_status = 'PAID' THEN l.order_id END) AS paid_orders
  FROM live_orders l JOIN orders o ON o.id = l.order_id
  GROUP BY l.session_id
)
SELECT c.source, c.medium, COALESCE(c.campaign, '(none)') AS campaign,
  COUNT(*) AS tracked_sessions,
  SUM(COALESCE(a.sample, 0)) AS sample_view_sessions,
  SUM(COALESCE(a.started, 0)) AS start_click_sessions,
  SUM(COALESCE(a.attempted, 0)) AS checkout_attempt_sessions,
  SUM(COALESCE(a.checkout_error, 0)) AS checkout_error_sessions,
  SUM(COALESCE(o.checkout_orders, 0) > 0) AS checkout_created_sessions,
  SUM(COALESCE(o.paid_orders, 0) > 0) AS paid_sessions,
  SUM(COALESCE(o.paid_orders, 0)) AS paid_orders
FROM cohort c
LEFT JOIN actions a ON a.session_id = c.session_id
LEFT JOIN outcomes o ON o.session_id = c.session_id
GROUP BY c.source, c.medium, c.campaign
ORDER BY tracked_sessions DESC, c.source;
