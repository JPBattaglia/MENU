# Funnel measurement — October 15, 2026

EC003 user priority: add funnel measurement after the offer and upload changes. Reuse the deployed `/api/funnel-event`, `funnel_events`, payment records, and onboarding business events. No backend replacement, database schema, service pricing, production gates, branding, or paid hosting changes.

The site records session-based visits, interactive sample views, generic and menu-specific Start clicks, viewed offers, selected services, opened details, checkout attempts/errors, successful inquiry receipts, outbound booking-link clicks, and onboarding opened/completed signals. Checkout receives first-touch attribution through its existing `tracking` field. The existing Worker records created checkout sessions and payment events. No client script emits a purchase event.

Load `<script src="funnel.js?v=20261015-start-choice" defer></script>` once on each marketing page, the interactive sample (`sample-menu.html`), the order page, and the payment-success page. Keep the script before the deferred order scripts so they can use `window.MenuMadeFunnel`. Both `/sample-menu` and `/sample-menu.html` are recognized. Sample views are recorded when that page loads; a link click alone is not a sample view.

The new signals use the existing backend-supported `CTA_CLICK` event type and an allowlisted `metadata.stage`:

| Stage | Meaning |
| --- | --- |
| `sample_menu_view` | The interactive sample page loaded in this tracked session. |
| `start_clicked` | A generic Start link or an explicit menu order control was clicked; only explicit menu controls carry the menu offer ID. |
| `checkout_attempt` | The customer attempted to create a checkout. |
| `checkout_error` | The browser received a checkout error. |

Start tracking covers internal links to `contact[.html]?service=menu` or `service=online_menu_qr`, bare contact-page Start links, and controls marked `data-start-menu` or `data-funnel-start`. Bare contact links and generic `data-funnel-start` controls send `start_clicked` without an `offer_id`; clicking Start does not imply a service choice. Explicit menu links and `data-start-menu` controls include `offer_online_menu_qr`. Inquiry links and other service links do not count as Start clicks. Each stage/service combination is sent at most once per page load; the reports deduplicate again by session, so a generic Start followed by an explicit menu Start still counts as one started session. Do not add customer data to tracking attributes or use arbitrary stage names.

Payment completion already runs on the server: the Stripe `checkout.session.completed` webhook updates the order to `PAID`, stores a successful payment, and records `PURCHASE_COMPLETED` for the order's offers. Loading or refreshing `checkoutsuccess.html` does not record a purchase. The report below counts live paid orders and distinct paid sessions rather than raw purchase events, since a single order can contain multiple offers.

The browser keeps a random session ID in sessionStorage, with a 30-minute inactivity window when navigating between pages. It sends approved campaign tokens, referring hostname, and an allowlisted page path. It does not send contact fields, document names/contents, query strings, payment-session references, or full referrer URLs. DNT and Global Privacy Control disable measurement. Browser/network blockers can undercount events; these are tracked sessions, not qualified leads or unique people. Anonymous tracking cannot distinguish a real prospect from the owner or a bot.

Run `booking-api/funnel-report.sql` in the existing D1 console to get the past-30-day session cohort by source, medium, and campaign. The SQL is read-only. It joins checkout sessions to actual orders and their live order-item metadata for payment counts, and uses server-created `ONBOARDING_COMPLETED` business events for onboarding. It deduplicates multi-service orders and repeated events. An onboarding completion means at least one project for that session's paid orders completed onboarding; it does not mean every project is production-ready. Inquiry counts are successful browser API receipts; booking-link clicks are not confirmed appointments. Historical orders without the new attribution do not enter the new visit cohort.

For outreach links use `?utm_source=restaurant_outreach&utm_medium=email&utm_campaign=menu_oct` with nonpersonal campaign labels. The first source in a session is retained. Append `?mm_measurement=test` when doing internal checks; the test flag persists through navigation and the report excludes those sessions. Use `?mm_measurement=off` to skip measurement on that page. Small counts are descriptive only: compare actual counts and effort, without claiming statistical confidence or causal lift.

Validation: frontend privacy, attribution persistence, event deduplication, booking-click semantics, and failure isolation tests; SQL fixture checks that duplicate checkout events, sandbox orders, and internal tests cannot inflate paid-session counts. Public pages are verified after deployment. No real inquiry, booking, or payment is required for verification.

## Sample-to-purchase report

Run this read-only query in the same D1 console to see the new sample and Start stages alongside checkout outcomes. It uses the first tracked visit in each session for attribution and excludes internal tests and sandbox orders. It counts whether each stage occurred during a session; it does not enforce stage order or imply that viewing the sample caused a purchase. Review counts by source weekly, particularly Start clicks without a created checkout and created checkouts without a paid order.

```sql
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
```
