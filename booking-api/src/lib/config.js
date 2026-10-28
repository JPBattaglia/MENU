import { REPLY_TO_ADDRESS } from "./email.js";

// Stage 2 (Oct 2026): owner approval, buyer delivery, signed links and the scheduled production runner.
var PUBLIC_BASE_URL = "https://menu-made.com";

var AUTOMATION_START_AT = "2026-10-25T00:00:00.000Z";

var APPROVAL_TTL_DAYS = 14;

var DELIVERY_LINK_TTL_DAYS = 90;

var EMAIL_MAX_ATTEMPTS = 5;

var EXTRAS_WINDOW_MINUTES = 30;

var SCHEDULED_RUNNER_MAX_STEPS = 10;

var SCHEDULED_RUNNER_BUDGET_MS = 90000;

var DELIVERABLE_LABELS = {
  MENU_DRAFT: "Online menu (web page)",
  QR_CODE: "QR code (SVG, prints at any size)",
  SOCIAL_CALENDAR: "Posting calendar (web page)",
  ACCESSIBILITY_REPORT: "Accessibility report (web page)",
  SITE_BUILD: "Website (generated pages)",
  CONVERSION_REPORT: "Conversion Fix report (web page)",
  CONVERSION_CHECKLIST: "Conversion Fix checklist (text)",
  SOCIAL_PACK: "Graphics pack (ZIP of PNG graphics and captions)",
  APP_BUILD: "Guest App (installable web app)",
  REVIEW_REPLY_DRAFTS: "Review reply drafts (web page)",
  GOOGLE_PROFILE_REPORT: "Google profile report (web page)"
};

function ownerEmailAddress(env) {
  return env.OWNER_EMAIL || REPLY_TO_ADDRESS;
}

function publicBaseUrl(env) {
  return String(env.PUBLIC_BASE_URL || PUBLIC_BASE_URL).replace(/\/+$/, "");
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 864e5).toISOString();
}

export {
  PUBLIC_BASE_URL,
  AUTOMATION_START_AT,
  APPROVAL_TTL_DAYS,
  DELIVERY_LINK_TTL_DAYS,
  EMAIL_MAX_ATTEMPTS,
  EXTRAS_WINDOW_MINUTES,
  SCHEDULED_RUNNER_MAX_STEPS,
  SCHEDULED_RUNNER_BUDGET_MS,
  DELIVERABLE_LABELS,
  ownerEmailAddress,
  publicBaseUrl,
  addDaysIso
};
