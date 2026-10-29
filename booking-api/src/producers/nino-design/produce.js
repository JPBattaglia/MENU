// Nino design services PRODUCE step (stage 10). One step for the four products: it reads the buyer's brief, builds
// the designs as SVG (design-svg.js), and parks a render job; the GitHub renderer draws the PNGs, zips them with a
// small preview page, and posts them back (render-jobs.js -> finishNinoDesignRender). The shared DELIVER step then
// asks the owner to approve (creative work) before the buyer is emailed.
// Anything that cannot be produced well (text that doesn't fit, an unreadable menu, an AI answer that fails its
// checks twice, the monthly AI cap) is never delivered: the owner is told and nothing reaches the buyer.
import { ownerEmailAddress } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";
import { AiCapError, generate } from "../../ai/generate.js";
import { findUnsupportedFacts } from "../../ai/quality.js";
import { loadRegenerationNote } from "../../approvals/actions.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { finishRun, loadLiveMenu } from "../menu-care/care-step.js";
import { parseMenuHtml } from "../menu-care/menu-edit.js";
import { extractMenuFromFile } from "../menu-qr/claude-reader.js";
import { menuToText } from "../social-posts/plan.js";
import { queueRender } from "../social-posts/render-jobs.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { bytesToBase64 } from "../../lib/util.js";
import { createZip } from "../social-posts/zip.js";
import { FONT_FAMILIES, flyerSvg, logoOptions, menuPageSvgs, socialSvg } from "./design-svg.js";
import { productForWorkflow, quoteMenuDesign } from "./products.js";

const SOCIAL_POSTS = 9;
const slugOf = (name) => String(name || "design").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "design";

async function tellOwner(env, context, product, subject, reasons) {
  const business = context.business_name || "A customer";
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[${product.name}] ${subject} for ${business}`,
    html: brandedEmailHtml({ eyebrow: "NINO DESIGN", heading: `${escapeHtml(business)}: ${escapeHtml(subject)}`, paragraphs: [`<ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`, "Nothing was sent to the customer."] }),
    text: `${business}: ${subject}\n- ${reasons.join("\n- ")}\nNothing was sent to the customer.`,
    idempotencyKey: `nino-design-blocked/${context.id}/${reasons.join("|").length}`,
    purpose: "AUTOMATION_ALERT", templateKey: "nino_design_blocked_v1"
  }).catch(() => null);
}

async function briefOf(env, projectId) {
  const rows = (await env.DB.prepare(`SELECT input_key, value_text FROM project_inputs WHERE project_id = ? AND value_text IS NOT NULL`).bind(projectId).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.input_key, r.value_text]));
}

async function logoDataUri(env, projectId) {
  const asset = await env.DB.prepare(`SELECT storage_key, mime_type FROM assets WHERE project_id = ? AND status = 'VALID' AND json_extract(metadata_json, '$.design_brief') = 'logo' ORDER BY uploaded_at DESC LIMIT 1`).bind(projectId).first();
  const object = asset ? await env.ASSETS.get(asset.storage_key) : null;
  return object ? `data:${asset.mime_type};base64,${bytesToBase64(new Uint8Array(await object.arrayBuffer()))}` : "";
}

// How many times this project has been produced (request changes -> a fresh variant of the layout).
async function variantOf(env, projectId) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM deliverables WHERE project_id = ? AND deliverable_type = 'NINO_DESIGN_PACK'`).bind(projectId).first();
  return Number(row?.n || 0);
}

// ---------- Social Graphics Pack: AI writes 9 posts from the brief only ----------
const SOCIAL_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: { type: "string", description: "Words printed on the graphic, 2-7 words" },
          subline: { type: "string", description: "Optional second line on the graphic, up to 10 words, or empty" },
          caption: { type: "string", description: "Caption in the business's voice, 1-3 sentences" },
          hashtags: { type: "array", items: { type: "string" } }
        },
        required: ["headline", "subline", "caption", "hashtags"]
      }
    }
  },
  required: ["posts"]
};

