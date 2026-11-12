// PDFs printed by a real browser from the menu page's own HTML and CSS (owner, Nov 12, 2026: "build it"), so the
// print PDF, tri-fold and table tent carry the chosen design exactly: colours, pattern, decorations, layout.
// Uses Cloudflare Browser Run through the BROWSER binding (wrangler.jsonc); no token. Workers Paid includes 10
// browser hours a month and each PDF takes a few seconds, drawn once per menu version (delivery.js keeps it in R2).
//   renderMenuPdf(env, format, { pageHtml, qrSvg, qrUrl }) -> Uint8Array | null
// Returns null whenever the browser can't be used or fails (no binding, a limit, an error, a non-PDF answer), and
// the caller falls back to the drawn PDF (print-pdf.js), so a buyer always gets a file.
import { buildPrintHtml } from "./print-html.js";

const TIMEOUT_MS = 25000;

async function renderMenuPdf(env, format, input) {
  if (typeof env?.BROWSER?.quickAction !== "function") return null;
  const html = buildPrintHtml(format, input);
  if (!html) return null;
  try {
    const response = await Promise.race([
      env.BROWSER.quickAction("pdf", {
        html,
        pdfOptions: { printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("browser pdf timed out")), TIMEOUT_MS))
    ]);
    if (!response?.ok) {
      console.warn("browser pdf refused", format, response?.status);
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // "%PDF": anything else (a JSON error, an empty body) is not a file to hand a buyer.
    if (bytes.length < 1000 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) return null;
    return bytes;
  } catch (error) {
    console.warn("browser pdf failed", format, String(error?.message || error).slice(0, 200));
    return null;
  }
}

export { renderMenuPdf };
