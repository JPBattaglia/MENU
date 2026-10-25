import { escapeHtml } from "./email.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders()
      }
    }
  );
}

function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || "").trim();
}

function normalizeNullableText(value) {
  const clean = String(value || "").trim();
  return clean || null;
}

function splitName(fullName) {
  const clean = normalizeName(fullName);
  if (!clean) {
    return {
      firstName: null,
      lastName: null
    };
  }
  const parts = clean.split(/\s+/);
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: null
    };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function safeFilename(filename) {
  const clean = String(filename || "upload").trim().replace(
    /[^a-zA-Z0-9._-]+/g,
    "-"
  ).replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "upload";
}

function extensionForMime(mimeType) {
  const map = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg"
  };
  return map[mimeType] || "bin";
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

function parseJsonOrNull(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function simplePage(status, title, bodyHtml) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · MENU-MADE</title>
<style>body{margin:0;background:#edf3f5;font-family:Arial,Helvetica,sans-serif;color:#26434f}main{max-width:560px;margin:40px auto;background:#fff;border:1px solid #dce8ec;padding:32px}h1{color:#071f2c;font-size:24px;margin:0 0 16px}p{line-height:1.6}a.btn,button{display:inline-block;background:#071f2c;color:#fff;border:0;border-radius:6px;padding:12px 20px;font-size:15px;font-weight:bold;text-decoration:none;margin:0 8px 12px 0;cursor:pointer}button{background:#00a7b5}dl{background:#f3f8f9;border:1px solid #dce8ec;padding:12px 16px}dt{font-size:12px;font-weight:bold;color:#45616c}dd{margin:0 0 8px}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${bodyHtml}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    }
  });
}

export {
  corsHeaders,
  jsonResponse,
  nowIso,
  normalizeEmail,
  normalizeName,
  normalizeNullableText,
  splitName,
  safeFilename,
  extensionForMime,
  bytesToHex,
  parseJsonOrNull,
  simplePage
};
