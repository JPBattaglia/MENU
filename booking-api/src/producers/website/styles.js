// The Website Package template styles (stage 7). Colours are derived from the buyer's brand colour, and text
// colours are always chosen for contrast, so a bad brand colour can never produce unreadable text.
const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(String(v ?? "").trim());
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const readableOn = (bg) => (contrast("#111111", bg) >= contrast("#ffffff", bg) ? "#111111" : "#ffffff");
// A colour usable as text/links on `bg`: the brand colour if readable, otherwise the plain text colour.
const textOn = (colour, bg, fallback) => (contrast(colour, bg) >= 4.5 ? colour : fallback);

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
// blurb is shown on the intake form; card is the panel colour (contact card, etc.).
const STYLES = {
  classic: { label: "Classic", blurb: "warm, serif type, traditional", bg: "#faf6ef", card: "#ffffff", ink: "#2a2420", muted: "#5a5049", defaultBrand: "#7a2e2e", font: SERIF, heading: SERIF, align: "center", radius: "2px", upper: false },
  modern: { label: "Modern", blurb: "clean, light, simple", bg: "#ffffff", card: "#f5f6f8", ink: "#16181d", muted: "#4b5160", defaultBrand: "#0f766e", font: SANS, heading: SANS, align: "left", radius: "12px", upper: false },
  bold: { label: "Bold", blurb: "dark, big type, high energy", bg: "#121212", card: "#1d1d1d", ink: "#f5f5f5", muted: "#c9c9c9", defaultBrand: "#f5b700", font: SANS, heading: "Impact, 'Arial Black', system-ui, sans-serif", align: "left", radius: "0", upper: true },
  rustic: { label: "Rustic", blurb: "earthy, cosy, hand-made feel", bg: "#f3ead8", card: "#fbf6ea", ink: "#33261a", muted: "#5c4a3a", defaultBrand: "#8a4b1f", font: SERIF, heading: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", align: "left", radius: "6px", upper: false },
  elegant: { label: "Elegant", blurb: "refined, spaced capitals, fine dining", bg: "#fbfaf8", card: "#ffffff", ink: "#1c1c1c", muted: "#555555", defaultBrand: "#6b5420", font: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", heading: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", align: "center", radius: "0", upper: true },
  fresh: { label: "Fresh", blurb: "light green, healthy, friendly", bg: "#f3fbf3", card: "#ffffff", ink: "#14301a", muted: "#3f5a45", defaultBrand: "#2e7d32", font: SANS, heading: SANS, align: "left", radius: "16px", upper: false },
  playful: { label: "Playful", blurb: "bright, rounded, fun - great for cafes and kids", bg: "#fff8e7", card: "#ffffff", ink: "#2b2140", muted: "#5a4d73", defaultBrand: "#c2185b", font: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif", heading: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif", align: "center", radius: "24px", upper: false },
  midnight: { label: "Midnight", blurb: "dark navy, modern, bars and late-night", bg: "#0f1b2d", card: "#17263d", ink: "#eef2f8", muted: "#b8c4d6", defaultBrand: "#4fc3f7", font: SANS, heading: SANS, align: "left", radius: "8px", upper: false },
  minimal: { label: "Minimal", blurb: "black and white, lots of space", bg: "#ffffff", card: "#f4f4f4", ink: "#000000", muted: "#555555", defaultBrand: "#111111", font: "Helvetica, Arial, sans-serif", heading: "Helvetica, Arial, sans-serif", align: "left", radius: "0", upper: false }
};

function paletteFor(styleKey, brandInput) {
  const style = STYLES[styleKey] || STYLES.modern;
  const brand = hexOk(brandInput) ? brandInput.trim().toLowerCase() : style.defaultBrand;
  return { style, brand, onBrand: readableOn(brand), link: textOn(brand, style.bg, style.ink) };
}

function css(styleKey, brandInput) {
  const { style: s, brand, onBrand, link } = paletteFor(styleKey, brandInput);
  return `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}img{max-width:100%}body{overflow-wrap:anywhere;margin:0;background:${s.bg};color:${s.ink};font:18px/1.65 ${s.font}}
a{color:${link};text-underline-offset:3px}a:focus-visible,button:focus-visible{outline:3px solid ${link};outline-offset:2px}
.skip{position:absolute;left:-999px;top:0;background:${brand};color:${onBrand};padding:10px 14px;z-index:10}.skip:focus{left:8px;top:8px}
header.site{padding:18px 20px;border-bottom:1px solid ${s.muted}33}header.site .in{max-width:980px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.brand{font:700 22px/1.2 ${s.heading};${s.upper ? "text-transform:uppercase;letter-spacing:.04em;" : ""}color:${s.ink};text-decoration:none;display:flex;align-items:center;gap:10px;min-width:0}.brand img{height:44px;width:auto}
nav ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px}nav a{color:${s.ink};text-decoration:none;padding:6px 2px;border-bottom:2px solid transparent}nav a[aria-current=page]{border-bottom-color:${brand}}nav a:hover{border-bottom-color:${brand}}
main{max-width:980px;margin:0 auto;padding:36px 20px 64px;text-align:${s.align}}h1,h2,h3{font-family:${s.heading};line-height:1.2;${s.upper ? "text-transform:uppercase;letter-spacing:.03em;" : ""}}h1{font-size:clamp(34px,6vw,58px);margin:.2em 0 .3em}h2{font-size:clamp(24px,4vw,34px);margin:1.6em 0 .5em}
.lead{font-size:clamp(19px,2.6vw,23px);color:${s.muted};max-width:46ch;${s.align === "center" ? "margin:0 auto 1.4em" : "margin:0 0 1.4em"}}
.btn{display:inline-block;background:${brand};color:${onBrand};padding:14px 24px;border-radius:${s.radius};text-decoration:none;font-weight:700;margin:6px 8px 6px 0}.btn:hover{filter:brightness(1.08)}
.hero img.hero-img{width:100%;max-height:420px;object-fit:cover;border-radius:${s.radius};margin:0 0 24px}
.text{text-align:left;max-width:68ch;${s.align === "center" ? "margin:0 auto" : ""}}
.menu-section{text-align:left;max-width:720px;${s.align === "center" ? "margin:0 auto" : ""}}.menu-section ul{list-style:none;padding:0;margin:0}.menu-section li{padding:14px 0;border-bottom:1px solid ${s.muted}44;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 16px}.menu-section .n{font-weight:700}.menu-section .p{font-weight:700;color:${s.ink}}.menu-section .d{grid-column:1/2;color:${s.muted};font-size:16px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin:0;padding:0;list-style:none}.gallery img{width:100%;height:230px;object-fit:cover;border-radius:${s.radius}}
dl.hours{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 22px;text-align:left;max-width:420px;${s.align === "center" ? "margin:0 auto" : ""}}dl.hours dt{font-weight:700}dl.hours dd{margin:0}
.card{background:${s.card};border:1px solid ${s.muted}33;border-radius:${s.radius};padding:22px;text-align:left;max-width:100%;width:560px;${s.align === "center" ? "margin:0 auto" : ""}}
footer.site{border-top:1px solid ${s.muted}33;padding:28px 20px;text-align:center;color:${s.muted};font-size:15px}
.vh{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
details.narrow{display:none}details.narrow summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:center;width:46px;height:46px;border:1px solid ${s.muted}55;border-radius:${s.radius};color:${s.ink}}details.narrow summary::-webkit-details-marker{display:none}details.narrow[open] summary{background:${s.muted}1a}
@media (max-width:720px){nav.wide{display:none}details.narrow{display:block}header.site{position:relative}header.site .in{flex-wrap:nowrap;justify-content:space-between}details.narrow{flex:none}details.narrow nav{position:absolute;left:0;right:0;top:100%;z-index:5;background:${s.bg};padding:0 20px 8px;border-bottom:1px solid ${s.muted}33;box-shadow:0 10px 18px rgba(0,0,0,.08)}details.narrow nav ul{flex-direction:column;gap:0}details.narrow nav a{display:block;padding:14px 4px;border-bottom:1px solid ${s.muted}33}details.narrow nav a[aria-current=page]{border-bottom-color:${s.muted}33;color:${link};font-weight:700}}
@media (max-width:560px){body{font-size:17px}}`;
}

export { STYLES, contrast, css, hexOk, paletteFor, readableOn };
