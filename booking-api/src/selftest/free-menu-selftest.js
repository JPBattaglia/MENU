// Daily self-test of the MΞNU free plan and the owner's menu editor (stage 15, Nov 17, 2026). One tick, the buyer's
// way, through the real routes, no Stripe and no AI call:
//   a stored menu preview (as the generator stores one, campaign 'selftest') -> "Start free" -> the emailed confirm
//   link (made here, as the email has it) -> the menu is live in Classic with the "Made with MΞNU" badge and a QR code
//   -> signed in, the editor loads it with the week's numbers -> one save changes a price, marks an item vegetarian and
//   gluten-free and another sold out -> the live page shows all three -> a visit with ?s=qr counts as a view and a QR
//   scan in the editor's numbers. Then everything the run made is removed, so it never counts toward the free plan's
//   per-email limit, the weekly emails or the Friday numbers.
// Start one by inserting a self_tests row with kind FREE_MENU_RUN and status REQUESTED. Only a failure emails the owner.
import { ownerEmailAddress, publicBaseUrl } from "../lib/config.js";
import { SELF_TEST_EMAIL, brandedEmailHtml, sendTransactionalEmail } from "../lib/email.js";
import { nowIso, parseJsonOrNull } from "../lib/http.js";
import { signLinkToken } from "../lib/links.js";
import { storeMenuDesigns } from "../marketing/public-preview.js";
import { MENU_DESIGNS } from "../producers/menu-qr/menu-designs.js";
import { freeOnSale } from "../marketing/free-menu.js";
import { dailyClock } from "./daily-clock.js";
import { updateTest } from "./menu-qr-selftest.js";

const KIND = "FREE_MENU_RUN";
const HOUR = 21;            // UTC, after the MΞNU Plus / Pro runs (20:20, 20:40)
const BUSINESS = "Free Self-Test Deli";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) MenuMadeSelfTest";
const MENU = {
  sections: [
    { name: "Sandwiches", items: [{ name: "Turkey Club", description: "", price: "$13" }, { name: "Caprese Panini", description: "Mozzarella, tomato, basil", price: "$12" }] },
    { name: "Sides", items: [{ name: "Pasta Salad", description: "", price: "$6" }] }
  ],
  notes: "", unreadable: ""
};
const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });

async function maybeScheduleDaily(env, now = dailyClock(env)) {
  if (!now || now.getUTCHours() !== HOUR || now.getUTCMinutes() >= 20) return;
  const recent = await env.DB.prepare(`SELECT 1 FROM self_tests WHERE kind = ? AND created_at > ? LIMIT 1`).bind(KIND, new Date(now.getTime() - 20 * 3600000).toISOString()).first();
  if (recent) return;
  const t = now.toISOString();
  await env.DB.prepare(`INSERT INTO self_tests (id, kind, status, requested_by, created_at, updated_at) VALUES (?, ?, 'REQUESTED', 'daily', ?, ?)`).bind(crypto.randomUUID(), KIND, t, t).run();
}

async function makePreview(env, now) {
  const token = `${crypto.randomUUID().replace(/-/g, "")}f7ee`; // 36 hex characters, like a real preview token
  await storeMenuDesigns(env, token, { business: BUSINESS, menu: MENU, colors: "", custom: {}, customized: 0 });
  await env.DB.prepare(`INSERT INTO menu_previews (token, request_id, email, business, ip_hash, campaign, status, item_count, created_at, expires_at) VALUES (?, ?, ?, ?, '', 'selftest', 'READY', 3, ?, ?)`)
    .bind(token, crypto.randomUUID(), SELF_TEST_EMAIL, BUSINESS, new Date(now).toISOString(), new Date(now + 86400000).toISOString()).run();
  return token;
}

