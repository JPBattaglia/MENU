// Google Visibility (stage 5, one-time $149). Workflow GOOGLE_VISIBILITY_V1:
//   PRODUCE  the buyer connects their Google profile (emailed link; a buyer who needs a new profile first gets Google's
//            create-and-verify steps), then we read it, score it against the checklist (audit.js), plan the changes we
//            can make from what the business gave Menu-Made (sources.js), and have the AI write a fuller description
//            (describe.js). The owner's review page is stored as a draft.
//   DELIVER  with changes planned: one owner approval (owner decision Oct 28, 2026: a new description is creative work),
//            then the changes are published on Google; with nothing to change it goes straight on. Then the before/after
//            report is made and emailed to the buyer with the Google Profile Care offer.
// The connection is keyed by the project id (a one-time order has no subscription); google/connect.js accepts it.
// Self-test projects (GOOGLE_VISIBILITY_SELFTEST) use the owner's profile: profile edits are sent with validateOnly (Google
// checks them, nothing changes) and the menu link and photos go to a location id that doesn't exist (Google refuses).
import { DELIVERY_LINK_TTL_DAYS, ownerEmailAddress, publicBaseUrl, APPROVAL_TTL_DAYS } from "../../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { jsonResponse, nowIso, parseJsonOrNull } from "../../lib/http.js";
import { signLinkToken } from "../../lib/links.js";
import { AiCapError } from "../../ai/generate.js";
import { loadRegenerationNote } from "../../approvals/actions.js";
import { createOwnerApproval, finishDelivery, isTestOrder, latestOwnerApproval, loadDeliveryContext, parkForOwnerApproval } from "../../approvals/release.js";
import { completeStep, retryStepLater } from "../../workflows/runner.js";
import {
  GoogleApiError, accessTokenFor, availableAttributes, createMedia, getAttributes, getLocationForAudit, listMedia, listReviews, patchLocation, setUriAttribute, v4LocationPath
} from "../../google/api.js";
import { googleConnectUrl } from "../../google/connect.js";
import { GoogleAuthError } from "../../google/oauth.js";
import { markPhoto, mediaUrl } from "../google-care/library.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { auditAfter, auditProfile, planFixes } from "./audit.js";
import { draftDescription } from "./describe.js";
import { FIX_LABELS, planPageHtml, reportHtml } from "./report.js";
import { businessSources } from "./sources.js";

