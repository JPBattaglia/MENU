// Extra menu pages (Oct 25, 2026 decision): every page in the buyer's menu file counts. When the file has
// more pages than the order paid for, production pauses before it starts, the buyer is emailed a link to
// pay $20 per extra page, and production resumes automatically once Stripe confirms the payment.
// Reminders go out on day 2 and day 5; the owner is alerted on day 7. Fewer pages than paid for is only
// flagged in the owner's approval email.
import { MENU_PACKAGE_PRICING } from "../../checkout/quote.js";
import { ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { recordProjectEvent } from "../../lib/db.js";
import { brandedEmailHtml, escapeHtml, looksLikeEmail, sendTransactionalEmail } from "../../lib/email.js";
import { jsonResponse, nowIso, parseJsonOrNull, simplePage } from "../../lib/http.js";
import { signLinkToken, verifyLinkToken } from "../../lib/links.js";

const PAY_LINK_TTL_DAYS = 30;
const REMINDER_DAYS = [2, 5];
const OWNER_ALERT_DAYS = 7;
const MAX_OBJECT_STREAMS = 400;
const MAX_INFLATED_BYTES = 40 * 1024 * 1024;

// ---------- Counting pages ----------

function bytesToLatin1(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return out;
}

// Returns { text, start, end } for the dictionary (<< ... >>) that encloses position `at`, or null.
function enclosingDict(text, at) {
  let depth = 0;
  let start = -1;
  for (let i = at; i > 0; i--) {
    if (text[i] === ">" && text[i - 1] === ">") { depth++; i--; continue; }
    if (text[i] === "<" && text[i - 1] === "<") {
      if (depth === 0) { start = i - 1; break; }
      depth--; i--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "<" && text[i + 1] === "<") { depth++; i++; continue; }
    if (text[i] === ">" && text[i + 1] === ">") {
      depth--; i++;
      if (depth === 0) return { text: text.slice(start, i + 1), start, end: i + 1 };
    }
  }
  return null;
}

function topLevelOnly(dict) {
  let inner = dict.slice(2, -2);
  let previous;
  do {
    previous = inner;
    inner = inner.replace(/<<[^<>]*>>/g, " ");
  } while (inner !== previous);
  return inner;
}

// The page tree's root /Pages node carries the total page count; nested nodes carry smaller counts.
function largestPagesCount(text) {
  let best = 0;
  const pattern = /\/Type\s*\/Pages(?![A-Za-z])/g;
  let match;
  while ((match = pattern.exec(text))) {
    const dict = enclosingDict(text, match.index);
    if (!dict) continue;
    const count = topLevelOnly(dict.text).match(/\/Count\s+(\d+)/);
    if (count) best = Math.max(best, Number(count[1]));
  }
  return best;
}

function pageLeafCount(text) {
  return (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
}

async function inflate(bytes) {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

// Modern PDFs often keep the page tree inside compressed object streams.
async function objectStreamTexts(text, bytes) {
  const texts = [];
  let inflatedTotal = 0;
  const pattern = /\/Type\s*\/ObjStm(?![A-Za-z])/g;
  let match;
  while ((match = pattern.exec(text)) && texts.length < MAX_OBJECT_STREAMS) {
    const dict = enclosingDict(text, match.index);
    if (!dict || !/\/FlateDecode/.test(dict.text)) continue;
    const dictEnd = dict.end;
    const streamAt = text.indexOf("stream", dictEnd);
    if (streamAt < 0 || streamAt - dictEnd > 32) continue;
    let dataStart = streamAt + 6;
    if (text[dataStart] === "\r") dataStart++;
    if (text[dataStart] === "\n") dataStart++;
    const dataEnd = text.indexOf("endstream", dataStart);
    if (dataEnd < 0) continue;
    let end = dataEnd;
    while (end > dataStart && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
    const inflated = await inflate(bytes.subarray(dataStart, end));
    if (!inflated) continue;
    inflatedTotal += inflated.length;
    if (inflatedTotal > MAX_INFLATED_BYTES) break;
    texts.push(bytesToLatin1(inflated));
  }
  return texts;
}

// Returns the number of pages in a PDF, or null when it can't be determined (e.g. an encrypted file).
async function countPdfPages(bytes) {
  const text = bytesToLatin1(bytes);
  if (!text.slice(0, 1024).includes("%PDF")) return null;
  let best = largestPagesCount(text);
  let leaves = pageLeafCount(text);
  for (const streamText of await objectStreamTexts(text, bytes)) {
    best = Math.max(best, largestPagesCount(streamText));
    leaves += pageLeafCount(streamText);
  }
  if (best > 0) return best;
  return leaves > 0 ? leaves : null;
}

// Every page in the file counts: a PDF counts its pages, a photo is one page. A menu link can't be counted.
async function countMenuPages(inputs, env) {
  const asset = inputs?.menu_file?.type === "FILE" ? inputs.menu_file.asset : null;
  if (!asset) return { pages: null, method: "link" };
  const mime = String(asset.mime_type || "").toLowerCase();
  if (mime.startsWith("image/")) return { pages: 1, method: "photo" };
  if (mime === "application/pdf") {
    const object = await env.ASSETS.get(asset.storage_key);
    if (!object) return { pages: null, method: "missing_file" };
    const pages = await countPdfPages(new Uint8Array(await object.arrayBuffer()));
    return { pages, method: pages ? "pdf" : "pdf_unreadable" };
  }
  return { pages: null, method: "unknown_file_type" };
}

// ---------- State ----------

async function paidMenuPages(orderItemId, env) {
  if (!orderItemId) return null;
  const row = await env.DB.prepare(`SELECT metadata_json FROM order_items WHERE id = ? LIMIT 1`).bind(orderItemId).first();
  const pages = parseJsonOrNull(row?.metadata_json)?.menu_package?.menu_pages;
  return Number.isInteger(pages) && pages > 0 ? pages : null;
}

async function loadPageBilling(projectId, env) {
  const row = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ? LIMIT 1`).bind(projectId).first();
  return parseJsonOrNull(row?.metadata_json)?.page_billing || null;
}

async function savePageBilling(projectId, state, env) {
  await env.DB.prepare(`
      UPDATE projects
      SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.page_billing', json(?)), updated_at = ?
      WHERE id = ?
    `).bind(JSON.stringify(state), nowIso(), projectId).run();
}

async function loadBillingContext(projectId, env) {
  return env.DB.prepare(`
      SELECT p.id, p.order_id, p.order_item_id, p.customer_id, p.business_id,
        b.name AS business_name, c.email AS customer_email, c.first_name,
        o.stripe_checkout_session_id
      FROM projects p
      JOIN businesses b ON b.id = p.business_id
      JOIN customers c ON c.id = p.customer_id
      JOIN orders o ON o.id = p.order_id
      WHERE p.id = ?
      LIMIT 1
    `).bind(projectId).first();
}

const isTestContext = (context) => String(context?.stripe_checkout_session_id || "").startsWith("cs_test_");
const dollars = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const pagesWord = (n) => `${n} page${n === 1 ? "" : "s"}`;

// One line for the owner's approval email; null when there is nothing to say.
function pageBillingNote(summary) {
  if (!summary || !Number.isInteger(summary.paid_pages)) return null;
  const covered = summary.paid_pages + Number(summary.paid_extra_pages || 0);
  const paidText = summary.paid_extra_pages
    ? `Paid for ${pagesWord(summary.paid_pages)} + ${summary.paid_extra_pages} extra`
    : `Paid for ${pagesWord(summary.paid_pages)}`;
  if (!Number.isInteger(summary.counted_pages)) {
    return `${paidText} · page count unavailable (${summary.count_method === "link" ? "menu sent as a link" : "file could not be counted"}). Check the page count yourself.`;
  }
  if (summary.counted_pages < covered) {
    const unused = covered - summary.counted_pages;
    return `${paidText} · menu has ${pagesWord(summary.counted_pages)} (${unused} unused, ${dollars(unused * MENU_PACKAGE_PRICING.additionalPageCents)}). Refund from Stripe if you choose.`;
  }
  return `${paidText} · menu has ${pagesWord(summary.counted_pages)}.`;
}

// ---------- Production check (called from PREPARE_INPUTS) ----------

async function checkPageBilling(targetStep, project, inputs, env) {
  const paid = await paidMenuPages(project.order_item_id, env);
  if (paid === null) return { proceed: true, summary: null };
  const counted = await countMenuPages(inputs, env);
  const state = (await loadPageBilling(project.id, env)) || {};
  const paidExtra = Number(state.paid_extra_pages || 0);
  const covered = paid + paidExtra;
  const summary = { paid_pages: paid, paid_extra_pages: paidExtra, counted_pages: counted.pages, count_method: counted.method };
  const checkedAt = nowIso();

  if (!Number.isInteger(counted.pages) || counted.pages <= covered) {
    await savePageBilling(project.id, {
      ...state, ...summary,
      status: paidExtra > 0 ? "PAID" : (Number.isInteger(counted.pages) ? "NOT_NEEDED" : "UNKNOWN"),
      extra_pages: 0, amount_cents: 0, checked_at: checkedAt
    }, env);
    return { proceed: true, summary };
  }

  const extra = counted.pages - covered;
  const amount = extra * MENU_PACKAGE_PRICING.additionalPageCents;
  const sameRequest = state.status === "PAYMENT_REQUIRED" && state.extra_pages === extra;
  const next = {
    ...state, ...summary,
    status: "PAYMENT_REQUIRED",
    extra_pages: extra,
    amount_cents: amount,
    checked_at: checkedAt,
    requested_at: sameRequest ? state.requested_at : checkedAt,
    buyer_notified_at: sameRequest ? state.buyer_notified_at || null : null,
    reminders_sent: sameRequest ? Number(state.reminders_sent || 0) : 0,
    owner_alerted_at: sameRequest ? state.owner_alerted_at || null : null,
    checkout_session_id: sameRequest ? state.checkout_session_id || null : null,
    checkout_url: sameRequest ? state.checkout_url || null : null,
    checkout_expires_at: sameRequest ? state.checkout_expires_at || null : null
  };
  await savePageBilling(project.id, next, env);
  if (!sameRequest) {
    await recordProjectEvent(env, project.id, "EXTRA_PAGES_PAYMENT_REQUIRED", targetStep.workflow_run_id,
      { paid_pages: paid, paid_extra_pages: paidExtra, counted_pages: counted.pages, extra_pages: extra, amount_cents: amount });
  }
  if (!next.buyer_notified_at) await sendPaymentEmail(project.id, next, "request", env);

  const reason = `Waiting for payment for ${extra} extra menu ${extra === 1 ? "page" : "pages"}`;
  const output = { ok: false, waiting_for: "EXTRA_PAGES_PAYMENT", ...summary, extra_pages: extra, amount_cents: amount };
  await env.DB.prepare(`UPDATE workflow_steps SET status = 'WAITING', error_message = ?, output_json = ? WHERE id = ?`)
    .bind(reason, JSON.stringify(output), targetStep.workflow_step_id).run();
  await env.DB.prepare(`UPDATE workflow_runs SET status = 'WAITING', error_code = 'EXTRA_PAGES_PAYMENT_REQUIRED', error_message = ? WHERE id = ?`)
    .bind(reason, targetStep.workflow_run_id).run();
  await env.DB.prepare(`UPDATE projects SET status = 'BLOCKED', blocked_reason = ?, updated_at = ? WHERE id = ?`)
    .bind(reason, nowIso(), project.id).run();
  return {
    proceed: false,
    response: jsonResponse({
      ok: true,
      processed: true,
      status: "WAITING",
      waiting_for: "EXTRA_PAGES_PAYMENT",
      workflow_run_id: targetStep.workflow_run_id,
      workflow_step_id: targetStep.workflow_step_id,
      step_key: targetStep.step_key,
      extra_pages: extra,
      amount_cents: amount
    }, 202)
  };
}

// ---------- Buyer emails ----------

async function sendPaymentEmail(projectId, state, kind, env) {
  const context = await loadBillingContext(projectId, env);
  if (!context || !looksLikeEmail(context.customer_email)) return { ok: false, error: "No buyer email" };
  const token = await signLinkToken(env, { kind: "extra_pages", id: projectId, ttlDays: PAY_LINK_TTL_DAYS });
  const payUrl = `${publicBaseUrl(env)}/api/extra-pages/${projectId}?t=${token}`;
  const business = context.business_name || "your business";
  const covered = state.paid_pages + Number(state.paid_extra_pages || 0);
  const amount = dollars(state.amount_cents);
  const reminder = kind !== "request";
  const subject = `${isTestContext(context) ? "[TEST] " : ""}${reminder ? "Reminder: " : ""}Your menu has ${state.counted_pages} pages — ${amount} to start production`;
  const lines = [
    `Your menu file for ${business} has ${pagesWord(state.counted_pages)}; your order covered ${pagesWord(covered)}.`,
    `Each additional page is ${dollars(MENU_PACKAGE_PRICING.additionalPageCents)}, so the balance for ${state.extra_pages === 1 ? "1 extra page" : `${state.extra_pages} extra pages`} is ${amount}.`,
    "Your menu goes into production as soon as the payment goes through."
  ];
  const html = brandedEmailHtml({
    preheader: `${amount} for ${state.extra_pages} extra menu ${state.extra_pages === 1 ? "page" : "pages"}, then we start your menu.`,
    eyebrow: reminder ? "PAYMENT REMINDER" : "ONE MORE STEP",
    heading: `Pay for ${state.extra_pages === 1 ? "1 extra page" : `${state.extra_pages} extra pages`} to start your menu`,
    paragraphs: [`Hi ${escapeHtml(context.first_name || "there")},`, ...lines.map(escapeHtml)],
    rows: [["Pages in your menu", String(state.counted_pages)], ["Pages already paid for", String(covered)], ["Balance", amount]],
    buttons: [{ label: `Pay ${amount}`, url: payUrl, primary: true }],
    footnote: "Page count wrong, or want to send a shorter menu? Reply to this email before paying."
  });
  const text = [`Hi ${context.first_name || "there"},`, "", ...lines, "", `Pay ${amount}: ${payUrl}`, "",
    "Page count wrong, or want to send a shorter menu? Reply to this email before paying.", "", "The MENU-MADE team"].join("\n");
  const sent = await sendTransactionalEmail(env, {
    to: String(context.customer_email).trim(),
    subject, html, text,
    idempotencyKey: `extra-pages/${projectId}/${state.requested_at}/${kind}`,
    purpose: "EXTRA_PAGES_PAYMENT",
    templateKey: `extra_pages_${kind}_v1`,
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId },
    bccInternal: true
  });
  if (sent.ok && kind === "request") {
    await savePageBilling(projectId, { ...state, buyer_notified_at: nowIso() }, env);
  }
  return sent;
}

// Runs on every scheduled tick: unsent requests, day 2 and day 5 reminders, day 7 owner alert.
async function sendPageBillingReminders(env, now = Date.now()) {
  const rows = (await env.DB.prepare(`
      SELECT id, metadata_json FROM projects
      WHERE json_extract(metadata_json, '$.page_billing.status') = 'PAYMENT_REQUIRED'
      LIMIT 50
    `).all()).results || [];
  let sent = 0;
  for (const row of rows) {
    let state = parseJsonOrNull(row.metadata_json)?.page_billing;
    if (!state?.requested_at) continue;
    if (!state.buyer_notified_at) {
      if ((await sendPaymentEmail(row.id, state, "request", env)).ok) sent++;
      continue;
    }
    const days = (now - Date.parse(state.requested_at)) / 86400000;
    const due = REMINDER_DAYS.filter((day) => days >= day).length;
    if (due > Number(state.reminders_sent || 0)) {
      const reminderNumber = Number(state.reminders_sent || 0) + 1;
      const result = await sendPaymentEmail(row.id, state, `reminder-${reminderNumber}`, env);
      if (result.ok) {
        state = { ...state, reminders_sent: reminderNumber };
        await savePageBilling(row.id, state, env);
        sent++;
      }
    }
    if (days >= OWNER_ALERT_DAYS && !state.owner_alerted_at) {
      const context = await loadBillingContext(row.id, env);
      const business = context?.business_name || "A customer";
      const result = await sendTransactionalEmail(env, {
        to: ownerEmailAddress(env),
        subject: `${isTestContext(context) ? "[TEST] " : ""}Unpaid extra menu pages: ${business}`,
        html: brandedEmailHtml({
          preheader: `${business} hasn't paid for extra menu pages after ${OWNER_ALERT_DAYS} days.`,
          eyebrow: "ORDER ON HOLD",
          heading: `${business}'s menu is waiting for payment`,
          paragraphs: [`Production has been paused for ${OWNER_ALERT_DAYS} days. The buyer was emailed the payment link and ${REMINDER_DAYS.length} reminders. Follow up directly, or refund the order from Stripe.`],
          rows: [["Business", business], ["Buyer", context?.customer_email || ""], ["Order", context?.order_id || ""],
            ["Pages", `${state.counted_pages} in menu · ${state.paid_pages + Number(state.paid_extra_pages || 0)} paid`], ["Balance", dollars(state.amount_cents)]]
        }),
        text: `${business}'s menu has been waiting ${OWNER_ALERT_DAYS} days for payment of ${dollars(state.amount_cents)} (${state.extra_pages} extra pages).\nBuyer: ${context?.customer_email || ""}\nOrder: ${context?.order_id || ""}`,
        idempotencyKey: `extra-pages-owner/${row.id}/${state.requested_at}`,
        purpose: "AUTOMATION_ALERT",
        templateKey: "extra_pages_unpaid_owner_v1",
        context: { orderId: context?.order_id, projectId: row.id, businessId: context?.business_id }
      });
      if (result.ok) await savePageBilling(row.id, { ...state, owner_alerted_at: nowIso() }, env);
    }
  }
  return { checked: rows.length, sent };
}

