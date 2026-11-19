// Previews stored before the Customize window's diet and allergen marks (Nov 18, 2026) are rebuilt on their next open.
// Run: node --no-warnings --test preview-marks-upgrade.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { handlePreviewView, storeMenuDesigns } from "./src/marketing/public-preview.js";

const TOKEN = "a".repeat(36);

function fakeEnv() {
  const files = new Map();
  const row = { token: TOKEN, status: "READY", created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), open_count: 0, design: null, campaign: "public", occasion: null, email: "buyer@example.test", free_project_id: null };
  return {
    files,
    ASSETS: {
      async get(key) { return files.has(key) ? { text: async () => files.get(key), arrayBuffer: async () => new TextEncoder().encode(files.get(key)).buffer } : null; },
      async put(key, value) { files.set(key, String(value)); }
    },
    DB: { prepare() { return { bind() { return this; }, async first() { return row; }, async run() { return {}; }, async all() { return { results: [] }; } }; } }
  };
}

const data = { business: "Sample Cafe", menu: { sections: [{ name: "Breakfast", items: [{ name: "Avocado Toast", description: "Sourdough", price: "$12" }] }], notes: "" }, colors: "", custom: {}, customized: 0 };

test("a preview stored with the old Customize window gets the marks on its next open", async () => {
  const env = fakeEnv();
  await storeMenuDesigns(env, TOKEN, data);
  const keys = [...env.files.keys()].filter((k) => k.endsWith(".html"));
  assert.ok(keys.length > 1);
  // Make every stored design look like a page from before Nov 18.
  for (const k of keys) {
    const old = env.files.get(k).replace(/<fieldset class="mm-it-marks"[^]*?<\/fieldset>/g, "").replace(/mm-it-marks/g, "mm-it-gone");
    assert.ok(old.includes('id="mm-items"') && !old.includes("mm-it-marks"));
    env.files.set(k, old);
  }
  const res = await handlePreviewView(new Request("https://menu-made.com/api/menu-preview/view/" + TOKEN, { headers: { "User-Agent": "Mozilla/5.0" } }), env, TOKEN);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes("mm-it-marks"), "served page has the marks");
  for (const k of keys) assert.ok(env.files.get(k).includes("mm-it-marks"), `${k} was re-stored`);
});

test("a current preview is served as stored, without rebuilding", async () => {
  const env = fakeEnv();
  await storeMenuDesigns(env, TOKEN, data);
  let puts = 0; const put = env.ASSETS.put; env.ASSETS.put = async (...a) => { puts++; return put(...a); };
  const res = await handlePreviewView(new Request("https://menu-made.com/api/menu-preview/view/" + TOKEN, { headers: { "User-Agent": "Mozilla/5.0" } }), env, TOKEN);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes("mm-it-marks"));
  assert.equal(puts, 0);
});
