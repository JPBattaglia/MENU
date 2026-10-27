// Menu Care (stage 6): apply a customer's change request to their live menu.
//   parseMenuHtml(html)      -> { businessName, primary, accent, logoDataUri, menu }   (reads the page buildDesignedMenuHtml wrote)
//   diffMenus(before, after) -> [{ kind: "added"|"removed"|"changed", section, name, before?, after? }]
//   applyMenuChange(env, {...}) -> { menu, summary, diff, problems }   (one generate() call, then deterministic checks)
// Nothing here publishes. The care step renders the new version and the owner approves it before it goes live.
import { generate } from "../../ai/generate.js";
import { findUnsupportedFacts } from "../../ai/quality.js";

const decode = (text) => String(text ?? "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
const strip = (html) => decode(String(html ?? "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

class MenuCareError extends Error {
  constructor(message, code = "MENU_CARE_ERROR") {
    super(message);
    this.name = "MenuCareError";
    this.code = code;
  }
}

function parseMenuHtml(html) {
  const source = String(html ?? "");
  if (!source.includes('class="menu-section"')) {
    throw new MenuCareError("This menu page is not in the designed format, so it cannot be edited automatically", "UNSUPPORTED_MENU");
  }
  const sections = [];
  for (const block of source.split('<section class="menu-section"').slice(1)) {
    const name = strip(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1]);
    const items = [];
    for (const li of block.split("<li>").slice(1)) {
      const chunk = li.split("</li>")[0];
      const itemName = strip(/<span class="item">([\s\S]*?)<\/span>/.exec(chunk)?.[1]);
      if (!itemName) continue;
      items.push({
        name: itemName,
        description: strip(/<p class="desc">([\s\S]*?)<\/p>/.exec(chunk)?.[1]),
        price: strip(/<span class="price">([\s\S]*?)<\/span>/.exec(chunk)?.[1])
      });
    }
    sections.push({ name, items });
  }
  const notes = strip(/<p class="notes">([\s\S]*?)<\/p>/.exec(source)?.[1]);
  const title = strip(/<h1>([\s\S]*?)<\/h1>/.exec(source)?.[1]);
  const logo = /<header>\s*<img src="([^"]+)"/.exec(source)?.[1];
  return {
    businessName: title,
    primary: /--primary:\s*(#[0-9a-f]{6})/i.exec(source)?.[1] || null,
    accent: /--accent:\s*(#[0-9a-f]{6})/i.exec(source)?.[1] || null,
    logoDataUri: logo ? decode(logo) : null,
    menu: { sections, notes, unreadable: "" }
  };
}

function flatten(menu) {
  const map = new Map();
  for (const section of menu.sections || []) {
    for (const item of section.items || []) {
      const key = `${section.name}\u0000${item.name}`.toLowerCase();
      map.set(key, { section: section.name, ...item });
    }
  }
  return map;
}

function diffMenus(before, after) {
  const a = flatten(before);
  const b = flatten(after);
  const out = [];
  for (const [key, item] of b) {
    const old = a.get(key);
    if (!old) out.push({ kind: "added", section: item.section, name: item.name, after: { price: item.price, description: item.description } });
    else if (old.price !== item.price || old.description !== item.description) {
      out.push({ kind: "changed", section: item.section, name: item.name,
        before: { price: old.price, description: old.description }, after: { price: item.price, description: item.description } });
    }
  }
  for (const [key, item] of a) {
    if (!b.has(key)) out.push({ kind: "removed", section: item.section, name: item.name, before: { price: item.price, description: item.description } });
  }
  if (String(before.notes || "") !== String(after.notes || "")) {
    out.push({ kind: "changed", section: "(notes)", name: "Footnote", before: { description: before.notes || "" }, after: { description: after.notes || "" } });
  }
  return out;
}

function describeDiff(diff) {
  return diff.map((d) => {
    if (d.kind === "added") return `Added ${d.name} (${d.section})${d.after.price ? ` ${d.after.price}` : ""}`;
    if (d.kind === "removed") return `Removed ${d.name} (${d.section})`;
    const bits = [];
    if ((d.before.price || "") !== (d.after.price || "")) bits.push(`price ${d.before.price || "none"} → ${d.after.price || "none"}`);
    if ((d.before.description || "") !== (d.after.description || "")) bits.push("description updated");
    return `Changed ${d.name} (${d.section}): ${bits.join(", ")}`;
  });
}

const MENU_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, description: { type: "string" }, price: { type: "string" } },
              required: ["name", "description", "price"]
            }
          }
        },
        required: ["name", "items"]
      }
    },
    notes: { type: "string" },
    understood: { type: "boolean", description: "False if the request is not a clear change to the menu (a question, a complaint, something unrelated)." },
    summary: { type: "string", description: "One plain sentence describing what you changed, or why you could not." }
  },
  required: ["sections", "notes", "understood", "summary"]
};

