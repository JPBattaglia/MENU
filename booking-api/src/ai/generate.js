// Shared AI step (stage 5). Every producer that writes copy, replies, posts or reports calls generate() instead of
// talking to the Anthropic API itself, so retries, JSON-schema output, token logging and the hard monthly cap
// live in one place.
//
//   const result = await generate(env, {
//     purpose: "review_reply",                 // short label stored with the usage row
//     system, prompt,                          // instructions and the user content
//     schema: { type: "object", properties: {...}, required: [...] },   // output shape (tool input_schema)
//     scope: { entityType: "SUBSCRIPTION", entityId: subscriptionId, correlationId },
//     capTokens: 2_000_000                     // optional; default env.AI_MONTHLY_TOKEN_CAP or DEFAULT_MONTHLY_TOKEN_CAP
//   });
//   result.output   -> object matching the schema
//   result.usage    -> { input_tokens, output_tokens }
//
// Usage is logged to business_events as event_type AI_USAGE (no schema change). The cap is checked BEFORE calling
// the API, per scope entity per calendar month (UTC); a capped call throws an AiCapError and costs nothing.
import { ANTHROPIC_MESSAGES_ENDPOINT, MENU_EXTRACTION_MODEL } from "../producers/menu-qr/claude-reader.js";

const DEFAULT_MODEL = MENU_EXTRACTION_MODEL;
const DEFAULT_MONTHLY_TOKEN_CAP = 2_000_000;
const MAX_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const TOOL_NAME = "record_output";
const USAGE_EVENT = "AI_USAGE";

class AiCapError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "AiCapError";
    this.code = "AI_CAP_REACHED";
    this.details = details;
  }
}

class AiOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = "AiOutputError";
    this.code = "AI_BAD_OUTPUT";
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function monthBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

// Tokens used this month by one scope entity. One indexed read (idx_business_events_ai_usage, migration 0004).
async function tokensUsedThisMonth(env, scope, now = new Date()) {
  const { start, end } = monthBounds(now);
  const rows = (await env.DB.prepare(`
      SELECT payload_json FROM business_events
      WHERE event_type = ? AND entity_id = ? AND created_at >= ? AND created_at < ?
    `).bind(USAGE_EVENT, scope.entityId, start, end).all()).results || [];
  let total = 0;
  for (const row of rows) {
    try {
      const usage = JSON.parse(row.payload_json || "{}");
      total += Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0);
    } catch { /* an unreadable row counts as zero rather than blocking production */ }
  }
  return total;
}

async function logUsage(env, scope, purpose, model, usage, attempts, now) {
  await env.DB.prepare(`
      INSERT INTO business_events (id, created_at, event_type, entity_type, entity_id, actor_type, actor_id, correlation_id, payload_json)
      VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'MENU_MADE_AI', ?, ?)
    `).bind(crypto.randomUUID(), now.toISOString(), USAGE_EVENT, scope.entityType || "SUBSCRIPTION", scope.entityId,
    scope.correlationId || null, JSON.stringify({ purpose, model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, attempts })).run();
}

function checkAgainstSchema(output, schema) {
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new AiOutputError("The model returned no structured output");
  for (const key of schema.required || []) {
    if (output[key] === undefined || output[key] === null) throw new AiOutputError(`The model output is missing "${key}"`);
  }
  for (const [key, definition] of Object.entries(schema.properties || {})) {
    if (output[key] === undefined) continue;
    const type = definition.type;
    const value = output[key];
    const ok = type === "string" ? typeof value === "string"
      : type === "number" || type === "integer" ? typeof value === "number"
        : type === "boolean" ? typeof value === "boolean"
          : type === "array" ? Array.isArray(value)
            : type === "object" ? value && typeof value === "object" && !Array.isArray(value)
              : true;
    if (!ok) throw new AiOutputError(`The model output field "${key}" is not a ${type}`);
  }
}

async function generate(env, options, deps = {}) {
  const { purpose, system, prompt, schema, scope } = options;
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!env.DB) throw new Error("D1 binding DB is not available");
  if (!prompt || !schema || !scope?.entityId || !purpose) throw new Error("generate() needs purpose, prompt, schema and scope.entityId");
  const fetcher = deps.fetch || fetch;
  const sleep = deps.sleep || defaultSleep;
  const now = deps.now || new Date(); // injectable so tests can pin the calendar month
  const cap = Number(options.capTokens ?? env.AI_MONTHLY_TOKEN_CAP ?? DEFAULT_MONTHLY_TOKEN_CAP);
  const used = await tokensUsedThisMonth(env, scope, now);
  if (used >= cap) throw new AiCapError(`Monthly AI token cap reached (${used} of ${cap})`, { used, cap });

  const model = options.model || env.AI_MODEL || DEFAULT_MODEL;
  const body = JSON.stringify({
    model,
    max_tokens: options.maxTokens || 4000,
    ...(system ? { system } : {}),
    tools: [{ name: TOOL_NAME, description: "Record the result.", input_schema: schema }],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: `${prompt}\n\nRespond only by calling the ${TOOL_NAME} tool once.` }]
  });

  let lastError = null;
  const total = { input_tokens: 0, output_tokens: 0 };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetcher(ANTHROPIC_MESSAGES_ENDPOINT, {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body
      });
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) { await sleep(500 * attempt); continue; }
      break;
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      lastError = new Error(`AI request failed: ${result?.error?.message || `HTTP ${response.status}`}`);
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) { await sleep(500 * attempt); continue; }
      break;
    }
    total.input_tokens += Number(result?.usage?.input_tokens || 0);
    total.output_tokens += Number(result?.usage?.output_tokens || 0);
    const output = (result?.content || []).find((block) => block.type === "tool_use" && block.name === TOOL_NAME)?.input;
    try {
      checkAgainstSchema(output, schema);
    } catch (error) {
      lastError = error; // a malformed answer is retried; its tokens were still spent and are logged below
      if (attempt < MAX_ATTEMPTS) continue;
      break;
    }
    await logUsage(env, scope, purpose, result.model || model, total, attempt, now);
    return { output, usage: total, model: result.model || model, attempts: attempt };
  }
  if (total.input_tokens || total.output_tokens) await logUsage(env, scope, purpose, model, total, MAX_ATTEMPTS, now).catch(() => null);
  throw lastError instanceof Error ? lastError : new Error("AI request failed");
}

export {
  AiCapError,
  AiOutputError,
  DEFAULT_MONTHLY_TOKEN_CAP,
  USAGE_EVENT,
  generate,
  monthBounds,
  tokensUsedThisMonth
};
