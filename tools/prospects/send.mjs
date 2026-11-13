// Auto-sent outreach (owner decision, Nov 5, 2026): cold prospect emails go out from jp@getmenumade.com (Zoho Mail
// Lite), a separate domain bought for this so menu-made.com and the iCloud inboxes (info@, jp@) are never at risk.
// Run on weekdays by .github/workflows/prospect-drafts.yml (the "send" run). Does nothing until the ZOHO_APP_PASSWORD
// repository secret exists.
//
// 1. Reply sync from the Zoho inbox: bounces -> BOUNCED; replies -> REPLIED, or OPTED_OUT for no thanks /
//    unsubscribe; every new reply is forwarded to info@menu-made.com (Reply-To = the prospect) so JP answers from
//    his normal inbox. Forwarded messages get the $MMForwarded keyword so they are forwarded once.
// 2. The day's allowance from the worker's warm-up plan (send-plan: 3 a day at first, rising to 30 a day).
// 3. Day-3 follow-ups of earlier auto-sent prospects first, then new prospects, each checked exactly like the
//    drafts (mail server exists, gaps re-checked in a phone-size browser, menu preview built when possible).
//
// The repository is public: the log shows counts only.
import { readFileSync } from "node:fs";
import { resolveMx } from "node:dns/promises";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { build, buildFollowup, buildFirstFollowup, holidaySeasonNow } from "./email.mjs";
import { verify } from "./verify.mjs";
import { makePreview } from "./preview.mjs";
import { isAutoReply } from "./auto-reply.mjs";

const API = "https://menu-made.com/api/system/prospects";
const USER = process.env.ZOHO_USER || "jp@getmenumade.com";
const FROM = { name: "JP Battaglia", address: USER };
const FORWARD_TO = "info@menu-made.com";
const PASS = process.env.ZOHO_APP_PASSWORD;
const DRY = process.env.PREVIEW === "1" || process.env.PREVIEW === "true";
const OPT_OUT = /\b(no thanks|no thank you|unsubscribe|remove me|take me off|stop emailing|not interested|do not (contact|email))\b/i;
const logo = readFileSync(new URL("./assets/email-logo.png", import.meta.url));

if (!PASS) { console.log("Auto-sending is not connected yet (ZOHO_APP_PASSWORD secret). Nothing sent."); process.exit(0); }

async function token() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: u, ACTIONS_ID_TOKEN_REQUEST_TOKEN: t } = process.env;
  return (await (await fetch(`${u}&audience=menu-made-prospect-drafts`, { headers: { Authorization: `Bearer ${t}` } })).json()).value;
}
async function api(path, body) {
  const res = await fetch(`${API}/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${out.error || ""}`);
  return out;
}

const smtp = nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: USER, pass: PASS } });
const imap = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, logger: false, auth: { user: USER, pass: PASS } });
await smtp.verify();
await imap.connect();

// Prospect mail: the Menu-made design, an unsubscribe header, and the logo inline.
const mail = (p, email, extra = {}) => ({
  from: FROM, to: p.email, subject: email.subject, text: email.text, html: email.html,
  attachments: [{ filename: "menu-made.png", content: logo, cid: "logo@menu-made", contentDisposition: "inline" }],
  list: { unsubscribe: { url: `mailto:${USER}?subject=unsubscribe`, comment: "Unsubscribe" } },
  headers: { "X-Menu-Made-Prospect": p.id, ...extra }
});

