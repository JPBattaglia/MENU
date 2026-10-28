// Google Profile Care (stage 5, weekly + monthly). Each weekly run (the monthly subscription job is week 1, the daily
// pass adds weeks 2-4, see review-replies/weeks.js):
//   PRODUCE  a weekly Google post (AI, facts checked) with a photo from the customer's library; review reply drafts
//            (the Review Replies code) unless the subscription also has Review Replies (Growth and Pro bundles), which
//            then answers them itself; in week 1 only: up to 3 library photos for the profile and the monthly report.
//   DELIVER  publish the post and photos (automatic), post review replies (1-3 stars after the owner approves), then one
//            weekly email to the customer with the post, photos, reviews and, in week 1, the report.
// Google's Q&A API was shut down on Nov 3, 2025, so answering questions is not part of this product.
// Self-test projects (GOOGLE_PROFILE_CARE_SELFTEST) run on the owner's profile but publish to a location id that does
// not exist, so Google refuses each write (400/404) without anything going public; reads and the report are real.
import { DELIVERY_LINK_TTL_DAYS, ownerEmailAddress, publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { signLinkToken } from "../../lib/links.js";
import { finishDelivery, isTestOrder, loadDeliveryContext } from "../../approvals/release.js";
import { completeStep, retryStepLater } from "../../workflows/runner.js";
import { settingsLink } from "../../subscriptions/settings.js";
import { GoogleApiError, createLocalPost, createMedia, v4LocationPath } from "../../google/api.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { isSelfTestProject, prepareGoogle, produceReviewDrafts, projectMeta, tokenOrPark } from "../review-replies/review-step.js";
import { clip, deliverReplies, loadReplyRows, previousAverage, produceOutput, reviewRepliesOverrides, stars } from "../review-replies/deliver.js";
import { markPhoto, mediaUrl, photoForPost, photoLibraryLink, photosNotOnProfile } from "./library.js";
import { draftWeeklyPost } from "./post.js";
import { fetchProfileNumbers, reportHtml, reportSummary } from "./report.js";

const PHOTOS_PER_MONTH = 3;
const SELFTEST_LOCATION = "locations/menu-made-selftest";
const e = escapeHtml;

const isMonthlyRun = (meta) => meta.source === "SUBSCRIPTION_PERIOD" || isSelfTestProject(meta);

async function hasReviewRepliesPlan(env, subscriptionId) {
  return Boolean(await env.DB.prepare(`SELECT 1 FROM entitlements WHERE subscription_id = ? AND entitlement_type = 'REVIEW_REPLIES' AND status = 'ACTIVE'`).bind(subscriptionId).first());
}

async function addItem(env, g, kind, ref, fields = {}) {
  const t = nowIso();
  await env.DB.prepare(`
      INSERT OR IGNORE INTO profile_care_items (id, subscription_id, project_id, kind, ref, status, content, asset_id, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), g.subscriptionId, g.context.id, kind, ref, fields.status || "DRAFTED", fields.content ?? null, fields.assetId || null, fields.error || null, t, t).run();
}

const itemsFor = async (env, projectId) => (await env.DB.prepare(`SELECT * FROM profile_care_items WHERE project_id = ? ORDER BY created_at`).bind(projectId).all()).results || [];

async function alertOwner(env, context, subject, lines, key) {
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject,
    html: brandedEmailHtml({ preheader: subject, eyebrow: "AUTOMATION ALERT", heading: subject, paragraphs: lines.map(e) }),
    text: `${subject}\n\n${lines.join("\n")}`, idempotencyKey: key, purpose: "AUTOMATION_ALERT", templateKey: "google_care_alert_v1",
    context: { projectId: context.id, businessId: context.business_id, orderId: context.order_id }
  }).catch(() => null);
}

async function runGoogleCareProduceStep(targetStep, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || new Date();
  const g = await prepareGoogle(targetStep, env, deps);
  if (g.parked) return g.parked;
  const output = { profile: g.connection.location_title || g.connection.location_name };

  if (!g.regeneration) {
    const existing = await itemsFor(env, g.context.id);
    // 1. The weekly post.
    if (!existing.some((i) => i.kind === "POST")) {
      const recent = (await env.DB.prepare(`SELECT content FROM profile_care_items WHERE subscription_id = ? AND kind = 'POST' AND status IN ('PUBLISHED', 'PROBED') ORDER BY created_at DESC LIMIT 4`).bind(g.subscriptionId).all()).results || [];
      const photo = await photoForPost(env, g.subscriptionId);
      const draft = await draftWeeklyPost(env, { businessName: g.businessName, location: g.location, settings: g.settings, now, scope: g.scope,
        recentPosts: recent.map((r) => parseJsonOrNull(r.content)?.summary).filter(Boolean) }, deps.generate);
      const content = JSON.stringify({ summary: draft.summary, website: g.location.websiteUri || null });
      if (draft.problems.length) {
        await addItem(env, g, "POST", "post", { status: "SKIPPED", content, error: `Not published: ${draft.problems.map((p) => p.kind).join(", ")}` });
        await alertOwner(env, g.context, `This week's Google post for ${g.businessName} was held back`, [
          "The draft still mentioned something the business never gave us, so it was not published.", `Draft: ${draft.summary}`,
          `Problems: ${draft.problems.map((p) => `${p.kind} (${p.value})`).join("; ")}`], `google-post-held/${g.context.id}`);
      } else {
        await addItem(env, g, "POST", "post", { content, assetId: photo?.id || null });
      }
      output.post = draft.problems.length ? "HELD" : "DRAFTED";
    }
    if (isMonthlyRun(g.meta)) {
      // 2. Photos for the profile.
      for (const photo of await photosNotOnProfile(env, g.subscriptionId, PHOTOS_PER_MONTH)) await addItem(env, g, "PHOTO", photo.id, { assetId: photo.id });
      // 3. The monthly report.
      if (!existing.some((i) => i.kind === "REPORT")) {
        try {
          const numbers = await fetchProfileNumbers(g.token, g.connection.location_name, now, fetchImpl);
          const since = new Date(now.getTime() - 30 * 864e5).toISOString();
          const count = async (sql) => Number((await env.DB.prepare(sql).bind(g.subscriptionId, since).first())?.n || 0);
          const posts = await count(`SELECT COUNT(*) AS n FROM profile_care_items WHERE subscription_id = ? AND kind = 'POST' AND status = 'PUBLISHED' AND updated_at >= ?`);
          const photos = await count(`SELECT COUNT(*) AS n FROM profile_care_items WHERE subscription_id = ? AND kind = 'PHOTO' AND status = 'PUBLISHED' AND updated_at >= ?`);
          const replies = await count(`SELECT COUNT(*) AS n FROM review_replies WHERE subscription_id = ? AND status = 'POSTED' AND updated_at >= ?`);
          const summary = await reportSummary(env, numbers, g.businessName, g.scope, deps.generate);
          const html = new TextEncoder().encode(reportHtml({ business: g.businessName, numbers, summary, posts, photos, replies }));
          const stored = await storeDeliverable(env, g.context, {
            type: "GOOGLE_PROFILE_REPORT", filename: `google-report-${numbers.range.end}.html`, mime: "text/html", bytes: html, folder: "google-care",
            metadata: { google_report: { ...numbers.headline, range: numbers.range } }
          });
          await addItem(env, g, "REPORT", "report", { status: "PUBLISHED", content: stored.deliverableId });
          output.report = numbers.headline;
        } catch (error) {
          if (error instanceof GoogleApiError && (error.status >= 500 || error.status === 429)) return retryStepLater(targetStep, env, error.message);
          if (!(error instanceof GoogleApiError)) throw error;
          await addItem(env, g, "REPORT", "report", { status: "FAILED", error: error.message.slice(0, 500) });
          await alertOwner(env, g.context, `The Google report for ${g.businessName} could not be made`, [error.message], `google-report-failed/${g.context.id}`);
          output.report = "FAILED";
        }
      }
    }
  }
  // 4. Reviews, unless Review Replies is also on this subscription (it answers them itself).
  if (await hasReviewRepliesPlan(env, g.subscriptionId)) {
    output.reviews = "BY_REVIEW_REPLIES_PLAN";
  } else {
    const reviews = await produceReviewDrafts(env, targetStep, g, deps);
    if (reviews.retry) return reviews.retry;
    Object.assign(output, reviews);
  }
  await completeStep(targetStep, output, env);
  return output;
}

