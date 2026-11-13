-- App opens (owner, Nov 13, 2026): each time the MENU-MADE or Nino app opens or comes back to the screen it loads
-- /api/app-hybrid/<app>, so the worker counts that request. No personal data: a device is a one-way hash of
-- address + phone type with a salt that changes every day, so a device can be counted within a day but never followed.
CREATE TABLE IF NOT EXISTS app_opens (
  day TEXT NOT NULL,          -- YYYY-MM-DD, Pacific time
  app TEXT NOT NULL,          -- menumade | nino
  platform TEXT NOT NULL,     -- ios | android
  opens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, app, platform)
);
CREATE TABLE IF NOT EXISTS app_open_devices (
  day TEXT NOT NULL,
  app TEXT NOT NULL,
  platform TEXT NOT NULL,
  device TEXT NOT NULL,       -- daily-salted hash, not reversible
  PRIMARY KEY (day, app, device)
);
