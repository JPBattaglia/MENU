import { bytesToBase64 } from "../../lib/util.js";

// Reads an uploaded menu PDF or photo with Claude and returns the menu as clean, structured text.
var ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";

var MENU_EXTRACTION_MODEL = "claude-sonnet-5-5";

var MENU_EXTRACTION_TOOL = {
  name: "record_menu",
  description: "Record every section and item on the menu exactly as printed.",
  input_schema: {
    type: "object",
    properties: {
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Section heading as printed, e.g. Starters. Use 'Menu' if the menu has no headings." },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string", description: "Description as printed; empty if none." },
                  price: { type: "string", description: "Price exactly as printed, e.g. $12 or 12 / 18. Empty if none." }
                },
                required: ["name", "description", "price"]
              }
            }
          },
          required: ["name", "items"]
        }
      },
      notes: { type: "string", description: "Printed footnotes worth keeping (allergens, surcharges, hours). Empty if none." },
      unreadable: { type: "string", description: "Describe any part you could not read with confidence. Empty if everything was legible." }
    },
    required: ["sections", "notes", "unreadable"]
  }
};

function formatExtractedMenu(menu) {
  const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const lines = [];
  let itemCount = 0;
  for (const section of (menu.sections || []).slice(0, 60)) {
    const items = (section.items || []).slice(0, 200).filter((item) => clean(item?.name, 200));
    if (!items.length) continue;
    lines.push(clean(section.name, 120).toUpperCase() || "MENU");
    for (const item of items) {
      const price = clean(item.price, 40);
      lines.push(price ? `${clean(item.name, 200)} — ${price}` : clean(item.name, 200));
      const description = clean(item.description, 600);
      if (description) lines.push(`  ${description}`);
      itemCount++;
    }
    lines.push("");
  }
  const notes = clean(menu.notes, 1000);
  if (notes) lines.push(notes);
  return { text: lines.join("\n").trim(), itemCount };
}

async function readMenuWithClaude(contentBlock, env) {
  const response = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.MENU_EXTRACTION_MODEL || MENU_EXTRACTION_MODEL,
      max_tokens: 16000,
      tools: [MENU_EXTRACTION_TOOL],
      // Forced tool_choice is not supported by every model; the instruction below requires the tool instead.
      tool_choice: { type: "auto" },
      messages: [{
        role: "user",
        content: [
          contentBlock,
          { type: "text", text: "This is a restaurant or food business menu. Respond only by calling the record_menu tool once, with the whole menu. Copy names, descriptions and prices exactly as printed; never invent, correct, translate or round anything. Keep the menu's own section order. Skip decorative text, logos, navigation and page numbers." }
        ]
      }]
    })
  });
  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok) {
    throw new Error(`Menu reading failed: ${result?.error?.message || `Anthropic API returned HTTP ${response.status}`}`);
  }
  const menu = (result?.content || []).find((block) => block.type === "tool_use" && block.name === "record_menu")?.input;
  if (!menu) throw new Error("Menu reading returned no menu");
  const { text, itemCount } = formatExtractedMenu(menu);
  if (itemCount === 0) throw new Error("No menu items could be read from the menu");
  return {
    menu,
    text,
    extraction: {
      model: result.model || null,
      item_count: itemCount,
      unreadable: String(menu.unreadable || "").slice(0, 500),
      input_tokens: result.usage?.input_tokens ?? null,
      output_tokens: result.usage?.output_tokens ?? null
    }
  };
}

async function structureMenuText(text, env) {
  return readMenuWithClaude({ type: "text", text: `MENU TEXT:\n${String(text).slice(0, 60000)}` }, env);
}

async function extractMenuFromFile(asset, env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!env.ASSETS) throw new Error("R2 ASSETS binding is not available");
  const mime = String(asset.mime_type || "").toLowerCase();
  if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(mime)) {
    throw new Error(`Menu file type ${mime || "unknown"} is not supported`);
  }
  const object = await env.ASSETS.get(asset.storage_key);
  if (!object) throw new Error("Menu file is missing from storage");
  const data = bytesToBase64(new Uint8Array(await object.arrayBuffer()));
  const fileBlock = mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mime, data } }
    : { type: "image", source: { type: "base64", media_type: mime, data } };
  const read = await readMenuWithClaude(fileBlock, env);
  return { requested_url: null, resolved_url: "", content_type: mime, text: read.text, menu: read.menu, extraction: read.extraction };
}

export {
  ANTHROPIC_MESSAGES_ENDPOINT,
  MENU_EXTRACTION_MODEL,
  MENU_EXTRACTION_TOOL,
  formatExtractedMenu,
  readMenuWithClaude,
  structureMenuText,
  extractMenuFromFile
};
