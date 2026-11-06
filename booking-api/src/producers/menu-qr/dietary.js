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
      const marks = ORDER.filter((code) => name.marks.includes(code) || description.marks.includes(code));
      marks.forEach((code) => used.add(code));
      return { ...item, name: name.text || String(item?.name ?? ""), description: description.text, marks };
    })
  }));
  return { menu: { ...menu, sections }, used: ORDER.filter((code) => used.has(code)) };
}

const markLabel = (code) => MARKS.find((mark) => mark.code === code)?.label || code;

export { MARKS, splitMarks, markItems, markLabel };
