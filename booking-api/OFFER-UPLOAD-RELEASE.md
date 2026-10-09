# Offer clarity and document intake — October 9, 2026

## Decision / deviation log

The user requested all offer-audit changes and a document upload option, then asked to check previous chats. This work takes priority within the current M3 work under EC003. It does not mark CP2 passed or advance the automation phase.

History reviewed: Menu-Made's current automation handbook (October 6), the October 5 branded inquiry emails and quality-check Worker, and the approved direct EveryExpert booking link. Website layout, official logos, mm-a11y, existing checkout, and automated production gates are preserved. The backend baseline is `29c987011ee43c720c835984c9f317a184233659` on `branded-inquiry-emails`; it includes previously deployed work absent from master.

No offer prices, paid offer versions, schema, or bindings change. The pages clarify existing USD prices, annual accessibility coverage paid as a single payment, required materials, delivery timing, Google Business Profile scope, and inquiry versus booking. Unestablished revision, menu-size, and hosting limits are referred for written confirmation rather than invented.

Document intake extends the existing inquiry adapter using the existing DB and ASSETS R2 bindings. One file up to 5 MB is accepted: PDF, DOC, DOCX, TXT, PNG, JPEG, or WebP. Extension, size, basic file signature, UTF-8 text, and checksum are checked. These checks are not malware scanning or complete document parsing. There is no new public download endpoint. Verify that the existing R2 bucket has no public access enabled.

Files are saved before receipt is confirmed and included in the owner's existing branded inquiry email. Customer emails contain the filename, without a file attachment. Checkout notes retain the inquiry reference. The document is for manual review; PDF/Word uploads do not satisfy automated menu-source requirements or bypass input validation, quality checks, or production checkpoints.

## Deployment order

1. Replace the `menu-checkout` Worker with the complete `booking-api/menu-checkout-with-booking.mjs` file. Retain the existing DB, ASSETS, Stripe, Resend, booking settings, routes, and scheduled trigger. No additional paid hosting is required.
2. Deploy the website changes only after the Worker is deployed, so visitors are not offered a file upload against the old JSON-only endpoint.
3. Verify an inquiry with a small test document: one saved request, one owner email with the document, and one branded customer confirmation. Retry the same request and confirm there is no duplicate. Verify ordinary inquiries without files and checkout without payment completion. Do not use a real customer's document for smoke tests.

## Verification

`node --test booking-api/worker.test.mjs booking-api/automation-proof.test.mjs document-upload.test.mjs`

Coverage includes existing branded emails and request validation, rate limits, duplicate request handling, private object persistence, document integrity and attachment delivery, unsupported/oversized files, recovery after R2 failure, required origin/binding checks, and the unchanged automated PDF rejection gate. Frontend tests cover multipart upload and receipt confirmation, JSON inquiries, and file validation.

Browser deployment remains blocked by Cloudflare's sign-in verification error. The code has not been deployed or smoke-tested against production.
