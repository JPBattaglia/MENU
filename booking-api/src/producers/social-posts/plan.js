// Social Posts content plan (stage 6): one AI call writes the month's 12 posts from the buyer's real menu and business name.
// Everything it writes is checked afterwards; a price, hour, phone number or link that is not in the source is a failure.
import { generate } from "../../ai/generate.js";
import { findUnsupportedFacts } from "../../ai/quality.js";

const POSTS_PER_MONTH = 12;

const SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "integer", description: "Day of the month to post, 1-28" },
          kind: { type: "string", description: "dish, story, seasonal or tip" },
          headline: { type: "string", description: "Short text printed on the graphic, 3-8 words" },
          caption: { type: "string", description: "Caption in the business's voice, 1-3 sentences" },
          hashtags: { type: "array", items: { type: "string" } },
          featured_item: { type: "string", description: "Exact menu item name this post is about, or empty" }
        },
        required: ["day", "kind", "headline", "caption", "hashtags", "featured_item"]
      }
    }
  },
  required: ["posts"]
};

const SYSTEM = [
  "You plan a month of Instagram and Facebook posts for a small restaurant or food business.",
  `Write exactly ${POSTS_PER_MONTH} posts spread across the month, mixing dish spotlights, short stories about the business, seasonal ideas and simple tips.`,
  "Use ONLY facts from the BUSINESS DETAILS and MENU. Never invent prices, opening hours, phone numbers, addresses, links, awards, discounts, ingredients or events.",
  "Do not put prices or hours in a headline or caption; a price is shown automatically for the featured menu item.",
  "featured_item must be copied exactly from the menu or left empty. Each headline must be different. Friendly, specific, no emojis in headlines."
].join(" ");

function menuToText(menu) {
  return (menu?.sections || []).flatMap((s) => (s.items || []).map((i) => `${s.name}: ${i.name}${i.price ? ` ${i.price}` : ""}${i.description ? ` - ${i.description}` : ""}`)).join("\n");
}

function validatePosts(posts, { menu, sourceText }) {
  const problems = [];
  if (!Array.isArray(posts) || posts.length !== POSTS_PER_MONTH) problems.push(`Expected ${POSTS_PER_MONTH} posts, got ${Array.isArray(posts) ? posts.length : 0}`);
  const names = new Map((menu?.sections || []).flatMap((s) => s.items || []).map((i) => [String(i.name).toLowerCase(), i]));
  const seen = new Set();
  const clean = [];
  (posts || []).forEach((post, index) => {
    const label = `Post ${index + 1}`;
    const headline = String(post.headline ?? "").replace(/\s+/g, " ").trim();
    const caption = String(post.caption ?? "").replace(/\s+/g, " ").trim();
    const hashtags = (Array.isArray(post.hashtags) ? post.hashtags : []).map((h) => String(h).trim().replace(/^(?!#)/, "#"));
    if (headline.length < 6 || headline.length > 60) problems.push(`${label}: headline must be 6-60 characters`);
    if (caption.length < 30 || caption.length > 600) problems.push(`${label}: caption must be 30-600 characters`);
    if (hashtags.length < 3 || hashtags.length > 10 || hashtags.some((h) => !/^#[A-Za-z0-9_]{2,40}$/.test(h))) problems.push(`${label}: use 3-10 simple hashtags`);
    if (seen.has(headline.toLowerCase())) problems.push(`${label}: duplicate headline`);
    seen.add(headline.toLowerCase());
    for (const fact of findUnsupportedFacts(`${headline} ${caption}`, sourceText)) problems.push(`${label}: ${fact.kind} "${fact.value}" is not in the business details or menu`);
    const item = names.get(String(post.featured_item ?? "").trim().toLowerCase());
    const day = Math.min(28, Math.max(1, Math.round(Number(post.day) || index * 2 + 1)));
    clean.push({ day, kind: String(post.kind || "post").slice(0, 20), headline, caption, hashtags, featured: item ? { name: item.name, price: item.price || "" } : null });
  });
  clean.sort((a, b) => a.day - b.day);
  return { posts: clean, problems };
}

async function planPosts(env, { businessName, menu, monthLabel, scope }, deps) {
  const menuText = menuToText(menu);
  const sourceText = `${businessName}\n${menuText}`;
  let feedback = "";
  let last = { posts: [], problems: ["No attempt was made"] };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generate(env, {
      purpose: "social_posts_plan",
      system: SYSTEM,
      prompt: `BUSINESS DETAILS:\nName: ${businessName}\nMonth: ${monthLabel}\n\nMENU:\n${menuText || "(no menu on file - write general posts about the business, with no dish names)"}${feedback}`,
      schema: SCHEMA,
      scope,
      maxTokens: 6000
    }, deps);
    last = validatePosts(result.output.posts, { menu, sourceText });
    if (last.problems.length === 0) return { ...last, attempts: attempt };
    feedback = `\n\nYour previous answer had these problems; fix them all:\n- ${last.problems.slice(0, 12).join("\n- ")}`;
  }
  return { ...last, attempts: 2 };
}

export { POSTS_PER_MONTH, menuToText, planPosts, validatePosts };