const SELFTEST_SOURCE = "GOOGLE_VISIBILITY_SELFTEST";
const SELFTEST_LOCATION = "locations/menu-made-selftest";
const CREATE_PROFILE_URL = "https://business.google.com/create";
const KEEP_DESCRIPTION = /\b(keep|leave|don'?t (?:change|touch|replace)|no new)\b[^.]*\bdescription\b/i;
const e = escapeHtml;

const isSelfTest = (meta) => meta?.source === SELFTEST_SOURCE;
const connectionKey = (meta, projectId) => meta?.google_subscription_id || projectId;

async function projectMeta(env, projectId) {
  return parseJsonOrNull((await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(projectId).first())?.metadata_json) || {};
}

async function input(env, projectId, key) {
  return (await env.DB.prepare(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = ? AND status = 'VALID'`).bind(projectId, key).first())?.value_text || "";
}

function park(targetStep, env, reason) {
  return (async () => {
    await env.DB.prepare(`UPDATE workflow_steps SET status = 'WAITING', error_message = NULL, output_json = ? WHERE id = ?`)
      .bind(JSON.stringify({ waiting_for: "GOOGLE_CONNECTION", reason }), targetStep.workflow_step_id).run();
    await env.DB.prepare(`UPDATE workflow_runs SET status = 'WAITING', error_code = 'GOOGLE_CONNECTION_REQUIRED', error_message = ? WHERE id = ?`).bind(reason, targetStep.workflow_run_id).run();
    await env.DB.prepare(`UPDATE projects SET status = 'AWAITING_INPUTS', blocked_reason = ?, updated_at = ? WHERE id = ?`).bind(reason, nowIso(), targetStep.project_id).run();
    return { waiting: true, response: jsonResponse({ ok: true, processed: true, status: "WAITING", waiting_for: "GOOGLE_CONNECTION", workflow_run_id: targetStep.workflow_run_id, step_key: targetStep.step_key }, 202) };
  })();
}

// The buyer's connect email. mode "new": they create and verify the profile with Google first (we can't do that for
// them: Google sends the owner a code or asks for a video). reminder 1 or 2 repeats it with a fresh link.
async function sendConnectEmail(env, context, { mode, reconnect = false, reminder = 0 }) {
  const business = context.business_name || "your business";
  const connect = await googleConnectUrl(env, context.id);
  const isNew = mode === "new" && !reconnect;
  const heading = reconnect ? "Please reconnect your Google profile" : isNew ? "Let's get your business on Google" : "Connect your Google profile to start";
  const paragraphs = reconnect
    ? [`Google stopped letting us update ${e(business)}'s profile. This happens after a Google password change or when access is removed. Reconnecting takes a minute.`]
    : isNew
      ? [`Thanks for ordering Google Visibility for ${e(business)}. Google only lets the business itself create and verify a profile, so there are two steps for you, then we take over:`,
        `<strong>1. Create your profile</strong> at <a href="${CREATE_PROFILE_URL}">business.google.com/create</a> with the Google account you'll manage it from. Enter your business name, category, address and phone.`,
        "<strong>2. Verify it.</strong> Google chooses how: a text or call, an email, a short video of your storefront, or a postcard with a code. It can take a few days.",
        "<strong>3. Press Connect Google below</strong> once Google says your profile is verified. We then check every detail, fill in what's missing and email you a before/after report."]
      : [`Thanks for ordering Google Visibility for ${e(business)}. To check and improve your Google Business Profile we need permission to manage it. It takes a minute.`,
        "We look at every detail Google shows, fill in what's missing, and email you a before/after report with anything only you can answer."];
  const subject = reconnect ? `Reconnect Google so we can finish ${business}'s profile`
    : reminder ? `Reminder: connect Google so we can improve ${business}'s profile`
      : isNew ? `Next step: create and connect ${business}'s Google profile` : `Connect Google so we can improve ${business}'s profile`;
  return sendTransactionalEmail(env, {
    to: context.customer_email, subject,
    html: brandedEmailHtml({
      preheader: isNew ? "Create your profile with Google, then connect it." : "One step to start your Google profile check.",
      eyebrow: "GOOGLE VISIBILITY", heading, paragraphs: [`Hi ${e(context.first_name || "there")},`, ...paragraphs, "Sign in with the Google account that manages your listing on Google Maps."],
      buttons: [{ label: reconnect ? "Reconnect Google" : "Connect Google", url: connect, primary: true }],
      footnote: "This link works for 30 days. You can remove our access any time in your Google Account under Security, Third-party connections. Questions? Reply to this email."
    }),
    text: `${heading}\n\n${paragraphs.map((p) => p.replace(/<[^>]+>/g, "")).join("\n\n")}\n\n${reconnect ? "Reconnect" : "Connect"} Google: ${connect}`,
    idempotencyKey: `gv-connect/${context.id}/${reconnect ? "re" : reminder}`, purpose: "GOOGLE_CONNECT_REQUEST",
    templateKey: reconnect ? "gv_reconnect_v1" : reminder ? `gv_connect_reminder_${reminder}_v1` : isNew ? "gv_connect_new_v1" : "gv_connect_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }
  });
}

// A token for the project's connection, or a parked step while the buyer has to (re)connect.
async function tokenOrPark(env, targetStep, context, meta, fetchImpl) {
  const connection = await env.DB.prepare(`SELECT * FROM google_connections WHERE subscription_id = ?`).bind(connectionKey(meta, context.id)).first();
  const ask = async (reconnect) => {
    if (isSelfTest(meta)) throw new Error(`The owner's Google profile is not connected: open ${publicBaseUrl(env)}/api/google/connect/owner`);
    const sent = await sendConnectEmail(env, context, { mode: await input(env, context.id, "google_mode"), reconnect });
    if (!sent.ok) return { parked: await retryStepLater(targetStep, env, `Google connect email failed: ${sent.error}`) };
    return { parked: await park(targetStep, env, reconnect ? "Waiting for the customer to reconnect Google" : "Waiting for the customer to connect Google") };
  };
  if (!connection || connection.status !== "ACTIVE") return ask(connection?.status === "NEEDS_RECONNECT");
  try {
    return { connection, token: await accessTokenFor(env, connection, fetchImpl) };
  } catch (error) {
    if (error instanceof GoogleAuthError && error.reconnect) return ask(true);
    if (error instanceof GoogleAuthError && error.status >= 500) return { parked: await retryStepLater(targetStep, env, error.message) };
    throw error;
  }
}

const transient = (error) => error instanceof GoogleApiError && (error.status >= 500 || error.status === 429);

// Self-test only: pretend some fields are empty so every kind of fix is exercised on a complete profile. The menu link
// is also treated as offered for this profile, whatever its category.
function blank(profile, fields = []) {
  const location = structuredClone(profile.location);
  const attributes = new Set(profile.attributes);
  const available = new Set(profile.available || []);
  let media = profile.media ? structuredClone(profile.media) : profile.media;
  for (const f of fields) {
    if (f === "description") delete location.profile;
    if (f === "phone") delete location.phoneNumbers;
    if (f === "website") delete location.websiteUri;
    if (f === "menu_link") { attributes.delete("attributes/url_menu"); available.add("attributes/url_menu"); }
    if (f === "photos") media = { mediaItems: [], totalMediaItemCount: 0 };
  }
  return { location, attributes, available, media };
}

async function readProfile(token, connection, fetchImpl) {
  const location = await getLocationForAudit(token, connection.location_name, fetchImpl);
  const attributes = new Set(((await getAttributes(token, connection.location_name, fetchImpl).catch((err) => { if (transient(err)) throw err; return {}; })).attributes || []).map((a) => a.name));
  const available = await availableAttributes(token, connection.location_name, fetchImpl).catch((err) => { if (transient(err)) throw err; return null; });
  const media = await listMedia(token, v4LocationPath(connection), fetchImpl).catch((err) => { if (transient(err)) throw err; return null; });
  let reviews = null;
  try {
    const data = await listReviews(token, connection, { pageSize: 50 }, fetchImpl);
    reviews = { count: Number(data.totalReviewCount || 0), average: Number(data.averageRating) || null, unanswered: (data.reviews || []).filter((r) => !r?.reviewReply?.comment).length };
  } catch (err) { if (transient(err)) throw err; }
  return { location, attributes, available, media, reviews };
}

async function tellOwner(env, context, subject, lines, key) {
  await sendTransactionalEmail(env, {
    to: context.customer_email === SELF_TEST_EMAIL ? SELF_TEST_EMAIL : ownerEmailAddress(env), subject,
    html: brandedEmailHtml({ preheader: subject, eyebrow: "GOOGLE VISIBILITY", heading: subject, paragraphs: lines.map(e) }),
    text: `${subject}\n\n${lines.join("\n")}`, idempotencyKey: key, purpose: "AUTOMATION_ALERT", templateKey: "gv_alert_v1",
    context: { projectId: context.id, businessId: context.business_id, orderId: context.order_id }
  }).catch(() => null);
}

async function runGoogleVisibilityProduceStep(targetStep, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || new Date();
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const meta = await projectMeta(env, context.id);
  const auth = await tokenOrPark(env, targetStep, context, meta, fetchImpl);
  if (auth.parked) return auth.parked;
  let profile;
  try {
    profile = await readProfile(auth.token, auth.connection, fetchImpl);
  } catch (error) {
    if (transient(error)) return retryStepLater(targetStep, env, error.message);
    throw error;
  }
  if (isSelfTest(meta)) Object.assign(profile, blank(profile, meta.selftest_blank));
  const business = context.business_name || profile.location.title || "the business";
  const audit = auditProfile(profile, now);
  const sources = isSelfTest(meta) ? (meta.selftest_sources || {}) : await businessSources(env, context.business_id);
  const regeneration = await loadRegenerationNote(env, context.id);
  let fixes = planFixes(audit, sources);
  if (regeneration && KEEP_DESCRIPTION.test(regeneration.note || "")) fixes = fixes.filter((f) => f.kind !== "DESCRIPTION");
  const output = { profile: auth.connection.location_title || auth.connection.location_name, score: audit.score };

  const describe = fixes.find((f) => f.kind === "DESCRIPTION");
  if (describe) {
    const scope = { entityType: "PROJECT", entityId: context.id, correlationId: targetStep.workflow_run_id };
    let draft;
    try {
      draft = await draftDescription(env, { businessName: business, location: profile.location, about: sources.about || "", note: regeneration?.note || "", scope }, deps.generate);
    } catch (error) {
      if (!(error instanceof AiCapError)) throw error;
      draft = { problems: [{ kind: "ai_cap", value: error.message }] };
    }
    if (draft.problems.length) {
      fixes = fixes.filter((f) => f !== describe);
      audit.notes.push("We drafted a new description but it didn't pass our fact check, so it is left as advice.");
      output.description = "HELD";
      await tellOwner(env, context, `${business}: the new Google description was held back`, [
        "It still mentioned something the business never gave us, so it is not in the changes.", `Draft: ${draft.description || ""}`,
        `Problems: ${draft.problems.map((p) => `${p.kind} (${p.value})`).join("; ")}`], `gv-description-held/${targetStep.workflow_run_id}`);
    } else {
      describe.value = draft.description;
      output.description = "DRAFTED";
    }
  }

  await env.DB.prepare(`DELETE FROM visibility_fixes WHERE project_id = ? AND status = 'PLANNED'`).bind(context.id).run();
  const t = nowIso();
  for (const fix of fixes) {
    await env.DB.prepare(`
        INSERT OR REPLACE INTO visibility_fixes (id, project_id, kind, ref, status, value, asset_id, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'PLANNED', ?, ?, NULL, ?, ?)
      `).bind(crypto.randomUUID(), context.id, fix.kind, fix.ref, fix.value ?? null, fix.assetId || null, t, t).run();
  }
  const html = new TextEncoder().encode(planPageHtml({ business, profileTitle: auth.connection.location_title, audit, fixes }));
  const plan = await storeDeliverable(env, context, {
    type: "GOOGLE_VISIBILITY_PLAN", filename: "google-visibility-review.html", mime: "text/html", bytes: html, folder: "google-visibility",
    metadata: { approval: "owner", google_visibility: { score: audit.score, fixes: fixes.length } }
  });
  await completeStep(targetStep, { ...output, fixes: fixes.map((f) => f.kind), plan_deliverable_id: plan.deliverableId, audit }, env);
  return output;
}

// Publishes one planned fix. Returns { status, error }; throws GoogleApiError on an outage.
async function applyFix(env, token, connection, fix, selfTest, fetchImpl) {
  const location = connection.location_name;
  const fake = `${connection.account_name}/${SELFTEST_LOCATION}`;
  // Only the menu link and images go to the synthetic location; profile edits are validated on the real one.
  const probe = (error) => (selfTest && !["DESCRIPTION", "PHONE", "WEBSITE"].includes(fix.kind) && error instanceof GoogleApiError && [400, 403, 404].includes(error.status) ? { status: "PROBED", error: `${error.status} from Google (expected)` } : null);
  try {
    if (["DESCRIPTION", "PHONE", "WEBSITE"].includes(fix.kind)) {
      const [body, mask] = fix.kind === "DESCRIPTION" ? [{ profile: { description: fix.value } }, "profile.description"]
        : fix.kind === "PHONE" ? [{ phoneNumbers: { primaryPhone: fix.value } }, "phoneNumbers"] : [{ websiteUri: fix.value }, "websiteUri"];
      await patchLocation(token, location, body, mask, { validateOnly: selfTest }, fetchImpl);
      return selfTest ? { status: "PROBED", error: "Validated by Google (validateOnly, nothing changed)" } : { status: "APPLIED" };
    }
    if (fix.kind === "MENU_LINK") {
      await setUriAttribute(token, selfTest ? SELFTEST_LOCATION : location, fix.ref, fix.value, fetchImpl);
    } else {
      await createMedia(token, selfTest ? fake : v4LocationPath(connection), await mediaUrl(env, fix.asset_id), fetchImpl, fix.kind === "LOGO" ? "LOGO" : "ADDITIONAL");
    }
    return selfTest ? { status: "FAILED", error: "Google accepted a write to the synthetic self-test location" } : { status: "APPLIED" };
  } catch (error) {
    if (transient(error)) throw error;
    return probe(error) || { status: "FAILED", error: String(error.message || error).slice(0, 500) };
  }
}

async function fixRows(env, projectId) {
  return (await env.DB.prepare(`SELECT * FROM visibility_fixes WHERE project_id = ? ORDER BY created_at, kind`).bind(projectId).all()).results || [];
}

async function produceOutput(env, runId) {
  return parseJsonOrNull((await env.DB.prepare(`SELECT output_json FROM workflow_steps WHERE workflow_run_id = ? AND step_key = 'PRODUCE'`).bind(runId).first())?.output_json) || {};
}

async function runGoogleVisibilityDeliverStep(targetStep, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const meta = await projectMeta(env, context.id);
  const produced = await produceOutput(env, targetStep.workflow_run_id);
  if (!produced.audit) throw new Error("DELIVER: the audit from PRODUCE is missing");
  let rows = await fixRows(env, context.id);
  const planned = rows.filter((r) => r.status === "PLANNED");

  let approval = await latestOwnerApproval(context.id, env);
  if (planned.length) {
    if (!(approval && ["PENDING", "APPROVED"].includes(approval.status))) {
      if (!produced.plan_deliverable_id) throw new Error("Changes wait for the owner but the review page is missing");
      approval = await createOwnerApproval(targetStep, context, [{ id: produced.plan_deliverable_id }], { mode: "OWNER", source: "STEP" }, approval, env);
    }
    if (approval.status === "PENDING") return parkForOwnerApproval(targetStep, context, approval, env);
    const auth = await tokenOrPark(env, targetStep, context, meta, fetchImpl);
    if (auth.parked) return auth.parked;
    try {
      for (const fix of planned) {
        const result = await applyFix(env, auth.token, auth.connection, fix, isSelfTest(meta), fetchImpl);
        await env.DB.prepare(`UPDATE visibility_fixes SET status = ?, error = ?, updated_at = ? WHERE id = ?`).bind(result.status, result.error || null, nowIso(), fix.id).run();
        if (result.status === "APPLIED" && fix.asset_id) await markAsset(env, fix.asset_id);
      }
    } catch (error) {
      if (transient(error)) return retryStepLater(targetStep, env, error.message);
      throw error;
    }
    rows = await fixRows(env, context.id);
    const failed = rows.filter((r) => r.status === "FAILED");
    if (failed.length) {
      await tellOwner(env, context, `Google refused ${failed.length} change${failed.length === 1 ? "" : "s"} for ${context.business_name || "a customer"}`,
        failed.map((f) => `${FIX_LABELS[f.kind] || f.kind}: ${f.error}`), `gv-failed/${targetStep.workflow_run_id}`);
    }
  } else if (approval?.status !== "APPROVED") {
    approval = null; // nothing goes on the profile: the report goes straight to the buyer
  }

  const applied = rows.filter((r) => ["APPLIED", "PROBED"].includes(r.status)).map((r) => ({ kind: r.kind, value: r.value }));
  const refused = rows.filter((r) => r.status === "FAILED").map((r) => ({ kind: r.kind }));
  const before = produced.audit;
  const after = auditAfter(before, applied);
  const business = context.business_name || before.title || "Your business";
  let report = await env.DB.prepare(`SELECT id FROM deliverables WHERE project_id = ? AND deliverable_type = 'GOOGLE_VISIBILITY_REPORT' AND status != 'SUPERSEDED' ORDER BY version DESC LIMIT 1`).bind(context.id).first();
  if (!report) {
    const html = new TextEncoder().encode(reportHtml({ business, before, after, applied, refused, date: nowIso().slice(0, 10), editUrl: before.mapsUri }));
    const stored = await storeDeliverable(env, context, {
      type: "GOOGLE_VISIBILITY_REPORT", filename: "google-visibility-report.html", mime: "text/html", bytes: html, folder: "google-visibility",
      metadata: { google_visibility: { before: before.score, after: after.score, changed: applied.length, todo: after.checks.filter((c) => c.applicable && !c.ok).length } }
    });
    report = { id: stored.deliverableId };
  }
  const url = `${publicBaseUrl(env)}/api/delivery/${report.id}?t=${await signLinkToken(env, { kind: "deliver", id: report.id, ttlDays: DELIVERY_LINK_TTL_DAYS })}`;
  const todo = after.checks.filter((c) => c.applicable && !c.ok).length;
  const test = isTestOrder(context) ? "[TEST] " : "";
  const sent = await sendTransactionalEmail(env, {
    to: context.customer_email,
    subject: `${test}${business}'s Google profile: ${before.score} → ${after.score}`,
    html: brandedEmailHtml({
      preheader: applied.length ? `${applied.length} improvements made, your report is ready.` : "Your Google profile report is ready.",
      eyebrow: "GOOGLE VISIBILITY", heading: `${e(business)}'s Google profile`,
      paragraphs: [`Hi ${e(context.first_name || "there")},`,
        applied.length ? `We made ${applied.length} improvement${applied.length === 1 ? "" : "s"} to your Google Business Profile. Google reviews some edits before they show, so give it a few days.` : "We checked every detail Google shows for your business.",
        todo ? `Your report lists ${todo} thing${todo === 1 ? "" : "s"} only you can answer, like your hours or categories. Each takes a minute.` : "Every item on our checklist now passes.",
        "Want it kept fresh? <strong>Google Profile Care</strong> posts a weekly update, adds your photos, replies to your reviews and sends a monthly report. See it at https://menu-made.com/services.html."],
      rows: [["Profile score before", String(before.score)], ["Profile score now", String(after.score)], ["Changes made", String(applied.length)], ["Left for you", String(todo)]],
      buttons: [{ label: "Open your report", url, primary: true }],
      footnote: `This link works for ${DELIVERY_LINK_TTL_DAYS} days. Questions? Reply to this email.`
    }),
    text: [`${business}'s Google profile: ${before.score} → ${after.score}`, "", `Changes made: ${applied.length}`, `Left for you: ${todo}`, "", `Open your report: ${url}`, "",
      "Google Profile Care keeps your profile fresh every week: https://menu-made.com/services.html"].join("\n"),
    idempotencyKey: `gv-delivery/${context.id}/${approval?.id || "auto"}`, purpose: "ORDER_DELIVERY", templateKey: "delivery_google_visibility_v1",
    context: { customerId: context.customer_id, businessId: context.business_id, orderId: context.order_id, projectId: context.id }, bccInternal: true
  });
  if (!sent.ok) return retryStepLater(targetStep, env, `Delivery email failed: ${sent.error}`);
  await env.DB.prepare(`UPDATE deliverables SET status = 'FINAL', customer_visible = 1, delivered_at = COALESCE(delivered_at, ?) WHERE id = ?`).bind(nowIso(), report.id).run();
  return finishDelivery(targetStep, context, {
    delivered_at: nowIso(), recipient: context.customer_email, email_id: sent.id, score_before: before.score, score_after: after.score,
    applied: rows.filter((r) => r.status === "APPLIED").length, probed: rows.filter((r) => r.status === "PROBED").length, refused: refused.length, report_deliverable_id: report.id,
    approval_id: approval?.id || null
  }, approval ? "OWNER" : "AUTO", approval, [{ id: report.id }], env);
}

async function markAsset(env, assetId) {
  const row = await env.DB.prepare(`SELECT metadata_json FROM assets WHERE id = ?`).bind(assetId).first();
  if (!row) return;
  await markPhoto(env, assetId, "google_visibility_uploaded");
}

// Presenter: the owner's approval email and page.
const googleVisibilityOverrides = {
  runDeliver: (targetStep, env) => runGoogleVisibilityDeliverStep(targetStep, env),
  ownerLabel(context) {
    return `${context.business_name || "A customer"} - Google Visibility changes`;
  },
  approvalCopy: {
    intro: "Check the changes. Approving publishes them on the customer's Google profile and emails them the report.",
    button: "Approve and publish on Google",
    done: "Approved. The changes are being published on Google now, and the customer gets their report."
  },
  async ownerEmail({ context, previews, approveUrl, env }) {
    const rows = (await env.DB.prepare(`SELECT * FROM visibility_fixes WHERE project_id = ? AND status = 'PLANNED' ORDER BY created_at`).bind(context.id).all()).results || [];
    const business = context.business_name || "A customer";
    const test = isTestOrder(context) ? "[TEST] " : "";
    const description = rows.find((r) => r.kind === "DESCRIPTION")?.value;
    const list = rows.filter((r) => r.kind !== "DESCRIPTION").map((r) => `${FIX_LABELS[r.kind] || r.kind}${r.kind === "PHOTO" || r.kind === "LOGO" ? "" : `: ${r.value}`}`);
    return {
      subject: `${test}Approve ${rows.length} Google profile change${rows.length === 1 ? "" : "s"} for ${business}`,
      templateKey: "owner_approval_google_visibility_v1",
      html: brandedEmailHtml({
        preheader: `${rows.length} change${rows.length === 1 ? "" : "s"} wait for your OK before going on Google.`,
        eyebrow: test ? "TEST · GOOGLE VISIBILITY" : "GOOGLE VISIBILITY",
        heading: `${e(business)}: ${rows.length} Google profile change${rows.length === 1 ? "" : "s"} to approve`,
        paragraphs: [
          description ? `<strong>New description:</strong> “${e(description)}”` : "",
          list.length ? `<strong>Also:</strong> ${list.map(e).join("; ")}` : "",
          "Nothing changes on their profile until you approve. The review page shows the full audit and what's left as advice."].filter(Boolean),
        buttons: [...previews.map((p) => ({ ...p, label: "See the review page" })), { label: "Approve and publish", url: approveUrl, primary: true }],
        footnote: `Request changes to have the description rewritten once from your note, or write "keep their description" to leave it out. Link expires in ${APPROVAL_TTL_DAYS} days.`
      }),
      text: [`${business}: ${rows.length} Google profile change(s) wait for your approval.`, description ? `New description: "${description}"` : "", ...list, "",
        ...previews.map((p) => `Review page: ${p.url}`), `Approve and publish: ${approveUrl}`].filter((l) => l !== "").join("\n")
    };
  }
};

export { SELFTEST_SOURCE, SELFTEST_LOCATION, KEEP_DESCRIPTION, sendConnectEmail, runGoogleVisibilityProduceStep, runGoogleVisibilityDeliverStep, googleVisibilityOverrides };
