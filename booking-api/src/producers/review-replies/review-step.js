// Review Replies PRODUCE step (stage 5, weekly): read the customer's recent Google reviews, draft a reply for every new
// one, and record each draft in review_replies with its route (AUTO or OWNER). DELIVER (deliver.js) posts them.
//   - No Google connection yet (a new subscriber) or a revoked one: email the customer their connect link and park the
//     step; connecting releases it (releaseGoogleWaits in google/connect.js).
//   - A redraft after the owner asked for changes only rewrites this week's drafts still waiting for the owner.
// The self-test (selftest/review-replies-selftest.js) runs this on the owner's own profile with two synthetic reviews
// added to whatever Google returns, because that profile has no real reviews.
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { jsonResponse, nowIso, parseJsonOrNull } from "../../lib/http.js";
import { loadRegenerationNote } from "../../approvals/actions.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { completeStep, retryStepLater } from "../../workflows/runner.js";
import { getSettings, settingsLink } from "../../subscriptions/settings.js";
import { GoogleApiError, accessTokenFor, getLocation, listReviews, v4LocationPath } from "../../google/api.js";
import { googleConnectUrl } from "../../google/connect.js";
import { GoogleAuthError } from "../../google/oauth.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { draftReplies, normalizeReview } from "./draft.js";
import { draftsPageHtml } from "./page.js";

const LOOKBACK_DAYS = 30;
const MAX_PAGES = 3;
const MAX_REVIEWS_PER_RUN = 30;
const SELFTEST_SOURCE = "REVIEW_REPLIES_SELFTEST";
const SELFTEST_REVIEW_PREFIX = "menu-made-selftest-";
const e = escapeHtml;

async function projectMeta(env, projectId) {
  const row = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(projectId).first();
  return parseJsonOrNull(row?.metadata_json) || {};
}

// Whose Google connection this project uses: the subscription's own, or (self-test only) the owner's profile.
function connectionKey(meta) {
  return meta.source === SELFTEST_SOURCE && meta.google_subscription_id ? meta.google_subscription_id : meta.subscription_id;
}

async function loadConnection(env, meta) {
  return env.DB.prepare(`SELECT * FROM google_connections WHERE subscription_id = ?`).bind(connectionKey(meta)).first();
}

const isSelfTestReview = (name) => String(name).includes(`/reviews/${SELFTEST_REVIEW_PREFIX}`);