// Publishes DRAFTED post and photo items. Throws GoogleApiError on an outage (the step retries); other refusals are
// recorded on the item.
async function publishItems(env, context, meta, token, connection, items, fetchImpl) {
  const probe = isSelfTestProject(meta);
  const path = probe ? `${connection.account_name}/${SELFTEST_LOCATION}` : v4LocationPath(connection);
  const failed = [];
  for (const item of items.filter((i) => i.status === "DRAFTED" && (i.kind === "POST" || i.kind === "PHOTO"))) {
    const set = (status, extra = {}) => env.DB.prepare(`UPDATE profile_care_items SET status = ?, google_name = ?, error = ?, updated_at = ? WHERE id = ?`)
      .bind(status, extra.name || null, extra.error || null, nowIso(), item.id).run();
    try {
      let created;
      const source = item.asset_id ? await mediaUrl(env, item.asset_id) : null;
      if (item.kind === "POST") {
        const content = parseJsonOrNull(item.content) || {};
        created = await createLocalPost(token, path, {
          languageCode: "en-US", topicType: "STANDARD", summary: content.summary,
          ...(source ? { media: [{ mediaFormat: "PHOTO", sourceUrl: source }] } : {}),
          ...(content.website ? { callToAction: { actionType: "LEARN_MORE", url: content.website } } : {})
        }, fetchImpl);
      } else {
        created = await createMedia(token, path, source, fetchImpl);
      }
      if (probe) { await set("FAILED", { error: "Google accepted a write to the synthetic self-test location" }); failed.push({ item, error: "accepted a synthetic write" }); continue; }
      await set("PUBLISHED", { name: created?.name || null });
      if (item.asset_id) await markPhoto(env, item.asset_id, item.kind === "POST" ? "used_post_at" : "used_upload_at");
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status >= 500 || error.status === 429)) throw error;
      if (probe && error instanceof GoogleApiError && [400, 404].includes(error.status)) { await set("PROBED", { error: `${error.status} from Google (expected)` }); continue; }
      await set("FAILED", { error: String(error.message).slice(0, 500) });
      failed.push({ item, error: error.message });
    }
  }
  return failed;
}

