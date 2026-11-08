import { bytesToBase64, escapeHtml2 } from "../../lib/util.js";
import { luminance, mix, styleCss, styleMeta, toStyle } from "./style.js";

var NAMED_MENU_COLORS = {
  tan: "#b8956a", red: "#a8322d", green: "#2f6b45", navy: "#1f2a44", gold: "#b8902b", black: "#1b1b1b",
  blue: "#1d4e89", orange: "#c8642b", yellow: "#c9a227", purple: "#5b3a8c", brown: "#6b4226", maroon: "#7a1f2b",
  burgundy: "#6d1a36", teal: "#0f766e", pink: "#c25b7f", gray: "#4b5563", grey: "#4b5563", cream: "#f3ead8",
  olive: "#5f6b2a", charcoal: "#2b2b2b", white: "#ffffff", silver: "#9aa0a6", copper: "#b06a3b", sage: "#7d9a7e"
};

function parseBrandColors(text) {
  const found = [];
  const raw = String(text || "").toLowerCase();
  const pattern = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|[a-z]+/g;
  let match;
  while ((match = pattern.exec(raw)) && found.length < 3) {
    let value = match[0];
    if (value.startsWith("#")) {
      if (value.length === 4) value = "#" + value.slice(1).split("").map((c) => c + c).join("");
      found.push(value);
    } else if (NAMED_MENU_COLORS[value]) {
      found.push(NAMED_MENU_COLORS[value]);
    }
  }
  return found;
}