async function runOnce(env, app, test) {
  const base = publicBaseUrl(env);
  const token = await makePreview(env, Date.now());
  test = await updateTest(env, test, { status: "RUNNING", stage: "START", state: { token } });
  const start = await json(await app(new Request(`${base}/api/menu-preview/free/${token}`, { method: "POST", headers: { Accept: "application/json" } })));
  if (!start.body?.ok) throw Object.assign(new Error(`Start free failed (HTTP ${start.status}): ${JSON.stringify(start.body).slice(0, 200)}`), { selfTest: test });
  // The emailed confirm link (free-menu.js signs it the same way); a button first, then the POST makes it live.
  const t = await signLinkToken(env, { kind: "menu-free", id: token, ttlDays: 1 });
  const confirmPage = await app(new Request(`${base}/api/menu-free/confirm/${token}?t=${encodeURIComponent(t)}`, { headers: { "User-Agent": PHONE_UA } }));
  if (!/<form method="post">/.test(await confirmPage.text())) throw Object.assign(new Error("The confirm link didn't show a button first"), { selfTest: test });
  const done = await app(new Request(`${base}/api/menu-free/confirm/${token}`, { method: "POST", body: new URLSearchParams({ t }) }));
  const cookie = (done.headers.get("Set-Cookie") || "").split(";")[0];
  if (done.status !== 303 || !cookie) throw Object.assign(new Error(`Confirming the free menu failed (HTTP ${done.status})`), { selfTest: test });
  const project = await env.DB.prepare(`SELECT p.id, p.business_id, p.order_id FROM menu_previews m JOIN projects p ON p.id = m.free_project_id WHERE m.token = ?`).bind(token).first();
  if (!project) throw Object.assign(new Error("No free menu project was made"), { selfTest: test });
  test = await updateTest(env, test, { project_id: project.id, order_id: project.order_id, state: { business_id: project.business_id } });
  const address = (await env.DB.prepare(`SELECT value_text FROM project_inputs WHERE project_id = ? AND input_key = 'qr_destination'`).bind(project.id).first())?.value_text;
  const qr = await env.DB.prepare(`SELECT 1 AS ok FROM deliverables WHERE project_id = ? AND deliverable_type = 'QR_CODE' AND status = 'FINAL'`).bind(project.id).first();
  if (!address || !qr) throw Object.assign(new Error("The free menu has no address or QR code"), { selfTest: test });
  const first = await (await app(new Request(address))).text();
  if (!first.includes("Turkey Club") || !first.includes("mm-made-with")) throw Object.assign(new Error("The live free menu is missing its items or the Made with MΞNU badge"), { selfTest: test });

  // The editor: load, then one save with a price change, two marks and a sold-out item.
  const headers = { Cookie: cookie, "Content-Type": "application/json" };
  const loaded = await json(await app(new Request(`${base}/api/account/menu?business=${project.business_id}`, { headers })));
  if (!loaded.body?.ok || !loaded.body.stats) throw Object.assign(new Error(`The menu editor didn't load the menu and its numbers (HTTP ${loaded.status})`), { selfTest: test });
  const menu = loaded.body.menu;
  const item = (name) => menu.sections.flatMap((s) => s.items).find((i) => i.name === name);
  item("Turkey Club").price = "$14";
  item("Caprese Panini").tags = ["V", "GF"];
  item("Pasta Salad").sold_out = true;
  const saved = await json(await app(new Request(`${base}/api/account/menu`, { method: "POST", headers, body: JSON.stringify({ business: project.business_id, sections: menu.sections, notes: "" }) })));
  if (!saved.body?.ok || !saved.body.changes?.length) throw Object.assign(new Error(`The editor save failed (HTTP ${saved.status}): ${JSON.stringify(saved.body).slice(0, 200)}`), { selfTest: test });

  // The live page, as a guest scanning the QR code.
  const page = await app(new Request(`${address}?s=qr`, { headers: { "User-Agent": PHONE_UA } }));
  const html = await page.text();
  const problems = [];
  if (!html.includes("$14")) problems.push("the new price $14");
  if (!/data-tags="V GF"/.test(html)) problems.push("the V and GF marks");
  if (!/<li class="sold-out">[\s\S]*?Pasta Salad/.test(html)) problems.push("Pasta Salad marked sold out");
  if (!html.includes("mm-made-with")) problems.push("the free plan badge");
  if (problems.length) throw Object.assign(new Error(`After the editor save the live menu is missing ${problems.join(", ")}`), { selfTest: test });
  const after = await json(await app(new Request(`${base}/api/account/menu?business=${project.business_id}`, { headers })));
  const stats = after.body?.stats;
  if (!(stats?.views >= 1) || !(stats?.qr_scans >= 1)) throw Object.assign(new Error(`The QR visit wasn't counted (views ${stats?.views}, QR scans ${stats?.qr_scans})`), { selfTest: test });

  await cleanUp(env, test);
  return updateTest(env, test, { status: "PASSED", stage: "DONE",
    log: `Start free, confirm link, live in Classic with badge and QR; editor saved ${saved.body.changes.length} changes (price, marks V GF, sold out), all on the live page; QR visit counted (${stats.views} view, ${stats.qr_scans} scan); everything removed` });
}

