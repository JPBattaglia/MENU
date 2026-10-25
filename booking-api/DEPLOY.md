# menu-checkout worker — source layout and deploy

The live `menu-checkout` worker is built from `booking-api/src/` (entry `src/worker.js`) by Wrangler.
`legacy/menu-checkout-live-2026-10-25.mjs` is a byte-for-byte copy of the module that was live before the
split (stage 2.5). It is a backup only — never edit it.

| Folder | Holds |
| --- | --- |
| `src/worker.js` | `fetch` router and `scheduled` handler |
| `src/lib/` | JSON/HTTP helpers, config constants, signed links, Resend sender + branded template, D1 helpers |
| `src/checkout/` | Catalog, quote, pending orders, checkout session, Stripe webhook, funnel events |
| `src/onboarding/` | Intake fields, uploads, checkout-menu attach, extras window, confirmation email |
| `src/workflows/` | Workflow definitions; runner (step selection, claim, scheduled loop, failure alerts) |
| `src/producers/menu-qr/` | Inputs, Claude menu reading, designed page, QR, quality check, package + delivery |
| `src/approvals/`, `src/delivery/` | Approve page; download links and hosted menu page |
| `src/booking/` | Contact/booking inquiry handler |

New producers get their own folder under `src/producers/`.

## Tests

    cd booking-api && npm install && npm test

## First deploy (one time, on the Mac)

1. `cd booking-api && npm install && npx wrangler login`
2. `npx wrangler deploy --dry-run --outdir dist` must succeed and list bindings `DB` (menu-made-db) and `ASSETS` (menu-made-assets).
3. In the Cloudflare dashboard → Workers → menu-checkout → Settings, confirm `wrangler.jsonc` matches:
   compatibility date and flags, Domains & Routes (Stripe's live webhook uses `menu-made.com/api/stripe-webhook`),
   whether workers.dev is used (e.g. by a test-mode Stripe webhook), and the cron `*/5 * * * *`.
   Fix `wrangler.jsonc` first if anything differs.
4. `npx wrangler deploy`
5. Smoke test: `/api/db-health`, `/api/menu-package-quote?pages=3` (expect $144), `/api/offers`.
   Rollback if needed: Cloudflare → menu-checkout → Deployments → roll back to the previous version.

## Every deploy after that

    cd booking-api && npm test && npx wrangler deploy

Secrets stay in Cloudflare (`npx wrangler secret put NAME`); never put them in `wrangler.jsonc`.
