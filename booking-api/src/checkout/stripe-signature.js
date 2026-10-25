async function verifyStripeSignature(payload, signatureHeader, secret) {
  const parsed = parseStripeSignatureHeader(
    signatureHeader
  );
  if (!parsed.timestamp || parsed.signatures.length === 0) {
    return false;
  }
  const toleranceSeconds = 300;
  const nowSeconds = Math.floor(
    Date.now() / 1e3
  );
  if (Math.abs(
    nowSeconds - parsed.timestamp
  ) > toleranceSeconds) {
    return false;
  }
  const signedPayload = `${parsed.timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["verify"]
  );
  for (const signatureHex of parsed.signatures) {
    const signatureBytes = hexToBytes(signatureHex);
    if (!signatureBytes) {
      continue;
    }
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(
        signedPayload
      )
    );
    if (valid) {
      return true;
    }
  }
  return false;
}

function parseStripeSignatureHeader(header) {
  const parts = header.split(",");
  let timestamp = null;
  const signatures = [];
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      timestamp = Number(value);
    }
    if (key === "v1" && value) {
      signatures.push(value);
    }
  }
  return {
    timestamp,
    signatures
  };
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(
    hex.length / 2
  );
  for (let i = 0; i < hex.length; i += 2) {
    const value = Number.parseInt(
      hex.slice(i, i + 2),
      16
    );
    if (Number.isNaN(value)) {
      return null;
    }
    bytes[i / 2] = value;
  }
  return bytes;
}

export {
  verifyStripeSignature,
  parseStripeSignatureHeader,
  hexToBytes
};
