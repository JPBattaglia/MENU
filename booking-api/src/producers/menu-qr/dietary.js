// Diet and allergen marks the menu already uses, shown as icons with a key on the print PDFs and the TV screen
// (owner, Nov 5, 2026). Only marks written on the menu itself are read, in brackets after an item or in its
// description, such as "Garden Salad (V, GF)" or "[vegan]". Nothing is guessed from ingredients: an allergen mark
// that isn't on the customer's menu never appears.
//   splitMarks(text) -> { text, marks }   text without the bracketed marks, marks as codes in MARKS order
//   markItems(menu)  -> { menu, used }     every item's name and description split; used = codes found, in order

const MARKS = [
  { code: "V", label: "Vegetarian", words: ["v", "veg", "vegetarian"] },
  { code: "VG", label: "Vegan", words: ["vg", "ve", "vegan"] },
  { code: "GF", label: "Gluten-free", words: ["gf", "gluten free", "gluten-free"] },
  { code: "DF", label: "Dairy-free", words: ["df", "dairy free", "dairy-free"] },
  { code: "N", label: "Contains nuts", words: ["n", "contains nuts", "nuts"] },
  { code: "HOT", label: "Spicy", words: ["spicy", "hot", "\u{1f336}", "\u{1f336}️"] }
];
const BY_WORD = new Map(MARKS.flatMap((mark) => mark.words.map((word) => [word, mark.code])));
const ORDER = MARKS.map((mark) => mark.code);

// A bracket group counts only when every part of it is a known mark, so "(6 pieces)" or "(add bacon)" stay as text.
function splitMarks(text) {
  const marks = new Set();
  const out = String(text ?? "").replace(/\s*[([]([^()[\]]{1,40})[)\]]/g, (whole, inner) => {
    const parts = inner.split(/\s*[,/|&+]\s*|\s+and\s+/i).map((part) => part.trim().toLowerCase()).filter(Boolean);
    if (!parts.length || !parts.every((part) => BY_WORD.has(part))) return whole;
    parts.forEach((part) => marks.add(BY_WORD.get(part)));
    return "";
  }).replace(/\s+/g, " ").trim();
  return { text: out, marks: ORDER.filter((code) => marks.has(code)) };
}

function markItems(menu) {
  const used = new Set();
  const sections = (menu?.sections || []).map((section) => ({
    ...section,
    items: (section.items || []).map((item) => {
      const name = splitMarks(item?.name);
      const description = splitMarks(item?.description);
      const tagged = normalizeTags(item?.tags);
      const marks = ORDER.filter((code) => name.marks.includes(code) || description.marks.includes(code) || tagged.includes(code));
      marks.forEach((code) => used.add(code));
      return { ...item, name: name.text || String(item?.name ?? ""), description: description.text, marks };
    })
  }));
  return { menu: { ...menu, sections }, used: ORDER.filter((code) => used.has(code)) };
}

const markLabel = (code) => MARKS.find((mark) => mark.code === code)?.label || code;

// Stage 15 "AI menu details" (Nov 17, 2026): an item can also carry marks as data, item.tags = ["V", "GF"], read with
// the menu (the reader maps the menu's own symbols and key, never guesses from ingredients) or ticked by the owner in
// the menu editor. normalizeTags keeps known codes only, in MARKS order, no repeats.
const CODES = new Set(ORDER);
function normalizeTags(list) {
  const given = new Set((Array.isArray(list) ? list : []).map((code) => String(code ?? "").trim().toUpperCase()).filter((code) => CODES.has(code)));
  return ORDER.filter((code) => given.has(code));
}

// A freshly read item: marks written in brackets move out of its name and description into tags, joined with the
// tags the reader gave. Returns a new item; an item with no marks comes back unchanged apart from an absent tags key.
function tagItem(item) {
  const name = splitMarks(item?.name);
  const description = splitMarks(item?.description);
  const tags = normalizeTags([...(item?.tags || []), ...name.marks, ...description.marks]);
  const out = { ...item, name: name.text || String(item?.name ?? ""), description: description.text };
  delete out.tags;
  return tags.length ? { ...out, tags } : out;
}

const tagMenu = (menu) => ({ ...menu, sections: (menu?.sections || []).map((section) => ({ ...section, items: (section.items || []).map(tagItem) })) });

export { MARKS, splitMarks, markItems, markLabel, normalizeTags, tagItem, tagMenu };
