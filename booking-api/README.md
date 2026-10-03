# Booking activation in the existing Worker

The uploaded production menu-checkout bundle includes Resend onboarding email support. Use menu-checkout-with-booking.mjs as the full dashboard replacement. Everything before the original export is preserved byte-for-byte. A wrapper intercepts only /api/booking; all other requests use the original handler.

Booking defaults reuse FROM_ADDRESS (orders@updates.menu-made.com), INTERNAL_BCC (menu.automate@gmail.com) for owner notifications, REPLY_TO_ADDRESS (info@menu-made.com) for customer replies, and RESEND_API_KEY. No new email account, Worker, route or hosting service is needed. BOOKING_FROM, BOOKING_TO, BOOKING_REPLY_TO and BOOKING_RATE_SALT may optionally override defaults. The private rate-limit salt falls back to the existing production-runner secret, then the Resend secret, with a booking-specific prefix. Existing bound secrets are retained when updating dashboard code; do not paste secrets into source.

Activation order:
1. Back up the currently deployed code. Run migrations/0001_booking_requests.sql in the existing menu-made-db D1 console; it adds only mm_booking_requests and its indexes.
2. Replace menu-checkout dashboard code with the entire menu-checkout-with-booking.mjs file and deploy. Do not use the separate booking-api/wrangler.jsonc for this integrated path.
3. Add a five-minute cron trigger (*/5 * * * *) to this existing Worker for bounded retries of pending notifications. Do not remove any existing triggers.
4. Confirm RESEND_API_KEY and DB remain bound. Test saving a booking and receipt of both notifications before publishing the frontend. Session times remain preferences pending manual confirmation. Check existing checkout and onboarding still work.
5. Publish only contact.html and booking.js from the draft branch once backend checks pass.

Owner/customer notifications record success separately. Failures retry at most 12 times within 20 hours; records remain available for manual follow-up afterward. Provider acceptance is not proof of inbox delivery. Rate limits, honeypot and origin checks provide baseline abuse resistance; they are not identity verification. Records have no automatic deletion pending a retention decision.

The standalone worker.mjs, tests and wrangler.jsonc remain as the earlier alternative/reference. The integrated full file is the intended activation path now that current production source is available. The original modular source on the owner’s laptop should be updated afterward so future Wrangler deployments retain booking support.

Validation: eight frontend/backend tests, full-bundle import and route checks, syntax checks, exact preservation check and SQLite migration/rate-limit checks pass. No live deployment or end-to-end email test has been performed here.