function parkForGoogle(targetStep, env, reason) {
  return (async () => {
    await env.DB.prepare(`UPDATE workflow_steps SET status = 'WAITING', error_message = NULL, output_json = ? WHERE id = ?`)
      .bind(JSON.stringify({ waiting_for: "GOOGLE_CONNECTION", reason }), targetStep.workflow_step_id).run();
    await env.DB.prepare(`UPDATE workflow_runs SET status = 'WAITING', error_code = 'GOOGLE_CONNECTION_REQUIRED', error_message = ? WHERE id = ?`)
      .bind(reason, targetStep.workflow_run_id).run();
    await env.DB.prepare(`UPDATE projects SET status = 'AWAITING_INPUTS', blocked_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(reason, nowIso(), targetStep.project_id).run();
    return { waiting: true, response: jsonResponse({ ok: true, processed: true, status: "WAITING", waiting_for: "GOOGLE_CONNECTION", workflow_run_id: targetStep.workflow_run_id, step_key: targetStep.step_key }, 202) };
  })();
}

// The customer's connect (or reconnect) email. One per project, so a customer who never connects hears again next month.
async function askToConnect(env, targetStep, context, meta, { reconnect }) {
  if (meta.source === SELFTEST_SOURCE) throw new Error("The owner's Google profile is not connected: open /api/google/connect/owner");
  const subscriptionId = meta.subscription_id;
  const connect = await googleConnectUrl(env, subscriptionId);
  const settings = await settingsLink(env, subscriptionId);
  const business = context.business_name || "your business";
  const heading = reconnect ? "Please reconnect your Google profile" : "Connect your Google profile to start";
  const lead = reconnect
    ? `Google stopped letting us reply to ${business}'s reviews. This happens after a Google password change or when access is removed. Reconnecting takes a minute.`
    : `Review Replies answers every new Google review for ${business}. To do that we need permission to reply on your Google Business Profile. It takes a minute.`;
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: reconnect ? `Reconnect Google so we can keep replying to ${business}'s reviews` : `Connect Google so we can reply to ${business}'s reviews`,
    html: brandedEmailHtml({
      preheader: reconnect ? "Your review replies are paused until you reconnect." : "One step to start your review replies.",
      eyebrow: "REVIEW REPLIES", heading,
      paragraphs: [`Hi ${e(context.first_name || "there")},`, e(lead), "Sign in with the Google account that manages your listing on Google Maps."],
      buttons: [{ label: reconnect ? "Reconnect Google" : "Connect Google", url: connect, primary: true }, { label: "Choose how replies sound (optional)", url: settings }],
      footnote: "We reply in your name: 4 and 5 star reviews get a reply straight away, and low ratings are checked by a person first. This link works for 30 days."
    }),
    text: `${heading}\n\n${lead}\n\n${reconnect ? "Reconnect" : "Connect"} Google: ${connect}\nChoose how replies sound (optional): ${settings}`,
    idempotencyKey: `review-google-${reconnect ? "reconnect" : "connect"}/${context.id}`,
    purpose: "GOOGLE_CONNECT_REQUEST", templateKey: reconnect ? "review_google_reconnect_v1" : "review_google_connect_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
  if (!sent.ok) return { retry: await retryStepLater(targetStep, env, `Google connect email failed: ${sent.error}`) };
  return parkForGoogle(targetStep, env, reconnect ? "Waiting for the customer to reconnect Google" : "Waiting for the customer to connect Google");
}

// A fresh access token, or a parked step when the customer has to (re)connect.
async function tokenOrPark(env, targetStep, context, meta, fetchImpl) {
  const connection = await loadConnection(env, meta);
  if (!connection || connection.status !== "ACTIVE") {
    const parked = await askToConnect(env, targetStep, context, meta, { reconnect: connection?.status === "NEEDS_RECONNECT" });
    return { parked: parked.retry || parked };
  }
  try {
    return { connection, token: await accessTokenFor(env, connection, fetchImpl) };
  } catch (error) {
    if (error instanceof GoogleAuthError && error.reconnect) {
      const parked = await askToConnect(env, targetStep, context, meta, { reconnect: true });
      return { parked: parked.retry || parked };
    }
    if (error instanceof GoogleAuthError && error.status >= 500) return { parked: await retryStepLater(targetStep, env, error.message) };
    throw error;
  }
}

// Reviews updated in the last LOOKBACK_DAYS, newest first, with Google's rating totals.
async function fetchRecentReviews(token, connection, now, fetchImpl) {
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 864e5).toISOString();
  const reviews = [];
  let totals = { average: null, count: null };
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await listReviews(token, connection, { pageSize: 50, pageToken, orderBy: "updateTime desc" }, fetchImpl);
    if (page === 0) totals = { average: Number.isFinite(Number(data.averageRating)) ? Number(data.averageRating) : null, count: Number(data.totalReviewCount || 0) };
    let older = false;
    for (const raw of data.reviews || []) {
      const review = normalizeReview(raw);
      if (review.time && review.time < cutoff) { older = true; continue; }
      reviews.push(review);
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken || older) break;
  }
  return { reviews, totals };
}

function selfTestReviews(meta, connection, now) {
  return (meta.selftest_reviews || []).map((r) => normalizeReview({
    name: `${v4LocationPath(connection)}/reviews/${SELFTEST_REVIEW_PREFIX}${r.id}`,
    starRating: r.starRating, comment: r.comment, reviewer: { displayName: r.reviewer }, createTime: now.toISOString(), updateTime: now.toISOString()
  }));
}

async function knownReviewNames(env, subscriptionId, names) {
  const known = new Set();
  for (let i = 0; i < names.length; i += 50) {
    const chunk = names.slice(i, i + 50);
    const rows = (await env.DB.prepare(`SELECT review_name FROM review_replies WHERE subscription_id = ? AND review_name IN (${chunk.map(() => "?").join(",")})`)
      .bind(subscriptionId, ...chunk).all()).results || [];
    for (const row of rows) known.add(row.review_name);
  }
  return known;
}

async function saveDraft(env, targetStep, subscriptionId, d) {
  const t = nowIso();
  await env.DB.prepare(`
      INSERT INTO review_replies (id, subscription_id, project_id, workflow_run_id, review_name, star_rating, reviewer_name, review_text, review_time,
        draft_reply, route, route_reason, problems_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (subscription_id, review_name) DO NOTHING
    `).bind(crypto.randomUUID(), subscriptionId, targetStep.project_id, targetStep.workflow_run_id, d.review.name, d.review.stars, d.review.reviewer || null,
    d.review.text, d.review.time, d.reply, d.route, d.reason, JSON.stringify(d.problems), d.skip ? "SKIPPED" : "DRAFTED", t, t).run();
}

async function runReviewRepliesProduceStep(targetStep, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || new Date();
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const meta = await projectMeta(env, context.id);
  const subscriptionId = meta.subscription_id;
  if (!subscriptionId) throw new Error("This Review Replies project has no subscription");

  const auth = await tokenOrPark(env, targetStep, context, meta, fetchImpl);
  if (auth.parked) return auth.parked;
  const { connection, token } = auth;
  const settings = await getSettings(env, subscriptionId);
  const location = await getLocation(token, connection.location_name, fetchImpl).catch(() => ({}));
  const businessName = context.business_name || location.title || connection.location_title || "the business";
  const regeneration = await loadRegenerationNote(env, context.id);
  const scope = { entityType: "SUBSCRIPTION", entityId: subscriptionId, correlationId: targetStep.workflow_run_id };

  let fetched = { reviews: [], totals: { average: null, count: null } };
  try {
    fetched = await fetchRecentReviews(token, connection, now, fetchImpl);
  } catch (error) {
    if (error instanceof GoogleApiError && (error.status >= 500 || error.status === 429)) return retryStepLater(targetStep, env, error.message);
    throw error;
  }

  let drafted = [];
  if (regeneration) {
    // Redraft only this run's replies still waiting for the owner, following the owner's note.
    const waiting = (await env.DB.prepare(`SELECT * FROM review_replies WHERE project_id = ? AND route = 'OWNER' AND status = 'DRAFTED'`).bind(context.id).all()).results || [];
    const reviews = waiting.map((row) => ({ name: row.review_name, stars: Number(row.star_rating), reviewer: row.reviewer_name || "", firstName: String(row.reviewer_name || "").split(/\s+/)[0] || "", text: row.review_text || "", time: row.review_time }));
    drafted = reviews.length ? await draftReplies(env, { reviews, businessName, settings, location, note: regeneration.note, scope }, deps.generate) : [];
    for (const d of drafted) {
      // A redraft never posts on its own: the owner sees it again, unless they asked to skip it.
      await env.DB.prepare(`UPDATE review_replies SET draft_reply = ?, route = 'OWNER', route_reason = ?, problems_json = ?, status = ?, updated_at = ? WHERE project_id = ? AND review_name = ?`)
        .bind(d.reply, d.skip ? "Owner asked not to reply" : `Redrafted after your note${d.problems.length ? `; ${d.reason}` : ""}`, JSON.stringify(d.problems), d.skip ? "SKIPPED" : "DRAFTED", nowIso(), context.id, d.review.name).run();
    }
  } else {
    const all = [...fetched.reviews, ...(meta.source === SELFTEST_SOURCE ? selfTestReviews(meta, connection, now) : [])];
    const unanswered = all.filter((r) => r.name && !r.hasReply);
    const known = await knownReviewNames(env, subscriptionId, unanswered.map((r) => r.name));
    const fresh = unanswered.filter((r) => !known.has(r.name)).slice(0, MAX_REVIEWS_PER_RUN);
    drafted = fresh.length ? await draftReplies(env, { reviews: fresh, businessName, settings, location, scope }, deps.generate) : [];
    for (const d of drafted) await saveDraft(env, targetStep, subscriptionId, d);
  }

  // The owner's preview page: every reply in this run that waits for them, with the review it answers.
  const waiting = (await env.DB.prepare(`SELECT * FROM review_replies WHERE project_id = ? AND route = 'OWNER' AND status = 'DRAFTED' ORDER BY star_rating, created_at`).bind(context.id).all()).results || [];
  let deliverableId = null;
  if (waiting.length) {
    const autoCount = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM review_replies WHERE project_id = ? AND route = 'AUTO'`).bind(context.id).first())?.n || 0);
    const html = new TextEncoder().encode(draftsPageHtml({ business: businessName, rows: waiting, autoCount, profile: connection.location_title }));
    const stored = await storeDeliverable(env, context, {
      type: "REVIEW_REPLY_DRAFTS", filename: "review-reply-drafts.html", mime: "text/html", bytes: html, folder: "review-replies",
      metadata: { approval: "owner", review_replies: { waiting: waiting.length } }
    });
    deliverableId = stored.deliverableId;
  }
  const output = {
    outcome: regeneration ? "REDRAFTED" : "DRAFTED",
    profile: connection.location_title || connection.location_name,
    reviews_in_window: fetched.reviews.length,
    drafted: drafted.length,
    auto: drafted.filter((d) => d.route === "AUTO").length,
    owner: drafted.filter((d) => d.route === "OWNER" && !d.skip).length,
    totals: fetched.totals,
    drafts_deliverable_id: deliverableId
  };
  await completeStep(targetStep, output, env);
  return output;
}

export { LOOKBACK_DAYS, MAX_REVIEWS_PER_RUN, SELFTEST_SOURCE, SELFTEST_REVIEW_PREFIX, isSelfTestReview, connectionKey, loadConnection, projectMeta, tokenOrPark, fetchRecentReviews, runReviewRepliesProduceStep };
