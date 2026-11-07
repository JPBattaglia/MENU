// Gathers CC0 / public-domain photo candidates for each mood category from Openverse (no API key), saves small
// thumbnails and a contact sheet per category for review. Run by .github/workflows/mood-photos.yml (Claude's
// workspace can't reach Openverse). Output: mood-candidates/<cat>/<nn>.jpg, mood-candidates/sheets/<cat>.jpg,
// mood-candidates/candidates.json.
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { CATEGORIES } from "./categories.mjs";

const OUT = "mood-candidates";
const PER_CAT = 16;
const UA = "MenuMadeMoodPhotos/1.0 (+https://menu-made.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = (process.env.MOOD_ONLY || "").split(",").filter(Boolean);

async function search(q, extra) {
  const params = new URLSearchParams({ q, license: "cc0,pdm", mature: "false", page_size: "20", aspect_ratio: "wide", ...extra });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 429) { await sleep(20000); continue; }
    if (!res.ok) { console.log(`  ${q}: HTTP ${res.status}`); return []; }
    return (await res.json()).results || [];
  }
  return [];
}

const all = {};
for (const [cat, terms] of Object.entries(CATEGORIES)) {
  if (only.length && !only.includes(cat)) continue;
  const seen = new Map();
  for (const extra of [{ source: "stocksnap,rawpixel" }, {}]) {
    for (const q of terms) {
      if (seen.size >= PER_CAT) break;
      for (const r of await search(q, extra)) {
        if (seen.size >= PER_CAT) break;
        if (seen.has(r.id) || !r.url || (r.width && r.width < 1200)) continue;
        seen.set(r.id, r);
      }
      await sleep(3500);
    }
  }
  await mkdir(`${OUT}/${cat}`, { recursive: true });
  const list = [];
  let n = 0;
  for (const r of seen.values()) {
    n++;
    const name = String(n).padStart(2, "0");
    try {
      const res = await fetch(r.thumbnail || `https://api.openverse.org/v1/images/${r.id}/thumb/`, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      await writeFile(`${OUT}/${cat}/${name}.jpg`, Buffer.from(await res.arrayBuffer()));
      list.push({ n: name, id: r.id, title: r.title, source: r.source, license: r.license, creator: r.creator, url: r.url, landing: r.foreign_landing_url, width: r.width, height: r.height });
    } catch { /* skip */ }
    await sleep(300);
  }
  all[cat] = list;
  console.log(`${cat}: ${list.length} candidates (${list.map((l) => l.source).join(",")})`);
  if (list.length) {
    await mkdir(`${OUT}/sheets`, { recursive: true });
    try {
      execFileSync("montage", ["-label", "%t", ...list.map((l) => `${OUT}/${cat}/${l.n}.jpg`), "-tile", "4x", "-geometry", "300x200+4+4", "-pointsize", "22", "-background", "#ffffff", `${OUT}/sheets/${cat}.jpg`]);
    } catch (e) { console.log(`  sheet failed: ${e.message.split("\n")[0]}`); }
  }
}
await writeFile(`${OUT}/candidates.json`, JSON.stringify(all, null, 1));
