-- Menu translations (stage 15, owner Nov 14, 2026: "maybe that should be something that you only get when you pay
-- for a plan"). One row per business: the languages its owner picked, the AI translations of every text on its live
-- menu (keyed by the original text, so an edit only translates what is new) and the owner's own corrections.
CREATE TABLE IF NOT EXISTS menu_translations (
  business_id TEXT PRIMARY KEY,
  languages_json TEXT NOT NULL DEFAULT '[]',   -- ["es", "zh-Hans"], in the owner's order
  strings_json TEXT NOT NULL DEFAULT '{}',     -- { "es": { "<original text>": "<translation>" } }
  overrides_json TEXT NOT NULL DEFAULT '{}',   -- same shape: the owner's corrections, which win
  fill_attempt_at TEXT,                        -- last time missing text was sent for translation
  updated_at TEXT NOT NULL
);
