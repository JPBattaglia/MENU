"""Read-only report fixtures: run python3 booking-api/service-report.test.py."""
import json
import sqlite3
import unittest
from pathlib import Path

QUERY = Path(__file__).with_name('service-funnel-report.sql').read_text()

class ServiceReportTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          CREATE TABLE funnel_events(id TEXT, created_at TEXT, event_type TEXT,
            session_id TEXT, source TEXT, medium TEXT, campaign TEXT,
            order_id TEXT, metadata_json TEXT);
          CREATE TABLE orders(id TEXT, payment_status TEXT);
          CREATE TABLE order_items(order_id TEXT, offer_id TEXT, metadata_json TEXT);
        ''')
        self.counter = 0

    def event(self, session, stage=None, service=None, kind='CTA_CLICK',
              test=False, order=None, environment=None):
        self.counter += 1
        metadata = {'instrumentation': 'mm_funnel_v1', 'is_test': test}
        if stage: metadata['stage'] = stage
        if service: metadata['service'] = service
        if environment: metadata['environment'] = environment
        self.db.execute("INSERT INTO funnel_events VALUES (?,datetime('now'),?,?,?,?,?,?,?)",
                        (str(self.counter), kind, session,
                         'internal-test' if test else 'outreach',
                         'email', 'services', order, json.dumps(metadata)))

    def visit(self, session, test=False):
        self.event(session, kind='SITE_VISIT', test=test)

    def order(self, session, order_id, service, status='PAID', environment='live'):
        self.db.execute('INSERT INTO orders VALUES (?,?)', (order_id, status))
        self.db.execute('INSERT INTO order_items VALUES (?,?,?)',
                        (order_id, 'offer_' + service, json.dumps({'environment': environment})))
        self.event(session, kind='CHECKOUT_STARTED', order=order_id, environment=environment)

    def rows(self):
        return {row['service']: dict(row) for row in self.db.execute(QUERY)}

    def test_quote_receipts_are_deduplicated_and_never_counted_as_paid(self):
        self.visit('website')
        for stage in ['offer_view', 'quote_started', 'inquiry_received', 'quote_received', 'quote_received']:
            self.event('website', stage, 'website', kind='OFFER_VIEW' if stage == 'offer_view' else 'CTA_CLICK')
        result = self.rows()['website']
        self.assertEqual(result['interested_sessions'], 1)
        self.assertEqual(result['inquiry_received_sessions'], 1)
        self.assertEqual(result['quote_received_sessions'], 1)
        self.assertEqual(result['paid_sessions'], 0)

    def test_orders_use_actual_live_payment_state_and_distinct_order_ids(self):
        self.visit('paid')
        self.order('paid', 'o-paid', 'google_visibility')
        self.event('paid', kind='CHECKOUT_STARTED', order='o-paid', environment='live')
        self.db.execute('INSERT INTO order_items SELECT * FROM order_items')
        self.visit('sandbox')
        self.order('sandbox', 'o-sandbox', 'google_visibility', environment='sandbox')
        self.visit('unpaid')
        self.order('unpaid', 'o-pending', 'google_visibility', status='PAYMENT_PENDING')
        result = self.rows()['google_visibility']
        self.assertEqual(result['interested_sessions'], 2)
        self.assertEqual(result['checkout_created_sessions'], 2)
        self.assertEqual(result['paid_sessions'], 1)
        self.assertEqual(result['paid_orders'], 1)

    def test_internal_tests_and_unapproved_service_metadata_are_excluded(self):
        self.visit('internal', test=True)
        self.event('internal', 'quote_received', 'app', test=True)
        self.order('internal', 'o-internal', 'google_visibility')
        self.visit('unknown')
        self.event('unknown', 'quote_received', 'private@example.com')
        self.assertEqual(self.rows(), {})

    def test_one_session_can_explore_multiple_services_without_duplicate_counts(self):
        self.visit('multi')
        self.visit('multi')
        self.event('multi', 'case_study_view', 'website')
        self.event('multi', 'demo_view', 'app')
        self.event('multi', 'demo_view', 'app')
        result = self.rows()
        self.assertEqual(set(result), {'website', 'app'})
        self.assertEqual(result['website']['case_view_sessions'], 1)
        self.assertEqual(result['app']['demo_view_sessions'], 1)
        self.assertEqual(result['app']['interested_sessions'], 1)

if __name__ == '__main__':
    unittest.main()
