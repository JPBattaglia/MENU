// Google Visibility pages: the owner's review page (what we found and what we will change) and the customer's
// before/after report. Both are self-contained HTML served through the signed delivery links.
import { escapeHtml } from "../../lib/email.js";
import { ADVICE } from "./audit.js";

const e = escapeHtml;
const FIX_LABELS = {
  DESCRIPTION: "New business description", PHONE: "Phone number", WEBSITE: "Website link", MENU_LINK: "Menu link", LOGO: "Logo", PHOTO: "Photo"
};
const STYLE = `body{margin:0;background:#f4f1ec;font:16px/1.55 system-ui,sans-serif;color:#1d1d1b}main{max-width:780px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:28px;margin:0 0 4px}h2{margin-top:28px}.scores{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.tile{flex:1 1 150px;background:#fff;border:1px solid #e3ddd2;border-radius:10px;padding:14px}
.n{font-size:34px;font-weight:700}.l{font-weight:600}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3ddd2}td,th{padding:8px 12px;border-bottom:1px solid #eee7da;text-align:left;vertical-align:top}
.ok{color:#1b7a3a;font-weight:600}.todo{color:#9b1c1c;font-weight:600}.fixed{color:#08747b;font-weight:600}.box{background:#fff;border:1px solid #e3ddd2;border-radius:10px;padding:14px;margin:12px 0}.note{font-size:13px;color:#6b675f}
a{color:#08747b}`;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${e(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

function fixValue(fix) {
  if (fix.kind === "DESCRIPTION") return `<div class="box">${e(fix.value || "")}</div>`;
  if (fix.kind === "LOGO" || fix.kind === "PHOTO") return "An image you uploaded to Menu-Made";
  return e(fix.value || "");
}

function checkRows(checks, { after = false } = {}) {
  return checks.filter((c) => c.applicable).map((c) => {
    const status = c.fixed ? `<span class="fixed">Fixed</span>` : c.ok ? `<span class="ok">Done</span>` : `<span class="todo">${after ? "Your turn" : "Missing"}</span>`;
    return `<tr><td>${e(c.label)}</td><td>${status}</td><td>${e(c.detail || "")}</td></tr>`;
  }).join("");
}

function adviceList(checks) {
  const todo = checks.filter((c) => c.applicable && !c.ok);
  if (!todo.length) return "<p>Nothing left to do: every check passes.</p>";
  return `<ol>${todo.map((c) => `<li><strong>${e(c.label)}.</strong> ${e(ADVICE[c.key] || "")}${c.key === "holiday_hours" && c.detail ? ` Coming up: ${e(c.detail)}.` : ""}</li>`).join("")}</ol>`;
}

// For the owner: before score, the planned changes (with the exact new description) and what is left as advice.
function planPageHtml({ business, profileTitle, audit, fixes }) {
  return page(`${business}: Google Visibility review`, `<h1>${e(business)}</h1><p>Google Visibility · review before publishing${profileTitle ? ` · Google profile "${e(profileTitle)}"` : ""}</p>
<div class="scores"><div class="tile"><div class="n">${audit.score}</div><div class="l">Profile score now</div></div><div class="tile"><div class="n">${fixes.length}</div><div class="l">Changes we will make</div></div></div>
<h2>Changes waiting for your approval</h2>${fixes.length ? `<table><thead><tr><th>Change</th><th>New value</th></tr></thead><tbody>${fixes.map((f) => `<tr><td>${e(FIX_LABELS[f.kind] || f.kind)}</td><td>${fixValue(f)}</td></tr>`).join("")}</tbody></table>` : "<p>None: there is nothing we can fill in from what the business gave us. The customer gets the report with advice only.</p>"}
<p class="note">Approving publishes these on the customer's Google profile straight away (Google may take a few days to review some edits) and emails them the before/after report. Request changes to have the description rewritten once from your note, or say "keep their description" to leave it out.</p>
<h2>What we found</h2><table><thead><tr><th>Check</th><th>Status</th><th>Now</th></tr></thead><tbody>${checkRows(audit.checks)}</tbody></table>
${audit.notes.length ? `<h2>Also noticed</h2><ul>${audit.notes.map((n) => `<li>${e(n)}</li>`).join("")}</ul>` : ""}
<h2>Left as advice for the customer</h2>${adviceList(audit.checks.map((c) => (fixes.some((f) => FIX_CHECK_OF[f.kind] === c.key) ? { ...c, ok: true } : c)))}`);
}

const FIX_CHECK_OF = { DESCRIPTION: "description", PHONE: "phone", WEBSITE: "website", MENU_LINK: "menu_link", LOGO: "logo", PHOTO: "photos" };

// For the customer: before/after score, what changed, what is left for them, and how Google Profile Care keeps it up.
function reportHtml({ business, before, after, applied, refused, date, editUrl }) {
  const changed = applied.length
    ? `<ul>${applied.map((f) => `<li>${e(FIX_LABELS[f.kind] || f.kind)}${f.kind === "DESCRIPTION" ? `:<div class="box">${e(f.value || "")}</div>` : f.kind === "LOGO" || f.kind === "PHOTO" ? "" : `: ${e(f.value || "")}`}</li>`).join("")}</ul>
<p class="note">Google reviews some edits before they show; most appear within a few days.</p>`
    : "<p>We didn't need to change anything ourselves this time; the list below is what will make the biggest difference.</p>";
  return page(`${business}: Google Visibility report`, `<h1>${e(business)}</h1><p>Google Visibility report · ${e(date)}</p>
<div class="scores"><div class="tile"><div class="n">${before.score}</div><div class="l">Profile score before</div></div><div class="tile"><div class="n">${after.score}</div><div class="l">Profile score now</div></div></div>
<h2>What we changed on your profile</h2>${changed}
${refused.length ? `<p class="note">Google didn't accept ${refused.length} change${refused.length === 1 ? "" : "s"} (${refused.map((f) => e(FIX_LABELS[f.kind] || f.kind)).join(", ")}). They are in your to-do list below.</p>` : ""}
<h2>Your to-do list</h2><p>These need you, because only you know the answer. Each takes a minute${editUrl ? `: <a href="${e(editUrl)}">open your profile on Google</a>, then choose <strong>Edit profile</strong>` : ": search your business name on Google while signed in, then choose <strong>Edit profile</strong>"}.</p>
${adviceList(after.checks)}
<h2>The full checklist</h2><table><thead><tr><th>Check</th><th>Status</th><th>Now</th></tr></thead><tbody>${checkRows(after.checks, { after: true })}</tbody></table>
${before.notes.length ? `<h2>Also worth knowing</h2><ul>${before.notes.map((n) => `<li>${e(n)}</li>`).join("")}</ul>` : ""}
<h2>Keep it this way</h2><p>A profile that's updated every week shows up more. <strong>Google Profile Care</strong> posts a weekly update, adds your photos, replies to your reviews and sends a monthly report of views, calls and direction requests. See it at <a href="https://menu-made.com/services.html">menu-made.com/services.html</a>.</p>
<p class="note">The score is Menu-Made's checklist of what Google shows on a complete profile. It is not a Google ranking, and no one can guarantee placement in Google results.</p>`);
}

export { FIX_LABELS, planPageHtml, reportHtml };
