// On/off switches the owner flips from an emailed link (owner request, Oct 29, 2026), so one problem can be paused
// without stopping everything else.
//
// Per service, two switches:
//   Making  (prod:<KEY>)  off = its orders and plan months still come in, but production waits (steps stay QUEUED) until
//                         it is back on; then they run in order. Self-test orders keep running, so the self-tests
//                         still prove the producer works.
//   Selling (sell:<KEY>)  off = live checkout refuses it with a polite "paused" message; test-mode checkouts are untouched.
// Plus "Everything" rows for both, and automations that aren't orders (notifications, reminder emails).
//
// Stored in worker_settings (migration 0021) as key "switch:<id>", value "off"; on = no row. Nothing reads a switch
// that isn't listed here.
//   GET  /api/switches          "Email me the link"     POST (no t) emails a 7-day signed link to the owner inbox
//   GET  /api/switches?t=       the switch page         POST (with t) saves it
import { ownerEmailAddress, publicBaseUrl } from "./config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "./email.js";
import { nowIso, simplePage } from "./http.js";
import { signLinkToken, verifyLinkToken } from "./links.js";

const LINK_KIND = "switches";
const LINK_TTL_DAYS = 7;

// key: the switch id; offers: catalog offer codes it covers (selling); workflows: workflow keys (making).
const SERVICES = [
  { key: "ONLINE_MENU_QR", label: "Online Menu + QR", offers: ["ONLINE_MENU_QR"], workflows: ["MENU_QR_V1"] },
  { key: "MENU_CARE", label: "Menu Care", offers: ["MENU_CARE"], workflows: ["MENU_CARE_V1"] },
  { key: "REVIEW_REPLIES", label: "Review Replies", offers: ["REVIEW_REPLIES"], workflows: ["REVIEW_REPLIES_V1"] },
  { key: "GOOGLE_PROFILE_CARE", label: "Google Profile Care", offers: ["GOOGLE_PROFILE_CARE"], workflows: ["GOOGLE_PROFILE_CARE_V1"] },
  { key: "GOOGLE_VISIBILITY", label: "Google Visibility", offers: ["GOOGLE_VISIBILITY"], workflows: ["GOOGLE_VISIBILITY_V1"] },
  { key: "SOCIAL_POSTS", label: "Social Posts", offers: ["SOCIAL_POSTS"], workflows: ["SOCIAL_POSTS_V1"] },
  { key: "ACCESSIBILITY_MONITORING", label: "Accessibility Monitoring", offers: ["ACCESSIBILITY_MONITORING"], workflows: ["ACCESSIBILITY_MONITORING_V1"] },
  { key: "CONVERSION_FIX", label: "Conversion Fix", offers: ["CONVERSION_FIX"], workflows: ["CONVERSION_FIX_V1"] },
  { key: "WEBSITE_PACKAGE", label: "Website Package", offers: ["WEBSITE_PACKAGE"], workflows: ["WEBSITE_PACKAGE_V1"] },
  { key: "WEBSITE_CARE", label: "Website Care", offers: ["WEBSITE_CARE"], workflows: ["WEBSITE_CARE_V1"] },
  { key: "GUEST_APP", label: "Guest App", offers: ["GUEST_APP", "GUEST_APP_SETUP"], workflows: ["GUEST_APP_SETUP_V1", "GUEST_APP_V1"] },
  { key: "NINO_DESIGN", label: "Nino design services", offers: ["NINO_SOCIAL_PACK", "NINO_FLYER", "NINO_MENU_DESIGN", "NINO_LOGO"], workflows: ["NINO_SOCIAL_PACK_V1", "NINO_FLYER_V1", "NINO_MENU_DESIGN_V1", "NINO_LOGO_V1"] },
  { key: "STAFF_MERCH", label: "Staff merch", offers: ["STAFF_MERCH"], workflows: ["STAFF_MERCH_V1"] }
];
const AUTOMATIONS = [
  { key: "PUSH", label: "App notifications", help: "Guest App and Store App notifications (restaurants' messages and new-special alerts). Off: restaurants can't send, and nothing queued goes out." },
  { key: "ABANDONED_EMAILS", label: "Unfinished-checkout reminders", help: "The email to buyers who started a checkout and didn't pay." }
];
const PREFIX = "switch:";
const ALL = "ALL";

