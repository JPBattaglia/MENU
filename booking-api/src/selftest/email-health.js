// Stage 12, task 6: email health (EMAIL_HEALTH). Once a day at 21:30 UTC (before the 22:00 report), in one pass:
//   1. Sending domain: Resend says updates.menu-made.com is verified, with every DNS record verified (DKIM and the
//      SPF/MX for its bounce subdomain). Every email, Menu-made's and Nino's, is sent from that domain.
//   2. DNS, read from Cloudflare's public resolver: the DKIM key and bounce-domain SPF are published; menu-made.com
//      and ninobattaglia.com each have a DMARC policy, mail servers (MX, for replies to info@ and hello@) and at most
//      one SPF record. A DMARC policy of p=none is noted, not failed.
//   3. Templates: every email sent in the last 3 days rendered cleanly (no "undefined", "NaN", "[object Object]",
//      unfilled ${...} or {{...}}, no empty subject). sendTransactionalEmail checks each message as it's sent and
//      keeps the findings on its communications row, so this covers every template that actually ran, including
//      all those the daily self-tests send to the self-test buyer.
//   4. Sending: no email failed to send in the last day, and none of the latest real-customer emails bounced or
//      was marked as spam (Resend's last event for each).
// Start one now by inserting a self_tests row with kind EMAIL_HEALTH and status REQUESTED.
import { nowIso } from "../lib/http.js";
import { SELF_TEST_EMAIL } from "../lib/email.js";
import { dailyClock } from "./daily-clock.js";

const KIND = "EMAIL_HEALTH";
const DAILY_HOUR_UTC = 21;
const DAILY_MINUTE_FROM = 30;
const SENDING_DOMAIN = "updates.menu-made.com";
const ROOT_DOMAINS = ["menu-made.com", "ninobattaglia.com"];
const RESEND_API = "https://api.resend.com";
const DOH = "https://cloudflare-dns.com/dns-query";
const BOUNCE_SAMPLE = 10;

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now) return;
  if (now.getUTCHours() !== DAILY_HOUR_UTC || now.getUTCMinutes() < DAILY_MINUTE_FROM || now.getUTCMinutes() >= DAILY_MINUTE_FROM + 20) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = now.toISOString();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

