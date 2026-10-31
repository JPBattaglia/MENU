// Review Replies DELIVER step (stage 5): "delivery" here means posting replies on Google, then a weekly summary email
// to the customer. Replies routed AUTO are posted at once; replies routed OWNER wait for one owner approval covering
// all of them (the stage 4 approval pages and digest), then are posted. Before posting, each review is read again so a
// reply the business wrote on Google in the meantime is never overwritten.
import { APPROVAL_TTL_DAYS, ownerEmailAddress } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { createOwnerApproval, finishDelivery, isTestOrder, latestOwnerApproval, loadDeliveryContext, parkForOwnerApproval } from "../../approvals/release.js";
import { retryStepLater } from "../../workflows/runner.js";
import { settingsLink } from "../../subscriptions/settings.js";
import { GoogleApiError, getReview, putReviewReply } from "../../google/api.js";
import { isSelfTestReview, projectMeta, tokenOrPark } from "./review-step.js";

const e = escapeHtml;
const SUMMARY_EVENT = "REVIEW_WEEK_SUMMARY";
const stars = (n) => (n ? `${"★".repeat(n)}${"☆".repeat(5 - n)}` : "No rating");
const clip = (text, n) => { const s = String(text || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

async function setRow(env, row, status, extra = {}) {
  await env.DB.prepare(`UPDATE review_replies SET status = ?, posted_at = ?, error = ?, updated_at = ? WHERE id = ?`)
    .bind(status, extra.postedAt || null, extra.error || null, nowIso(), row.id).run();
}

// Posts each row. Throws a GoogleApiError on a Google outage (5xx/429) so the step is retried; anything else is
// recorded on the row and the rest carry on.
async function postRows(env, token, rows, fetchImpl) {
  const result = { posted: 0, probed: 0, skipped: 0, failed: [] };
  for (const row of rows) {
    if (!String(row.draft_reply || "").trim()) { await setRow(env, row, "SKIPPED", { error: "No reply to post" }); result.skipped += 1; continue; }
    if (isSelfTestReview(row.review_name)) {
      // Self-test: the real reply call against the owner's real profile, for a review that does not exist.
      // Google answering 404 proves the token, scope, endpoint and request shape reach the reply API.
      try {
        await putReviewReply(token, row.review_name, row.draft_reply, fetchImpl);
        await setRow(env, row, "FAILED", { error: "Google accepted a reply to a synthetic review" });
        result.failed.push({ row, error: "Google accepted a reply to a synthetic review" });
      } catch (error) {
        if (error instanceof GoogleApiError && error.status === 404) { await setRow(env, row, "PROBED", { postedAt: nowIso(), error: "404 from Google (expected)" }); result.probed += 1; continue; }
        if (error instanceof GoogleApiError && (error.status >= 500 || error.status === 429)) throw error;
        await setRow(env, row, "FAILED", { error: String(error.message).slice(0, 500) });
        result.failed.push({ row, error: error.message });
      }
      continue;
    }
    try {
      const current = await getReview(token, row.review_name, fetchImpl);
      if (current?.reviewReply?.comment && String(current.reviewReply.updateTime || "") > String(row.created_at)) {
        await setRow(env, row, "SKIPPED", { error: "The business already replied on Google" }); result.skipped += 1; continue;
      }
      await putReviewReply(token, row.review_name, row.draft_reply, fetchImpl);
      await setRow(env, row, "POSTED", { postedAt: nowIso() });
      result.posted += 1;
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status >= 500 || error.status === 429)) throw error;
      if (error instanceof GoogleApiError && error.status === 404) { await setRow(env, row, "SKIPPED", { error: "The review was removed from Google" }); result.skipped += 1; continue; }
      await setRow(env, row, "FAILED", { error: String(error.message).slice(0, 500) });
      result.failed.push({ row, error: error.message });
    }
  }
  return result;
}