// The set of switch ids that are off, e.g. "prod:MENU_CARE". Empty if the table isn't there (tests, old databases).
async function offSwitches(env) {
  if (!env?.DB) return new Set();
  try {
    const rows = (await env.DB.prepare(`SELECT key FROM worker_settings WHERE key >= ? AND key < ? AND value = 'off'`).bind(PREFIX, "switch;").all()).results || [];
    return new Set(rows.map((r) => r.key.slice(PREFIX.length)));
  } catch {
    return new Set();
  }
}

// Workflow keys whose production waits, or "*" for all.
async function pausedWorkflows(env, off = null) {
  const set = off || await offSwitches(env);
  if (set.has(`prod:${ALL}`)) return { all: true, keys: [] };
  return { all: false, keys: SERVICES.filter((s) => set.has(`prod:${s.key}`)).flatMap((s) => s.workflows) };
}

// The first paused service among these offer codes (live checkout), or null.
async function pausedForSale(env, offerCodes) {
  const set = await offSwitches(env);
  const codes = [...new Set(offerCodes.filter(Boolean))];
  if (!codes.length) return null;
  if (set.has(`sell:${ALL}`)) return { label: "Ordering" };
  for (const s of SERVICES) if (set.has(`sell:${s.key}`) && codes.some((c) => s.offers.includes(c))) return s;
  return null;
}

async function automationOff(env, key) {
  return (await offSwitches(env)).has(`auto:${key}`);
}

const pausedMessage = (paused) => `${paused.label} is paused for a short while. Please try again later, or reply to any Menu-made email and we'll help.`;

// ---------- owner page ----------

async function emailLink(env) {
  const inbox = ownerEmailAddress(env);
  const link = `${publicBaseUrl(env)}/api/switches?t=${encodeURIComponent(await signLinkToken(env, { kind: LINK_KIND, id: "owner", ttlDays: LINK_TTL_DAYS }))}`;
  const sent = await sendTransactionalEmail(env, {
    to: inbox,
    subject: "Your Menu-made on/off switches",
    html: brandedEmailHtml({ preheader: "Pause any service or automation from one page.", eyebrow: "OWNER", heading: "On/off switches",
      paragraphs: ["Pause making or selling any service, or an automation, without stopping the rest. The link works for 7 days; open the page again any time for a fresh one.", "If you didn't ask for this, ignore it."],
      buttons: [{ label: "Open switches", url: link, primary: true }] }),
    text: `Your on/off switches (link works for 7 days):\n${link}`,
    idempotencyKey: `switches-link/${Math.floor(Date.now() / 600000)}`, purpose: "OWNER_ACTION", templateKey: "switches_link_v1"
  }).catch((error) => ({ ok: false, error }));
  if (!sent?.ok) return simplePage(502, "The email didn't send", "<p>Please try again in a minute.</p>");
  return simplePage(200, "Check your email", `<p>We sent the link to <strong>${escapeHtml(inbox)}</strong>.</p>`);
}

async function waitingCounts(env) {
  try {
    const rows = (await env.DB.prepare(`
        SELECT wr.workflow_key, COUNT(*) AS n FROM workflow_runs wr JOIN projects p ON p.id = wr.project_id
        WHERE wr.status IN ('QUEUED', 'RUNNING') AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = p.customer_id AND c.email = 'delivered@resend.dev')
        GROUP BY wr.workflow_key
      `).all()).results || [];
    return new Map(rows.map((r) => [r.workflow_key, Number(r.n)]));
  } catch { return new Map(); }
}

