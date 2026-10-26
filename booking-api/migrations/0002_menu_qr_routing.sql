-- Stage 4: Menu + QR keeps its owner approval step now that routing reads offers.requires_approval.
-- Apply before deploying the stage 4 worker, otherwise Menu + QR would deliver automatically.
UPDATE offers SET requires_approval = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = 'ONLINE_MENU_QR';
