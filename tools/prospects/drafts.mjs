// Marketing: the iCloud side of prospect outreach (info@menu-made.com). Run by .github/workflows/prospect-drafts.yml.
//
// Nov 16, 2026 (owner: "Emails are getting no response", then "Do all"): this job no longer writes drafts. Every
// prospect email, first and follow-up, now goes out by itself from jp@getmenumade.com (send.mjs), so nothing piles up
// in the owner's Drafts. What's left here:
// 1. Status sync, so nobody is emailed twice: addresses in Sent from the last 45 days -> SENT; replies in the inbox
//    from the last 45 days -> REPLIED, or OPTED_OUT when they say no thanks / unsubscribe / remove / stop; bounces.
// 2. Clean-up: prospect drafts this job made earlier and the owner never sent are removed from Drafts, and the worker
//    is told (prospects/release) so those businesses go back to the auto-sender: a first email, a follow-up, or
//    nothing for a holiday draft to someone already emailed (two emails per business at most).
//
// Secrets: ICLOUD_USER (the Apple ID email used for iCloud Mail), ICLOUD_APP_PASSWORD (an app-specific password).
// The repository is public: the log shows counts only.
import { isAutoReply } from "./auto-reply.mjs";
import { ImapFlow } from "imapflow";

const API = "https://menu-made.com/api/system/prospects";
// PREVIEW=1: sync and list the clean-up, but delete nothing.
const PREVIEW = process.env.PREVIEW === "1" || process.env.PREVIEW === "true";
const OPT_OUT = /\b(no thanks|no thank you|unsubscribe|remove me|take me off|stop emailing|not interested|do not (contact|email))\b/i;

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
const client = new ImapFlow({ host: "imap.mail.me.com", port: 993, secure: true, logger: false,
  auth: { user: process.env.ICLOUD_USER, pass: process.env.ICLOUD_APP_PASSWORD } });
let draftsBox = null, sentBox = null, sentBoxes = [], inboxBoxes = ["INBOX"];
{
  await client.connect();
  const boxes = await client.list();
  const special = (use, fallback) => boxes.find((b) => b.specialUse === use)?.path || boxes.find((b) => fallback.test(b.path))?.path;
  draftsBox = special("\\Drafts", /^drafts$/i);
  sentBox = special("\\Sent", /^sent( messages)?$/i);
  if (!draftsBox) throw new Error("No Drafts folder found in iCloud Mail");
  // iCloud keeps two Sent folders (Apple Mail saves to "Sent Messages") and several junk folders; read them all.
  sentBoxes = boxes.filter((b) => b.specialUse === "\\Sent" || /^sent( messages| items)?$/i.test(b.path)).map((b) => b.path);
  inboxBoxes = ["INBOX", ...boxes.filter((b) => b.specialUse === "\\Junk" || /^junk( e-?mail)?$/i.test(b.path)).map((b) => b.path)];
  console.log(`Folders: ${boxes.map((b) => `${b.path}${b.specialUse ? ` (${b.specialUse})` : ""}`).join(", ")}`);
}

