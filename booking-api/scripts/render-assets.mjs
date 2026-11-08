// Images the renderer puts into the SVGs before drawing them, and the JPEG step (owner review, Nov 7, 2026: posts now
// carry the business's own photos). Kept apart from render-social-posts.mjs so it can be tested without the renderer.
//   spec.assets.logo                the logo as a data URI, for __LOGO_DATA_URI__
//   spec.photos [{ placeholder, url | data }]  each photo's signed link (or, in local runs, its data URI)
//   file.format "jpg"               photo graphics are saved as JPEG: as PNG a month of them would pass 40 MB

async function resolvePhotos(spec, fetcher = fetch) {
  const map = new Map();
  for (const p of spec.photos || []) {
    if (p.data) { map.set(p.placeholder, p.data); continue; }
    const response = await fetcher(p.url);
    if (!response.ok) throw new Error(`A photo could not be downloaded: HTTP ${response.status}`);
    const type = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!/^image\/(jpeg|png)$/.test(type)) throw new Error(`A photo has an unexpected type (${type})`);
    map.set(p.placeholder, `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`);
  }
  return map;
}

function fillAssets(svg, logo, photos) {
  let out = logo ? svg.replaceAll("__LOGO_DATA_URI__", logo) : svg;
  for (const [placeholder, data] of photos || []) out = out.replaceAll(placeholder, data);
  return out;
}

async function toJpeg(png, quality = 86) {
  let sharp;
  try { sharp = (await import("sharp")).default; } catch { throw new Error("The JPEG encoder (sharp) is not installed"); }
  return new Uint8Array(await sharp(Buffer.from(png)).flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer());
}

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + length;
  }
  return null;
}

export { fillAssets, jpegSize, resolvePhotos, toJpeg };