async function sendCareSummary(env, targetStep, context, meta, items, replyRows, reviewsHandled, totals) {
  const business = context.business_name || "your business";
  const post = items.find((i) => i.kind === "POST");
  const postText = parseJsonOrNull(post?.content)?.summary || "";
  const photos = items.filter((i) => i.kind === "PHOTO" && ["PUBLISHED", "PROBED"].includes(i.status)).length;
  const reportItem = items.find((i) => i.kind === "REPORT" && i.status === "PUBLISHED");
  let reportUrl = null;
  if (reportItem?.content) {
    await env.DB.prepare(`UPDATE deliverables SET status = 'FINAL', customer_visible = 1, delivered_at = COALESCE(delivered_at, ?) WHERE id = ?`).bind(nowIso(), reportItem.content).run();
    reportUrl = `${publicBaseUrl(env)}/api/delivery/${reportItem.content}?t=${await signLinkToken(env, { kind: "deliver", id: reportItem.content, ttlDays: DELIVERY_LINK_TTL_DAYS })}`;
  }
  const answered = replyRows.filter((r) => ["POSTED", "PROBED"].includes(r.status));
  const previous = await previousAverage(env, meta.subscription_id, targetStep.workflow_run_id);
  const rating = Number.isFinite(totals?.average) && totals.count
    ? `${totals.average.toFixed(1)} from ${totals.count} reviews${previous !== null && Math.abs(previous - totals.average) >= 0.05 ? ` (${totals.average > previous ? "up" : "down"} from ${previous.toFixed(1)})` : ""}` : null;
  const postLine = post?.status === "PUBLISHED" || post?.status === "PROBED" ? `New Google post: “${e(clip(postText, 300))}”`
    : post ? "This week's post was held back for a check; we'll follow up." : "";
  const test = isTestOrder(context) ? "[TEST] " : "";
  const rows = [["Google post", post && ["PUBLISHED", "PROBED"].includes(post.status) ? "Published" : post ? "Held back" : "None this week"], ["Photos added", String(photos)]];
  if (reviewsHandled) rows.push(["New reviews", String(replyRows.length)], ["Answered", String(answered.length)]);
  if (rating) rows.push(["Google rating", rating]);
  const buttons = [...(reportUrl ? [{ label: "Open your monthly report", url: reportUrl, primary: true }] : []),
    { label: "Add photos", url: await photoLibraryLink(env, meta.subscription_id) }, { label: "Tell us your specials", url: await settingsLink(env, meta.subscription_id) }];
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `${test}This week on ${business}'s Google profile${reportUrl ? " + your monthly report" : ""}`,
    html: brandedEmailHtml({
      preheader: reportUrl ? "Your weekly update and monthly Google report." : "Your weekly Google profile update.",
      eyebrow: "GOOGLE PROFILE CARE", heading: `This week on ${business}'s Google profile`,
      paragraphs: [`Hi ${e(context.first_name || "there")},`, postLine,
        ...answered.slice(0, 4).map((r) => `${stars(Number(r.star_rating))} “${e(clip(r.review_text, 120) || "rating only")}”<br><span style="color:#08747b">Our reply:</span> “${e(clip(r.draft_reply, 200))}”`),
        reviewsHandled ? "" : "Your review replies come in their own weekly email.",
        photos === 0 && isMonthlyRun(meta) ? "Add a few photos to your library and we'll put them on your profile next month." : ""].filter(Boolean),
      rows, buttons,
      footnote: "Want something featured next week, like a special or an event? Add it with \"Tell us your specials\" or reply to this email."
    }),
    text: [`This week on ${business}'s Google profile`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", postText ? `Post: ${postText}` : "", reportUrl ? `Monthly report: ${reportUrl}` : ""].filter(Boolean).join("\n"),
    idempotencyKey: `google-care-summary/${targetStep.workflow_run_id}`, purpose: "GOOGLE_CARE_SUMMARY", templateKey: "google_care_weekly_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
  if (sent.ok && reviewsHandled) {
    await env.DB.prepare(`INSERT INTO business_events (id, created_at, event_type, entity_type, entity_id, actor_type, actor_id, correlation_id, payload_json)
        VALUES (?, ?, 'REVIEW_WEEK_SUMMARY', 'SUBSCRIPTION', ?, 'SYSTEM', 'MENU_MADE_AUTOMATION', ?, ?)`)
      .bind(crypto.randomUUID(), nowIso(), meta.subscription_id, targetStep.workflow_run_id, JSON.stringify({ average: Number.isFinite(totals?.average) ? totals.average : null, count: totals?.count ?? null })).run();
  }
  return { ...sent, reportUrl };
}

async function runGoogleCareDeliverStep(targetStep, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const meta = await projectMeta(env, context.id);
  let items = await itemsFor(env, context.id);
  if (items.some((i) => i.status === "DRAFTED")) {
    const auth = await tokenOrPark(env, targetStep, context, meta, fetchImpl);
    if (auth.parked) return auth.parked;
    let failed;
    try {
      failed = await publishItems(env, context, meta, auth.token, auth.connection, items, fetchImpl);
    } catch (error) {
      if (error instanceof GoogleApiError) return retryStepLater(targetStep, env, error.message);
      throw error;
    }
    if (failed.length) {
      await alertOwner(env, context, `Google refused ${failed.length} update${failed.length === 1 ? "" : "s"} for ${context.business_name || "a customer"}`,
        failed.map((f) => `${f.item.kind}: ${f.error}`), `google-care-failed/${targetStep.workflow_run_id}`);
    }
    items = await itemsFor(env, context.id);
  }
  const produced = await produceOutput(env, targetStep.workflow_run_id);
  const reviewsHandled = produced.reviews !== "BY_REVIEW_REPLIES_PLAN";
  const replies = await deliverReplies(targetStep, env, context, meta, fetchImpl);
  if (replies.parked) return replies.parked;
  const replyRows = await loadReplyRows(env, context.id);
  const sent = await sendCareSummary(env, targetStep, context, meta, items, replyRows, reviewsHandled, produced.totals || {});
  if (!sent.ok) return retryStepLater(targetStep, env, `Weekly email failed: ${sent.error}`);
  const count = (kind, status) => items.filter((i) => i.kind === kind && i.status === status).length;
  return finishDelivery(targetStep, context, {
    delivered_at: nowIso(), recipient: context.customer_email, email_id: sent.id,
    post: items.find((i) => i.kind === "POST")?.status || null, photos_published: count("PHOTO", "PUBLISHED"), photos_probed: count("PHOTO", "PROBED"),
    report: Boolean(sent.reportUrl), reviews: replyRows.length, replies_posted: replyRows.filter((r) => r.status === "POSTED").length,
    approval_id: replies.approval?.id || null
  }, replies.approval ? "OWNER" : "AUTO", replies.approval, [], env);
}

const googleCareOverrides = {
  ...reviewRepliesOverrides,
  runDeliver: (targetStep, env) => runGoogleCareDeliverStep(targetStep, env),
  ownerLabel(context) {
    return `${context.business_name || "A customer"} - review replies (Google Profile Care)`;
  }
};

export { PHOTOS_PER_MONTH, SELFTEST_LOCATION, runGoogleCareProduceStep, runGoogleCareDeliverStep, googleCareOverrides };