// 1. Status sync.
const since = new Date(Date.now() - 45 * 86400000);
const updates = [];
for (const sentBox of sentBoxes) {
  const lock = await client.getMailboxLock(sentBox);
  try {
    let n = 0;
    for await (const m of client.fetch({ since }, { envelope: true })) {
      n++;
      for (const to of m.envelope?.to || []) if (to.address) updates.push({ email: to.address.toLowerCase(), status: "SENT", ...(m.envelope?.date ? { sent_at: new Date(m.envelope.date).toISOString() } : {}) });
    }
    console.log(`Sent folder "${sentBox}": ${n} messages in the last 45 days`);
  } finally { lock.release(); }
}
let replies = 0, optOuts = 0, bounces = 0;
for (const inboxBox of inboxBoxes) {
  const lock = await client.getMailboxLock(inboxBox);
  try {
    let n = 0;
    for await (const m of client.fetch({ since }, { envelope: true, source: { maxLength: 60000 } })) {
      n++;
      const from = m.envelope?.from?.[0]?.address?.toLowerCase();
      if (!from || from.endsWith("@menu-made.com")) continue;
      const text = m.source ? m.source.toString("utf8") : "";
      // Delivery failures (Nov 1, 2026: the first sends bounced 3): the failed address is in the report.
      // Any standard delivery-failure report counts, whatever its sender or subject (Nov 5, 2026: one was missed).
      if (/^(mailer-daemon|postmaster)@/i.test(from) || /undeliver|not delivered|delivery (status notification|has failed|failure|incomplete)|returned mail|failure notice|could not be delivered|mail delivery failed/i.test(m.envelope?.subject || "") || /final-recipient:|diagnostic-code:|action:\s*failed|status:\s*5\.\d+\.\d+|address not found|user unknown|no such user|mailbox (unavailable|not found|does not exist)|recipient address rejected/i.test(text.slice(0, 20000))) {
        const failed = new Set();
        for (const r of text.matchAll(/(?:final|original)-recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)/gi)) failed.add(r[1].toLowerCase());
        if (!failed.size) for (const r of text.matchAll(/(?:^|[\s<:])([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24})/gim)) {
          const a = r[1].toLowerCase(); if (!/menu-made\.com$|icloud\.com$|me\.com$|mac\.com$|apple\.com$/.test(a)) failed.add(a);
        }
        for (const a of failed) updates.push({ email: a, status: "BOUNCED" });
        bounces += failed.size;
        continue;
      }
      if (isAutoReply(text, m.envelope?.subject || "")) continue; // auto-responses are not replies (Nov 12, 2026)
      const out = OPT_OUT.test(`${m.envelope?.subject || ""}\n${text.split(/\r?\n\r?\n/).slice(1).join("\n").slice(0, 4000)}`);
      updates.push({ email: from, status: out ? "OPTED_OUT" : "REPLIED" });
    }
    console.log(`${inboxBox}: ${n} messages in the last 45 days`);
  } finally { lock.release(); }
}
// The worker only moves rows that are prospects, and only forward (an opt-out is final).
for (let k = 0; k < updates.length; k += 400) {
  const r = await api("status", { updates: updates.slice(k, k + 400) });
  const part = updates.slice(k, k + 400);
  replies += part.filter((u) => u.status === "REPLIED").length; optOuts += part.filter((u) => u.status === "OPTED_OUT").length;
  console.log(`Status sync: ${r.changed} prospect rows updated (delivery failures found: ${bounces})`);
}

// 2. Clean-up of unsent prospect drafts (see the top of this file).
const lock = await client.getMailboxLock(draftsBox);
const found = { first: [], followup: [], holiday: [] }; const uids = [];
try {
  // An empty Drafts folder answers "1:*" with "Invalid message number" (Nov 10, 2026).
  if (client.mailbox?.exists) for await (const m of client.fetch("1:*", { uid: true, headers: ["x-menu-made-prospect", "x-menu-made-holiday", "x-menu-made-followup"] })) {
    const headers = m.headers?.toString() || "";
    const id = /x-menu-made-prospect:\s*(\S+)/i.exec(headers)?.[1];
    if (!id) continue; // only drafts this job made; the owner's own drafts are never touched
    found[/x-menu-made-holiday:/i.test(headers) ? "holiday" : /x-menu-made-followup:/i.test(headers) ? "followup" : "first"].push(id);
    uids.push(m.uid);
  }
  if (uids.length && !PREVIEW) await client.messageDelete(uids.join(","), { uid: true });
} finally { lock.release(); }
const released = uids.length && !PREVIEW ? await api("release", found) : { changed: 0 };
await client.logout();
console.log(`Unsent prospect drafts removed from Drafts: ${uids.length} (${found.first.length} first, ${found.followup.length} follow-up, ${found.holiday.length} holiday); ${released.changed} businesses handed to the auto-sender.`);