// 1. Reply sync.
const boxes = await imap.list();
const folders = ["INBOX", ...boxes.filter((b) => b.specialUse === "\\Junk" || /^(spam|junk)$/i.test(b.path)).map((b) => b.path)];
const since = new Date(Date.now() - 45 * 86400000);
const updates = [];
let replies = 0, bounces = 0, forwarded = 0;
for (const folder of folders) {
  const lock = await imap.getMailboxLock(folder);
  try {
    const forward = [];
    for await (const m of imap.fetch({ since }, { uid: true, envelope: true, flags: true, source: { maxLength: 200000 } })) {
      const from = m.envelope?.from?.[0]?.address?.toLowerCase();
      if (!from || from === USER || from.endsWith("@getmenumade.com") || from.endsWith("@zoho.com") && !/mailer-daemon|postmaster/.test(from)) continue;
      const text = m.source ? m.source.toString("utf8") : "";
      const subject = m.envelope?.subject || "";
      // Any standard delivery-failure report counts, whatever its sender or subject (Nov 5, 2026: one was missed).
      if (/^(mailer-daemon|postmaster)@/i.test(from) || /undeliver|not delivered|delivery (status notification|has failed|failure|incomplete)|returned mail|failure notice|could not be delivered|mail delivery failed/i.test(subject) || /final-recipient:|diagnostic-code:|action:\s*failed|status:\s*5\.\d+\.\d+|address not found|user unknown|no such user|mailbox (unavailable|not found|does not exist)|recipient address rejected/i.test(text.slice(0, 20000))) {
        const failed = new Set();
        for (const r of text.matchAll(/(?:final|original)-recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)/gi)) failed.add(r[1].toLowerCase());
        if (!failed.size) for (const r of text.matchAll(/(?:^|[\s<:])([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24})/gim)) {
          const a = r[1].toLowerCase(); if (!/getmenumade\.com$|menu-made\.com$|zoho(mail)?\.com$/.test(a)) failed.add(a);
        }
        for (const a of failed) updates.push({ email: a, status: "BOUNCED" });
        bounces += failed.size;
        continue;
      }
      // Only answers to our own emails count (Zoho's welcome and notice mail is not a prospect reply).
      if (!m.envelope?.inReplyTo && !/^\s*re:/i.test(subject)) continue;
      if (isAutoReply(text, subject)) continue; // out-of-office and "we got your message" mail is not a reply
      const out = OPT_OUT.test(`${subject}\n${text.split(/\r?\n\r?\n/).slice(1).join("\n").slice(0, 4000)}`);
      updates.push({ email: from, status: out ? "OPTED_OUT" : "REPLIED" });
      replies++;
      if (!m.flags?.has("$MMForwarded")) forward.push({ uid: m.uid, from, name: m.envelope?.from?.[0]?.name || from, subject, source: m.source, optOut: out });
    }
    for (const f of forward) {
      if (DRY) continue;
      await smtp.sendMail({
        from: FROM, to: FORWARD_TO, replyTo: f.from,
        subject: `${f.optOut ? "Opted out" : "Prospect reply"}: ${f.subject || "(no subject)"}`,
        text: `${f.name} <${f.from}> replied to the getmenumade.com outreach${f.optOut ? " and asked not to be contacted again (they won't be)" : ""}.\nTheir full message is attached. Hit Reply to answer them from this inbox.`,
        attachments: f.source ? [{ filename: "reply.eml", content: f.source, contentType: "message/rfc822" }] : []
      });
      await imap.messageFlagsAdd(String(f.uid), ["$MMForwarded"], { uid: true });
      forwarded++;
    }
  } finally { lock.release(); }
}
for (let k = 0; k < updates.length; k += 400) await api("status", { updates: updates.slice(k, k + 400) });
console.log(`Reply sync: ${replies} replies (${forwarded} newly forwarded to the owner), ${bounces} bounces.`);

// 2. Today's allowance.
const plan = await api("send-plan", {});
console.log(`Warm-up business day ${plan.day}: ${plan.cap} a day, ${plan.sent_today} already sent today, ${plan.left} left.`);
let left = DRY ? 0 : plan.left;

// 3a. Follow-ups of earlier auto-sent prospects.
const { prospects: due = [], price } = await api("followups", { via: "getmenumade" });
const followed = [];
let built = 0;
for (const row of due) {
  if (left <= 0) break;
  // In the holiday season the follow-up closes with the Holiday Menu offer as well (owner, Nov 12, 2026).
  const p = { ...row, holiday_note: holidaySeasonNow() };
  let email;
  if (p.kind === "no_preview") {
    const preview = await makePreview(api, p);
    if (preview) built++;
    email = buildFirstFollowup({ ...p, offer_code: preview?.offer_code || p.offer_code }, preview?.url || null, price, preview?.kind);
  } else email = buildFollowup(p, price);
  if (!email) continue;
  await smtp.sendMail(mail(p, email, { "X-Menu-Made-Followup": "1" }));
  followed.push(p.id);
  left--;
}
if (followed.length) await api("followups", { mark: followed });

// 3b. New prospects.
const sent = [], skipped = [];
let previews = 0;
if (left > 0) {
  const { chromium } = await import("playwright");
  const { prospects } = await api("batch", { limit: Math.min(50, left * 3) });
  const browser = await chromium.launch();
  for (const candidate of prospects) {
    if (sent.length >= left) break;
    const mx = await resolveMx(String(candidate.email).split("@")[1]).catch(() => []);
    if (!mx.length) { skipped.push({ id: candidate.id, status: "SKIPPED" }); continue; }
    const checked = await verify(browser, candidate).catch(() => null);
    if (!checked) { skipped.push({ id: candidate.id, status: "SKIPPED" }); continue; }
    const p = { ...candidate, gaps_json: JSON.stringify(checked.gaps), offer_code: checked.offer_code, email: checked.email };
    // The preview is built while the prospect is still NEW; record the confirmed gaps first.
    await api("status", { updates: [{ id: p.id, status: "NEW", gaps: checked.gaps, offer_code: checked.offer_code }] });
    const preview = await makePreview(api, p, checked.gaps);
    if (preview) { previews++; p.offer_code = preview.offer_code; }
    const demoUrl = preview?.url || null;
    const email = build(p, demoUrl, preview?.kind);
    if (!email) continue;
    await smtp.sendMail(mail(p, email));
    sent.push({ id: p.id, status: "SENT", via: "getmenumade", sent_at: new Date().toISOString(), gaps: checked.gaps, offer_code: p.offer_code });
  }
  await browser.close();
}
if (sent.length || skipped.length) await api("status", { updates: [...sent, ...skipped] });
await imap.logout();
console.log(`Sent from ${USER}: ${sent.length} new (${previews} with a menu or website preview), ${followed.length} follow-ups (${built} previews built); ${skipped.length} candidates skipped.`);