// ---------- Payment link and Stripe ----------

async function createExtraPagesCheckout(projectId, state, context, env) {
  const test = isTestContext(context);
  const key = test ? env.STRIPE_SECRET_KEY_TEST : env.STRIPE_SECRET_KEY;
  if (!key) throw new Error(`${test ? "STRIPE_SECRET_KEY_TEST" : "STRIPE_SECRET_KEY"} is not configured`);
  const base = publicBaseUrl(env);
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", `${base}/api/extra-pages/${projectId}/done`);
  params.append("cancel_url", `${base}/api/extra-pages/${projectId}/done?cancelled=1`);
  if (looksLikeEmail(context.customer_email)) params.append("customer_email", String(context.customer_email).trim());
  params.append("line_items[0][price_data][currency]", "usd");
  params.append("line_items[0][price_data][unit_amount]", String(MENU_PACKAGE_PRICING.additionalPageCents));
  params.append("line_items[0][price_data][product_data][name]", `Additional menu pages — ${context.business_name || "Online Menu + QR"}`);
  params.append("line_items[0][price_data][product_data][description]",
    `Your menu has ${state.counted_pages} pages; your order covered ${state.paid_pages + Number(state.paid_extra_pages || 0)}.`);
  params.append("line_items[0][quantity]", String(state.extra_pages));
  params.append("metadata[purpose]", "extra_menu_pages");
  params.append("metadata[project_id]", projectId);
  params.append("metadata[extra_pages]", String(state.extra_pages));
  params.append("metadata[requested_at]", state.requested_at);
  params.append("metadata[original_order]", context.order_id);
  params.append("metadata[environment]", test ? "sandbox" : "live");
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `extra-pages/${projectId}/${state.requested_at}/${Date.now() - (Date.now() % 3600000)}`
    },
    body: params.toString()
  });
  const session = await response.json().catch(() => null);
  if (!response.ok || !session?.url) throw new Error(session?.error?.message || `Stripe returned HTTP ${response.status}`);
  return session;
}

