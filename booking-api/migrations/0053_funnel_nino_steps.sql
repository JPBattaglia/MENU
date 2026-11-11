-- Nov 10, 2026 (owner): Nino site shopping steps by source. ninobattaglia.com/visit-count.js sends DESIGN_VIEW,
-- ADD_TO_CART and CHECKOUT_CLICK to /api/funnel-event; the Friday numbers read them (src/marketing/weekly-numbers.js).
-- SQLite can't change a CHECK, so the table is rebuilt with the same columns and indexes. Nothing references it.
CREATE TABLE funnel_events_new (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'SITE_VISIT',
            'OFFER_VIEW',
            'CTA_CLICK',
            'CHECKOUT_STARTED',
            'PURCHASE_COMPLETED',
            'DESIGN_VIEW',
            'ADD_TO_CART',
            'CHECKOUT_CLICK'
        )
    ),
    visitor_id TEXT,
    session_id TEXT,
    offer_id TEXT,
    offer_version_id TEXT,
    order_id TEXT,
    source TEXT,
    medium TEXT,
    campaign TEXT,
    referrer TEXT,
    landing_path TEXT,
    metadata_json TEXT,
    FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL,
    FOREIGN KEY (offer_version_id) REFERENCES offer_versions(id) ON DELETE SET NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);
INSERT INTO funnel_events_new SELECT id, created_at, event_type, visitor_id, session_id, offer_id, offer_version_id, order_id, source, medium, campaign, referrer, landing_path, metadata_json FROM funnel_events;
DROP TABLE funnel_events;
ALTER TABLE funnel_events_new RENAME TO funnel_events;
CREATE INDEX idx_funnel_events_created ON funnel_events(created_at);
CREATE INDEX idx_funnel_events_type_created ON funnel_events(event_type, created_at);
CREATE INDEX idx_funnel_events_offer_created ON funnel_events(offer_id, created_at);
CREATE INDEX idx_funnel_events_visitor ON funnel_events(visitor_id, created_at);
CREATE INDEX idx_funnel_events_campaign ON funnel_events(campaign, created_at);
