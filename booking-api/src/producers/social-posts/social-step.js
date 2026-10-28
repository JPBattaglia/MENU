// Social Posts PRODUCE step (stage 6, monthly). Reads the buyer's live menu, has the shared AI step plan 12 posts,
// renders each as a 1080x1080 and a 1080x1920 graphic, and stores a posting calendar (web page, for review) and a ZIP
// (PNGs + captions) as draft deliverables. The shared DELIVER step then asks the owner to approve before the buyer is emailed.
// A plan that fails its quality checks twice, or an AI cap, is never delivered: the owner is told and nothing reaches the buyer.
import { ownerEmailAddress } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { AiCapError } from "../../ai/generate.js";
import { loadRegenerationNote } from "../../approvals/actions.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { loadLiveMenu, finishRun } from "../menu-care/care-step.js";
import { parseMenuHtml } from "../menu-care/menu-edit.js";
import { getSettings } from "../../subscriptions/settings.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { POSTS_PER_MONTH, planPosts } from "./plan.js";
import { queueSocialRender } from "./render-jobs.js";
import { SIZES, brandOf, esc, renderPostSvg } from "./render.js";
import { createZip } from "./zip.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");

function monthOf(metadata) {
  const d = new Date(metadata.period_start || Date.now());
  return { label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

function captionsText(business, month, posts) {
  const lines = [`${business} - social posts for ${month.label}`, ""];
  posts.forEach((post, i) => {
    lines.push(`Post ${pad(i + 1)} - suggested date: ${MONTHS[month.month - 1]} ${post.day}`, `Graphics: post-${pad(i + 1)}-square.png (feed), post-${pad(i + 1)}-story.png (story)`, post.caption, post.hashtags.join(" "), "");
  });
  return lines.join("\n");
}

function calendarHtml(business, month, posts, svgs) {
  const cards = posts.map((post, i) => `
    <article>
      <div class="art">${svgs[i].replace(/<\?xml[^>]*>/, "").replace(/ width="\d+" height="\d+"/, ' width="100%" height="auto"')}</div>
      <h2>${esc(MONTHS[month.month - 1])} ${post.day} <small>${esc(post.kind)}</small></h2>
      <p>${esc(post.caption)}</p>
      <p class="tags">${esc(post.hashtags.join(" "))}</p>
    </article>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(business)} - ${esc(month.label)} posts</title>
<style>body{margin:0;background:#f4f1ec;font:16px/1.5 system-ui,sans-serif;color:#1d1d1b}header{padding:28px 20px;text-align:center}h1{margin:0;font-size:28px}main{max-width:1000px;margin:0 auto;padding:0 16px 48px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}article{background:#fff;border:1px solid #e3ddd2;border-radius:10px;padding:14px}.art svg{display:block;width:100%;height:auto;border-radius:6px}h2{font-size:17px;margin:12px 0 4px}h2 small{color:#6b675f;font-weight:400;margin-left:6px}.tags{color:#4a6a7a;font-size:14px}</style></head>
<body><header><h1>${esc(business)}</h1><p>Social posts for ${esc(month.label)}: ${posts.length} posts, each with a feed and a story graphic in the ZIP.</p></header><main>${cards}</main></body></html>`;
}

async function tellOwner(env, context, subject, reasons) {
  const business = context.business_name || "A customer";
  const list = reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("");
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[Social Posts] ${subject} for ${business}`,
    html: brandedEmailHtml({ eyebrow: "SOCIAL POSTS", heading: `${escapeHtml(business)}: ${escapeHtml(subject)}`, paragraphs: [`<ul>${list}</ul>`, "Nothing was sent to the customer."] }),
    text: `${business}: ${subject}\n- ${reasons.join("\n- ")}\nNothing was sent to the customer.`,
    idempotencyKey: `social-blocked/${context.id}/${reasons.join("|").length}`,
    purpose: "AUTOMATION_ALERT",
    templateKey: "social_posts_blocked_v1"
  }).catch(() => null);
}

async function runSocialPostsProduceStep(targetStep, env, deps = {}) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const project = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ?`).bind(context.id).first();
  const metadata = parseJsonOrNull(project?.metadata_json) || {};
  const month = monthOf(metadata);
  const business = context.business_name || "Your business";

  const blocked = async (subject, reasons) => {
    await tellOwner(env, context, subject, reasons);
    await finishRun(targetStep, context, { outcome: "NOT_PRODUCED", reasons }, env);
    return { outcome: "NOT_PRODUCED", reasons };
  };

  let live = null;
  const liveHtml = await loadLiveMenu(env, context.business_id);
  if (liveHtml) { try { live = parseMenuHtml(liveHtml); } catch { live = null; } }
  const note = await loadRegenerationNote(env, context.id);
  const settings = metadata.subscription_id ? await getSettings(env, metadata.subscription_id).catch(() => ({})) : {}; // optional extras: never block the posts
  const plan = await planPosts(env, {
    businessName: business,
    menu: live?.menu || null,
    extra: [settings.voice && `Voice: ${settings.voice}`, settings.specials && `Specials and events to feature: ${settings.specials}`].filter(Boolean).join("\n"),
    monthLabel: note ? `${month.label}. Reviewer correction from a previous attempt: ${note.note}` : month.label,
    scope: { entityType: "SUBSCRIPTION", entityId: metadata.subscription_id || context.id, correlationId: targetStep.workflow_run_id }
  }, deps.generate).catch((error) => (error instanceof AiCapError ? { capped: error.message } : Promise.reject(error)));
  if (plan.capped) return blocked("monthly AI limit reached", [plan.capped]);
  if (plan.problems.length) return blocked("posts failed the quality checks", plan.problems);

  const brand = brandOf({ primary: live?.primary, accent: live?.accent });
  const svgs = { square: [], story: [] };
  const graphics = [];
  for (const [i, post] of plan.posts.entries()) {
    for (const size of ["square", "story"]) {
      const result = renderPostSvg(post, { businessName: business, brand, logoDataUri: live?.logoDataUri }, size);
      if (result.error) return blocked("a graphic could not be built", [`Post ${i + 1}: ${result.error}`]);
      svgs[size].push(result.svg);
      graphics.push({ name: `post-${pad(i + 1)}-${size}.png`, svg: result.svg, width: SIZES[size].width, height: SIZES[size].height });
    }
  }
  const captions = captionsText(business, month, plan.posts);
  const html = new TextEncoder().encode(calendarHtml(business, month, plan.posts, svgs.square));
  const care = { month: month.label, posts: plan.posts.length, attempts: plan.attempts };
  const calendar = await storeDeliverable(env, context, { type: "SOCIAL_CALENDAR", filename: `${business}-posting-calendar-${month.year}-${pad(month.month)}.html`.replace(/\s+/g, "-"), mime: "text/html", bytes: html, folder: "social-calendar", metadata: { social: care } });
  const packFilename = `${business}-social-posts-${month.year}-${pad(month.month)}.zip`.replace(/\s+/g, "-");
  const base = { outcome: "PRODUCED", month: month.label, posts: plan.posts.length, calendar_deliverable: calendar.deliverableId };

  // Tests inject a rasterizer and draw inline. Live, the PNGs are drawn by GitHub Actions (render-jobs.js): the free
  // plan's 10 ms CPU per run is far too little for 24 PNGs, and Cloudflare ended the run mid-step on Oct 27, 2026.
  const rasterize = deps.rasterize || env.SOCIAL_RASTERIZER;
  if (!rasterize) {
    return queueSocialRender(env, targetStep, {
      files: graphics,
      extra: [{ name: "captions-and-calendar.txt", text: captions }],
      finish: { pack_filename: packFilename, care, output: base }
    });
  }
  const files = [];
  for (const g of graphics) files.push({ name: g.name, data: await rasterize(g.svg, g.width) });
  files.push({ name: "captions-and-calendar.txt", data: new TextEncoder().encode(captions) });
  const pack = await storeDeliverable(env, context, { type: "SOCIAL_PACK", filename: packFilename, mime: "application/zip", bytes: createZip(files), folder: "social-pack", metadata: { social: care } });
  const output = { ...base, png_files: graphics.length, pack_deliverable: pack.deliverableId, version: pack.version };
  await completeStep(targetStep, output, env);
  return output;
}

export { POSTS_PER_MONTH, calendarHtml, captionsText, runSocialPostsProduceStep };
