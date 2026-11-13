// Your Website (site files), $299 (owner, Nov 6, 2026). The buyer picked one of the nine designs in the site generator
// (marketing/website-preview.js) and paid. PRODUCE rebuilds that design from what the preview was built from and
// zips the complete site. When the same order has Website Care ($49/mo, "we host and maintain it"), the site also
// goes live at <slug>.menu-made.com right away (a SITE_BUILD the live server reads) and Website Care takes over:
// monthly report, changes on request, their own domain when it is pointed.
// DELIVER is automatic: one email with the zip (and the live address when hosted).
import { publicBaseUrl } from "../../lib/config.js";
import { brandedEmailHtml, escapeHtml, sendTransactionalEmail } from "../../lib/email.js";
import { nowIso, parseJsonOrNull } from "../../lib/http.js";
import { ownerEmailAddress } from "../../lib/config.js";
import { isTestOrder, loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { createZip } from "../social-posts/zip.js";
import { buildDesignSite, designFor } from "../website/templates/index.js";
import { formAction } from "./site-form.js";
import { slugify, validSlug } from "../website/intake.js";
import { OWN_DAYS, ownLink } from "./own.js";
import { domainForOrder, queueDomain } from "../website/domain-purchase.js";

const enc = new TextEncoder();

function readme(name, design, hosted, samples = false) {
  return [
    `${name}: your website`,
    "",
    `Design: ${design.label}. Made by MENU-MADE (menu-made.com).`,
    "",
    "What's inside",
    "  index.html     the home page",
    "  menu.html      the menu (when there is one)",
    "  about.html     your story",
    "  contact.html   hours, address, phone and a contact form",
    "  styles.css     the design",
    "  img/           your logo and photos (when you added them)",
    ...(samples ? ["  img/mood-*.jpg sample photos we added so the site isn't bare. They're free-licence (CC0, public domain),", "                 so you may keep them, but your own photos look better: add them with the link in our email."] : []),
    "",
    "The contact form",
    "  Messages from the form on contact.html come to the email you used at checkout, through Menu-Made, wherever",
    "  the site is hosted. Reply to the email to answer the person who wrote.",
    "",
    "Putting it online yourself",
    "  Any web host works. Upload all the files to the top folder of your site (often called public_html or www).",
    "  Free and simple: drag this folder onto https://app.netlify.com/drop, or use Cloudflare Pages.",
    "  The fonts load from Google Fonts; with no internet they fall back to standard fonts.",
    "",
    "Changing it",
    "  Open index.html in any text editor. Your menu items, hours and contact details are plain text in it.",
    "",
    hosted ? "We host it for you on your Website Care plan. Ask for changes any time by replying to our emails." : "Want us to host it and keep it up to date? Website Care is $49/mo: menu-made.com/plans.html",
    ""
  ].join("\n");
}

// The page as the live server serves it: one HTML page with its styles inside (the live CSP allows inline styles).
const inlined = (files, file = "index.html") => files[file].replace('<link rel="stylesheet" href="styles.css">', () => `<style>${files["styles.css"]}</style>`);

async function reserveSlug(env, context, name) {
  const existing = await env.DB.prepare(`SELECT slug FROM website_sites WHERE business_id = ? ORDER BY created_at ASC LIMIT 1`).bind(context.business_id).first();
  if (existing?.slug) return existing.slug;
  const base = (slugify(name) || "site").slice(0, 24).replace(/-+$/, "") || "site";
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!validSlug(slug)) continue;
    if (await env.DB.prepare(`SELECT 1 AS t FROM website_sites WHERE slug = ?`).bind(slug).first()) continue;
    if (await env.DB.prepare(`SELECT 1 AS t FROM guest_apps WHERE slug = ?`).bind(slug).first().catch(() => null)) continue;
    const t = nowIso();
    await env.DB.prepare(`INSERT INTO website_sites (id, slug, project_id, business_id, customer_id, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), slug, context.id, context.business_id, context.customer_id, "generator", t, t).run();
    return slug;
  }
  throw new Error("No free web address for this business");
}

async function tellOwner(env, context, problem) {
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env),
    subject: `[Website] ${problem} for ${context.business_name || "a customer"}`,
    html: brandedEmailHtml({ eyebrow: "WEBSITE", heading: `${escapeHtml(context.business_name || "A customer")}: ${escapeHtml(problem)}`, paragraphs: [`Order ${escapeHtml(context.order_id)}. Nothing was sent to the buyer. Reply to the buyer, or ask Claude to look at it.`] }),
    text: `${context.business_name}: ${problem}. Order ${context.order_id}. Nothing was sent to the buyer.`,
    idempotencyKey: `site-files-blocked/${context.id}`, purpose: "AUTOMATION_ALERT", templateKey: "site_files_blocked_v1"
  }).catch(() => null);
}

// Builds the chosen design from the preview's data.json: the zip (SITE_ZIP) and, with Website Care, the live site
// (SITE_BUILD, FINAL at once). Used by PRODUCE and again when the buyer adds a logo or photos after paying (own.js).
// Hosted when the order's plan includes Website Care: Website Care itself, the Pro plan, or your own plan with it
// (Nov 6, 2026: plans are offered beside the site at checkout).
const HOSTED_SQL = `SELECT 1 AS ok FROM order_items WHERE order_id = ? AND (json_extract(metadata_json, '$.plan_code') = 'WEBSITE_CARE'
  OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(metadata_json, '$.includes'), '[]')) WHERE value = 'WEBSITE_CARE')) LIMIT 1`;

async function makeSiteFiles(env, context, meta, { replace = false } = {}) {
  const design = designFor(meta.site_design);
  const data = /^[a-f0-9]{36}$/.test(String(meta.site_preview || "")) ? parseJsonOrNull(await (await env.ASSETS.get(`website-previews/${meta.site_preview}/data.json`))?.text()) : null;
  if (!design || !data?.site || !data?.copy) return { missing: true };
  const site = { ...data.site, name: data.site.name || context.business_name };
  // The logo and photos added with "Make it yours" sit beside the preview; one that can't be read is left out.
  const images = [];
  const fetchImage = async (ref) => {
    if (!ref?.path || !/^img\/[a-z0-9-]+\.(png|jpg|webp)$/.test(ref.path)) return false;
    const object = await env.ASSETS.get(`website-previews/${meta.site_preview}/${ref.path}`);
    if (!object) return false;
    const bytes = new Uint8Array(await object.arrayBuffer());
    images.push({ path: ref.path, bytes, mime: { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[ref.path.split(".").pop()] });
    return true;
  };
  if (site.logo && !(await fetchImage(site.logo))) site.logo = null;
  const photos = [];
  for (const p of site.photos || []) if (await fetchImage(p)) photos.push(p);
  site.photos = photos;
  // The Contact page form sends to the buyer's inbox through Menu-made (site-form.js), wherever the site is hosted.
  const files = buildDesignSite(site, data.copy, design.key, { formAction: await formAction(env, context.id) });
  const hosted = Boolean(await env.DB.prepare(`
      ${HOSTED_SQL}
    `).bind(context.order_id).first());
  const folder = (slugify(site.name) || "website").slice(0, 40);
  const zip = createZip([
    ...Object.entries(files).map(([name, text]) => ({ name: `${folder}/${name}`, data: enc.encode(text) })),
    ...images.map((i) => ({ name: `${folder}/${i.path}`, data: i.bytes })),
    { name: `${folder}/README.txt`, data: enc.encode(readme(site.name, design, hosted, site.photos.some((p) => p.sample))) }
  ]);
  const supersede = (type) => env.DB.prepare(`UPDATE deliverables SET status = 'SUPERSEDED' WHERE project_id = ? AND deliverable_type = ? AND status != 'SUPERSEDED'`).bind(context.id, type).run();
  if (replace) await supersede("SITE_ZIP");
  const stored = await storeDeliverable(env, context, { type: "SITE_ZIP", filename: `${folder}-website.zip`, mime: "application/zip", bytes: zip, folder: "site-zip", metadata: { site_files: { design: design.key, preview: meta.site_preview } } });
  if (replace) await env.DB.prepare(`UPDATE deliverables SET status = 'FINAL', customer_visible = 1, delivered_at = ? WHERE id = ?`).bind(nowIso(), stored.deliverableId).run();
  let live = null, slug = null;
  if (hosted) {
    slug = await reserveSlug(env, context, site.name);
    const pages = Object.fromEntries(Object.keys(files).filter((f) => f.endsWith(".html")).map((f) => [f, inlined(files, f)]));
    // The live server reads images from R2 by key, so they're copied out of the preview into the project's own storage.
    const liveImages = [];
    for (const i of images) {
      const key = ["customers", context.customer_id, "projects", context.id, "site-images", i.path.slice(4)].join("/");
      await env.ASSETS.put(key, i.bytes, { httpMetadata: { contentType: i.mime } });
      liveImages.push({ path: i.path, storage_key: key, mime: i.mime, size: i.bytes.length });
    }
    const build = { version: 1, slug, style: `generator:${design.key}`, built_at: nowIso(), pages, images: liveImages, site, copy: data.copy };
    if (replace) await supersede("SITE_BUILD");
    const b = await storeDeliverable(env, context, { type: "SITE_BUILD", filename: `${slug}-site.json`, mime: "application/json", bytes: enc.encode(JSON.stringify(build)), folder: "site-build", metadata: { website: { slug, style: `generator:${design.key}`, pages: Object.keys(pages).length, images: liveImages.length } } });
    // Live at once: the buyer chose this exact design, so there is nothing more to approve.
    await env.DB.prepare(`UPDATE deliverables SET status = 'FINAL', customer_visible = 1, delivered_at = ? WHERE id = ?`).bind(nowIso(), b.deliverableId).run();
    live = `https://${slug}.menu-made.com/`;
  }
  return { design, zipId: stored.deliverableId, hosted, live, slug, images: images.length, site };
}