async function produceOutput(env, runId) {
  const row = await env.DB.prepare(`SELECT output_json FROM workflow_steps WHERE workflow_run_id = ? AND step_key = 'PRODUCE'`).bind(runId).first();
  return parseJsonOrNull(row?.output_json) || {};
}

async function previousAverage(env, subscriptionId, runId) {
  const row = await env.DB.prepare(`SELECT payload_json FROM business_events WHERE event_type = ? AND entity_id = ? AND correlation_id != ? ORDER BY created_at DESC LIMIT 1`)
    .bind(SUMMARY_EVENT, subscriptionId, runId).first();
  const average = parseJsonOrNull(row?.payload_json)?.average;
  return Number.isFinite(average) ? average : null;
}

async function alertOwnerOfPostFailures(env, context, failed, runId) {
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `${failed.length} review repl${failed.length === 1 ? "y" : "ies"} couldn't be posted for ${context.business_name || "a customer"}`,
    html: brandedEmailHtml({ preheader: "Google refused some review replies.", eyebrow: "AUTOMATION ALERT", heading: "Google refused some review replies",
      paragraphs: ["The rest of this week's replies were posted. These were not:"],
      rows: failed.slice(0, 10).map((f) => [`${f.row.star_rating || "?"} stars`, clip(f.error, 200)]) }),
    text: `Google refused ${failed.length} review repl(ies) for ${context.business_name || "a customer"}:\n${failed.map((f) => `- ${f.row.review_name}: ${f.error}`).join("\n")}`,
    idempotencyKey: `review-post-failed/${runId}`, purpose: "AUTOMATION_ALERT", templateKey: "review_post_failed_v1"
  }).catch(() => null);
}

async function sendWeeklySummary(env, targetStep, context, meta, rows, totals) {
  const business = context.business_name || "your business";
  const answered = rows.filter((r) => ["POSTED", "PROBED"].includes(r.status));
  const notAnswered = rows.filter((r) => ["SKIPPED", "FAILED"].includes(r.status));
  const previous = await previousAverage(env, meta.subscription_id, targetStep.workflow_run_id);
  const rating = Number.isFinite(totals?.average) && totals.count
    ? `${totals.average.toFixed(1)} from ${totals.count} review${totals.count === 1 ? "" : "s"}${previous !== null && Math.abs(previous - totals.average) >= 0.05 ? ` (${totals.average > previous ? "up" : "down"} from ${previous.toFixed(1)})` : ""}`
    : "Not shown by Google yet";
  const lines = answered.slice(0, 6).map((r) => `${stars(Number(r.star_rating))} “${e(clip(r.review_text, 140) || "rating only")}”<br><span style="color:#08747b">Our reply:</span> “${e(clip(r.draft_reply, 220))}”`);
  const settings = await settingsLink(env, meta.subscription_id);
  const test = isTestOrder(context) ? "[TEST] " : "";
  const subject = rows.length
    ? `${test}${business}'s Google reviews this week: ${rows.length} new, ${answered.length} answered`
    : `${test}${business}'s Google reviews this week: no new reviews`;
  const paragraphs = [`Hi ${e(context.first_name || "there")},`,
    rows.length ? `Here's what happened on your Google profile this week.` : "No new reviews came in this week. We'll check again next week.",
    ...lines,
    notAnswered.length ? `${notAnswered.length} review${notAnswered.length === 1 ? " was" : "s were"} not answered by us (already answered on Google, removed, or held back).` : ""
  ].filter(Boolean);
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject,
    html: brandedEmailHtml({
      preheader: rows.length ? `${answered.length} of ${rows.length} new reviews answered.` : "No new reviews this week.",
      eyebrow: "REVIEW REPLIES · WEEKLY SUMMARY", heading: `${business}'s reviews this week`, paragraphs,
      rows: [["New reviews", String(rows.length)], ["Answered", String(answered.length)], ["Google rating", rating]],
      buttons: [{ label: "Change how replies sound", url: settings }],
      footnote: "Replies to 4 and 5 star reviews go out on their own; low ratings are read by a person first. Want a reply changed? Answer this email."
    }),
    text: [`${business}'s Google reviews this week`, "", `New reviews: ${rows.length}`, `Answered: ${answered.length}`, `Google rating: ${rating}`, "",
      ...answered.slice(0, 6).map((r) => `${Number(r.star_rating) || "?"} stars: "${clip(r.review_text, 140)}"\nOur reply: "${clip(r.draft_reply, 220)}"\n`),
      `Change how replies sound: ${settings}`].join("\n"),
    idempotencyKey: `review-summary/${targetStep.workflow_run_id}`,
    purpose: "REVIEW_SUMMARY", templateKey: "review_weekly_summary_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
  if (sent.ok) {
    await env.DB.prepare(`INSERT INTO business_events (id, created_at, event_type, entity_type, entity_id, actor_type, actor_id, correlation_id, payload_json)
        VALUES (?, ?, ?, 'SUBSCRIPTION', ?, 'SYSTEM', 'MENU_MADE_AUTOMATION', ?, ?)`)
      .bind(crypto.randomUUID(), nowIso(), SUMMARY_EVENT, meta.subscription_id, targetStep.workflow_run_id,
        JSON.stringify({ average: Number.isFinite(totals?.average) ? totals.average : null, count: totals?.count ?? null, new: rows.length, answered: answered.length })).run();
  }
  return sent;
}

