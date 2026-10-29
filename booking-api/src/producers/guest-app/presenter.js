// What the owner and the customer read for a Guest App setup (stage 8). Plugged into the shared deliver step.
import { APPROVAL_TTL_DAYS, publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { signLinkToken } from "../../lib/links.js";
import { isTestOrder } from "../../approvals/release.js";
import { appUrl, updateLink } from "./app-step.js";
import { counterLink, pushLink } from "./engage.js";

const infoOf = (files) => parseJsonOrNull(files?.find((f) => f.deliverable_type === "APP_BUILD")?.metadata_json)?.app || {};

async function appPreviewUrl(env, buildId, ttlDays) {
  const token = await signLinkToken(env, { kind: "apppreview", id: buildId, ttlDays });
  return `${publicBaseUrl(env)}/api/app-preview/${buildId}/${token}/`;
}

const INSTALL_STEPS = [
  ["iPhone (Safari)", "Open the link, tap the Share button, then \"Add to Home Screen\"."],
  ["Android (Chrome)", "Open the link, tap \"Install app\" when it appears, or the menu (three dots) then \"Install app\" / \"Add to Home screen\"."]
];

const guestAppOverrides = {
  name: "GUEST_APP",
  ownerLabel(context) { return `${context.business_name || "A customer"} - Guest App`; },
  async previewLinks({ files, env }) {
    const build = files.find((f) => f.deliverable_type === "APP_BUILD");
    return build ? [{ label: "Preview the app", url: await appPreviewUrl(env, build.id, APPROVAL_TTL_DAYS) }] : [];
  },
  async ownerEmail({ context, files, previews, approveUrl }) {
    const test = isTestOrder(context);
    const business = context.business_name || "A customer";
    const info = infoOf(files);
    return {
      subject: `${test ? "[TEST] " : ""}Approve ${business}'s Guest App`,
      templateKey: "owner_approval_guest_app_v1",
      html: brandedEmailHtml({
        preheader: `${business}'s Guest App is built and passed its checks.`,
        eyebrow: test ? "TEST · GUEST APP" : "GUEST APP",
        heading: `${business}'s Guest App is ready to review`,
        paragraphs: [`"${escapeHtml(info.name || business)}", shown as "${escapeHtml(info.short_name || "")}" under the icon${info.has_logo ? ", icon made from their logo" : ", icon made from their initials"}. It passed the automated checks: accessibility scan, install manifest and icons, offline support, and the phone, address and hours. Open the preview on your phone before approving. Nothing is live until you approve.`],
        rows: [["Address", `${info.slug || ""}.menu-made.com/app`], ["Link expires", `${APPROVAL_TTL_DAYS} days`]],
        buttons: [...previews, { label: "Review and approve", url: approveUrl, primary: true }],
        footnote: "If something is off, choose request changes: the app is rebuilt from the customer's latest answers."
      }),
      text: [`${business}'s Guest App is ready for review. Nothing is live until you approve.`, "", ...previews.map((p) => `${p.label}: ${p.url}`), `Review and approve: ${approveUrl}`].join("\n")
    };
  },
  async buyerEmail({ context, files, env }) {
    const business = context.business_name || "your business";
    const info = infoOf(files);
    const url = appUrl(env, info.slug);
    const update = info.app_id ? await updateLink(env, info.app_id) : null;
    const push = info.app_id ? await pushLink(env, info.app_id) : null;
    const counter = info.app_id ? await counterLink(env, info.app_id) : null;
    const steps = `<ul>${INSTALL_STEPS.map(([who, how]) => `<li><strong>${who}:</strong> ${escapeHtml(how)}</li>`).join("")}</ul>`;
    return {
      recipient: context.customer_email,
      subject: `${isTestOrder(context) ? "[TEST] " : ""}Your Guest App is live`,
      templateKey: "delivery_guest_app_v1",
      html: brandedEmailHtml({
        preheader: `${business}'s Guest App is live.`,
        eyebrow: "YOUR GUEST APP IS LIVE",
        heading: `${business} is on your guests' home screens`,
        paragraphs: [
          `Hi ${escapeHtml(context.first_name || "there")}, your Guest App is live at <strong>${escapeHtml(url)}</strong>. Share the link, or print the QR code for your tables and window.`,
          `Guests add it to their home screen like this:${steps}`,
          "Need to change specials, the menu or hours? Use the update button below anytime while your plan is active. Changes go live within minutes.",
          "Included in your plan: notifications to guests who turn them on (up to 2 a day, and automatically when you post a new special if you chose that), and a rewards card. To start rewards, write the reward on the update form, then keep the counter screen open by the till: guests type its code in the app to collect a visit."
        ],
        buttons: [{ label: "Open my app", url, primary: true }, { label: "Download the QR code", url: `${url}qr.svg` }, ...(update ? [{ label: "Update my app", url: update }] : []), ...(push ? [{ label: "Send a notification", url: push }] : []), ...(counter ? [{ label: "Rewards counter screen", url: counter }] : [])],
        footnote: "Questions? Reply to this email."
      }),
      text: [`Hi ${context.first_name || "there"},`, "", `Your Guest App is live: ${url}`, `QR code to print: ${url}qr.svg`, "", ...INSTALL_STEPS.map(([who, how]) => `${who}: ${how}`), "", ...(update ? [`Update your app anytime: ${update}`] : []), ...(push ? [`Send a notification: ${push}`] : []), ...(counter ? [`Rewards counter screen: ${counter}`] : [])].join("\n")
    };
  }
};

export { appPreviewUrl, guestAppOverrides };
