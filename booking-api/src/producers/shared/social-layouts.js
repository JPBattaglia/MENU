// Social post layouts, shared by Social Posts (monthly) and Nino's Social Graphics Pack (owner review, Nov 7, 2026:
// every graphic was the same text-on-a-colour tile, with no photos). Six layouts: three around one of the business's
// own photos and three type-only ones, in the brand's colours. pickLayouts() spreads them over a month so neighbouring
// posts never look alike.
//
// Photos are never put on a post that names a dish: nothing says which dish a library photo shows, and a pizza post
// over a photo of pasta would mislead. They go on the story, seasonal, tip and welcome posts.
//
// Images are placeholders (__LOGO_DATA_URI__, __PHOTO_n__) filled in by the renderer, so a month of posts doesn't carry
// the same photo bytes 24 times.
const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const BODY = "'Liberation Sans', Arial, sans-serif";
const SIZES = { square: [1080, 1080], story: [1080, 1920] };
const PHOTO_LAYOUTS = ["photo-full", "photo-band", "photo-frame"];
const TEXT_LAYOUTS = ["bold", "light", "accent"];

const lum = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const inkOn = (bg) => (contrast(bg, "#111111") >= contrast(bg, "#ffffff") ? "#111111" : "#ffffff");

function wrapLines(text, { fontSize, maxWidth, em }) {
  const perLine = Math.max(3, Math.floor(maxWidth / (fontSize * em)));
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (word.length > perLine) return null;
    if (!line) line = word;
    else if (`${line} ${word}`.length <= perLine) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function fit(text, { maxWidth, maxHeight, start, min, em, lineHeight = 1.12 }) {
  for (let size = start; size >= min; size -= 2) {
    const lines = wrapLines(text, { fontSize: size, maxWidth, em });
    if (lines && lines.length && lines.length * size * lineHeight <= maxHeight) return { lines, size, height: lines.length * size * lineHeight };
  }
  return null;
}

const lines = (ls, { x, y, size, lineHeight = 1.12, anchor = "middle", fill, family, weight = 400, extra = "" }) =>
  ls.map((l, i) => `<text x="${x}" y="${Math.round(y + (i + 1) * size * lineHeight - size * (lineHeight - 1))}" font-size="${size}" font-family="${family}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}"${extra}>${esc(l)}</text>`).join("");

// Palette for the layouts from two brand colours: a dark one, a light one, the accent and the ink on the accent.
function layoutPalette({ dark, light, accent }) {
  const d = lum(dark) < 0.25 ? dark : "#1d1d1b";
  const l = lum(light) > 0.6 ? light : "#faf7f2";
  const a = accent || "#c9a227";
  return { dark: d, light: l, accent: a, accentInk: inkOn(a), onDark: inkOn(d), onLight: inkOn(l), accentOnLight: contrast(a, l) >= 3 ? a : inkOn(l) };
}

// Which layout each post gets. posts: [{ featured: bool }]; photos: how many photos there are.
function pickLayouts(posts, photos, offset = 0) {
  let p = offset, t = offset, last = "";
  return posts.map((post, i) => {
    const usePhoto = photos > 0 && !post.featured && (i % 2 === 0 || posts.length - i <= 2);
    let layout = usePhoto ? PHOTO_LAYOUTS[p++ % PHOTO_LAYOUTS.length] : TEXT_LAYOUTS[t++ % TEXT_LAYOUTS.length];
    if (layout === last) layout = usePhoto ? PHOTO_LAYOUTS[p++ % PHOTO_LAYOUTS.length] : TEXT_LAYOUTS[t++ % TEXT_LAYOUTS.length];
    last = layout;
    return { layout, photo: usePhoto ? `__PHOTO_${(i % photos) + 1}__` : null };
  });
}

// One post. post: { headline, subline?, featured?: { name, price } }. Returns { svg, width, height } or { error }.
function socialLayout(post, { layout, size, businessName, palette, head = { family: BODY, weight: 700, em: 0.58 }, logo = false, photo = null, uid = "a" }) {
  // uid keeps gradient and clip ids unique when several posts sit inline on one page (the review calendar).
  const [W, H] = SIZES[size];
  const story = size === "story";
  const hf = `'${String(head.family).replace(/'/g, "")}', 'Liberation Sans', Arial, sans-serif`;
  const p = palette;
  const parts = [];
  const featuredText = post.featured?.name ? `${post.featured.name}${post.featured.price ? ` · ${post.featured.price}` : ""}` : "";
  const headline = String(post.headline || "").trim();
  const sub = String(post.subline || "").trim();
  const name = String(businessName || "").trim();
  const fail = () => ({ error: `The headline "${headline.slice(0, 40)}" does not fit the ${size} graphic` });
  const pill = (y, bg, ink, x = W / 2, anchor = "middle") => {
    if (!featuredText) return 0;
    const ff = fit(featuredText, { maxWidth: W - 300, maxHeight: 60, start: 44, min: 28, em: 0.56 });
    if (!ff) return 0;
    const w = Math.min(W - 180, Math.round(ff.lines[0].length * ff.size * 0.56 + 110));
    const left = anchor === "middle" ? Math.round(x - w / 2) : x;
    parts.push(`<rect x="${left}" y="${y}" width="${w}" height="${ff.size + 46}" rx="${(ff.size + 46) / 2}" fill="${bg}"/>`);
    parts.push(lines(ff.lines, { x: anchor === "middle" ? x : left + w / 2, y: y + 23, size: ff.size, fill: ink, family: BODY, weight: 700 }));
    return ff.size + 46;
  };
  const logoAt = (x, y, w, h, plate) => {
    if (!logo) return;
    if (plate) parts.push(`<rect x="${x - 14}" y="${y - 10}" width="${w + 28}" height="${h + 20}" rx="18" fill="#ffffff" fill-opacity="0.92"/>`);
    parts.push(`<image href="__LOGO_DATA_URI__" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`);
  };
  const photoImg = (x, y, w, h, clip = "") => parts.push(`<image href="${photo}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"${clip}/>`);

  if (PHOTO_LAYOUTS.includes(layout) && !photo) return { error: `Layout ${layout} needs a photo` };

  if (layout === "photo-full") {
    photoImg(0, 0, W, H);
    parts.push(`<defs><linearGradient id="shade-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#shade-${uid})"/>`);
    const m = 80;
    const hb = fit(headline, { maxWidth: W - m * 2, maxHeight: story ? 600 : 330, start: story ? 120 : 96, min: 48, em: head.em });
    if (!hb) return fail();
    const subFit = sub ? fit(sub, { maxWidth: W - m * 2, maxHeight: 110, start: 42, min: 28, em: 0.52 }) : null;
    const nameH = 46;
    let y = H - m - nameH - (subFit ? subFit.height + 20 : 0) - hb.height - 30;
    parts.push(`<rect x="${m}" y="${y - 34}" width="90" height="8" fill="${p.accent}"/>`);
    parts.push(lines(hb.lines, { x: m, y, size: hb.size, fill: "#ffffff", family: hf, weight: head.weight, anchor: "start" }));
    y += hb.height + 20;
    if (subFit) { parts.push(lines(subFit.lines, { x: m, y, size: subFit.size, fill: "#ffffff", family: BODY, anchor: "start", extra: ' opacity="0.92"' })); y += subFit.height + 10; }
    parts.push(lines([name], { x: m, y: H - m - nameH, size: 36, fill: "#ffffff", family: BODY, weight: 700, anchor: "start", extra: ' letter-spacing="2" opacity="0.9"' }));
    logoAt(W - m - 170, m, 170, 110, true);
  } else if (layout === "photo-band") {
    const ph = Math.round(H * (story ? 0.58 : 0.56));
    photoImg(0, 0, W, ph);
    parts.push(`<rect x="0" y="${ph}" width="${W}" height="${H - ph}" fill="${p.dark}"/><rect x="0" y="${ph}" width="${W}" height="12" fill="${p.accent}"/>`);
    const m = 80;
    const room = H - ph - 12 - 70 - 60 - (featuredText ? 100 : 0);
    const hb = fit(headline, { maxWidth: W - m * 2, maxHeight: room, start: story ? 110 : 84, min: 44, em: head.em });
    if (!hb) return fail();
    let y = ph + 12 + Math.round((room - hb.height) / 2) + 30;
    parts.push(lines(hb.lines, { x: W / 2, y, size: hb.size, fill: p.onDark, family: hf, weight: head.weight }));
    y += hb.height + 26;
    pill(y, p.accent, p.accentInk);
    parts.push(lines([name], { x: W / 2, y: H - 70 - 40, size: 34, fill: p.onDark, family: BODY, weight: 700, extra: ' letter-spacing="2" opacity="0.85"' }));
    logoAt(m - 6, m - 10, 150, 96, true);
  } else if (layout === "photo-frame") {
    parts.push(`<rect width="${W}" height="${H}" fill="${p.light}"/>`);
    const m = 70;
    const ph = Math.round((H - m * 2) * (story ? 0.6 : 0.58));
    parts.push(`<defs><clipPath id="frame-${uid}"><rect x="${m}" y="${m}" width="${W - m * 2}" height="${ph}" rx="36"/></clipPath></defs>`);
    photoImg(m, m, W - m * 2, ph, ` clip-path="url(#frame-${uid})"`);
    const top = m + ph + 40;
    const room = H - top - 120;
    const hb = fit(headline, { maxWidth: W - m * 2 - 40, maxHeight: room, start: story ? 104 : 76, min: 40, em: head.em });
    if (!hb) return fail();
    parts.push(lines(hb.lines, { x: W / 2, y: top + Math.max(0, Math.round((room - hb.height) / 2) - 10), size: hb.size, fill: p.accentOnLight, family: hf, weight: head.weight }));
    parts.push(`<rect x="${W / 2 - 50}" y="${H - 108}" width="100" height="6" fill="${p.accent}"/>`);
    parts.push(lines([name], { x: W / 2, y: H - 90, size: 32, fill: p.onLight, family: BODY, weight: 700, extra: ' letter-spacing="2"' }));
    logoAt(m + 24, m + 24, 140, 90, true);
  } else {
    // Type-only layouts.
    const bg = layout === "light" ? p.light : layout === "accent" ? p.accent : p.dark;
    const ink = layout === "light" ? p.accentOnLight : layout === "accent" ? p.accentInk : p.onDark;
    const body = layout === "light" ? p.onLight : ink;
    parts.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
    if (layout === "bold") parts.push(`<rect x="0" y="0" width="${W}" height="22" fill="${p.accent}"/><rect x="0" y="${H - 22}" width="${W}" height="22" fill="${p.accent}"/>`);
    if (layout === "accent") parts.push(`<rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${p.accentInk}" stroke-opacity="0.5" stroke-width="4"/>`);
    if (layout === "light") parts.push(`<rect x="0" y="0" width="22" height="${H}" fill="${p.accent}"/>`);
    const m = 110;
    const logoH = logo ? 120 : 0;
    const top = (story ? 330 : 140) + (logo ? logoH + 30 : 0);
    const bottomReserve = 150 + (featuredText ? 110 : 0) + (sub ? 120 : 0);
    const hb = fit(headline, { maxWidth: W - m * 2, maxHeight: H - top - bottomReserve, start: story ? 140 : 112, min: 48, em: head.em });
    if (!hb) return fail();
    const block = hb.height + (sub ? 120 : 0) + (featuredText ? 110 : 0);
    let y = Math.max(top, Math.round((H - block) / 2) - (story ? 40 : 10));
    logoAt(W / 2 - 90, y - logoH - 40, 180, logoH, layout !== "light" && lum(bg) < 0.4);
    parts.push(lines(hb.lines, { x: W / 2, y, size: hb.size, fill: ink, family: hf, weight: head.weight }));
    y += hb.height + 30;
    if (sub) {
      const sf = fit(sub, { maxWidth: W - m * 2, maxHeight: 100, start: 44, min: 28, em: 0.52 });
      if (sf) { parts.push(lines(sf.lines, { x: W / 2, y, size: sf.size, fill: body, family: BODY })); y += sf.height + 30; }
    }
    pill(y + 10, layout === "accent" ? p.dark : p.accent, layout === "accent" ? p.onDark : p.accentInk);
    parts.push(lines([name], { x: W / 2, y: H - 120, size: 38, fill: body, family: BODY, weight: 700, extra: ' letter-spacing="2" opacity="0.9"' }));
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`, width: W, height: H };
}

export { PHOTO_LAYOUTS, SIZES, TEXT_LAYOUTS, layoutPalette, pickLayouts, socialLayout };
