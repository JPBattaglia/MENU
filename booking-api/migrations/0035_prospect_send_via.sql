-- Auto-sent outreach (owner decision, Nov 5, 2026): cold prospect emails go out from jp@getmenumade.com (Zoho Mail),
-- a separate domain so menu-made.com and the iCloud inboxes are never put at risk. sent_via = 'getmenumade' marks a
-- prospect emailed that way (its follow-up is sent the same way); NULL = sent by the owner from iCloud Mail.
ALTER TABLE prospects ADD COLUMN sent_via TEXT;
CREATE INDEX IF NOT EXISTS prospects_sent_via ON prospects (sent_via, sent_at);
