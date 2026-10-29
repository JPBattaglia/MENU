// Nino design services (stage 10): automated graphic design sold on ninobattaglia.com and produced by this engine.
// Owner decisions (Oct 28, 2026): four services, sold on the Nino site with checkout through Menu-made's engine and
// Stripe account; every result waits for the owner's one-click approval (creative work); prices below.
//
// Each product: offer code, workflow key, price, the brief the buyer fills in after paying, and what is produced.
// Facts printed on a design (dates, prices, phone numbers, addresses) come only from the buyer's own brief or menu.

const STYLES = ["classic", "modern", "bold", "elegant", "playful", "rustic"];

const NINO_PRODUCTS = {
  NINO_SOCIAL_PACK: {
    code: "NINO_SOCIAL_PACK", workflow: "NINO_SOCIAL_PACK_V1", name: "Social Graphics Pack", priceCents: 14900,
    short: "9 branded graphics with captions", deliverable: "a ZIP of 9 feed graphics, 9 story graphics and captions",
    fields: [
      { key: "business_name", label: "Business name as it should appear", type: "text", required: true, max: 60 },
      { key: "about", label: "What your business is", type: "textarea", required: true, max: 600, help: "A few sentences: what you sell or serve, who comes to you, what you're known for." },
      { key: "promote", label: "What should the posts promote?", type: "textarea", required: true, max: 900, help: "Dishes, products, services, events or offers. Only what you write here (and your menu, if we host it) is used, so include the details you want shown." },
      { key: "voice", label: "Tone of voice (optional)", type: "text", required: false, max: 80, help: "For example: warm and family-run, playful, upscale." },
      { key: "brand_colors", label: "Brand colours (optional)", type: "text", required: false, max: 60, help: "Up to two colours, like #b3261e, #f2b705. Leave blank and we'll pick from your logo's style." }
    ],
    logo: true
  },
  NINO_FLYER: {
    code: "NINO_FLYER", workflow: "NINO_FLYER_V1", name: "Flyer", priceCents: 7900,
    // Owner decision Oct 28, 2026: the flyer is taxed (Stripe Tax, digital finished artwork); the other design services are not.
    taxCode: "txcd_10505001",
    short: "A print-ready letter-size flyer", deliverable: "a print-ready flyer (letter size, 300 dpi PNG) and a square version for social media",
    fields: [
      { key: "business_name", label: "Business name as it should appear", type: "text", required: true, max: 60 },
      { key: "headline", label: "Headline", type: "text", required: true, max: 60, help: "The big words. For example: Live Jazz Fridays, or Grand Opening." },
      { key: "details", label: "Details", type: "textarea", required: true, max: 400, help: "Up to 5 short lines: date and time, what's on, the offer. Printed exactly as written, one line each." },
      { key: "call_to_action", label: "Call to action (optional)", type: "text", required: false, max: 50, help: "For example: Book a table, or Free entry." },
      { key: "contact", label: "Address, phone or website to print (optional)", type: "text", required: false, max: 120 },
      { key: "style", label: "Style", type: "select", options: STYLES, required: true },
      { key: "brand_colors", label: "Brand colours (optional)", type: "text", required: false, max: 60, help: "Up to two colours, like #b3261e, #f2b705." }
    ],
    logo: true
  },
  NINO_MENU_DESIGN: {
    code: "NINO_MENU_DESIGN", workflow: "NINO_MENU_DESIGN_V1", name: "Menu Redesign", priceCents: 19900,
    includedPages: 4, extraPageCents: 2500, maxPages: 12,
    short: "Your menu, redesigned for print", deliverable: "your redesigned menu as print-ready pages (letter size, 300 dpi PNG)",
    fields: [
      { key: "business_name", label: "Business name as it should appear", type: "text", required: true, max: 60 },
      { key: "tagline", label: "Line under the name (optional)", type: "text", required: false, max: 70, help: "For example: Wood-fired pizza since 1998." },
      { key: "footer", label: "Footer line (optional)", type: "text", required: false, max: 160, help: "Address, phone, or a note like 'Ask about allergens'. Printed exactly as written." },
      { key: "style", label: "Style", type: "select", options: STYLES, required: true },
      { key: "brand_colors", label: "Brand colours (optional)", type: "text", required: false, max: 60, help: "Up to two colours, like #b3261e, #f2b705." }
    ],
    logo: true,
    menuFile: true
  },
  NINO_LOGO: {
    code: "NINO_LOGO", workflow: "NINO_LOGO_V1", name: "Logo (wordmark)", priceCents: 24900,
    short: "6 typographic logo options, final files", deliverable: "6 wordmark options, each as a transparent PNG and on light and dark backgrounds",
    fields: [
      { key: "business_name", label: "Name for the logo", type: "text", required: true, max: 32, help: "Exactly as it should be spelled. Short names work best." },
      { key: "tagline", label: "Tagline (optional)", type: "text", required: false, max: 40 },
      { key: "style", label: "Style", type: "select", options: STYLES, required: true },
      { key: "brand_colors", label: "Colours (optional)", type: "text", required: false, max: 60, help: "Up to two colours, like #1f2a2e, #c9a227. Leave blank and we'll choose." }
    ],
    logo: false
  }
};

const NINO_WORKFLOWS = Object.fromEntries(Object.values(NINO_PRODUCTS).map((p) => [p.workflow, p]));
const productForWorkflow = (key) => NINO_WORKFLOWS[key] || null;
const productForCode = (code) => NINO_PRODUCTS[String(code || "").toUpperCase()] || null;

// Menu Redesign is priced by the number of printed pages the buyer picks at checkout.
function quoteMenuDesign(pages) {
  const p = NINO_PRODUCTS.NINO_MENU_DESIGN;
  if (!Number.isInteger(pages) || pages < 1 || pages > p.maxPages) return null;
  const extra = Math.max(0, pages - p.includedPages);
  return { pages, included_pages: p.includedPages, extra_pages: extra, total_cents: p.priceCents + extra * p.extraPageCents };
}

export { NINO_PRODUCTS, NINO_WORKFLOWS, STYLES, productForCode, productForWorkflow, quoteMenuDesign };
