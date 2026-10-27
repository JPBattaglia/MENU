// The three Website Package template styles (stage 7). Colours are derived from the buyer's brand colour, and text
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

const STYLES = {
  classic: { label: "Classic", bg: "#faf6ef", ink: "#2a2420", muted: "#5a5049", defaultBrand: "#7a2e2e", font: "Georgia, 'Times New Roman', serif", heading: "Georgia, 'Times New Roman', serif", align: "center", radius: "2px", upper: false },
  modern: { label: "Modern", bg: "#ffffff", ink: "#16181d", muted: "#4b5160", defaultBrand: "#0f766e", font: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", heading: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", align: "left", radius: "12px", upper: false },
  bold: { label: "Bold", bg: "#121212", ink: "#f5f5f5", muted: "#c9c9c9", defaultBrand: "#f5b700", font: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", heading: "Impact, 'Arial Black', system-ui, sans-serif", align: "left", radius: "0", upper: true }
};

function paletteFor(styleKey, brandInput) {
  const style = STYLES[styleKey] || STYLES.modern;
  const brand = hexOk(brandInput) ? brandInput.trim().toLowerCase() : style.defaultBrand;
  return { style, brand, onBrand: readableOn(brand), link: textOn(brand, style.bg, style.ink) };
}

function css(styleKey, brandInput) {
  const { style: s, brand, onBrand, link } = paletteFor(styleKey, brandInput);
  return `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:${s.bg};color:${s.ink};font:18px/1.65 ${s.font}}
a{color:${link};text-underline-offset:3px}a:focus-visible,button:focus-visible{outline:3px solid ${link};outline-offset:2px}
.skip{position:absolute;left:-999px;top:0;background:${brand};color:${onBrand};padding:10px 14px;z-index:10}.skip:focus{left:8px;top:8px}
header.site{padding:18px 20px;border-bottom:1px solid ${s.muted}33}header.site .in{max-width:980px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.brand{font:700 22px/1.2 ${s.heading};${s.upper ? "text-transform:uppercase;letter-spacing:.04em;" : ""}color:${s.ink};text-decoration:none;display:flex;align-items:center;gap:10px}.brand img{height:44px;width:auto}
nav ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px}nav a{color:${s.ink};text-decoration:none;padding:6px 2px;border-bottom:2px solid transparent}nav a[aria-current=page]{border-bottom-color:${brand}}nav a:hover{border-bottom-color:${brand}}
main{max-width:980px;margin:0 auto;padding:36px 20px 64px;text-align:${s.align}}h1,h2,h3{font-family:${s.heading};line-height:1.2;${s.upper ? "text-transform:uppercase;letter-spacing:.03em;" : ""}}h1{font-size:clamp(34px,6vw,58px);margin:.2em 0 .3em}h2{font-size:clamp(24px,4vw,34px);margin:1.6em 0 .5em}
.lead{font-size:clamp(19px,2.6vw,23px);color:${s.muted};max-width:46ch;${s.align === "center" ? "margin:0 auto 1.4em" : "margin:0 0 1.4em"}}
.btn{display:inline-block;background:${brand};color:${onBrand};padding:14px 24px;border-radius:${s.radius};text-decoration:none;font-weight:700;margin:6px 8px 6px 0}.btn:hover{filter:brightness(1.08)}
.hero img.hero-img{width:100%;max-height:420px;object-fit:cover;border-radius:${s.radius};margin:0 0 24px}
.text{text-align:left;max-width:68ch;${s.align === "center" ? "margin:0 auto" : ""}}
.menu-section{text-align:left;max-width:720px;${s.align === "center" ? "margin:0 auto" : ""}}.menu-section ul{list-style:none;padding:0;margin:0}.menu-section li{padding:14px 0;border-bottom:1px solid ${s.muted}44;display:grid;grid-template-columns:1fr auto;gap:2px 16px}.menu-section .n{font-weight:700}.menu-section .p{font-weight:700;color:${s.ink}}.menu-section .d{grid-column:1/2;color:${s.muted};font-size:16px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin:0;padding:0;list-style:none}.gallery img{width:100%;height:230px;object-fit:cover;border-radius:${s.radius}}
dl.hours{display:grid;grid-template-columns:auto 1fr;gap:6px 22px;text-align:left;max-width:420px;${s.align === "center" ? "margin:0 auto" : ""}}dl.hours dt{font-weight:700}dl.hours dd{margin:0}
.card{background:${s.bg === "#ffffff" ? "#f5f6f8" : s.bg === "#121212" ? "#1d1d1d" : "#fff"};border:1px solid ${s.muted}33;border-radius:${s.radius};padding:22px;text-align:left;max-width:560px;${s.align === "center" ? "margin:0 auto" : ""}}
footer.site{border-top:1px solid ${s.muted}33;padding:28px 20px;text-align:center;color:${s.muted};font-size:15px}
@media (max-width:560px){body{font-size:17px}header.site .in{justify-content:center}}`;
}

export { STYLES, contrast, css, hexOk, paletteFor, readableOn };