const SYSTEM = [
  "You update a restaurant's published menu for the owner.",
  "You receive the CURRENT MENU as JSON and the owner's CHANGE REQUEST.",
  "Return the complete updated menu in the same structure. Apply ONLY what the request asks for.",
  "Every item, description, price and note the request does not mention must be copied through exactly as it is.",
  "Never invent a price, ingredient, hour or claim. If the request needs a price that is not given, set understood to false.",
  "If the request is not a clear menu change, set understood to false and return the current menu unchanged."
].join(" ");

// Checks that do not trust the model: every price must come from the old menu or the request itself.
function checkChange({ before, after, requestText, diff }) {
  const problems = [];
  const afterItems = (after.sections || []).reduce((n, s) => n + (s.items || []).length, 0);
  const beforeItems = (before.sections || []).reduce((n, s) => n + (s.items || []).length, 0);
  if (afterItems === 0) problems.push("The updated menu has no items");
  if (beforeItems >= 4 && afterItems < beforeItems / 2) problems.push(`The change removes most of the menu (${beforeItems} items down to ${afterItems})`);
  if (diff.length === 0) problems.push("The request did not change anything on the menu");
  const known = `${(before.sections || []).flatMap((s) => (s.items || []).map((i) => `${i.price} ${i.description} ${i.name}`)).join("\n")}\n${before.notes || ""}\n${requestText}`;
  const written = [
    ...diff.filter((d) => d.after).map((d) => `${d.after.price || ""} ${d.after.description || ""}`),
    ...diff.filter((d) => d.section === "(notes)").map((d) => d.after.description)
  ].join("\n");
  for (const fact of findUnsupportedFacts(written, known)) problems.push(`${fact.kind} "${fact.value}" is not in the current menu or the request`);
  return problems;
}

async function applyMenuChange(env, { menu, requestText, scope, deps }) {
  const request = String(requestText ?? "").trim().slice(0, 4000);
  if (request.length < 3) throw new MenuCareError("The change request is empty", "EMPTY_REQUEST");
  const result = await generate(env, {
    purpose: "menu_care_edit",
    system: SYSTEM,
    prompt: `CURRENT MENU:\n${JSON.stringify(menu)}\n\nCHANGE REQUEST:\n${request}`,
    schema: MENU_SCHEMA,
    scope,
    maxTokens: 16000
  }, deps);
  const after = { sections: result.output.sections, notes: String(result.output.notes ?? ""), unreadable: "" };
  const summary = String(result.output.summary || "").slice(0, 300);
  if (!result.output.understood) return { menu: menu, summary, diff: [], problems: [`Not applied: ${summary || "the request is not a clear menu change"}`], understood: false };
  const diff = diffMenus(menu, after);
  const problems = checkChange({ before: menu, after, requestText: request, diff });
  return { menu: after, summary, diff, problems, understood: true, usage: result.usage };
}

export { MenuCareError, applyMenuChange, checkChange, describeDiff, diffMenus, parseMenuHtml };
