// Marketing (Nov 1, 2026, owner choice): the week's prospect emails as drafts in info@menu-made.com (iCloud Mail).
// Run by .github/workflows/prospect-drafts.yml with imapflow and nodemailer installed. The owner opens Apple Mail,
// reviews each draft in Drafts and taps Send; nothing is sent by this job.
//
// 1. Status sync, so nobody is emailed twice: addresses in Sent from the last 45 days -> SENT; replies in the inbox
//    from the last 45 days -> REPLIED, or OPTED_OUT when they say no thanks / unsubscribe / remove / stop.
// 2. The week's batch (default 25) from the private database, each built by email.mjs with the logo inline, appended
//    to Drafts (\Draft flag), then marked DRAFTED.
//
// Secrets: ICLOUD_USER (the Apple ID email used for iCloud Mail), ICLOUD_APP_PASSWORD (an app-specific password).
// The repository is public: the log shows counts only.
import { readFileSync } from "node:fs";
import { resolveMx } from "node:dns/promises";
import { ImapFlow } from "imapflow";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { build, buildFollowup, buildFirstFollowup } from "./email.mjs";
import { verify } from "./verify.mjs";
import { makePreview } from "./preview.mjs";
import { chromium } from "playwright";

const API = "https://menu-made.com/api/system/prospects";
const FROM = { name: "JP Battaglia", address: "info@menu-made.com" };
const LIMIT = Number(process.env.BATCH_SIZE || 25);
// PREVIEW=1: browser checks only (no iCloud Mail): confirmed gaps are saved on the prospect, the rest are SKIPPED.
const PREVIEW = process.env.PREVIEW === "1" || process.env.PREVIEW === "true";
// REFRESH=1: rebuild the drafts still in Drafts (after a design or wording change). Sent emails are never touched.
const REFRESH = process.env.REFRESH === "1" || process.env.REFRESH === "true";
// SYNC_ONLY=1: record sent mail, replies, opt-outs and bounces; add no drafts.
// FOLLOWUPS_ONLY=1 (Thursday run): after the sync, add only the day-3 follow-up drafts (marketing plan v4).
const FOLLOWUPS_ONLY = process.env.FOLLOWUPS_ONLY === "1" || process.env.FOLLOWUPS_ONLY === "true";
const SYNC_ONLY = process.env.SYNC_ONLY === "1" || process.env.SYNC_ONLY === "true";
const OPT_OUT = /\b(no thanks|no thank you|unsubscribe|remove me|take me off|stop emailing|not interested|do not (contact|email))\b/i;
const logo = readFileSync(new URL("./assets/email-logo.png", import.meta.url));

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
const raw = (mail) => new Promise((resolve, reject) => new MailComposer(mail).compile().build((e, m) => (e ? reject(e) : resolve(m))));

// Day-3 follow-ups (marketing plan v4): sent prospects who opened their menu preview 3+ days ago and haven't replied,
// plus (Nov 5, 2026) prospects emailed before previews existed: their menu preview is built now when their menu is a
// file, otherwise they get a short follow-up about their offer. One draft each, ever; the worker records it.
async function addFollowups() {
  const { prospects: due = [], price } = await api("followups", {});
  const done = [];
  let built = 0;
  for (const p of due) {
    let email;
    if (p.kind === "no_preview") {
      const preview = await makePreview(api, p);
      if (preview) built++;
      email = buildFirstFollowup({ ...p, offer_code: preview?.offer_code || p.offer_code }, preview?.url || null, price, preview?.kind);
    } else email = buildFollowup(p, price);
    if (!email) continue;
    const message = await raw({ from: FROM, to: p.email, subject: email.subject, text: email.text, html: email.html,
      attachments: [{ filename: "menu-made.png", content: logo, cid: "logo@menu-made", contentDisposition: "inline" }],
      headers: { "X-Menu-Made-Prospect": p.id, "X-Menu-Made-Followup": "1" } });
    await client.append(draftsBox, message, ["\\Draft", "\\Seen"]);
    done.push(p.id);
  }
  if (done.length) await api("followups", { mark: done });
  console.log(`Follow-up drafts added: ${done.length} (${built} with a menu preview built for the follow-up)`);
}

const client = PREVIEW ? null : new ImapFlow({ host: "imap.mail.me.com", port: 993, secure: true, logger: false,
  auth: { user: process.env.ICLOUD_USER, pass: process.env.ICLOUD_APP_PASSWORD } });
