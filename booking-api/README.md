# Direct booking requests

This branch replaces the email-app booking flow in contact.html and booking.js with POST /api/booking. A successful response means the request is saved in D1. Session times remain preferences pending manual confirmation.

## Activation order — backend first

The existing menu-checkout Worker is outside this repository. This separate Worker claims only the exact /api/booking route, using the existing menu-made-db database. It does not replace checkout or the root site Wrangler configuration. Verify the database ID and exact-route precedence in the Cloudflare account before deployment.

1. Set up a verified menu-made.com sender with Resend (or adapt `deliver` to an existing transactional email provider). The configured bookings@menu-made.com From address must be authorized by the provider. No account or paid service has been provisioned by this change.
2. Authenticate Wrangler in the Cloudflare account. Set `RESEND_API_KEY` and a randomly generated `BOOKING_RATE_SALT` secret using the booking-api/wrangler.jsonc configuration. Never put secrets in Git.
3. Execute **this SQL file only** against menu-made-db: `npx wrangler d1 execute menu-made-db --remote --file booking-api/migrations/0001_booking_requests.sql --config booking-api/wrangler.jsonc`. Do not apply unrelated migration chains from the separate checkout project.
4. Deploy with `npx wrangler deploy --config booking-api/wrangler.jsonc`. Verify the exact booking route is assigned and the broader checkout routes still point to menu-checkout.
5. Make one authorized end-to-end request, confirm its database record and both emails, retry the same ID and check for no duplicate record or emails. Verify the existing checkout still works. Endpoint requires Origin https://menu-made.com or https://www.menu-made.com and JSON content.
6. Only then merge/deploy contact.html and booking.js. Do not publish the frontend ahead of the endpoint.

The handler fails closed if storage or email configuration is missing. It limits body size, validates fields/timezones/dates, rejects filled honeypots, permits only the site origins, and atomically limits new requests to five per IP/hour and 100 globally/hour. IPs are salted hashes. Add Turnstile if abuse warrants it; the honeypot and limits are not identity verification.

Requests are saved before email delivery. Provider acceptance is recorded independently for the owner and customer; queued failures retry every five minutes, at most 12 attempts within 20 hours. After that, inspect rows with unsent notifications and follow up manually. The time window stays within the provider's 24-hour idempotency window. Provider acceptance does not guarantee inbox delivery. Records have no automatic deletion; choose a retention policy with the owner before enabling cleanup.

Run local tests: `node --test booking-api/worker.test.mjs booking-api/frontend.test.mjs`.
