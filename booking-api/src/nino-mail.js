// Mail relay for the Nino shirt shop (worker nino-printful-commerce-api).
//
// The shop reaches this only through a Cloudflare service binding to the named entrypoint "NinoMail"; named
// entrypoints have no public route, so nothing on the internet can call it. It sends with this worker's
// RESEND_API_KEY under Nino's name, so the shop needs no email key of its own. The shop builds the message
// (its own branding); this only fixes the sender and reply-to and checks the shape.

import { skipSelfTestSend } from "./lib/email.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const NINO_FROM = "Nino Battaglia <orders@updates.menu-made.com>";
export const NINO_REPLY_TO = "hello@ninobattaglia.com";
// Newsletter issues (the shop's newsletter.mjs) go out from a separate address and must carry a one-click
// unsubscribe (RFC 8058). Only the shop's own unsubscribe route is accepted, so a caller can't point it elsewhere.
export const NINO_NEWS_FROM = "Nino Battaglia <news@updates.menu-made.com>";
const UNSUBSCRIBE = /^https:\/\/nino-printful-commerce-api\.ijpbattaglia\.workers\.dev\/api\/unsubscribe\?t=[a-f0-9]{48}$/;

const looksLikeEmail = (value) => typeof value === "string" && value.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value);

export async function sendNinoMail(env, message, fetcher = fetch) {
  const { to, subject, html, text, kind, unsubscribe } = message || {};
  const news = kind === "news";
  if (kind != null && !news) throw new Error("nino_mail_invalid_kind");
  if (news && !UNSUBSCRIBE.test(String(unsubscribe || ""))) throw new Error("nino_mail_news_needs_unsubscribe");
  if (!looksLikeEmail(to)) throw new Error("nino_mail_invalid_recipient");
  if (typeof subject !== "string" || !subject || subject.length > 200) throw new Error("nino_mail_invalid_subject");
  if (typeof html !== "string" || html.length > 200000 || (text != null && (typeof text !== "string" || text.length > 50000))) throw new Error("nino_mail_invalid_body");
  if (!env.RESEND_API_KEY) throw new Error("nino_mail_not_configured");
  // The shop's self-test buyer skips Resend after the day's first real self-test send (owner decision, Oct 30, 2026).
  if (await skipSelfTestSend(env, to)) return { id: `dry-${crypto.randomUUID()}` };
  const response = await fetcher(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: news ? NINO_NEWS_FROM : NINO_FROM, to: [to], reply_to: NINO_REPLY_TO, subject, html, ...(text ? { text } : {}),
      ...(news ? { headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}) })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`nino_mail_resend_${response.status}: ${String(body?.message || "").slice(0, 160)}`);
  return { id: body?.id || null };
}