let draftsBox = null, sentBox = null, sentBoxes = [], inboxBoxes = ["INBOX"];
if (!PREVIEW) {
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
if (!PREVIEW) for (const inboxBox of inboxBoxes) {
  const lock = await client.getMailboxLock(inboxBox);
  try {
    let n = 0;
    for await (const m of client.fetch({ since }, { envelope: true, source: { maxLength: 60000 } })) {
      n++;
      const from = m.envelope?.from?.[0]?.address?.toLowerCase();
      if (!from || from.endsWith("@menu-made.com")) continue;
      const text = m.source ? m.source.toString("utf8") : "";
      // Delivery failures (Nov 1, 2026: the first sends bounced 3): the failed address is in the report.
      if (/^(mailer-daemon|postmaster)@/i.test(from) || /undeliver|delivery (status notification|has failed|failure)|returned mail|failure notice|could not be delivered/i.test(m.envelope?.subject || "")) {
        const failed = new Set();
        for (const r of text.matchAll(/(?:final|original)-recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)/gi)) failed.add(r[1].toLowerCase());
        if (!failed.size) for (const r of text.matchAll(/(?:^|[\s<:])([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24})/gim)) {
          const a = r[1].toLowerCase(); if (!/menu-made\.com$|icloud\.com$|me\.com$|mac\.com$|apple\.com$/.test(a)) failed.add(a);
        }
        for (const a of failed) updates.push({ email: a, status: "BOUNCED" });
        bounces += failed.size;
        continue;
      }
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

if (SYNC_ONLY) { await client.logout(); console.log("Sync only: no drafts added."); process.exit(0); }
if (FOLLOWUPS_ONLY) { await addFollowups(); await client.logout(); process.exit(0); }
if (REFRESH) {
  const lock = await client.getMailboxLock(draftsBox);
  const old = [];
  try {
    for await (const m of client.fetch("1:*", { uid: true, headers: ["x-menu-made-prospect"] })) {
      const id = /x-menu-made-prospect:\s*(\S+)/i.exec(m.headers?.toString() || "")?.[1];
      if (id) old.push({ uid: m.uid, id });
    }
  } finally { lock.release(); }
  const { prospects: rows } = await api("batch", { ids: [...new Set(old.map((o) => o.id))] });
  let rebuilt = 0;
  for (const p of rows) {
    const email = build(p);
    if (!email) continue;
    const message = await raw({ from: FROM, to: p.email, subject: email.subject, text: email.text, html: email.html,
      attachments: [{ filename: "menu-made.png", content: logo, cid: "logo@menu-made", contentDisposition: "inline" }],
      headers: { "X-Menu-Made-Prospect": p.id } });
    await client.append(draftsBox, message, ["\\Draft", "\\Seen"]);
    const uids = old.filter((o) => o.id === p.id).map((o) => o.uid);
    const l2 = await client.getMailboxLock(draftsBox);
    try { await client.messageDelete(uids.join(","), { uid: true }); } finally { l2.release(); }
    rebuilt++;
  }
  await client.logout();
  console.log(`Refreshed ${rebuilt} drafts still in Drafts (${old.length} found).`);
  process.exit(0);
}

// Once the getmenumade.com sender has warmed up (send.mjs), it sends the new prospects itself and the iCloud drafts
// stop (owner, Nov 5, 2026); follow-ups for prospects the owner sent from iCloud still arrive here as drafts.
const plan = await api("send-plan", {}).catch(() => null);
if (plan?.warmup_done && !PREVIEW) {
  await addFollowups(); await client.logout();
  console.log("New prospects now go out automatically from jp@getmenumade.com; only follow-up drafts were added.");
  process.exit(0);
}

// 2. This week's drafts. Every claim is re-checked in a phone-size browser first (verify.mjs); a prospect whose gaps
// don't hold up is SKIPPED and never emailed. Candidates are taken three times over so the week still gets LIMIT.
const { prospects } = await api("batch", { limit: Math.min(50, LIMIT * 3) });
const browser = await chromium.launch();
const drafted = [], skipped = [];
let previews = 0;
for (const candidate of prospects) {
  if (drafted.length >= LIMIT) break;
  // The address's domain must accept mail at all (no mail server = a sure bounce).
  const mx = await resolveMx(String(candidate.email).split("@")[1]).catch(() => []);
  if (!mx.length) { skipped.push({ id: candidate.id, status: "SKIPPED" }); continue; }
  const checked = await verify(browser, candidate).catch(() => null);
  if (!checked) { skipped.push({ id: candidate.id, status: "SKIPPED" }); continue; }
  const p = { ...candidate, gaps_json: JSON.stringify(checked.gaps), offer_code: checked.offer_code, email: checked.email };
  if (PREVIEW) { drafted.push({ id: p.id, status: "NEW", gaps: checked.gaps, offer_code: checked.offer_code }); continue; }
  const confirmed = { gaps: checked.gaps, offer_code: checked.offer_code };
  // Marketing plan v4: each prospect's own menu (as a phone page) or business (as a website) is built first.
  // Any failure just means the email goes out without the preview.
  await api("status", { updates: [{ id: p.id, status: "NEW", ...confirmed }] }).catch(() => null);
  const preview = await makePreview(api, p, checked.gaps);
  if (preview) { previews++; p.offer_code = preview.offer_code; confirmed.offer_code = preview.offer_code; }
  const demoUrl = preview?.url || null;
  const email = build(p, demoUrl, preview?.kind);
  if (!email) continue;
  const message = await raw({ from: FROM, to: p.email, subject: email.subject, text: email.text, html: email.html,
    attachments: [{ filename: "menu-made.png", content: logo, cid: "logo@menu-made", contentDisposition: "inline" }],
    headers: { "X-Menu-Made-Prospect": p.id } });
  await client.append(draftsBox, message, ["\\Draft", "\\Seen"]);
  drafted.push({ id: p.id, status: "DRAFTED", ...confirmed });
}
await browser.close();
if (PREVIEW) {
  if (drafted.length || skipped.length) await api("status", { updates: [...drafted, ...skipped] });
  console.log(`Preview: ${drafted.length} prospects confirmed in a browser, ${skipped.length} skipped. Nothing was drafted or sent.`);
  process.exit(0);
}
if (drafted.length || skipped.length) await api("status", { updates: [...drafted, ...skipped] });
await addFollowups();
await client.logout();
console.log(`Drafts added to iCloud Mail: ${drafted.length} (asked for ${LIMIT}), ${previews} with a menu preview; ${skipped.length} candidates skipped because their gaps didn't hold up in a browser.`);