function colorLuminance(hex) {
  const channel = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// Darkens a color until white text on it reaches WCAG AA contrast (4.5:1).
function readableOnWhiteText(hex) {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < 20 && 1.05 / (colorLuminance(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`) + 0.05) < 4.5; i++) {
    [r, g, b] = [r, g, b].map((v) => Math.round(v * 0.88));
  }
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

async function loadLogoDataUri(asset, env) {
  if (!asset?.storage_key || !env.ASSETS) return null;
  const mime = String(asset.mime_type || "").toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(mime)) return null;
  if (Number(asset.size_bytes || 0) > 1572864) return null;
  const object = await env.ASSETS.get(asset.storage_key);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength > 1572864) return null;
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

// subtitle: the line under the name ("Menu" unless the buyer changed it with Customize in the menu generator).
// highlight: one colour for the design's highlights only (dividers, nav, numbers, borders), leaving its header and
// headings as designed (owner, Nov 7, 2026: a chosen colour on the headings made every design look the same).
// ---------- Logo legibility (owner, Nov 7, 2026: "in some menus the logo doesn't show very well") ----------
// The menu generator measures an uploaded logo in the buyer's browser (public-preview.js) and sends
// "t=<has see-through parts 0|1>;l=<average luminance 0-1>;c=<ink coverage of its outline box 0-1>;b=<solid box 0|1>".
// Per design, the logo then gets one treatment against the header behind it:
//   none   it already stands out (contrast >= 4.5)
//   halo   a soft glow following the logo's own shape (contrast 3 to 4.5), light behind a dark logo, dark behind a light one
//   badge  a rounded plate in a tone of the design (contrast under 3, or a fine-lined logo)
//   boxed  a logo with its own solid background: rounded corners, a highlight-colour border
// mode (Customize "Logo background"): auto | none | light | dark | accent. Unmeasured logos: JPEG = boxed, else halo.
// The measurement and mode stay in the page (data-logo) so Menu Care updates keep the same treatment.
const LOGO_MODES = ["auto", "none", "light", "dark", "accent"];

function parseLogoInfo(text) {
  const raw = Object.fromEntries(String(text || "").split(";").map((part) => part.split("=")).filter((kv) => kv.length === 2));
  const num = (v, lo, hi) => (Number.isFinite(Number(v)) && String(v).trim() !== "" ? Math.min(hi, Math.max(lo, Number(v))) : null);
  const info = { t: num(raw.t, 0, 1), l: num(raw.l, 0, 1), c: num(raw.c, 0, 1), b: num(raw.b, 0, 1) };
  return info.l === null && info.b === null ? null : info;
}
const logoInfoText = (info) => (info ? ["t", "l", "c", "b"].filter((k) => info[k] !== null && info[k] !== undefined).map((k) => `${k}=${info[k]}`).join(";") : "");

function logoTreatment({ info, mode, isJpeg, headerBg, theme, accent }) {
  const bgDark = luminance(headerBg) < 0.25;
  const paper = theme ? theme.paper : "#fbf8f3";
  const ink = theme ? theme.text : "#1d1d1b";
  const light = mix(luminance(paper) > 0.4 ? paper : ink, "#ffffff", 0.45);
  const dark = mix(luminance(paper) > 0.4 ? ink : paper, "#000000", 0.2);
  const pick = LOGO_MODES.includes(mode) ? mode : "auto";
  if (pick === "none") return { kind: "none" };
  if (pick === "light") return { kind: "badge", plate: light };
  if (pick === "dark") return { kind: "badge", plate: dark };
  if (pick === "accent") return { kind: "badge", plate: accent };
  if (!info) return isJpeg ? { kind: "boxed" } : { kind: "halo", glow: bgDark ? "#ffffff" : "#000000" };
  if (info.b === 1) return { kind: "boxed" };
  const l = info.l ?? 0.5;
  const bgL = luminance(headerBg);
  const ratio = (Math.max(l, bgL) + 0.05) / (Math.min(l, bgL) + 0.05);
  if (ratio >= 4.5) return { kind: "none" };
  if ((info.c !== null && info.c < 0.35) || ratio < 3) {
    const plate = l < 0.4 ? light : dark;
    // A plate the same tone as the header (a mid-tone logo on a light header) wouldn't help: leave the logo as is.
    const pl = luminance(plate);
    return (Math.max(pl, bgL) + 0.05) / (Math.min(pl, bgL) + 0.05) < 1.4 ? { kind: "none" } : { kind: "badge", plate };
  }
  return { kind: "halo", glow: l < 0.4 ? "#ffffff" : "#000000" };
}

function logoImgHtml({ logoDataUri, alt, logo, theme, primary, accent }) {
  if (!logoDataUri) return "";
  const banded = theme ? ["band", "arch", "hero", "ticket"].includes(theme.header) : true;
  const headerBg = theme ? (banded ? theme.heading : theme.paper) : primary;
  const t = logoTreatment({ info: logo?.info || null, mode: logo?.mode, isJpeg: /^data:image\/jpe?g/i.test(logoDataUri), headerBg, theme, accent });
  const vars = t.kind === "badge" ? ` style="--plate: ${t.plate}"` : t.kind === "halo" ? ` style="--glow: ${t.glow}"` : "";
  const data = [logoInfoText(logo?.info), `m=${LOGO_MODES.includes(logo?.mode) ? logo.mode : "auto"}`].filter(Boolean).join(";");
  return `<img src="${escapeHtml2(logoDataUri)}" alt="${alt} logo" class="logo-${t.kind}"${vars} data-logo="${escapeHtml2(data)}">`;
}

// logo: { info, mode } for the logo's legibility treatment (see logoTreatment above).
// hideName: the logo already spells the name (owner, Nov 7, 2026), so the name is kept for screen readers, search and
// Menu Care but not shown. Only with a logo.
function buildDesignedMenuHtml({ businessName, brandColors, menu, logoDataUri, style, subtitle, highlight, logo, hideName }) {
  // The look of the customer's own menu, when the reader saw one (style.js); otherwise the standard page.
  let theme = toStyle(style ?? menu?.style);
  const esc = escapeHtml2;
  const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  // Pale colours (paper, cream, white) can't carry white text or headings, so they're left out.
  const colors = parseBrandColors(brandColors).filter((c) => colorLuminance(c) < 0.6);
  // Colours named for the order (or read from the menu) lead the theme's headings and accents.
  if (theme && colors.length) theme = toStyle({ ...theme, heading: colors[0], accent: colors[1] || colors[0] });
  const mark = parseBrandColors(highlight)[0];
  if (theme && mark) theme = toStyle({ ...theme, accent: mark });
  const primary = theme ? theme.heading : readableOnWhiteText(colors[0] || "#1f2a2e");
  const accent = theme ? theme.accent : colors[1] ? readableOnWhiteText(colors[1]) : primary;
  const sections = (menu.sections || []).slice(0, 60).map((section, index) => ({
    id: `s${index + 1}`,
    name: clean(section.name, 120) || "Menu",
    items: (section.items || []).slice(0, 200).map((item) => ({
      name: clean(item?.name, 200),
      description: clean(item?.description, 600),
      price: clean(item?.price, 40)
    })).filter((item) => item.name)
  })).filter((section) => section.items.length);
  const notes = clean(menu.notes, 1000);
  const name = esc(businessName || "Menu");
  const line = esc(clean(subtitle, 60) || "Menu");
  const nav = sections.length > 1
    ? `<nav class="jump" aria-label="Menu sections">${sections.map((s) => `<a href="#${s.id}">${esc(s.name)}</a>`).join("")}</nav>`
    : "";
  const body = sections.map((section) => `
    <section class="menu-section" id="${section.id}" aria-labelledby="${section.id}-h">
      <h2 id="${section.id}-h">${esc(section.name)}</h2>
      <ul>${section.items.map((item) => `
        <li>
          <div class="row"><span class="item">${esc(item.name)}</span>${item.price ? `<span class="leader" aria-hidden="true"></span><span class="price">${esc(item.price)}</span>` : ""}</div>
          ${item.description ? `<p class="desc">${esc(item.description)}</p>` : ""}
        </li>`).join("")}
      </ul>
    </section>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — Menu</title>
<meta name="description" content="${name} menu">
${styleMeta(theme)}
<style>
  :root { --primary: ${primary}; --accent: ${accent}; --ink: #1d1d1b; --muted: #5d5a55; --paper: #fbf8f3; --rule: #e6dfd3; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { background: var(--primary); color: #fff; text-align: center; padding: 36px 20px 30px; }
  header img { display: block; max-height: 84px; max-width: 70%; margin: 0 auto 14px; object-fit: contain; }
  h1.name-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; padding: 0; }
  header:has(h1.name-hidden) img { max-height: 120px; }
  header img.logo-halo { filter: drop-shadow(0 0 1px var(--glow)) drop-shadow(0 0 1px var(--glow)) drop-shadow(0 0 7px color-mix(in srgb, var(--glow) 70%, transparent)); }
  header img.logo-badge { box-sizing: content-box; padding: 12px 18px; border-radius: 16px; background: var(--plate); box-shadow: 0 3px 12px rgba(0,0,0,.18); }
  header img.logo-boxed { border-radius: 10px; border: 2px solid var(--accent); box-shadow: 0 3px 12px rgba(0,0,0,.18); }
  h1 { margin: 0; font: 600 clamp(28px, 7vw, 44px)/1.1 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; letter-spacing: .5px; }
  header p { margin: 8px 0 0; font-size: 13px; letter-spacing: 3px; text-transform: uppercase; opacity: .85; }
  .jump { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; overflow-x: auto; padding: 10px 16px; background: rgba(251, 248, 243, .96); border-bottom: 1px solid var(--rule); scrollbar-width: none; }
  .jump::-webkit-scrollbar { display: none; }
  .jump a:first-child { margin-left: auto; } .jump a:last-child { margin-right: auto; }
  .jump a { flex: none; padding: 7px 14px; border: 1px solid var(--rule); border-radius: 999px; color: var(--primary); background: #fff; font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap; }
  main { max-width: 720px; margin: 0 auto; padding: 8px 20px 48px; }
  .menu-section { scroll-margin-top: 64px; padding-top: 28px; }
  h2 { margin: 0 0 14px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); color: var(--primary); font: 600 22px/1.2 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; letter-spacing: 1px; text-transform: uppercase; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { padding: 12px 0; border-bottom: 1px solid var(--rule); }
  li:last-child { border-bottom: 0; }
  .row { display: flex; align-items: baseline; gap: 8px; }
  .item { font-weight: 650; }
  .leader { flex: 1; border-bottom: 1px dotted #b9b2a6; transform: translateY(-4px); min-width: 16px; }
  .price { font-weight: 650; color: var(--primary); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .desc { margin: 4px 0 0; color: var(--muted); font-size: 15px; }
  .notes { margin-top: 32px; padding: 16px; border-radius: 10px; background: #fff; border: 1px solid var(--rule); color: var(--muted); font-size: 14px; }
  footer { padding: 24px 20px 36px; text-align: center; color: var(--muted); font-size: 12px; }
  footer a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }${styleCss(theme)}
</style>
</head>
<body>
  <header>
    ${logoImgHtml({ logoDataUri, alt: name, logo, theme, primary, accent: theme ? theme.accent : accent })}
    <h1${hideName && logoDataUri ? ' class="name-hidden"' : ""}>${name}</h1>
    <p>${line}</p>
  </header>
  ${nav}
  <main>
    <section class="menu-content" aria-label="${name} menu">${body}
    </section>
    ${notes ? `<p class="notes">${esc(notes)}</p>` : ""}
  </main>
  <footer>Menu by <a href="https://menu-made.com/">MENU-MADE</a></footer>
</body>
</html>`;
}

// Every item name and price the reader produced must appear on the rendered page.
function assertMenuRendered(html, menu) {
  for (const section of menu.sections || []) {
    for (const item of section.items || []) {
      for (const value of [item?.name, item?.price]) {
        const text = String(value ?? "").replace(/\s+/g, " ").trim();
        if (text && !html.includes(escapeHtml2(text.slice(0, 200)))) {
          throw new Error(`Menu check failed: "${text.slice(0, 60)}" is missing from the page`);
        }
      }
    }
  }
}

function buildMenuDraftHtml({
  businessName,
  brandColors,
  sourceUrl,
  menuText
}) {
  const safeBusiness = escapeHtml2(
    businessName
  );
  const safeColors = escapeHtml2(
    brandColors || ""
  );
  const safeSource = escapeHtml2(
    sourceUrl
  );
  const safeMenu = escapeHtml2(
    menuText
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeBusiness} Menu</title>
  <style>
    :root {
      color-scheme: light;
      font-family:
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #f7f7f5;
      color: #171717;
      line-height: 1.6;
    }

    main {
      width: min(900px, calc(100% - 32px));
      margin: 0 auto;
      padding: 48px 0 72px;
    }

    header {
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid #d8d8d4;
    }

    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 6vw, 4rem);
      line-height: 1;
    }

    .brand-colors {
      margin: 0;
      color: #666;
    }

    .menu-content {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 1rem;
    }

    footer {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid #d8d8d4;
      font-size: 0.8rem;
      color: #666;
    }

    footer a {
      color: inherit;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${safeBusiness}</h1>
      <p>Menu</p>
      ${safeColors ? `<p class="brand-colors">Brand colors supplied: ${safeColors}</p>` : ""}
    </header>

    <section
      class="menu-content"
      aria-label="${safeBusiness} menu"
    >${safeMenu}</section>

    ${safeSource ? `<footer>
      <p>
        Draft generated from
        <a href="${safeSource}">
          supplied menu source
        </a>.
      </p>
    </footer>` : ""}
  </main>
</body>
</html>`;
}

export { parseLogoInfo, logoTreatment, LOGO_MODES,
  NAMED_MENU_COLORS,
  parseBrandColors,
  colorLuminance,
  readableOnWhiteText,
  loadLogoDataUri,
  buildDesignedMenuHtml,
  assertMenuRendered,
  buildMenuDraftHtml
};
