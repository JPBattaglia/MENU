// Mood photos (owner, Nov 6, 2026): when a business gives no photos, the generator shows free-licence (CC0 / public
// domain) photos that suit its menu, so a site isn't bare. They're marked sample: the preview says so, the buyer's own
// photos ("Make it yours" or after paying) replace them, and the zip's README says what they are.
// The library lives in the public repo at /assets/mood/ (index.json lists each file's category, source and licence;
// added with .github/workflows/mood-photos.yml). Each preview gets its own copies at img/mood-<n>.jpg, so the zip and
// the hosted site carry them like any other photo.

const LIBRARY = "https://menu-made.com/assets/mood/";
const COUNT = 2;   // the designs show photos[0] (hero) and photos[1] (about)

// Menu words -> category. Order breaks ties (more specific first).
const WORDS = {
  pizza: ["pizza", "pizzeria", "calzone", "margherita", "pepperoni", "stromboli"],
  sushi: ["sushi", "sashimi", "nigiri", "maki", "tempura", "edamame", "izakaya", "japanese", "omakase"],
  ramen: ["ramen", "udon", "soba", "tonkotsu", "noodle soup"],
  vietnamese: ["pho", "banh mi", "vietnamese", "bun bo", "vermicelli"],
  korean: ["korean", "bibimbap", "bulgogi", "kimchi", "galbi", "japchae", "tteokbokki"],
  thai: ["thai", "pad thai", "pad see ew", "tom yum", "massaman", "panang", "larb", "green curry"],
  chinese: ["dumpling", "dumplings", "dim sum", "bao", "chow mein", "lo mein", "kung pao", "wonton", "szechuan", "sichuan", "chinese", "potsticker", "potstickers", "mapo"],
  indian: ["indian", "tikka", "masala", "naan", "biryani", "samosa", "tandoori", "paneer", "korma", "vindaloo", "dal", "daal", "chutney"],
  mexican: ["taco", "tacos", "burrito", "burritos", "quesadilla", "enchilada", "enchiladas", "nachos", "guacamole", "carnitas", "al pastor", "tamale", "tamales", "mexican", "taqueria", "torta", "pozole", "churros"],
  mediterranean: ["falafel", "hummus", "shawarma", "gyro", "gyros", "kebab", "kebabs", "pita", "tzatziki", "mediterranean", "greek", "lebanese", "tabbouleh", "halal", "turkish", "persian", "baba ghanoush"],
  bbq: ["bbq", "barbecue", "brisket", "pulled pork", "ribs", "smoked", "smokehouse"],
  steak: ["steak", "steaks", "ribeye", "sirloin", "filet mignon", "steakhouse", "porterhouse", "prime rib"],
  seafood: ["seafood", "oyster", "oysters", "clam", "clams", "shrimp", "prawn", "prawns", "lobster", "crab", "salmon", "mussels", "calamari", "ceviche", "poke", "fish"],
  burgers: ["burger", "burgers", "cheeseburger", "fries", "hot dog", "onion rings", "milkshake"],
  italian: ["pasta", "spaghetti", "lasagna", "ravioli", "risotto", "gnocchi", "fettuccine", "penne", "carbonara", "bolognese", "tiramisu", "bruschetta", "italian", "trattoria", "osteria", "antipasti"],
  donuts: ["donut", "donuts", "doughnut", "doughnuts", "cruller", "fritter", "fritters"],
  icecream: ["ice cream", "gelato", "sundae", "soft serve", "frozen yogurt", "sorbet", "creamery", "scoop"],
  pastry: ["croissant", "croissants", "pastry", "pastries", "danish", "scone", "scones", "muffin", "muffins", "patisserie", "macaron", "macarons", "eclair"],
  bakery: ["bakery", "bread", "sourdough", "baguette", "loaf", "bagel", "bagels", "focaccia"],
  dessert: ["cake", "cakes", "cupcake", "cupcakes", "cheesecake", "dessert", "desserts", "brownie", "cookies", "crepe", "crepes"],
  breakfast: ["breakfast", "brunch", "pancake", "pancakes", "waffle", "waffles", "omelet", "omelette", "eggs benedict", "french toast", "hash browns", "diner"],
  coffee: ["coffee", "espresso", "latte", "cappuccino", "americano", "macchiato", "mocha", "cold brew", "cafe", "café", "cortado", "roastery"],
  tea: ["boba", "bubble tea", "milk tea", "matcha", "chai", "teahouse", "tea"],
  juice: ["smoothie", "smoothies", "juice", "juices", "acai", "juicery"],
  salad: ["salad", "salads", "grain bowl", "vegan", "quinoa", "kale", "plant-based", "poke bowl"],
  sandwich: ["sandwich", "sandwiches", "deli", "hoagie", "panini", "reuben", "grilled cheese", "subs"],
  wine: ["wine", "wines", "cabernet", "pinot", "chardonnay", "merlot", "sauvignon", "prosecco", "champagne", "by the glass", "winery", "wine bar"],
  beer: ["beer", "beers", "ipa", "lager", "stout", "pilsner", "brewery", "brewing", "taproom", "on tap", "draft", "pub", "tavern"],
  cocktails: ["cocktail", "cocktails", "margarita", "mojito", "martini", "old fashioned", "negroni", "spritz", "whiskey", "bourbon", "tequila", "mezcal", "mocktail", "lounge", "happy hour", "cocktail bar"]
};
const FALLBACK = ["restaurant", "food"];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = Object.fromEntries(Object.entries(WORDS).map(([cat, words]) => [cat, words.map((w) => new RegExp(`(^|[^a-z])${escapeRe(w)}([^a-z]|$)`, "i"))]));