async function runSiteFilesProduceStep(targetStep, env) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const item = await env.DB.prepare(`SELECT oi.metadata_json FROM projects p JOIN order_items oi ON oi.id = p.order_item_id WHERE p.id = ?`).bind(context.id).first();
  const meta = parseJsonOrNull(item?.metadata_json) || {};
  const made = await makeSiteFiles(env, context, meta);
  if (made.missing) {
    await tellOwner(env, context, "the chosen site couldn't be found");
    const output = { outcome: "NOT_PRODUCED", reasons: ["The chosen design or its preview data is missing"] };
    await completeStep(targetStep, output, env);
    return output;
  }
  // A domain bought at checkout: registered and pointed by the cron (domain-purchase.js). Test orders buy nothing.
  const domain = made.hosted && made.slug && meta.domain ? await queueDomain(env, context, meta.domain, made.slug, { test: isTestOrder(context) }) : null;
  const output = { outcome: "PRODUCED", design: made.design.key, zip_deliverable: made.zipId, hosted: made.hosted, images: made.images, ...(made.live ? { live_url: made.live } : {}), ...(domain ? { domain } : {}) };
  await completeStep(targetStep, output, env);
  return output;
}

// The DELIVER email: the zip, and the live address when Menu-made hosts it. Only the zip is sent as a file.
const siteFilesOverrides = {
  name: "SITE_FILES",
  async loadFiles(context, targetStep, env) {
    const row = await env.DB.prepare(`
        SELECT d.id, d.deliverable_type, d.version, d.status, d.customer_visible, a.original_filename, a.mime_type, a.size_bytes, a.storage_key, a.metadata_json
        FROM deliverables d JOIN assets a ON a.id = d.asset_id
        WHERE d.project_id = ? AND d.deliverable_type = 'SITE_ZIP' AND d.status != 'SUPERSEDED' ORDER BY d.version DESC LIMIT 1
      `).bind(context.id).first();
    if (!row) throw new Error(`${targetStep.step_key}: this project has nothing to deliver`);
    return [{ ...row, approval: null }];
  },
  ownerLabel(context) { return `${context.business_name || "A customer"} - website files`; },
  async buyerEmail({ context, files, linkFor, env }) {
    const business = context.business_name || "your business";
    const zip = await linkFor(files[0], { download: true });
    const site = await env.DB.prepare(`SELECT slug FROM website_sites WHERE business_id = ? ORDER BY created_at ASC LIMIT 1`).bind(context.business_id).first();
    const hosted = Boolean(await env.DB.prepare(HOSTED_SQL).bind(context.order_id).first());
    const live = hosted && site?.slug ? `https://${site.slug}.menu-made.com/` : null;
    const own = await ownLink(env, context.id);
    const domain = live ? await domainForOrder(env, context.order_id) : null;
    // Owner, Nov 12, 2026: a buyer who bought a domain gets "Open your live site" on that domain, with the
    // menu-made.com address only as the backup while the domain is being registered.
    const ownUrl = domain && !["FAILED", "HELD"].includes(domain.status) ? `https://${domain.domain}/` : null;
    const paragraphs = [
      `Hi ${escapeHtml(context.first_name || "there")}, your website for ${escapeHtml(business)} is ready.`,
      "The download is a zip with the whole site. The README inside says how to put it online with any web host.",
      `Want your own logo and photos on it? <a href="${escapeHtml(own)}">Add them here</a> and we rebuild it for you, free, for the next ${OWN_DAYS} days.`,
      ownUrl ? `Your website's address is <a href="${escapeHtml(ownUrl)}"><strong>${escapeHtml(domain.domain)}</strong></a>. We're registering it in your name now; it usually answers within 30 minutes, and we'll email you the moment it does. Until then your site is already live at <a href="${escapeHtml(live)}">${escapeHtml(live)}</a>, which keeps working too.`
        : live && domain ? `We're hosting it for you on Website Care. It's live now at <a href="${escapeHtml(live)}">${escapeHtml(live)}</a>, and we're registering <strong>${escapeHtml(domain.domain)}</strong> for you. We'll email you the moment it's live there too (usually within the hour).`
        : live ? `We're hosting it for you on Website Care. It's live now at <a href="${escapeHtml(live)}">${escapeHtml(live)}</a>. To use your own web address, reply to this email with it and we'll send the two settings to change.` : `Want us to host it and keep it current? Add <a href="${escapeHtml(publicBaseUrl(env))}/plans.html">Website Care</a> for $49/mo.`
    ];
    return {
      recipient: context.customer_email,
      subject: `${isTestOrder(context) ? "[TEST] " : ""}Your website is ready`,
      templateKey: "delivery_site_files_v1",
      html: brandedEmailHtml({ preheader: `${business}'s website, ready to download${live ? " and live" : ""}.`, eyebrow: "YOUR WEBSITE", heading: `${business}'s website is ready`, paragraphs,
        buttons: [{ label: "Download your website (zip)", url: zip, primary: true }, ...(ownUrl ? [{ label: `Open ${domain.domain}`, url: ownUrl }, { label: "Open it now on menu-made.com", url: live }] : live ? [{ label: "Open your live site", url: live }] : []), { label: "Add your logo and photos", url: own }], footnote: "The download link works for 90 days, so save the zip. Questions? Reply to this email." }),
      text: [`Your website for ${business} is ready.`, `Download (zip): ${zip}`, ...(ownUrl ? [`Your site: ${ownUrl} (answers within about 30 minutes; we'll email you)`, `Live now meanwhile: ${live}`] : live ? [`Live now: ${live}`] : []), `Add your logo and photos (free, ${OWN_DAYS} days): ${own}`, "The download link works for 90 days."].join("\n")
    };
  }
};

export { inlined, makeSiteFiles, readme, runSiteFilesProduceStep, siteFilesOverrides };