// TXT/MX answers from Cloudflare's DNS-over-HTTPS resolver. Returns an array of strings (TXT joined, MX as given).
async function dnsLookup(fetcher, name, type) {
  const response = await fetcher(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" } });
  if (!response.ok) throw new Error(`DNS lookup for ${name} ${type} returned HTTP ${response.status}`);
  const data = await response.json();
  const code = type === "TXT" ? 16 : 15;
  return (data.Answer || []).filter((a) => a.type === code).map((a) => type === "TXT" ? String(a.data).replace(/^"|"$/g, "").replace(/"\s*"/g, "") : String(a.data));
}

async function resendGet(fetcher, env, path) {
  const response = await fetcher(`${RESEND_API}${path}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
  let data = null; try { data = await response.json(); } catch { data = null; }
  if (response.status === 401 || response.status === 403) return { restricted: true, data };
  if (!response.ok) throw new Error(`Resend ${path} returned HTTP ${response.status}${data?.message ? `: ${data.message}` : ""}`);
  return { data };
}

async function checkEmailHealth(env, fetcher, now = Date.now()) {
  const problems = []; const notes = [];

  // 1. Resend's own view of the sending domain.
  if (!env.RESEND_API_KEY) problems.push("Resend: the email key isn't on the worker");
  else {
    const list = await resendGet(fetcher, env, "/domains");
    if (list.restricted) notes.push("Resend key can only send, so domain status was read from DNS alone");
    else {
      const domain = (list.data?.data || []).find((d) => d.name === SENDING_DOMAIN);
      if (!domain) problems.push(`Resend: ${SENDING_DOMAIN} isn't set up as a sending domain`);
      else if (domain.status !== "verified") problems.push(`Resend: ${SENDING_DOMAIN} is ${domain.status}, not verified`);
      else {
        const detail = await resendGet(fetcher, env, `/domains/${domain.id}`);
        const bad = (detail.data?.records || []).filter((r) => r.status && r.status !== "verified");
        if (bad.length) problems.push(`Resend: ${bad.map((r) => `${r.record || r.type} ${r.name} is ${r.status}`).join(", ")}`);
        else notes.push(`Resend: ${SENDING_DOMAIN} verified, every record verified`);
      }
    }
  }

  // 2. DNS.
  const dkim = await dnsLookup(fetcher, `resend._domainkey.${SENDING_DOMAIN}`, "TXT");
  if (!dkim.some((v) => /p=[A-Za-z0-9+/]/.test(v))) problems.push(`DNS: no DKIM key at resend._domainkey.${SENDING_DOMAIN}`);
  const bounceSpf = await dnsLookup(fetcher, `send.${SENDING_DOMAIN}`, "TXT");
  const bounceSpfRecords = bounceSpf.filter((v) => /^v=spf1\b/i.test(v));
  if (bounceSpfRecords.length !== 1) problems.push(`DNS: send.${SENDING_DOMAIN} has ${bounceSpfRecords.length} SPF records (needs exactly 1)`);
  if (dkim.length && bounceSpfRecords.length === 1) notes.push(`DNS: DKIM and SPF published for ${SENDING_DOMAIN}`);

  for (const root of ROOT_DOMAINS) {
    const dmarc = (await dnsLookup(fetcher, `_dmarc.${root}`, "TXT")).filter((v) => /^v=DMARC1\b/i.test(v));
    if (dmarc.length !== 1) problems.push(`DNS: ${root} has ${dmarc.length} DMARC records (needs exactly 1)`);
    else {
      const policy = (dmarc[0].match(/\bp=(\w+)/i) || [])[1]?.toLowerCase() || "missing";
      if (policy === "missing") problems.push(`DNS: the DMARC record for ${root} has no policy (p=)`);
      else notes.push(`DNS: ${root} DMARC p=${policy}${policy === "none" ? " (monitoring only; fine for now)" : ""}`);
    }
    const spf = (await dnsLookup(fetcher, root, "TXT")).filter((v) => /^v=spf1\b/i.test(v));
    if (spf.length > 1) problems.push(`DNS: ${root} has ${spf.length} SPF records; receivers treat that as no SPF`);
    else if (!spf.length) notes.push(`DNS: ${root} has no SPF record of its own (mail is sent from ${SENDING_DOMAIN}, so this only affects spoofing)`);
    const mx = await dnsLookup(fetcher, root, "MX");
    if (!mx.length) problems.push(`DNS: ${root} has no mail server (MX), so replies to it bounce`);
  }

  // 3. Templates that rendered with leftovers in the last 3 days.
  const since3 = new Date(now - 3 * 86400000).toISOString();
  const linted = (await env.DB.prepare(`SELECT template_key, metadata_json FROM communications WHERE created_at > ? AND metadata_json LIKE '%"lint"%' ORDER BY created_at DESC LIMIT 50`).bind(since3).all()).results || [];
  const byTemplate = new Map();
  for (const row of linted) {
    let lint = []; try { lint = JSON.parse(row.metadata_json || "{}").lint || []; } catch { lint = []; }
    if (lint.length && !byTemplate.has(row.template_key)) byTemplate.set(row.template_key, lint);
  }
  if (byTemplate.size) problems.push(`Templates: ${[...byTemplate].slice(0, 6).map(([k, l]) => `${k} (${l.join(", ")})`).join("; ")}`);
  const sent = await env.DB.prepare(`SELECT COUNT(DISTINCT template_key) AS n FROM communications WHERE created_at > ? AND channel = 'EMAIL'`).bind(since3).first();
  notes.push(`${sent?.n || 0} email templates sent in 3 days, ${byTemplate.size} with render problems`);

  // 4. Send failures (last day) and bounces or spam reports among the latest real-customer emails.
  const since1 = new Date(now - 86400000).toISOString();
  const failed = (await env.DB.prepare(`SELECT template_key, error_message FROM communications WHERE created_at > ? AND channel = 'EMAIL' AND status = 'FAILED' ORDER BY created_at DESC LIMIT 20`).bind(since1).all()).results || [];
  if (failed.length) problems.push(`Sending: ${failed.length} email${failed.length === 1 ? "" : "s"} failed to send in the last day (e.g. ${failed[0].template_key}: ${String(failed[0].error_message || "").slice(0, 120)})`);
  if (env.RESEND_API_KEY) {
    const recent = (await env.DB.prepare(`SELECT template_key, recipient, provider_message_id FROM communications WHERE created_at > ? AND channel = 'EMAIL' AND status = 'SENT' AND provider_message_id IS NOT NULL AND recipient != ? AND recipient NOT LIKE '%@resend.dev' ORDER BY created_at DESC LIMIT ?`).bind(since3, SELF_TEST_EMAIL, BOUNCE_SAMPLE).all()).results || [];
    const bounced = []; let read = 0; let restricted = false;
    for (const row of recent) {
      const got = await resendGet(fetcher, env, `/emails/${row.provider_message_id}`).catch(() => null);
      if (!got) continue;
      if (got.restricted) { restricted = true; break; }
      read += 1;
      if (["bounced", "complained"].includes(got.data?.last_event)) bounced.push(`${row.template_key} ${got.data.last_event}`);
    }
    if (bounced.length) problems.push(`Sending: ${bounced.length} of the latest customer emails ${bounced.length === 1 ? "was" : "were"} not accepted (${bounced.join(", ")})`);
    else if (read) notes.push(`latest ${read} customer emails delivered (no bounces or spam reports)`);
    else if (!restricted) notes.push("no real-customer emails in 3 days to sample");
  }
  return { problems, notes };
}

async function advanceEmailHealthSelfTests(env, deps = {}) {
  if (!env.DB) return [];
  await maybeScheduleDaily(env, deps.now).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status = 'REQUESTED' ORDER BY created_at LIMIT 1`).bind(KIND).all()).results || [];
  const out = [];
  for (const test of tests) {
    const t = nowIso();
    await env.DB.prepare(`UPDATE self_tests SET status = 'RUNNING', stage = 'CHECK', stage_started_at = ?, updated_at = ? WHERE id = ? AND status = 'REQUESTED'`).bind(t, t, test.id).run();
    let status = "PASSED"; let error = null; let log = [];
    try {
      const { problems, notes } = await checkEmailHealth(env, deps.fetch || ((u, o) => fetch(u, o)), deps.clock ? deps.clock() : Date.now());
      log = notes.map((note) => ({ at: nowIso(), stage: "CHECK", note }));
      if (problems.length) { status = "FAILED"; error = `${problems.length} problem${problems.length === 1 ? "" : "s"}: ${problems.join(" | ")}`.slice(0, 1000); }
    } catch (e) { status = "FAILED"; error = `The email check didn't finish: ${String(e?.message || e).slice(0, 300)}`; }
    const done = nowIso();
    await env.DB.prepare(`UPDATE self_tests SET status = ?, stage = 'DONE', error = ?, log_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
      .bind(status, error, JSON.stringify(log), done, done, test.id).run();
    out.push({ id: test.id, status });
  }
  return out;
}

export { KIND as EMAIL_HEALTH_KIND, advanceEmailHealthSelfTests, checkEmailHealth, maybeScheduleDaily };