// Removes what the run made. The customer row is the shared self-test customer and stays.
async function cleanUp(env, test) {
  const s = parseJsonOrNull(test.state_json) || {};
  const token = s.token;
  const project = token ? await env.DB.prepare(`SELECT free_project_id AS id FROM menu_previews WHERE token = ?`).bind(token).first().catch(() => null) : null;
  const projectId = project?.id || test.project_id;
  if (projectId) {
    const row = await env.DB.prepare(`SELECT business_id, order_id FROM projects WHERE id = ?`).bind(projectId).first().catch(() => null);
    const assets = (await env.DB.prepare(`SELECT a.id, a.storage_key FROM deliverables d JOIN assets a ON a.id = d.asset_id WHERE d.project_id = ?`).bind(projectId).all().catch(() => ({ results: [] }))).results || [];
    for (const a of assets) await env.ASSETS.delete(a.storage_key).catch(() => null);
    const run = (sql, ...args) => env.DB.prepare(sql).bind(...args).run().catch(() => null);
    await run(`DELETE FROM deliverables WHERE project_id = ?`, projectId);
    for (const a of assets) await run(`DELETE FROM assets WHERE id = ?`, a.id);
    await run(`DELETE FROM project_inputs WHERE project_id = ?`, projectId);
    await run(`DELETE FROM projects WHERE id = ?`, projectId);
    if (row?.order_id) { await run(`DELETE FROM order_items WHERE order_id = ?`, row.order_id); await run(`DELETE FROM orders WHERE id = ?`, row.order_id); }
    if (row?.business_id) {
      await run(`DELETE FROM menu_stats_daily WHERE business_id = ?`, row.business_id);
      await run(`DELETE FROM customer_businesses WHERE business_id = ?`, row.business_id);
      await run(`DELETE FROM businesses WHERE id = ? AND name = ?`, row.business_id, BUSINESS);
    }
  }
  if (/^[a-f0-9]{36}$/.test(String(token || ""))) {
    await env.DB.prepare(`DELETE FROM menu_previews WHERE token = ? AND campaign = 'selftest'`).bind(token).run().catch(() => null);
    for (const key of [...MENU_DESIGNS.map((d) => `${d.key}.html`), "data.json"]) await env.ASSETS.delete(`menu-previews/${token}/${key}`).catch(() => null);
  }
}

async function failTest(env, test, message) {
  test = (await env.DB.prepare(`SELECT * FROM self_tests WHERE id = ?`).bind(test.id).first()) || test;
  const failed = await updateTest(env, test, { status: "FAILED", error: String(message).slice(0, 1000), log: `FAILED: ${message}` });
  await cleanUp(env, failed).catch(() => null);
  await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject: "Free plan self-test failed",
    html: brandedEmailHtml({ preheader: "The automated test of the free plan and menu editor failed.", eyebrow: "SELF-TEST", heading: "The free plan self-test failed",
      paragraphs: ["The daily test of the free menu and the menu editor stopped before it finished. Real owners may hit the same problem. Forward this email to Claude."],
      rows: [["Error", failed.error], ["Self-test", test.id]] }),
    text: `The free plan self-test failed.\n${failed.error}\nSelf-test: ${test.id}`,
    idempotencyKey: `self-test-failed/${test.id}`, purpose: "AUTOMATION_ALERT", templateKey: "self_test_failed_v1"
  }).catch(() => null);
  return failed;
}

async function advanceFreeMenuSelfTests(env, app) {
  if (!env.DB || !env.ASSETS) return [];
  // No free plan since Nov 19, 2026 ("no FREE"): nothing to test unless the owner switches it back on.
  if (!freeOnSale(env)) return [];
  await maybeScheduleDaily(env).catch(() => null);
  const tests = (await env.DB.prepare(`SELECT * FROM self_tests WHERE kind = ? AND status = 'REQUESTED' ORDER BY created_at ASC LIMIT 1`).bind(KIND).all()).results || [];
  const results = [];
  for (const test of tests) {
    let out;
    try { out = await runOnce(env, app, test); } catch (error) { out = await failTest(env, error?.selfTest || test, error instanceof Error ? error.message : String(error)); }
    results.push({ id: out.id, status: out.status });
  }
  return results;
}

export { KIND as FREE_MENU_SELF_TEST_KIND, advanceFreeMenuSelfTests, cleanUp as cleanUpFreeMenuSelfTest, maybeScheduleDaily as scheduleFreeMenuSelfTest };