async function switchPage(env, token, notice = "") {
  const off = await offSwitches(env);
  const counts = await waitingCounts(env);
  const box = (id) => `<input type="checkbox" name="on" value="${escapeHtml(id)}"${off.has(id) ? "" : " checked"} style="width:22px;height:22px">`;
  const cell = "padding:8px 6px;border-bottom:1px solid #dce8ec;text-align:center";
  const rows = SERVICES.map((s) => {
    const waiting = s.workflows.reduce((n, k) => n + (counts.get(k) || 0), 0);
    return `<tr><td style="${cell};text-align:left">${escapeHtml(s.label)}${waiting && off.has(`prod:${s.key}`) ? `<br><small>${waiting} waiting</small>` : ""}</td><td style="${cell}">${box(`prod:${s.key}`)}</td><td style="${cell}">${box(`sell:${s.key}`)}</td></tr>`;
  }).join("");
  const offList = [...off].length;
  return simplePage(200, "On/off switches", `${notice}
<p>${offList ? `<strong>${offList} switch${offList === 1 ? " is" : "es are"} off.</strong>` : "Everything is on."} Untick to pause, tick to turn back on, then press Save.</p>
<form method="post" action="/api/switches"><input type="hidden" name="t" value="${escapeHtml(token)}">
<table style="width:100%;border-collapse:collapse;font-size:15px">
<tr><th style="${cell};text-align:left">Service</th><th style="${cell}">Making</th><th style="${cell}">Selling</th></tr>
<tr><td style="${cell};text-align:left"><strong>Everything</strong></td><td style="${cell}">${box(`prod:${ALL}`)}</td><td style="${cell}">${box(`sell:${ALL}`)}</td></tr>
${rows}
</table>
<p style="font-size:13px"><strong>Making</strong> off: orders and plan months still come in and wait; they're made in order when you turn it back on. <strong>Selling</strong> off: buyers can't check out for it and see a short "paused" message. Self-tests keep running either way.</p>
<h2 style="font-size:18px">Automations</h2>
${AUTOMATIONS.map((a) => `<p><label>${box(`auto:${a.key}`)} <strong>${escapeHtml(a.label)}</strong><br><small>${escapeHtml(a.help)}</small></label></p>`).join("")}
<p><button type="submit">Save</button></p></form>`);
}

const ALL_IDS = [`prod:${ALL}`, `sell:${ALL}`, ...SERVICES.flatMap((s) => [`prod:${s.key}`, `sell:${s.key}`]), ...AUTOMATIONS.map((a) => `auto:${a.key}`)];

async function handleSwitches(request, env) {
  if (!env.DB) return simplePage(503, "Temporarily unavailable", "<p>Please try again in a minute.</p>");
  const url = new URL(request.url);
  const expired = () => simplePage(403, "This link has expired", `<p>Open <a href="/api/switches">the switches page</a> again to get a fresh link.</p>`);
  if (request.method === "GET" && !url.searchParams.get("t")) {
    return simplePage(200, "On/off switches", `<p>Pause making or selling any service, or an automation, without stopping the rest. We'll email a 7-day link to <strong>${escapeHtml(ownerEmailAddress(env))}</strong>.</p>
<form method="post" action="/api/switches"><button type="submit">Email me the link</button></form>`);
  }
  if (request.method === "GET") {
    const token = url.searchParams.get("t");
    const payload = await verifyLinkToken(env, token, [LINK_KIND], "owner");
    return !payload || payload.expired ? expired() : switchPage(env, token);
  }
  let form;
  try { form = await request.formData(); } catch { form = null; }
  const token = form ? String(form.get("t") || "") : "";
  if (!token) return emailLink(env);
  const payload = await verifyLinkToken(env, token, [LINK_KIND], "owner");
  if (!payload || payload.expired) return expired();
  const on = new Set(form.getAll("on").map(String));
  const before = await offSwitches(env);
  const t = nowIso();
  const changed = [];
  for (const id of ALL_IDS) {
    const wantOff = !on.has(id);
    if (wantOff === before.has(id)) continue;
    changed.push(`${id} ${wantOff ? "off" : "on"}`);
    if (wantOff) {
      await env.DB.prepare(`INSERT INTO worker_settings (key, value, updated_at) VALUES (?, 'off', ?) ON CONFLICT(key) DO UPDATE SET value = 'off', updated_at = excluded.updated_at`).bind(PREFIX + id, t).run();
    } else {
      await env.DB.prepare(`DELETE FROM worker_settings WHERE key = ?`).bind(PREFIX + id).run();
    }
  }
  if (changed.length) console.log(`Switches changed: ${changed.join(", ")}`);
  return switchPage(env, token, `<p style="color:#1a6b3a"><strong>${changed.length ? `Saved: ${changed.length} change${changed.length === 1 ? "" : "s"}.` : "No changes."}</strong></p>`);
}

export { ALL, AUTOMATIONS, LINK_KIND, SERVICES, automationOff, handleSwitches, offSwitches, pausedForSale, pausedMessage, pausedWorkflows };