// GET /api/extra-pages/<projectId>?t=<token>: sends the buyer to Stripe for the balance.
async function handleExtraPagesPay(request, env, projectId) {
  const url = new URL(request.url);
  const token = await verifyLinkToken(env, url.searchParams.get("t"), ["extra_pages"], projectId);
  if (!token) return simplePage(403, "Link not valid", "<p>This payment link isn't valid. Reply to your email from MENU-MADE and we'll send a new one.</p>");
  if (token.expired) return simplePage(410, "Link expired", "<p>This payment link has expired. Reply to your email from MENU-MADE and we'll send a new one.</p>");
  const state = await loadPageBilling(projectId, env);
  if (!state || state.status !== "PAYMENT_REQUIRED") {
    return simplePage(200, "Nothing to pay", state?.status === "PAID"
      ? "<p>Thanks — the extra pages are paid and your menu is in production. We'll email you when it's ready.</p>"
      : "<p>There's no balance on this order. We'll email you when your menu is ready.</p>");
  }
  const context = await loadBillingContext(projectId, env);
  if (!context) return simplePage(404, "Order not found", "<p>We couldn't find this order. Reply to your email from MENU-MADE.</p>");
  // Reuse an open Checkout Session (link scanners and repeat clicks don't create new ones).
  if (state.checkout_url && state.checkout_expires_at && Date.parse(state.checkout_expires_at) - Date.now() > 10 * 60000) {
    return Response.redirect(state.checkout_url, 303);
  }
  let session;
  try {
    session = await createExtraPagesCheckout(projectId, state, context, env);
  } catch (error) {
    console.error("Extra pages checkout failed:", error instanceof Error ? error.message : String(error));
    return simplePage(502, "Payment page unavailable", "<p>We couldn't open the payment page just now. Please try the link again in a few minutes.</p>");
  }
  await savePageBilling(projectId, {
    ...state,
    checkout_session_id: session.id,
    checkout_url: session.url,
    checkout_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null
  }, env);
  return Response.redirect(session.url, 303);
}