function checkSocialPosts(posts, sourceText) {
  const problems = [];
  if (!Array.isArray(posts) || posts.length !== SOCIAL_POSTS) problems.push(`Expected ${SOCIAL_POSTS} posts, got ${Array.isArray(posts) ? posts.length : 0}`);
  const seen = new Set();
  const clean = (posts || []).map((post, i) => {
    const label = `Post ${i + 1}`;
    const headline = String(post.headline ?? "").replace(/\s+/g, " ").trim();
    const subline = String(post.subline ?? "").replace(/\s+/g, " ").trim();
    const caption = String(post.caption ?? "").replace(/\s+/g, " ").trim();
    const hashtags = (Array.isArray(post.hashtags) ? post.hashtags : []).map((h) => String(h).trim().replace(/^(?!#)/, "#"));
    if (headline.length < 4 || headline.length > 50) problems.push(`${label}: headline must be 4-50 characters`);
    if (subline.length > 70) problems.push(`${label}: subline must be at most 70 characters`);
    if (caption.length < 30 || caption.length > 600) problems.push(`${label}: caption must be 30-600 characters`);
    if (hashtags.length < 3 || hashtags.length > 10 || hashtags.some((h) => !/^#[A-Za-z0-9_]{2,40}$/.test(h))) problems.push(`${label}: use 3-10 simple hashtags`);
    if (seen.has(headline.toLowerCase())) problems.push(`${label}: duplicate headline`);
    seen.add(headline.toLowerCase());
    for (const fact of findUnsupportedFacts(`${headline} ${subline} ${caption}`, sourceText)) problems.push(`${label}: ${fact.kind} "${fact.value}" is not in the brief`);
    return { headline, subline, caption, hashtags };
  });
  return { posts: clean, problems };
}

async function writeSocialPosts(env, { brief, menuText, note, scope }, deps) {
  const source = [`Name: ${brief.business_name}`, `About: ${brief.about || ""}`, `Promote: ${brief.promote || ""}`, brief.voice ? `Voice: ${brief.voice}` : "", menuText ? `MENU:\n${menuText}` : ""].filter(Boolean).join("\n");
  let feedback = note ? `\n\nThe reviewer asked for these changes to the previous version: ${note}` : "";
  let last = { posts: [], problems: ["No attempt was made"] };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generate(env, {
      purpose: "nino_social_pack",
      system: `You are a graphic designer's copywriter. Write exactly ${SOCIAL_POSTS} social media posts for one small business, to be printed on branded graphics. Use ONLY facts from the BRIEF. Never invent prices, dates, opening hours, phone numbers, addresses, links, awards, discounts or events. Each headline different, punchy, no emojis on the graphic.`,
      prompt: `BRIEF:\n${source}${feedback}`,
      schema: SOCIAL_SCHEMA, scope, maxTokens: 5000
    }, deps);
    last = checkSocialPosts(result.output.posts, source);
    if (!last.problems.length) return { ...last, attempts: attempt };
    feedback = `\n\nYour previous answer had these problems; fix them all:\n- ${last.problems.slice(0, 12).join("\n- ")}`;
  }
  return { ...last, attempts: 2 };
}

// ---------- The step ----------

async function runNinoDesignProduceStep(targetStep, env, deps = {}) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const product = productForWorkflow(targetStep.workflow_key);
  if (!product) throw new Error(`No Nino design product for ${targetStep.workflow_key}`);
  const blocked = async (subject, reasons) => {
    await tellOwner(env, context, product, subject, reasons);
    await finishRun(targetStep, context, { outcome: "NOT_PRODUCED", reasons }, env);
    return { outcome: "NOT_PRODUCED", reasons };
  };
  const brief = await briefOf(env, context.id);
  const logo = product.logo ? await logoDataUri(env, context.id) : "";
  const hasLogo = Boolean(logo);
  const variant = await variantOf(env, context.id);
  const note = await loadRegenerationNote(env, context.id);
  const business = brief.business_name || context.business_name || "Your business";
  const slug = slugOf(business);
  const files = [];
  const sections = [];
  const extra = [];
  const info = { product: product.code, variant };

  if (product.code === "NINO_FLYER") {
    for (const size of ["print", "square"]) {
      const r = flyerSvg(brief, { size, hasLogo, variant });
      if (r.error) return blocked("the flyer could not be laid out", [r.error]);
      files.push({ name: `${slug}-flyer-${size === "print" ? "letter-300dpi" : "square"}.png`, svg: r.svg, width: r.width, height: r.height, preview_width: size === "print" ? 700 : 600 });
    }
    sections.push({ heading: "Your flyer", files: files.map((f) => f.name) });
  } else if (product.code === "NINO_LOGO") {
    const r = logoOptions(brief, { variant });
    if (r.error) return blocked("the logo could not be laid out", [r.error]);
    for (const option of r.options) {
      for (const file of option.files) files.push({ ...file, name: file.name.replace(/^option-(\d+)\//, "option-$1-"), preview_width: 600 });
      sections.push({ heading: `Option ${option.id}: ${option.face}, ${option.layout.toLowerCase()}`, files: option.files.map((f) => f.name.replace(/^option-(\d+)\//, "option-$1-")) });
    }
    info.options = r.options.length;
    extra.push({ name: "README.txt", text: `${business} - logo options\n\nEach option comes as a transparent PNG (for anything printed or placed on a photo), on white, and on dark. All are 2000 x 1000 pixels.\nReply to the delivery email with the option you like best if you'd like it as your Menu-Made brand.\n` });
  } else if (product.code === "NINO_SOCIAL_PACK") {
    let menuText = "";
    const liveHtml = context.business_id ? await loadLiveMenu(env, context.business_id).catch(() => null) : null;
    if (liveHtml) { try { menuText = menuToText(parseMenuHtml(liveHtml).menu); } catch { menuText = ""; } }
    const plan = await writeSocialPosts(env, { brief, menuText, note: note?.note || "", scope: { entityType: "PROJECT", entityId: context.id, correlationId: targetStep.workflow_run_id } }, deps.generate)
      .catch((error) => (error instanceof AiCapError ? { capped: error.message } : Promise.reject(error)));
    if (plan.capped) return blocked("monthly AI limit reached", [plan.capped]);
    if (plan.problems.length) return blocked("the posts failed the quality checks", plan.problems);
    const pad = (n) => String(n).padStart(2, "0");
    for (const [i, post] of plan.posts.entries()) {
      for (const size of ["square", "story"]) {
        const r = socialSvg(post, { businessName: business, style: brief.style || ["classic", "modern", "bold"][variant % 3], brandColors: brief.brand_colors, hasLogo }, size);
        if (r.error) return blocked("a graphic could not be laid out", [`Post ${i + 1}: ${r.error}`]);
        files.push({ name: `post-${pad(i + 1)}-${size}.png`, svg: r.svg, width: r.width, height: r.height, preview_width: size === "square" ? 360 : 0 });
      }
    }
    sections.push({ heading: "Feed graphics (stories are in the ZIP too)", files: files.filter((f) => f.name.endsWith("square.png")).map((f) => f.name) });
    extra.push({ name: "captions.txt", text: [`${business} - social graphics pack`, "", ...plan.posts.map((p, i) => `Post ${pad(i + 1)}: post-${pad(i + 1)}-square.png (feed), post-${pad(i + 1)}-story.png (story)\n${p.caption}\n${p.hashtags.join(" ")}\n`)].join("\n") });
    info.posts = plan.posts.length; info.attempts = plan.attempts;
    info.captions = plan.posts.map((p) => p.caption);
  } else if (product.code === "NINO_MENU_DESIGN") {
    const menuAsset = brief.menu_upload ? await env.DB.prepare(`SELECT storage_key, mime_type FROM assets WHERE id = ?`).bind(brief.menu_upload).first() : null;
    if (!menuAsset) return blocked("no menu file on the order", ["The brief has no menu file, so nothing could be redesigned."]);
    let read;
    try { read = deps.readMenu ? await deps.readMenu(menuAsset) : await extractMenuFromFile(menuAsset, env); }
    catch (error) { return blocked("the menu could not be read", [error instanceof Error ? error.message : String(error)]); }
    const item = await env.DB.prepare(`SELECT metadata_json FROM order_items WHERE id = ?`).bind(context.order_item_id).first();
    const pages = Number(parseJsonOrNull(item?.metadata_json)?.design_pages || product.includedPages);
    if (!quoteMenuDesign(pages)) return blocked("the order has no valid page count", [`Page count ${pages} is not between 1 and ${product.maxPages}.`]);
    const r = menuPageSvgs(read.menu, brief, { pages, hasLogo });
    if (r.error) return blocked("the menu could not be laid out", [r.error, "The buyer may need more pages: ask them to reply, or refund the difference."]);
    for (const page of r.pages) files.push({ ...page, name: `${slug}-${page.name}`, preview_width: 700 });
    sections.push({ heading: "Your menu", files: files.map((f) => f.name) });
    info.pages = r.pages.length; info.paid_pages = pages; info.scale = r.scale;
    info.items = (read.menu.sections || []).reduce((n, s) => n + (s.items || []).length, 0);
    info.unreadable = read.extraction?.unreadable || "";
  }

  const packFilename = `${slug}-${product.code.toLowerCase().replace(/^nino_/, "").replace(/_/g, "-")}.zip`;
  const finish = { kind: "NINO_DESIGN", pack_filename: packFilename, info, output: { outcome: "PRODUCED", product: product.code, files: files.length } };
  const rasterize = deps.rasterize || env.SOCIAL_RASTERIZER;
  if (!rasterize) {
    return queueRender(env, targetStep, {
      kind: "NINO_DESIGN",
      files: files.map(({ preview_width, ...f }) => f),
      extra,
      assets: logo ? { logo } : {},
      fonts: FONT_FAMILIES,
      preview: { title: `${business} - ${product.name}`, sections, widths: Object.fromEntries(files.filter((f) => f.preview_width).map((f) => [f.name, f.preview_width])) },
      finish
    });
  }
  // Tests draw inline with an injected rasterizer (no preview page is drawn here).
  const drawn = [];
  for (const f of files) drawn.push({ name: f.name, data: await rasterize(logo ? f.svg.replaceAll("__LOGO_DATA_URI__", logo) : f.svg, f.width) });
  for (const e of extra) drawn.push({ name: e.name, data: new TextEncoder().encode(e.text) });
  drawn.push({ name: "preview.html", data: new TextEncoder().encode(`<!doctype html><title>${escapeHtml(business)}</title><p>${files.length} images</p>`) });
  return finishNinoDesignRender(env, context, drawn, finish, { targetStep, zipBytes: createZip(drawn) });
}

// Stores the drawn pack and its preview page as draft deliverables. Called by the render-job route (live) or inline.
// The ZIP is stored exactly as the renderer sent it (re-zipping would cost more CPU than the free plan allows), so it
// also holds preview.html: a one-page overview the buyer can open.
async function finishNinoDesignRender(env, context, entries, finish, { targetStep = null, zipBytes } = {}) {
  const previewEntry = entries.find((e) => e.name === "preview.html");
  if (!previewEntry) throw new Error("The render came back without its preview page");
  const preview = await storeDeliverable(env, context, { type: "NINO_DESIGN_PREVIEW", filename: finish.pack_filename.replace(/\.zip$/, "-preview.html"), mime: "text/html", bytes: previewEntry.data, folder: "nino-design-preview", metadata: { nino_design: finish.info } });
  const pack = await storeDeliverable(env, context, { type: "NINO_DESIGN_PACK", filename: finish.pack_filename, mime: "application/zip", bytes: zipBytes, folder: "nino-design-pack", metadata: { nino_design: finish.info } });
  const output = { ...finish.output, preview_deliverable: preview.deliverableId, pack_deliverable: pack.deliverableId, version: pack.version };
  if (targetStep) await completeStep(targetStep, output, env);
  return output;
}

export { SOCIAL_POSTS, checkSocialPosts, finishNinoDesignRender, runNinoDesignProduceStep, writeSocialPosts };
