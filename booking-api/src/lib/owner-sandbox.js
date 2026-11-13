// Owner sandbox lock (owner, Nov 13, 2026: "Lock it"). Test checkout runs real production, so it must not be open to
// anyone who finds the address. Test mode now needs an owner pass: a signed token (kind "owner-sandbox") that reaches
// a browser only through the links emailed to the owner inbox (GET/POST /api/owner-sandbox/link). site-nav.js and
// ninobattaglia.com's design-services.js keep it in that browser and send it as sandbox_token with test checkouts,
// test-mode previews and test-mode uploads. The self-tests sign their own pass inside the worker.
//   GET  /api/owner-sandbox/link   a page with "Email me the test mode links"
//   POST /api/owner-sandbox/link   emails them to the owner inbox (nothing else can receive them)
import { ownerEmailAddress, publicBaseUrl } from "./config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "./email.js";
import { simplePage } from "./http.js";
import { signLinkToken, verifyLinkToken } from "./links.js";

const KIND = "owner-sandbox";
const TTL_DAYS = 30;

// Empty without a signing secret (local test runs, where the lock is off anyway).
async function ownerSandboxToken(env) {
  if (!env?.PRODUCTION_RUNNER_SECRET) return "";
  return signLinkToken(env, { kind: KIND, id: "owner", ttlDays: TTL_DAYS });
}

// True for a valid, unexpired owner pass. The lock is on where the worker's config says OWNER_SANDBOX_LOCK "on"
// (wrangler.jsonc, the live worker); local test runs leave it off unless a test turns it on.
async function sandboxPass(env, token) {
  if (env?.OWNER_SANDBOX_LOCK !== "on") return true;
  if (!env?.PRODUCTION_RUNNER_SECRET) return false;
  if (typeof token !== "string" || !token) return false;
  const payload = await verifyLinkToken(env, token, [KIND], "owner").catch(() => null);
  return !!payload && !payload.expired;
}

// The JSON body of a test checkout, read without using up the request.
async function sandboxPassFromBody(env, request) {
  const body = await request.clone().json().catch(() => null);
  return sandboxPass(env, body?.sandbox_token);
}

async function handleOwnerSandboxLink(request, env) {
  const inbox = ownerEmailAddress(env);
  if (request.method === "GET") {
    return simplePage(200, "Test mode", `<p>Test mode lets you check out with Stripe's test card on menu-made.com and on Nino's design services page. We'll email the links to <strong>${escapeHtml(inbox)}</strong>; open them in the browser you test with. They work for ${TTL_DAYS} days.</p>
<form method="post" action="/api/owner-sandbox/link"><button type="submit">Email me the test mode links</button></form>`);
  }
  const token = await ownerSandboxToken(env);
  const menu = `${publicBaseUrl(env)}/?sandbox=${encodeURIComponent(token)}`;
  const nino = `https://ninobattaglia.com/services.html?sandbox=${encodeURIComponent(token)}`;
  const sent = await sendTransactionalEmail(env, {
    to: inbox,
    subject: "Your test mode links (menu-made.com and Nino's design services)",
    html: brandedEmailHtml({ preheader: "Turn on test mode in the browser you test with.", eyebrow: "OWNER", heading: "Test mode links",
      paragraphs: [
        "Open a link in the browser or phone you want to test with. That browser shows a yellow TEST MODE bar and checks out with Stripe's test card (4242 4242 4242 4242, any future date, any CVC). Everyone else keeps live checkout.",
        `Tap <strong>Leave test mode</strong> on the bar when you're done. The links work for ${TTL_DAYS} days; ask for fresh ones at ${escapeHtml(publicBaseUrl(env))}/api/owner-sandbox/link.`
      ],
      buttons: [{ label: "Test mode on menu-made.com", url: menu, primary: true }, { label: "Test mode on Nino's design services", url: nino, primary: false }] }),
    text: `Test mode on menu-made.com: ${menu}\nTest mode on Nino's design services: ${nino}\nThey work for ${TTL_DAYS} days.`,
    idempotencyKey: `owner-sandbox-link/${Math.floor(Date.now() / 600000)}`, purpose: "OWNER_ACTION", templateKey: "owner_sandbox_link_v1"
  }).catch((error) => ({ ok: false, error }));
  if (!sent?.ok) return simplePage(502, "The email didn't send", "<p>Please try again in a minute.</p>");
  return simplePage(200, "Check your email", `<p>We sent the test mode links to <strong>${escapeHtml(inbox)}</strong>.</p>`);
}

export { ownerSandboxToken, sandboxPass, sandboxPassFromBody, handleOwnerSandboxLink, KIND as OWNER_SANDBOX_KIND };
