-- Read-only, anonymous service-interest report for the existing D1 database.
-- First tracked visit in the past 30 days; internal tests and sandbox orders excluded.
-- Counts are distinct sessions per service. One session can appear under multiple services.
WITH visits AS (
  SELECT session_id, source, medium, campaign, created_at,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at, id) AS position
  FROM funnel_events
  WHERE event_type = 'SITE_VISIT' AND session_id IS NOT NULL
    AND json_extract(metadata_json, '$.instrumentation') = 'mm_funnel_v1'
    AND COALESCE(json_extract(metadata_json, '$.is_test'), 0) = 0
    AND COALESCE(source, '') <> 'internal-test'
), cohort AS (
  SELECT * FROM visits
  WHERE position = 1 AND datetime(created_at) >= datetime('now', '-30 days')
), actions AS (
  SELECT session_id, json_extract(metadata_json, '$.service') AS service,
    MAX(event_type = 'OFFER_VIEW') AS viewed,
    MAX(json_extract(metadata_json, '$.stage') = 'sample_menu_view') AS sample,
    MAX(json_extract(metadata_json, '$.stage') = 'case_study_view') AS case_view,
    MAX(json_extract(metadata_json, '$.stage') = 'demo_view') AS demo,
    MAX(json_extract(metadata_json, '$.stage') = 'service_link_clicked') AS service_link,
    MAX(json_extract(metadata_json, '$.stage') = 'quote_started') AS quote_started,
    MAX(json_extract(metadata_json, '$.stage') = 'inquiry_received') AS inquiry_received,
    MAX(json_extract(metadata_json, '$.stage') = 'quote_received') AS quote_received
  FROM funnel_events
  WHERE event_type IN ('CTA_CLICK', 'OFFER_VIEW')
    AND json_extract(metadata_json, '$.instrumentation') = 'mm_funnel_v1'
    AND COALESCE(json_extract(metadata_json, '$.is_test'), 0) = 0
    AND json_extract(metadata_json, '$.service') IN (
      'online_menu_qr', 'conversion_fix', 'google_visibility',
      'accessibility_upgrade', 'website', 'app', 'other'
    )
  GROUP BY session_id, json_extract(metadata_json, '$.service')
), live_orders AS (
  SELECT DISTINCT f.session_id, o.id AS order_id, o.payment_status,
    CASE oi.offer_id
      WHEN 'offer_online_menu_qr' THEN 'online_menu_qr'
      WHEN 'offer_conversion_fix' THEN 'conversion_fix'
      WHEN 'offer_google_visibility' THEN 'google_visibility'
      WHEN 'offer_accessibility_upgrade' THEN 'accessibility_upgrade'
    END AS service
  FROM funnel_events f
  JOIN orders o ON o.id = f.order_id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE f.event_type = 'CHECKOUT_STARTED'
    AND json_extract(f.metadata_json, '$.environment') = 'live'
    AND json_extract(oi.metadata_json, '$.environment') = 'live'
), outcomes AS (
  SELECT session_id, service,
    COUNT(DISTINCT order_id) AS checkout_orders,
    COUNT(DISTINCT CASE WHEN payment_status = 'PAID' THEN order_id END) AS paid_orders
  FROM live_orders
  WHERE service IS NOT NULL
  GROUP BY session_id, service
), interest AS (
  SELECT session_id, service FROM actions
  UNION
  SELECT session_id, service FROM outcomes
)
SELECT c.source, c.medium, COALESCE(c.campaign, '(none)') AS campaign,
  i.service, COUNT(*) AS interested_sessions,
  SUM(COALESCE(a.viewed, 0)) AS offer_view_sessions,
  SUM(COALESCE(a.sample, 0)) AS sample_view_sessions,
  SUM(COALESCE(a.case_view, 0)) AS case_view_sessions,
  SUM(COALESCE(a.demo, 0)) AS demo_view_sessions,
  SUM(COALESCE(a.service_link, 0)) AS service_link_sessions,
  SUM(COALESCE(a.quote_started, 0)) AS quote_started_sessions,
  SUM(COALESCE(a.inquiry_received, 0)) AS inquiry_received_sessions,
  SUM(COALESCE(a.quote_received, 0)) AS quote_received_sessions,
  SUM(COALESCE(o.checkout_orders, 0) > 0) AS checkout_created_sessions,
  SUM(COALESCE(o.paid_orders, 0) > 0) AS paid_sessions,
  SUM(COALESCE(o.paid_orders, 0)) AS paid_orders
FROM cohort c
JOIN interest i ON i.session_id = c.session_id
LEFT JOIN actions a ON a.session_id = i.session_id AND a.service = i.service
LEFT JOIN outcomes o ON o.session_id = i.session_id AND o.service = i.service
GROUP BY c.source, c.medium, c.campaign, i.service
ORDER BY interested_sessions DESC, c.source, i.service;
