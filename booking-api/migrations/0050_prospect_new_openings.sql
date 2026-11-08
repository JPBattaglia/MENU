-- Nov 8, 2026 (owner): newly opened San Francisco food and drink businesses, from the city's Registered Business
-- Locations open data (DataSF g8m3-pdis), join the prospect emails and the Friday numbers email.
--   source        osm (OpenStreetMap, the original weekly finder) | sf_registry (new opening not yet on the map)
--   opened_on     YYYY-MM-DD the business registered this location with the city (set on matched OSM rows too)
--   looked_up_at  when its website, email and phone were last looked up on the web (new openings only; once per row)
ALTER TABLE prospects ADD COLUMN source TEXT;
ALTER TABLE prospects ADD COLUMN opened_on TEXT;
ALTER TABLE prospects ADD COLUMN looked_up_at TEXT;
CREATE INDEX IF NOT EXISTS prospects_opened_on ON prospects (opened_on);