// Categories ranked for this business: a name or cuisine match counts 3, each menu word 1.
function moodScores(site = {}, cuisine = "") {
  const head = `${site.name || ""} ${cuisine || ""}`.toLowerCase();
  const body = `${site.offerings || ""} ${site.about || ""}`.toLowerCase();
  return Object.entries(PATTERNS).map(([cat, res], order) => {
    let score = 0;
    for (const re of res) { if (re.test(head)) score += 3; if (re.test(body)) score += 1; }
    return { cat, score, order };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.order - b.order);
}
const moodCategories = (site, cuisine) => [...moodScores(site, cuisine).map((s) => s.cat), ...FALLBACK];

// A stable pick for a business: the same name gets the same photos every time.
function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text || "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Files to use, from the library index. Hero: the best match. Second: a strong runner-up (a pizza place with a real
// wine list), else another photo of the best match, else the general restaurant photos.
function pickMood(index, site, cuisine = "") {
  const byCat = new Map();
  for (const e of Array.isArray(index) ? index : []) {
    if (!e?.file || !/^[a-z]+-\d+\.jpg$/.test(e.file) || !["cc0", "pdm"].includes(e.license)) continue;
    if (!byCat.has(e.cat)) byCat.set(e.cat, []);
    byCat.get(e.cat).push(e);
  }
  const scores = moodScores(site, cuisine).filter((s) => byCat.has(s.cat));
  const cats = [...scores.map((s) => s.cat), ...FALLBACK.filter((c) => byCat.has(c))];
  if (!cats.length) return [];
  const seed = seedOf(site?.name);
  const at = (cat, k) => { const list = byCat.get(cat); return list[(seed + k) % list.length]; };
  const top = scores[0];
  const runner = scores.slice(1).find((s) => s.score >= 2 && top && s.score * 2 >= top.score);
  const order = [[cats[0], 0], ...(runner ? [[runner.cat, 0]] : []), [cats[0], 1], ...cats.slice(1).map((c) => [c, 0])];
  const picked = [];
  for (const [cat, k] of order) {
    if (picked.length >= COUNT) break;
    const e = at(cat, k);
    if (!picked.includes(e)) picked.push(e);
  }
  return picked;
}

// Copies the chosen mood photos beside a preview (website-previews/<token>/img/mood-<n>.jpg) and returns the photo
// refs for site.photos, marked sample. Any failure returns [] and the designs fall back to their photo-free heroes.
async function addMoodPhotos(env, token, site, { cuisine = "", fetcher = fetch } = {}) {
  if (!env?.ASSETS || site?.kind === "services") return [];
  try {
    const res = await fetcher(`${LIBRARY}index.json`, { cf: { cacheTtl: 3600 } });
    if (!res.ok) return [];
    const chosen = pickMood(await res.json(), site, cuisine);
    const photos = [];
    for (const e of chosen) {
      const img = await fetcher(`${LIBRARY}${e.file}`, { cf: { cacheTtl: 86400 } });
      if (!img.ok) continue;
      const bytes = new Uint8Array(await img.arrayBuffer());
      if (bytes.length < 1000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) continue;
      const n = photos.length + 1;
      await env.ASSETS.put(`website-previews/${token}/img/mood-${n}.jpg`, bytes, { httpMetadata: { contentType: "image/jpeg" } });
      photos.push({ path: `img/mood-${n}.jpg`, alt: "", sample: true, mood: e.file });
    }
    return photos;
  } catch {
    return [];
  }
}

const ownPhotoCount = (site) => (site?.photos || []).filter((p) => !p.sample).length;
const hasSamplePhotos = (site) => (site?.photos || []).some((p) => p.sample);

export { addMoodPhotos, hasSamplePhotos, moodCategories, moodScores, ownPhotoCount, pickMood, LIBRARY as MOOD_LIBRARY };
