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
import { ImapFlow } from "imapflow";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { build } from "./email.mjs";
import { verify } from "./verify.mjs";
import { chromium } from "playwright";

const API = "https://menu-made.com/api/system/prospects";
const FROM = { name: "JP Battaglia", address: "info@menu-made.com" };
const LIMIT = Number(process.env.BATCH_SIZE || 25);
// PREVIEW=1: browser checks only (no iCloud Mail): confirmed gaps are saved on the prospect, the rest are SKIPPED.
const PREVIEW = process.env.PREVIEW === "1" || process.env.PREVIEW === "true";
// REFRESH=1: rebuild the drafts still in Drafts (after a design or wording change). Sent emails are never touched.
const REFRESH = process.env.REFRESH === "1" || process.env.REFRESH === "true";
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

const client = PREVIEW ? null : new ImapFlow({ host: "imap.mail.me.com", port: 993, secure: true, logger: false,
  auth: { user: process.env.ICLOUD_USER, pass: process.env.ICLOUD_APP_PASSWORD } });
let draftsBox = null, sentBox = null;
if (!PREVIEW) {
  await client.connect();
  const boxes = await client.list();
  const special = (use, fallback) => boxes.find((b) => b.specialUse === use)?.path || boxes.find((b) => fallback.test(b.path))?.path;
  draftsBox = special("\\Drafts", /^drafts$/i);
  sentBox = special("\\Sent", /^sent( messages)?$/i);
  if (!draftsBox) throw new Error("No Drafts folder found in iCloud Mail");
}

// 1. Status sync.
const since = new Date(Date.now() - 45 * 86400000);
const updates = [];
if (sentBox) {
  const lock = await client.getMailboxLock(sentBox);
  try {
    for await (const m of client.fetch({ since }, { envelope: true })) {
      for (const to of m.envelope?.to || []) if (to.address) updates.push({ email: to.address.toLowerCase(), status: "SENT" });
    }
  } finally { lock.release(); }
}
let replies = 0, optOuts = 0;
if (!PREVIEW) {
  const lock = await client.getMailboxLock("INBOX");
  try {
    for await (const m of client.fetch({ since }, { envelope: true, source: { maxLength: 20000 } })) {
      const from = m.envelope?.from?.[0]?.address?.toLowerCase();
      if (!from || from.endsWith("@menu-made.com")) continue;
      const text = m.source ? m.source.toString("utf8") : "";
      const out = OPT_OUT.test(`${m.envelope?.subject || ""}\n${text.split(/\r?\n\r?\n/).slice(1).join("\n").slice(0, 4000)}`);
      updates.push({ email: from, status: out ? "OPTED_OUT" : "REPLIED" });
    }
  } finally { lock.release(); }
}
// The worker only moves rows that are prospects, and only forward (an opt-out is final).
for (let k = 0; k < updates.length; k += 400) {
  const r = await api("status", { updates: updates.slice(k, k + 400) });
  const part = updates.slice(k, k + 400);
  replies += part.filter((u) => u.status === "REPLIED").length; optOuts += part.filter((u) => u.status === "OPTED_OUT").length;
  console.log(`Status sync: ${r.changed} prospect rows updated`);
}

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

// 2. This week's drafts. Every claim is re-checked in a phone-size browser first (verify.mjs); a prospect whose gaps
// don't hold up is SKIPPED and never emailed. Candidates are taken three times over so the week still gets LIMIT.
const { prospects } = await api("batch", { limit: Math.min(50, LIMIT * 3) });
const browser = await chromium.launch();
const drafted = [], skipped = [];
for (const candidate of prospects) {
  if (drafted.length >= LIMIT) break;
  const checked = await verify(browser, candidate).catch(() => null);
  if (!checked) { skipped.push({ id: candidate.id, status: "SKIPPED" }); continue; }
  const p = { ...candidate, gaps_json: JSON.stringify(checked.gaps), offer_code: checked.offer_code, email: checked.email };
  if (PREVIEW) { drafted.push({ id: p.id, status: "NEW", gaps: checked.gaps, offer_code: checked.offer_code }); continue; }
  const confirmed = { gaps: checked.gaps, offer_code: checked.offer_code };
  const email = build(p);
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
await client.logout();
console.log(`Drafts added to iCloud Mail: ${drafted.length} (asked for ${LIMIT}); ${skipped.length} candidates skipped because their gaps didn't hold up in a browser.`);
