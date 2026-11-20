-- Menu from a link (Nov 19, 2026): POST /api/menu-preview/link fetches a restaurant's menu page; this counts
-- fetches per network per hour (marketing/menu-link.js, LINKS_PER_HOUR). Apply to menu-made-db before the code.
CREATE TABLE IF NOT EXISTS menu_link_fetches (ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_menu_link_fetches_ip ON menu_link_fetches (ip_hash, created_at);
