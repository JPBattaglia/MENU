// Whether a menu fits a tri-fold at a readable size (owner, Nov 12, 2026: "if a trifold is not possible then remove
// it from the list of buttons and mention it's not possible in the email"). Same rule as the tri-fold itself:
// buildTriFoldPdf's planner returns nothing for a menu too long for the three inside panels.
//   triFoldPossible(env, projectId) -> true | false | null   (null: no draft to check, so callers keep the button)
import { buildTriFoldPdf } from "./print-pdf.js";
import { parseMenuHtml } from "../menu-care/menu-edit.js";
import QRCode from "qrcode/lib/browser.js";

const TRI_FOLD_NOTE = "No tri-fold for this menu: it is too long to fit one at a readable size. The print menu (PDF) fits any length.";

async function triFoldPossible(env, projectId) {
  try {
    const draft = await env.DB.prepare(`
        SELECT a.storage_key FROM deliverables d JOIN assets a ON a.id = d.asset_id
        WHERE d.project_id = ? AND d.deliverable_type = 'MENU_DRAFT' AND d.status != 'SUPERSEDED' ORDER BY d.version DESC LIMIT 1`).bind(projectId).first();
    const object = draft?.storage_key ? await env.ASSETS.get(draft.storage_key) : null;
    if (!object) return null;
    const parsed = parseMenuHtml(await object.text());
    const qrUrl = "https://menu-made.com/api/menu/check";
    const plan = await buildTriFoldPdf({ ...parsed, qrModules: QRCode.create(qrUrl, { errorCorrectionLevel: "M" }).modules, qrUrl, planOnly: true });
    return Boolean(plan);
  } catch {
    return null;
  }
}

export { triFoldPossible, TRI_FOLD_NOTE };
