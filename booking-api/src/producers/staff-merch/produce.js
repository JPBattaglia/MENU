// Staff merch PRODUCE step (stage 10): the proof. A one-page order proof (each shirt with its Nino design photo, colour,
// sizes and quantities, prices, delivery address) and, when the business added its logo, a drawing of the shirt back
// with the logo where Printful prints it (4 in wide, 1 in below the collar). Orders with a logo wait for the owner's
// approval of that proof (placement and the right to print the logo); orders without one go straight on.
// The Printful order itself is placed by the DELIVER step (presenter.js) once the proof is released.
import { escapeHtml } from "../../lib/email.js";
import { bytesToBase64 } from "../../lib/util.js";
import { loadDeliveryContext } from "../../approvals/release.js";
import { completeStep } from "../../workflows/runner.js";
import { storeDeliverable } from "../shared/deliverables.js";
import { merchOf } from "./order.js";

const e = escapeHtml;
const money = (c) => `$${(Number(c) / 100).toFixed(2)}`;

function proofHtml({ business, merch, logoDataUri }) {
  const groups = new Map();
  for (const line of merch.lines) {
    const key = `${line.product_id}|${line.color}`;
    if (!groups.has(key)) groups.set(key, { title: line.title, color: line.color, image: line.image, sizes: [] });
    groups.get(key).sizes.push(line);
  }
  const cards = [...groups.values()].map((g) => `<article><div class="photos">${g.image ? `<figure><img src="${e(g.image)}" alt="${e(g.title)} in ${e(g.color)}"><figcaption>Front: Nino's design</figcaption></figure>` : ""}
    ${logoDataUri ? `<figure><svg viewBox="0 0 300 340" role="img" aria-label="Shirt back with logo"><path d="M60 20 L110 0 Q150 25 190 0 L240 20 L300 80 L260 115 L240 95 L240 340 L60 340 L60 95 L40 115 L0 80 Z" fill="#e9e6e1" stroke="#9a948a" stroke-width="2"/><image href="${e(logoDataUri)}" x="110" y="36" width="80" height="80" preserveAspectRatio="xMidYMid meet"/></svg><figcaption>Back: your logo, 4 in wide, upper back</figcaption></figure>` : ""}</div>
    <h2>${e(g.title)} <small>${e(g.color)}</small></h2>
    <table><tr><th>Size</th><th>Qty</th><th>Each</th><th>Line</th></tr>${g.sizes.map((s) => `<tr><td>${e(s.size)}</td><td>${s.quantity}</td><td>${money(s.unit_cents)}</td><td>${money(s.line_cents)}</td></tr>`).join("")}</table></article>`).join("");
  const p = merch.pricing;
  const r = merch.recipient || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(business)} - staff merch proof</title>
<style>body{margin:0;background:#f4f1ec;font:16px/1.5 system-ui,sans-serif;color:#1d1d1b}main{max-width:900px;margin:0 auto;padding:24px 16px 48px}h1{margin:0}article{background:#fff;border:1px solid #e3ddd2;border-radius:10px;padding:16px;margin:18px 0}.photos{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0;width:260px;max-width:100%}img,svg{width:100%;height:auto;border-radius:6px;background:#f6f4f0}figcaption{font-size:13px;color:#6b675f}h2 small{font-weight:400;color:#6b675f}table{border-collapse:collapse;width:100%;max-width:480px}td,th{border-bottom:1px solid #eee;padding:6px 8px;text-align:left}.sum{background:#fff;border:1px solid #e3ddd2;border-radius:10px;padding:16px}</style></head>
<body><main><h1>${e(business)}: staff shirts</h1><p>Order proof. ${p.shirts} shirt${p.shirts === 1 ? "" : "s"}, designs by Nino Battaglia, printed and shipped by Printful.</p>${cards}
<section class="sum"><p>Shirts ${money(p.list_subtotal_cents)}${p.discount_percent ? ` &minus; ${p.discount_percent}% team discount ${money(p.discount_cents)}` : ""} = <strong>${money(p.subtotal_cents)}</strong>${p.logo_fee_cents ? ` (includes the ${money(p.logo_fee_cents)} logo print on each shirt)` : ""}</p>
<p>Delivery: ${e(merch.rate.name)} ${money(merch.rate.amount_cents)}</p>
${merch.tax_cents ? `<p>Sales tax: ${money(merch.tax_cents)} &middot; Paid: <strong>${money(p.subtotal_cents + merch.rate.amount_cents + merch.tax_cents)}</strong></p>` : ""}
<p>Ships to: ${e([r.name, r.address1, r.address2, r.city, r.state_code, r.zip, r.country_code].filter(Boolean).join(", "))}</p></section></main></body></html>`;
}

async function runStaffMerchProduceStep(targetStep, env) {
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const context = await loadDeliveryContext(targetStep.project_id, env);
  if (!context) throw new Error("Production project could not be loaded");
  const merch = await merchOf(env, context);
  if (!merch?.lines?.length) throw new Error("Staff merch details are missing from the project");
  let logoDataUri = "";
  if (merch.logo_key) {
    const object = await env.ASSETS.get(merch.logo_key);
    if (!object) throw new Error("The uploaded logo is missing from storage");
    logoDataUri = `data:${object.httpMetadata?.contentType || "image/png"};base64,${bytesToBase64(new Uint8Array(await object.arrayBuffer()))}`;
  }
  const business = context.business_name || "Your business";
  const html = new TextEncoder().encode(proofHtml({ business, merch, logoDataUri }));
  const slug = business.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "staff";
  // With a logo the proof needs the owner's approval (placement and the right to print it): the deliverable says so.
  const proof = await storeDeliverable(env, context, {
    type: "MERCH_PROOF", filename: `${slug}-staff-merch-proof.html`, mime: "text/html", bytes: html, folder: "merch-proof",
    metadata: { staff_merch: { shirts: merch.pricing.shirts, logo: Boolean(merch.logo_key), subtotal_cents: merch.pricing.subtotal_cents }, ...(merch.logo_key ? { approval: "owner" } : {}) }
  });
  const output = { outcome: "PRODUCED", shirts: merch.pricing.shirts, logo: Boolean(merch.logo_key), proof_deliverable: proof.deliverableId };
  await completeStep(targetStep, output, env);
  return output;
}

export { proofHtml, runStaffMerchProduceStep };
