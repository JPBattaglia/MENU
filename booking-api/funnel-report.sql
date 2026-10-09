-- Read-only report for the existing Menu-Made D1 database.
-- Session cohort: first tracked visit within the past 30 days, excluding internal tests.
-- Counts are distinct sessions. Orders/payments are separate from browser click signals.
WITH visits AS (
  SELECT session_id, source, medium, campaign, created_at,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at, id) AS position
  FROM funnel_events
  WHERE event_type = 'SITE_VISIT'
    AND session_id IS NOT NULL
    AND json_extract(metadata_json, '$.instrumentation') = 'mm_funnel_v1'
    AND COALESCE(json_extract(metadata_json, '$.is_test'), 0) = 0
    AND source <> 'internal-test'
), cohort AS (
  SELECT * FROM visits
  WHERE position = 1 AND datetime(created_at) >= datetime('now', '-30 days')
), actions AS (
  SELECT session_id,
    MAX(json_extract(metadata_json, '$.stage') = 'service_selected') AS selected,
    MAX(json_extract(metadata_json, '$.stage') = 'details_opened') AS details,
    MAX(json_extract(metadata_json, '$.stage') = 'checkout_attempt') AS attempted,
    MAX(json_extract(metadata_json, '$.stage') = 'checkout_error') AS checkout_error,
    MAX(json_extract(metadata_json, '$.stage') = 'inquiry_received') AS inquiry,
    MAX(json_extract(metadata_json, '$.stage') = 'booking_link_clicked') AS booking_click
  FROM funnel_events
  WHERE event_type = 'CTA_CLICK'
    AND json_extract(metadata_json, '$.instrumentation') = 'mm_funnel_v1'
    AND COALESCE(json_extract(metadata_json, '$.is_test'), 0) = 0
  GROUP BY session_id
), checkout_orders AS (
  SELECT DISTINCT f.session_id, f.order_id
  FROM funnel_events f JOIN orders o ON o.id = f.order_id
  WHERE f.event_type = 'CHECKOUT_STARTED'
    AND json_extract(f.metadata_json, '$.environment') = 'live'
    AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id
      AND json_extract(oi.metadata_json, '$.environment') = 'live')
), outcomes AS (
  SELECT co.session_id,
    COUNT(DISTINCT co.order_id) AS checkout_orders,
    COUNT(DISTINCT CASE WHEN o.payment_status = 'PAID' THEN co.order_id END) AS paid_orders,
    MAX(o.payment_status = 'PAID') AS paid,
    MAX(o.payment_status = 'PAID' AND EXISTS (
      SELECT 1 FROM business_events b
      WHERE b.event_type = 'ONBOARDING_COMPLETED' AND b.correlation_id = co.order_id
    )) AS onboarded
  FROM checkout_orders co JOIN orders o ON o.id = co.order_id
  GROUP BY co.session_id
)
SELECT c.source, c.medium, COALESCE(c.campaign, '(none)') AS campaign,
  COUNT(*) AS tracked_sessions,
  SUM(COALESCE(a.selected, 0)) AS service_selected_sessions,
  SUM(COALESCE(a.details, 0)) AS details_opened_sessions,
  SUM(COALESCE(a.attempted, 0)) AS checkout_attempt_sessions,
  SUM(COALESCE(a.checkout_error, 0)) AS checkout_error_sessions,
  SUM(COALESCE(o.checkout_orders, 0) > 0) AS checkout_created_sessions,
  SUM(COALESCE(o.paid, 0)) AS paid_sessions,
  SUM(COALESCE(o.onboarded, 0)) AS onboarding_completed_sessions,
  SUM(COALESCE(a.inquiry, 0)) AS inquiry_received_sessions,
  SUM(COALESCE(a.booking_click, 0)) AS booking_link_click_sessions,
  SUM(COALESCE(o.checkout_orders, 0)) AS checkout_orders,
  SUM(COALESCE(o.paid_orders, 0)) AS paid_orders
FROM cohort c
LEFT JOIN actions a ON a.session_id = c.session_id
LEFT JOIN outcomes o ON o.session_id = c.session_id
GROUP BY c.source, c.medium, c.campaign
ORDER BY tracked_sessions DESC, c.source;
