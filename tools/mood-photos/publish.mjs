// Publishes the chosen mood photos: assets/mood/picks.json ({ cat: ["03", "07", ...] }, numbers from the contact
// sheets) -> full-size originals from their source, resized to 1400 px JPEGs with metadata stripped, saved as
// assets/mood/<cat>-<n>.jpg, plus assets/mood/index.json (licence and source of each). CC0 / public domain only.
import { readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const UA = "MenuMadeMoodPhotos/1.0 (+https://menu-made.com)";
const picks = JSON.parse(await readFile("assets/mood/picks.json", "utf8"));
const cands = JSON.parse(await readFile("mood-candidates/candidates.json", "utf8"));
let index = [];
try { index = JSON.parse(await readFile("assets/mood/index.json", "utf8")); } catch { /* first run */ }
const im = (() => { try { execFileSync("magick", ["-version"]); return "magick"; } catch { return "convert"; } })();

for (const [cat, nums] of Object.entries(picks)) {
  index = index.filter((e) => e.cat !== cat);
  let i = 0;
  for (const n of nums) {
    const c = (cands[cat] || []).find((x) => x.n === n);
    if (!c) { console.log(`${cat} ${n}: not in candidates`); continue; }
    if (!["cc0", "pdm"].includes(c.license)) { console.log(`${cat} ${n}: licence ${c.license}, skipped`); continue; }
    const res = await fetch(c.url, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) { console.log(`${cat} ${n}: HTTP ${res.status} for the original`); continue; }
    i++;
    const file = `${cat}-${i}.jpg`;
    await writeFile("/tmp/mood-original", Buffer.from(await res.arrayBuffer()));
    execFileSync(im, ["/tmp/mood-original[0]", "-auto-orient", "-resize", "1400x1400>", "-strip", "-interlace", "Plane", "-quality", "76", `assets/mood/${file}`]);
    index.push({ file, cat, source: c.source, license: c.license, creator: c.creator || "", landing: c.landing || "", openverse_id: c.id });
    console.log(`${cat}: ${file} from ${c.source}`);
  }
}
index.sort((a, b) => a.file.localeCompare(b.file));
await writeFile("assets/mood/index.json", JSON.stringify(index, null, 1) + "\n");
await rm("mood-candidates", { recursive: true, force: true });