// GET /api/extra-pages/<projectId>/done: where Stripe sends the buyer back.
function handleExtraPagesDone(request) {
  const cancelled = new URL(request.url).searchParams.has("cancelled");
  return cancelled
    ? simplePage(200, "Payment not completed", "<p>No payment was taken. Use the link in your email whenever you're ready, and we'll start your menu right after.</p>")
    : simplePage(200, "Payment received", "<p>Thanks! Your menu is going into production now. We'll email you when it's ready.</p>");
}

// checkout.session.completed with metadata.purpose = extra_menu_pages.
async function handleExtraPagesPaid(session, env) {
  const projectId = session?.metadata?.project_id;
  if (!projectId) throw new Error("Extra pages payment has no project_id");
  if (session.payment_status !== "paid") return { ok: true, ignored: "not_paid" };
  const state = await loadPageBilling(projectId, env);
  if (!state) throw new Error(`Extra pages payment references unknown project ${projectId}`);
  const payments = Array.isArray(state.payments) ? state.payments : [];
  if (payments.some((payment) => payment.session_id === session.id)) return { ok: true, duplicate: true };
  const extraPages = Number(session.metadata.extra_pages || 0);
  const paidAt = nowIso();
  const next = {
    ...state,
    status: "PAID",
    paid_extra_pages: Number(state.paid_extra_pages || 0) + extraPages,
    paid_at: paidAt,
    extra_pages: 0,
    amount_cents: 0,
    checkout_url: null,
    checkout_expires_at: null,
    payments: [...payments, { session_id: session.id, extra_pages: extraPages, amount_cents: session.amount_total ?? null, paid_at: paidAt }]
  };
  await savePageBilling(projectId, next, env);
  await recordProjectEvent(env, projectId, "EXTRA_PAGES_PAID", session.id,
    { extra_pages: extraPages, amount_cents: session.amount_total ?? null });
  // Release the parked PREPARE_INPUTS step; it re-counts the pages and continues.
  const run = await env.DB.prepare(`
      SELECT wr.id FROM workflow_runs wr
      JOIN workflow_steps ws ON ws.workflow_run_id = wr.id
      WHERE wr.project_id = ? AND wr.status = 'WAITING' AND wr.error_code = 'EXTRA_PAGES_PAYMENT_REQUIRED'
        AND ws.step_key = 'PREPARE_INPUTS' AND ws.status = 'WAITING'
      LIMIT 1
    `).bind(projectId).first();
  if (run?.id) {
    await env.DB.prepare(`UPDATE workflow_steps SET status = 'QUEUED', error_message = NULL WHERE workflow_run_id = ? AND step_key = 'PREPARE_INPUTS' AND status = 'WAITING'`).bind(run.id).run();
    await env.DB.prepare(`UPDATE workflow_runs SET status = 'QUEUED', error_code = NULL, error_message = NULL WHERE id = ?`).bind(run.id).run();
    await env.DB.prepare(`UPDATE projects SET status = 'READY', blocked_reason = NULL, updated_at = ? WHERE id = ?`).bind(paidAt, projectId).run();
  }
  return { ok: true, released: Boolean(run?.id) };
}

export {
  countPdfPages,
  countMenuPages,
  paidMenuPages,
  loadPageBilling,
  pageBillingNote,
  checkPageBilling,
  sendPageBillingReminders,
  handleExtraPagesPay,
  handleExtraPagesDone,
  handleExtraPagesPaid
};
