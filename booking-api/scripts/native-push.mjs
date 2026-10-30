// Sends Store App notifications to Apple (APNs, HTTP/2) for the menu-checkout worker, which can't speak HTTP/2.
// Run by .github/workflows/native-push.yml; details in booking-api/src/store-app/native-push.js.
// No packages: Node's own http2 and crypto. This repo is public, so the logs are public: the key, device tokens and
// message text are masked or never printed; only counts and Apple's reason codes are.
import http2 from "node:http2";
import { createPrivateKey, sign } from "node:crypto";

const BASE = process.env.WORKER_BASE || "https://menu-made.com";
const AUDIENCE = "menu-made-native-push";
const MAX_BATCHES = 20;
const PARALLEL = 20;

const mask = (value) => { for (const line of String(value).split(/\r?\n/)) if (line.trim()) console.log(`::add-mask::${line.trim()}`); };
const b64u = (buf) => Buffer.from(buf).toString("base64url");

async function oidcToken() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer } = process.env;
  if (!url || !bearer) throw new Error("No GitHub OIDC token available (id-token: write missing?)");
  const res = await fetch(`${url}&audience=${AUDIENCE}`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new Error(`OIDC token request failed: ${res.status}`);
  const { value } = await res.json();
  mask(value);
  return value;
}

async function worker(token, path, body) {
  const res = await fetch(`${BASE}/api/native-push/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Worker ${path.startsWith("next") ? "next" : "report"}: HTTP ${res.status} ${data.error || ""}`);
  return data;
}

// Apple provider token: ES256 JWT signed with the team's push key. Good for up to an hour; one per run is enough.
function providerToken({ key_id, team_id, p8 }) {
  const header = b64u(JSON.stringify({ alg: "ES256", kid: key_id }));
  const claims = b64u(JSON.stringify({ iss: team_id, iat: Math.floor(Date.now() / 1000) }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: createPrivateKey(p8), dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64u(signature)}`;
}

const sessions = new Map();
function session(environment) {
  const host = environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  let s = sessions.get(host);
  if (!s || s.closed || s.destroyed) { s = http2.connect(host); s.on("error", () => sessions.delete(host)); sessions.set(host, s); }
  return s;
}

function sendOne(jwt, device, payload, collapseId) {
  return new Promise((resolve) => {
    let req;
    try {
      req = session(device.environment).request({
        ":method": "POST", ":path": `/3/device/${device.token}`,
        authorization: `bearer ${jwt}`, "apns-topic": device.topic, "apns-push-type": "alert", "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 86400), "apns-collapse-id": collapseId.slice(0, 64)
      });
    } catch (error) { resolve({ device: device.id, status: 0, reason: "ConnectError" }); return; }
    let status = 0; let data = "";
    const timer = setTimeout(() => { req.close(); resolve({ device: device.id, status: 0, reason: "Timeout" }); }, 15000);
    req.on("response", (h) => { status = Number(h[":status"]); });
    req.setEncoding("utf8");
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => { clearTimeout(timer); let reason = ""; try { reason = JSON.parse(data || "{}").reason || ""; } catch {} resolve({ device: device.id, status, reason }); });
    req.on("error", () => { clearTimeout(timer); resolve({ device: device.id, status: 0, reason: "StreamError" }); });
    req.end(payload);
  });
}

async function main() {
  const token = await oidcToken();
  let batches = 0; let total = 0;
  const tally = {};
  for (; batches < MAX_BATCHES; batches++) {
    const next = await worker(token, "next");
    if (!next.job) break;
    const { job, apple } = next;
    mask(apple.p8); mask(job.title); mask(job.body);
    for (const d of job.devices) mask(d.token);
    const jwt = providerToken(apple);
    mask(jwt);
    const payload = JSON.stringify({ aps: { alert: { title: job.title, body: job.body }, sound: "default" }, tag: job.tag });
    const results = [];
    for (let i = 0; i < job.devices.length; i += PARALLEL) {
      results.push(...await Promise.all(job.devices.slice(i, i + PARALLEL).map((d) => sendOne(jwt, d, payload, job.tag))));
    }
    for (const r of results) { const k = r.status === 200 ? "200" : `${r.status} ${r.reason}`.trim(); tally[k] = (tally[k] || 0) + 1; }
    total += results.length;
    const reported = await worker(token, job.id, { claim: job.claim, results });
    console.log(`Batch ${batches + 1}: ${results.length} phones, job now ${reported.status}`);
  }
  for (const s of sessions.values()) s.close();
  const summary = total ? `Sent to ${total} phones in ${batches} batches: ${Object.entries(tally).map(([k, n]) => `${k} x${n}`).join(", ")}` : "Nothing to send";
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) { const { appendFileSync } = await import("node:fs"); appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`); }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
