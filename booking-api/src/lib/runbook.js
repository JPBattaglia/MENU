// Stage 13: the alert runbook. Every owner alert (purpose AUTOMATION_ALERT) ends with its runbook entry: a short code,
// what happened, and the ONE action to take. sendTransactionalEmail adds it from the alert's templateKey, so a new alert
// only needs a line in RUNBOOK_BY_TEMPLATE. The same table is in the automation handbook (Technical reference tab,
// "Alert runbook"); keep the two the same. An alert whose templateKey isn't listed gets R0.
//
// Entries never ask the owner for a token, and never suggest a refund (no-refund policy, Oct 30, 2026) or a paid
// Cloudflare plan (owner decision: stay on Free).
const RUNBOOK = {
  R0: { title: "Something unexpected", happened: "An alert without its own entry yet.", action: "Forward this email to Claude." },
  R1: { title: "An order stopped", happened: "A production step failed on an order and won't retry on its own. The buyer has been told nothing new.", action: "Forward this email to Claude; it fixes the cause and restarts the order." },
  R2: { title: "A service is blocked on an order", happened: "The automation couldn't finish one service for one buyer (a check didn't pass, or an outside service refused). Nothing was shown to the buyer.", action: "Forward this email to Claude." },
  R3: { title: "Waiting on the buyer", happened: "A paid order is paused because the buyer hasn't sent what's needed (a brief, a Google connection, a shirt list, payment for extra pages). They have had the automatic reminders.", action: "Reach out to the buyer yourself (reply to their order email). No refund is due; the order waits until they send it." },
  R4: { title: "Review replies didn't post", happened: "Some of this week's Google review replies couldn't be posted; the rest went out.", action: "Forward this email to Claude; usually the Google connection needs the buyer to reconnect." },
  R5: { title: "Graphics waiting to be drawn", happened: "GitHub hasn't drawn waiting images (social posts, app icons, Nino designs) for over an hour, so nothing has reached you for approval.", action: "Follow the GitHub steps in the email above (enable or re-run the \"Render social posts\" workflow); if it still waits, forward this email to Claude." },
  R6: { title: "A self-test failed", happened: "A sandbox test order for one service didn't pass. Real buyers may hit the same problem.", action: "Forward this email to Claude." },
  R7: { title: "Daily check", happened: "Once a day: a service's self-test didn't pass or went stale, or a real order needs you.", action: "Do what each line says; for anything else, forward this email to Claude." },
  R8: { title: "Database near its free limit", happened: "Cloudflare's free daily database limit is close. If reached, checkouts and sites stop until 5 pm Pacific.", action: "Forward this email to Claude; it cuts the reads for free (you stay on the free plan)." },
  R9: { title: "App notifications problem", happened: "A Mobile App notification couldn't be sent (Apple or Google refused it).", action: "Forward this email to Claude." },
  R11: { title: "A logo is waiting on Nino", happened: "Nino was sent a logo brief 4 or more days ago and hasn't uploaded the designs. The buyer is waiting.", action: "Check in with Nino and forward him the upload button in this email." },
  R10: { title: "GitHub refused a job", happened: "GitHub didn't accept a job from the worker; app builds, images and notifications wait (nothing is lost).", action: "Tell Claude \"GitHub token refused\"; it walks you through a new token, about 3 minutes." }
};

const RUNBOOK_BY_TEMPLATE = {
  automation_failure_v1: "R1",
  conversion_blocked_v1: "R2", guest_app_blocked_v1: "R2", site_files_blocked_v1: "R2", nino_design_blocked_v1: "R2", social_posts_blocked_v1: "R2",
  website_blocked_v1: "R2", google_care_alert_v1: "R2", gv_alert_v1: "R2", domain_purchase_blocked_v1: "R2", domain_renewal_stuck_v1: "R2",
  conversion_no_brief_v1: "R3", gv_not_connected_v1: "R3", nino_design_brief_owner_v1: "R3", merch_missing_v1: "R3", extra_pages_unpaid_owner_v1: "R3", domain_renewal_unpaid_owner_v1: "R3",
  review_post_failed_v1: "R4",
  render_stale_v1: "R5",
  self_test_failed_v1: "R6",
  coverage_report_v2: "R7",
  d1_near_limit_v1: "R8",
  native_push_alert_v1: "R9",
  github_dispatch_refused_v1: "R10",
  nino_logo_stale_v1: "R11"
};

function runbookEntry(templateKey) {
  const code = RUNBOOK_BY_TEMPLATE[String(templateKey || "")] || "R0";
  return { code, ...RUNBOOK[code] };
}

const RUNBOOK_MARK = "Runbook ";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Adds the entry above the email's dark footer (or at the end), once.
// pauseUrl: a signed link to the owner's on/off switches, so a failing service can be paused from the alert itself.
function withRunbook(html, text, templateKey, pauseUrl = null) {
  const e = runbookEntry(templateKey);
  const label = `${RUNBOOK_MARK}${e.code}: ${e.title}`;
  const marker = '<tr><td style="padding:24px 32px;background-color:#071f2c;">';
  const pauseHtml = pauseUrl ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:#26434f;">Keeps failing? <a href="${esc(pauseUrl)}" style="display:inline-block;border:1px solid #071f2c;color:#071f2c;text-decoration:none;font-weight:bold;padding:6px 12px;border-radius:6px;">Pause a service</a> (stops making or selling just that one; link works 7 days)</p>` : "";
  const block = `<tr><td style="padding:16px 32px;border-top:1px solid #dce8ec;"><p style="margin:0 0 6px;font-size:13px;font-weight:bold;color:#071f2c;">${esc(label)}</p><p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#26434f;">${esc(e.happened)}</p><p style="margin:0;font-size:13px;line-height:1.5;color:#26434f;"><strong>One action:</strong> ${esc(e.action)}</p>${pauseHtml}</td></tr>`;
  const outHtml = typeof html !== "string" || html.includes(label) ? html
    : html.includes(marker) ? html.replace(marker, block + marker)
    : html.includes("</body>") ? html.replace("</body>", `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;"><strong>${esc(label)}</strong><br>${esc(e.happened)}<br><strong>One action:</strong> ${esc(e.action)}</p>${pauseHtml}</body>`)
    : `${html}<p><strong>${esc(label)}</strong><br>${esc(e.happened)}<br><strong>One action:</strong> ${esc(e.action)}</p>${pauseHtml}`;
  const outText = typeof text !== "string" || text.includes(label) ? text : `${text}\n\n${label}\n${e.happened}\nOne action: ${e.action}${pauseUrl ? `\nKeeps failing? Pause a service (link works 7 days): ${pauseUrl}` : ""}`;
  return { html: outHtml, text: outText };
}

export { RUNBOOK, RUNBOOK_BY_TEMPLATE, runbookEntry, withRunbook };
