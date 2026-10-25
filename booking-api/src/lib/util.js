function bytesToHex2(bytes) {
  return Array.from(bytes).map(
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(
    String(value)
  );
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );
  return bytesToHex2(
    new Uint8Array(buffer)
  );
}

function escapeHtml2(value) {
  return String(
    value ?? ""
  ).replaceAll(
    "&",
    "&amp;"
  ).replaceAll(
    "<",
    "&lt;"
  ).replaceAll(
    ">",
    "&gt;"
  ).replaceAll(
    '"',
    "&quot;"
  ).replaceAll(
    "'",
    "&#039;"
  );
}

function sanitizeFilename(value) {
  const clean = String(
    value || "menu"
  ).trim().toLowerCase().replace(
    /[^a-z0-9]+/g,
    "-"
  ).replace(
    /^-+|-+$/g,
    ""
  );
  return clean || "menu";
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export {
  bytesToHex2,
  sha256Hex,
  escapeHtml2,
  sanitizeFilename,
  bytesToBase64
};
