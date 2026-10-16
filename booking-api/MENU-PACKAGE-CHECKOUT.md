# Complete menu checkout — October 15, 2026

## Request and price contract

The existing `/api/create-checkout`, `/api/create-checkout-session`, and sandbox `/api/create-checkout-test` routes accept a top-level `menu_pages` **JSON integer from 1 through 50** when Online Menu + QR is selected. Exactly one menu package is allowed per order, including aliases of the same catalog offer. Use `qty: 1`; additional pages belong in `menu_pages`. A missing, fractional, string, out-of-range, or unrelated page count returns HTTP 400 before creating an order or contacting Stripe.

```json
{
  "items": [{ "key": "online_menu_qr", "qty": 1 }],
  "menu_pages": 5,
  "customer": {
    "name": "Example Buyer",
    "business": "Example Cafe",
    "email": "buyer@example.com"
  }
}
```

The server resolves the existing active public offer, then calculates USD cents: **12900 setup + 1500 first-year hosting + 2000 × max(0, menu_pages − 3)**. Three or fewer pages cost $144 total; five pages cost $184. Two revisions are included. Client-provided prices, quote objects, and currency do not affect this calculation. If the active catalog setup price or currency no longer matches $129 USD, checkout fails closed with HTTP 503 until the server quote and public offer are reconciled.

`GET /api/menu-package-quote?pages=3` returns `{ "ok": true, "quote": { ... } }` using the identical quote calculation. It is read-only, needs no storage or payment binding, and permits a safe production verification of three pages ($144) and five pages ($184). Invalid or missing page counts return HTTP 400.

Hosting for the first year is paid upfront in this one-time checkout. Renewal is $15/year and arranged separately. This change creates no Stripe subscription, automatic renewal, recurring charge, or renewal reminder service.

## Persistence and fulfillment

The menu retains its existing offer ID, offer version, order item, and MENU_QR workflow. Its order item uses the complete first-year price, with the scope and full price breakdown retained as `order_items.metadata_json.menu_package`. Extra pages and prepaid hosting do not create separate fulfillment projects. The order total and Stripe `price_data.unit_amount` come from that same calculated quote; the Stripe description includes the page, revision, hosting, and renewal terms. Other services retain their existing live Stripe price IDs.

The payment webhook, signature verification, verified-payment requirement for onboarding, existing input validation, private draft deliverables, quality checks, and production checkpoints are unchanged. This change does not claim that a document upload completes automated onboarding or removes the existing PDF/Word extraction gate.

The complete bundle also preserves the already-deployed production runner's scoped workflow/step selection and authorized `dry_run` preview. These previously deployed changes were reconciled with the repository baseline by a clean three-way merge, and tests confirm dry-run requests perform no writes.

## Deployment

1. Replace the **existing `menu-checkout` Worker** with the complete `booking-api/menu-checkout-with-booking.mjs` module, retaining its DB and ASSETS bindings, Stripe/Resend settings, routes, schedules, and all existing secrets. No database migration or new binding is required. `booking-api/worker.mjs` is the standalone inquiry/booking implementation; it is not the complete checkout Worker.
2. Publish the matching frontend immediately after the API is deployed. Old menu checkout requests without `menu_pages` are deliberately rejected instead of silently collecting an amount the visitor has not reviewed.
3. The repository's `wrangler.jsonc` configures the static `menu` site and has no checkout Worker DB or ASSETS bindings. Do not use it to replace or reconfigure the checkout Worker. Use the existing Worker deployment configuration or Cloudflare's module replacement flow.
4. Verify the public page breakdown and a sandbox checkout: three pages = $144, five pages = $184, one order item, one menu workflow after a verified test payment, and the original onboarding requirements. Check an existing non-menu checkout still uses its established price. No real customer payment is necessary for a smoke test.

## Verification

`node --test booking-api/menu-package-checkout.test.mjs booking-api/worker.test.mjs booking-api/automation-proof.test.mjs`

The tests exercise the real Worker routes against mocked D1 and Stripe, bounded integer validation, duplicate menu aliases, quantity validation, tampered client amounts, catalog mismatch, saved order and quote consistency, Stripe one-time line items, mixed-service pricing, provider rejection, unsigned webhook rejection, existing document intake, and private production draft gates. No production API mutation or payment was performed during these tests.

## October 15 deployment

The complete bundle was deployed to the existing menu-checkout Worker through Cloudflare’s module upload API with all existing binding types retained. The deployed runner selection/dry-run behavior was merged into this bundle before release. Binding names, resource identifiers, and secret names were compared before and after deployment and were unchanged. A protected local backup of the prior module and settings is retained outside the public repository. Public read-only price quotes were checked for 3 and 5 pages.
