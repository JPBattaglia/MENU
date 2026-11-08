// US spelling for the copy we write (owner review, Nov 7, 2026): Menu-made's buyers are US businesses, and the AI
// sometimes writes "Neighbourhood", "Flavours" or "Savour". Words the business itself uses (in its brief or menu) are allowed.
const UK = /\b(neighbour\w*|flavour\w*|favour\w*|colour\w*|savour\w*|honour\w*|centre\w*|theatre\w*|harbour\w*|organis\w*|realis\w*|recognis\w*|specialis\w*|cosy|grey|jewellery|programme|travelled|travelling|catalogue|moustache)\b/gi;

function ukSpellings(text, allowedText = "") {
  const allowed = String(allowedText || "").toLowerCase();
  const found = new Set();
  for (const m of String(text || "").matchAll(UK)) {
    const word = m[0].toLowerCase();
    if (!allowed.includes(word)) found.add(m[0]);
  }
  return [...found];
}

const US_SPELLING = "Write in American English with US spelling (neighborhood, flavor, favorite, color, savor, center, cozy).";

export { US_SPELLING, ukSpellings };