// The review part of DELIVER, shared by Review Replies and Google Profile Care: post AUTO replies, ask the owner once
// for the rest, post those after approval. Returns { parked } while waiting (or retrying), else { ownerRows, approval }.
async function deliverReplies(targetStep, env, context, meta, fetchImpl) {
  const rows = (await env.DB.prepare(`SELECT * FROM review_replies WHERE project_id = ? ORDER BY created_at`).bind(context.id).all()).results || [];
  const autoRows = rows.filter((r) => r.route === "AUTO" && r.status === "DRAFTED");
  const ownerRows = rows.filter((r) => r.route === "OWNER" && r.status === "DRAFTED");

  let approval = await latestOwnerApproval(context.id, env);
  if (ownerRows.length && !(approval && ["PENDING", "APPROVED"].includes(approval.status))) {
    const drafts = await env.DB.prepare(`SELECT id FROM deliverables WHERE project_id = ? AND deliverable_type = 'REVIEW_REPLY_DRAFTS' AND status != 'SUPERSEDED' ORDER BY version DESC LIMIT 1`).bind(context.id).first();
    if (!drafts) throw new Error("Replies wait for the owner but the drafts page is missing");
    approval = await createOwnerApproval(targetStep, context, [{ id: drafts.id }], { mode: "OWNER", source: "ITEM" }, approval, env);
  }
  const ownerApproved = ownerRows.length > 0 && approval?.status === "APPROVED";
  const toPost = [...autoRows, ...(ownerApproved ? ownerRows : [])];
  if (toPost.length) {
    const auth = await tokenOrPark(env, targetStep, context, meta, fetchImpl);
    if (auth.parked) return { parked: auth.parked };
    let posting;
    try {
      posting = await postRows(env, auth.token, toPost, fetchImpl);
    } catch (error) {
      if (error instanceof GoogleApiError) return { parked: await retryStepLater(targetStep, env, error.message) };
      throw error;
    }
    if (posting.failed.length) await alertOwnerOfPostFailures(env, context, posting.failed, targetStep.workflow_run_id);
  }
  if (ownerRows.length && !ownerApproved) return { parked: await parkForOwnerApproval(targetStep, context, approval, env) };
  return { ownerRows, approval: ownerRows.length ? approval : null };
}

async function loadReplyRows(env, projectId) {
  return (await env.DB.prepare(`SELECT * FROM review_replies WHERE project_id = ? ORDER BY created_at`).bind(projectId).all()).results || [];
}

