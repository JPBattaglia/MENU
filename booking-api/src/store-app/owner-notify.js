// Owner-only Notifications page (owner, Nov 17, 2026: "a notifications button or feature page into the websites that
// only I can access to send notifications"). menu-made.com/notify and ninobattaglia.com/notify open this page.
//   GET  /api/owner/notify          "Email me a sign-in link" (no form fields: the link only ever goes to OWNER_EMAIL)
//   POST /api/owner/notify          sends a one-hour signed link to the owner inbox (at most one email per 10 minutes)
//   GET  /api/owner/notify?t=...    the Notifications page: one "Send a notification" button per own app, each opening
//                                   that app's existing send page (engage.js handleAppPush)
// No password or token for the owner to keep: the sign-in link replaces both.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../lib/email.js";
import { simplePage } from "../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../lib/links.js";
import { DAILY_PUSH_LIMIT, pushLink } from "../producers/guest-app/engage.js";
import { nativeDeviceCount } from "./native-push.js";
import { PUSH_LABELS } from "./own-apps.js";

const LINK_KIND = "ownernotify";
const OWNER = "owner";
const LINK_TTL_DAYS = 1 / 24;
const PATH = "/api/owner/notify";

async function emailSignInLink(env) {
  const inbox = ownerEmailAddress(env);
  const link = `${publicBaseUrl(env)}${PATH}?t=${encodeURIComponent(await signLinkToken(env, { kind: LINK_KIND, id: OWNER, ttlDays: LINK_TTL_DAYS }))}`;
  const bucket = Math.floor(Date.now() / 600000);
  const sent = await sendTransactionalEmail(env, {
    to: inbox,
    subject: "Your sign-in link: app notifications",
    html: brandedEmailHtml({ preheader: "One-hour link to send app notifications.", eyebrow: "YOUR APPS", heading: "Send app notifications",
      paragraphs: ["Tap the button to open your Notifications page for the MΞNU and Nino apps. It works for one hour.", "If you didn't ask for this, ignore it. Nobody else can use it."],
      buttons: [{ label: "Open Notifications", url: link, primary: true }] }),
    text: `Open your Notifications page (link works for one hour):\n${link}`,
    idempotencyKey: `owner-notify-link/${bucket}`, purpose: "OWNER_ACTION", templateKey: "owner_notify_link_v1"
  }).catch((error) => ({ ok: false, error }));
  if (!sent?.ok) return simplePage(502, "The email didn't send", "<p>Please try again in a minute.</p>");
  return simplePage(200, "Check your email", `<p>We sent a sign-in link to <strong>${escapeHtml(inbox)}</strong>. Open it on this phone or computer; it works for one hour.</p>
<p>If you pressed the button a moment ago, use the earlier email.</p>`);
}

async function notificationsPage(env) {
  const apps = ((await env.DB.prepare(`SELECT g.id, s.bundle_id FROM store_apps s JOIN guest_apps g ON g.project_id = s.project_id WHERE s.own_app = 1 ORDER BY s.bundle_id`).all()).results || [])
    .filter((a) => PUSH_LABELS[a.bundle_id]);
  if (!apps.length) return simplePage(200, "Notifications", "<p>Your apps aren't set up yet.</p>");
  const rows = [];
  for (const a of apps) {
    const web = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE app_id = ? AND status = 'ACTIVE'`).bind(a.id).first().catch(() => null))?.n || 0;
    const phones = web + await nativeDeviceCount(env, a.id).catch(() => 0);
    rows.push(`<p><a href="${escapeHtml(await pushLink(env, a.id))}" style="display:inline-block;background:#00d6e6;color:#012f34;font-weight:bold;text-decoration:none;padding:13px 22px;border-radius:6px">Send a notification: ${escapeHtml(PUSH_LABELS[a.bundle_id])}</a><br><small>${phones} ${phones === 1 ? "phone has" : "phones have"} notifications on</small></p>`);
  }
  return simplePage(200, "Notifications", `<p>Pick an app. You'll write a title and a short message, then press Send.</p>
${rows.join("\n")}
<p><small>Each app can send ${DAILY_PUSH_LIMIT} a day; for the Nino app the automatic new-design notification counts as one. This page works for an hour; after that, open menu-made.com/notify again.</small></p>`);
}

async function handleOwnerNotify(request, env) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  if (request.method === "POST") return emailSignInLink(env);
  const token = new URL(request.url).searchParams.get("t");
  if (!token) {
    return simplePage(200, "App notifications", `<p>This page is for the owner. We'll email a one-hour sign-in link to <strong>${escapeHtml(ownerEmailAddress(env))}</strong>.</p>
<form method="post" action="${PATH}"><button type="submit">Email me a sign-in link</button></form>`);
  }
  const payload = await verifyLinkToken(env, token, [LINK_KIND], OWNER);
  if (!payload || payload.expired) {
    return simplePage(403, "This link has expired", `<p>Sign-in links work for one hour.</p><form method="post" action="${PATH}"><button type="submit">Email me a new link</button></form>`);
  }
  return notificationsPage(env);
}

export { LINK_KIND as OWNER_NOTIFY_LINK_KIND, handleOwnerNotify };
