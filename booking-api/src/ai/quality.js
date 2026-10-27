// Producer quality checks for generated copy (stage 5). Pure functions: nothing here calls a model or the database.
//   - length: a reply must be inside a sensible range
//   - facts: prices, opening hours, phone numbers, emails and web addresses may appear in generated text only if they
//     are in the inputs the buyer gave us (menu, profile details) — never invented by the model
//   - privacy: contact details a reviewer wrote in their review must not be repeated in a public reply

const PRICE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
const TIME = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d[\s().-]?){7,}\d/g;
const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;

const squash = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ");
const digits = (value) => String(value ?? "").replace(/\D/g, "");

function findAll(pattern, text) {
  return [...String(text ?? "").matchAll(pattern)].map((match) => match[0].trim());
}

function sameTime(a, b) {
  const norm = (value) => {
    const m = /(\d{1,2})(?::(\d{2}))?\s?(a|p)/i.exec(value);
    return m ? `${Number(m[1])}:${m[2] || "00"}${m[3].toLowerCase()}` : squash(value);
  };
  return norm(a) === norm(b);
}

// Facts in `text` that do not appear in `sourceText` (everything the buyer provided).
function findUnsupportedFacts(text, sourceText) {
  const source = squash(sourceText);
  const sourceDigits = digits(sourceText);
  const problems = [];
  for (const price of findAll(PRICE, text)) {
    const amount = price.replace(/[^\d.]/g, "").replace(/\.00$/, "");
    const present = new RegExp(`\\$\\s?${amount.replace(".", "\\.")}(?:\\.00)?(?!\\d)`).test(String(sourceText ?? ""));
    if (!present) problems.push({ kind: "price", value: price });
  }
  for (const time of findAll(TIME, text)) {
    if (!findAll(TIME, sourceText).some((known) => sameTime(known, time))) problems.push({ kind: "hours", value: time });
  }
  for (const email of findAll(EMAIL, text)) {
    if (!source.includes(email.toLowerCase())) problems.push({ kind: "email", value: email });
  }
  for (const phone of findAll(PHONE, text)) {
    const d = digits(phone);
    if (d.length >= 7 && !sourceDigits.includes(d)) problems.push({ kind: "phone", value: phone });
  }
  for (const raw of findAll(URL_LIKE, text)) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (!source.includes(url.toLowerCase())) problems.push({ kind: "url", value: url });
  }
  return problems;
}

function checkLength(text, { min = 1, max = 1200 } = {}) {
  const length = String(text ?? "").trim().length;
  if (length < min) return [{ kind: "too_short", value: `${length} characters` }];
  if (length > max) return [{ kind: "too_long", value: `${length} characters` }];
  return [];
}

// Contact details the reviewer wrote that the reply repeats.
function findRepeatedReviewerDetails(reply, reviewText) {
  const problems = [];
  const replyText = squash(reply);
  for (const email of findAll(EMAIL, reviewText)) {
    if (replyText.includes(email.toLowerCase())) problems.push({ kind: "reviewer_email", value: email });
  }
  const replyDigits = digits(reply);
  for (const phone of findAll(PHONE, reviewText)) {
    const d = digits(phone);
    if (d.length >= 7 && replyDigits.includes(d)) problems.push({ kind: "reviewer_phone", value: phone });
  }
  return problems;
}

// One call for the common case: a generated reply or post checked against everything the buyer gave us.
function qualityCheck(text, { sourceText = "", reviewText = "", min, max } = {}) {
  const problems = [
    ...checkLength(text, { min, max }),
    ...findUnsupportedFacts(text, sourceText),
    ...findRepeatedReviewerDetails(text, reviewText)
  ];
  return { ok: problems.length === 0, problems };
}

export { checkLength, findRepeatedReviewerDetails, findUnsupportedFacts, qualityCheck };