async function runReviewRepliesDeliverStep(targetStep, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const meta = await projectMeta(env, context.id);
  const replies = await deliverReplies(targetStep, env, context, meta, fetchImpl);
  if (replies.parked) return replies.parked;
  const rows = await loadReplyRows(env, context.id);
  const totals = (await produceOutput(env, targetStep.workflow_run_id)).totals || {};
  const sent = await sendWeeklySummary(env, targetStep, context, meta, rows, totals);
  if (!sent.ok) return retryStepLater(targetStep, env, `Weekly summary email failed: ${sent.error}`);
  const count = (status) => rows.filter((r) => r.status === status).length;
  return finishDelivery(targetStep, context, {
    delivered_at: nowIso(), recipient: context.customer_email, email_id: sent.id,
    reviews: rows.length, posted: count("POSTED"), probed: count("PROBED"), skipped: count("SKIPPED"), failed: count("FAILED"),
    approval_id: replies.approval?.id || null
  }, replies.approval ? "OWNER" : "AUTO", replies.approval, [], env);
}

// Presenter: what the owner reads in the approval email and on the approve page.
const reviewRepliesOverrides = {
  runDeliver: (targetStep, env) => runReviewRepliesDeliverStep(targetStep, env),
  ownerLabel(context) {
    return `${context.business_name || "A customer"} - review replies`;
  },
  approvalCopy: {
    intro: "Read the replies. Approving posts them on the customer's Google profile right away.",
    button: "Approve and post on Google",
    done: "Approved. The replies are being posted on Google now, and the customer gets their weekly summary."
  },
  async ownerEmail({ context, previews, approveUrl, env }) {
    const rows = (await env.DB.prepare(`SELECT * FROM review_replies WHERE project_id = ? AND route = 'OWNER' AND status = 'DRAFTED' ORDER BY star_rating`).bind(context.id).all()).results || [];
    const business = context.business_name || "A customer";
    const test = isTestOrder(context) ? "[TEST] " : "";
    const n = rows.length;
    return {
      subject: `${test}Approve ${n} review repl${n === 1 ? "y" : "ies"} for ${business}`,
      templateKey: "owner_approval_review_replies_v1",
      html: brandedEmailHtml({
        preheader: `${n} low-rating repl${n === 1 ? "y waits" : "ies wait"} for your OK before posting on Google.`,
        eyebrow: test ? "TEST · OWNER APPROVAL" : "OWNER APPROVAL",
        heading: `${business}: ${n} review repl${n === 1 ? "y" : "ies"} to approve`,
        paragraphs: ["These answer 1 to 3 star reviews (or drafts a check flagged), so nothing is posted until you approve. Replies to 4 and 5 star reviews already went out.",
          ...rows.slice(0, 5).map((r) => `${stars(Number(r.star_rating))} “${e(clip(r.review_text, 160) || "rating only")}”<br><strong>Reply:</strong> “${e(clip(r.draft_reply, 400))}”${r.problems_json && r.problems_json !== "[]" ? `<br><em>${e(r.route_reason || "")}</em>` : ""}`)],
        buttons: [...previews.map((p) => ({ ...p, label: "See all drafts" })), { label: "Approve and post", url: approveUrl, primary: true }],
        footnote: `On the approve page you can approve all, or request changes (say what to change, or which review to leave unanswered). Link expires in ${APPROVAL_TTL_DAYS} days.`
      }),
      text: [`${business}: ${n} review repl(ies) wait for your approval before posting on Google.`, "",
        ...rows.slice(0, 5).map((r) => `${Number(r.star_rating) || "?"} stars: "${clip(r.review_text, 160)}"\nReply: "${clip(r.draft_reply, 400)}"\n`),
        ...previews.map((p) => `See all drafts: ${p.url}`), `Approve and post: ${approveUrl}`].join("\n")
    };
  }
};

export { SUMMARY_EVENT, stars, clip, postRows, deliverReplies, loadReplyRows, produceOutput, previousAverage, runReviewRepliesDeliverStep, reviewRepliesOverrides };
