// The nine site designs. Each one: its own layout and type, using the business's brand colour as the accent (text in
// the accent only where it reads at 4.5:1). Works with no photos (most generator sites have only a menu): each design
// has its own photo-free hero.
import { aboutHtml, brandOr, callBtn, contactLines, esc, hoursList, inkOn, item, logoImg, menuBtn, mix, nav, orderBtn, photo, textOn } from "./common.js";

const year = () => new Date().getUTCFullYear();
const sections = (d, fn) => d.sections.map((s, i) => fn(s, i)).join("");

// 1. Trattoria: warm and classic. Full-width banner hero, centered serif name, menu in two columns with dotted leaders.
const trattoria = {
  key: "trattoria", label: "Trattoria", blurb: "Warm and classic, serif type, menu with dotted price lines", defaultBrand: "#8c2f1b",
  fonts: "family=Playfair+Display:wght@600;800&family=Lora:wght@400;600",
  render(d, brandIn) {
    const b = brandOr(brandIn, this.defaultBrand), bg = "#fbf6ee", ink = "#2b211b", acc = textOn(b, bg, ink), on = inkOn(b);
    const css = `body{background:${bg};color:${ink};font:18px/1.7 Lora,Georgia,serif}
.top{display:flex;justify-content:center;gap:28px;padding:14px 20px;background:${ink};font:600 14px/1 Lora,serif;letter-spacing:.12em;text-transform:uppercase}.top a{color:#f3e9da;text-decoration:none}.top a:hover{text-decoration:underline}
.hero{position:relative;text-align:center;color:#fff;padding:110px 20px 120px;background:${d.photos[0] ? "#1c1410" : `radial-gradient(circle at 20% 20%,${mix(b, "#ffffff", .12)},transparent 55%),linear-gradient(160deg,${mix(b, "#000000", .15)},${mix(b, "#000000", .55)})`};overflow:hidden}
.hero img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.45}.hero .in{position:relative;max-width:820px;margin:0 auto}
.hero .logo{margin:0 auto 18px;width:84px;height:84px;object-fit:contain;background:#fff;border-radius:50%;padding:8px}
.hero h1{font:800 clamp(42px,8vw,86px)/1.05 'Playfair Display',Georgia,serif;margin:0 0 14px}.hero p{font-size:clamp(19px,2.6vw,24px);margin:0 auto 28px;max-width:34ch}
.orn{display:block;margin:0 auto 18px;width:120px;height:2px;background:currentColor;opacity:.6}
.btn{display:inline-block;margin:6px;padding:14px 26px;border:2px solid #fff;color:#fff;text-decoration:none;font-weight:600;letter-spacing:.05em}.btn.fill{background:${b};border-color:${b};color:${on}}
main{max-width:1060px;margin:0 auto;padding:0 20px}h2{font:800 clamp(32px,5vw,48px)/1.1 'Playfair Display',serif;text-align:center;margin:80px 0 8px}.sub{text-align:center;color:${acc};font-style:italic;margin:0 0 40px}
.menu-grid{columns:2 420px;column-gap:56px}.msec{break-inside:avoid;margin:0 0 36px}.msec h3{font:600 24px 'Playfair Display',serif;color:${acc};border-bottom:1px solid ${ink}33;padding-bottom:8px;margin:0 0 12px}.msec ul{padding:0;margin:0}.item{padding:9px 0}
.about{max-width:680px;margin:0 auto;text-align:center;font-size:19px}
.visit{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:28px;background:#fff;border:1px solid ${ink}22;padding:36px;margin:0 0 80px}.visit h3{font:600 22px 'Playfair Display',serif;margin:0 0 12px}.hours{display:grid;grid-template-columns:auto 1fr;gap:6px 20px}.hours .wide{grid-column:1/3}.visit a{color:${acc}}
footer{text-align:center;padding:28px;background:${ink};color:#e8dccb;font-size:15px}`;
    const body = `<nav class="top" aria-label="Main">${nav(d)}</nav>
<header class="hero" id="main" data-hero>${photo(d, 0, "bg")}<div class="in">${logoImg(d, "logo", 84)}<span class="orn"></span><h1>${esc(d.name)}</h1><p>${esc(d.tagline)}</p>${menuBtn(d, "btn fill")}${orderBtn(d, "btn")}${callBtn(d, "btn")}</div></header>
<main>${d.sections.length ? `<section id="menu"><h2>${d.menuLabel}</h2><p class="sub">${esc(d.intro)}</p><div class="menu-grid">${sections(d, (s) => `<div class="msec">${s.name ? `<h3>${esc(s.name)}</h3>` : ""}<ul>${s.items.map((i) => item(i, { leader: true })).join("")}</ul></div>`)}</div></section>` : ""}
<section id="about"><h2>Our story</h2><p class="sub">${esc(d.name)}</p><div class="about">${aboutHtml(d)}</div></section>
<section id="visit"><h2>${d.address ? "Visit us" : "Get in touch"}</h2><p class="sub">${d.address ? "We’d love to see you" : "We’d love to hear from you"}</p><div class="visit">${d.hours.length || d.phone ? `<div><h3>Hours</h3>${hoursList(d)}</div>` : ""}<div><h3>Find us</h3>${contactLines(d)}</div></div></section></main>
<footer>© ${year()} ${esc(d.name)}</footer>`;
    return { css, body, theme: b };
  }
};

// 2. Bistro: modern split hero (words left, colour or photo right), sticky bar, menu as a grid of cards.
const bistro = {
  key: "bistro", label: "Bistro", blurb: "Modern split layout, menu as cards", defaultBrand: "#0f766e",
  fonts: "family=DM+Serif+Display&family=Inter:wght@400;600;700",
  render(d, brandIn) {
    const b = brandOr(brandIn, this.defaultBrand), bg = "#ffffff", ink = "#15181d", acc = textOn(b, bg, ink), on = inkOn(b), soft = mix(b, "#ffffff", .9);
    const css = `body{background:${bg};color:${ink};font:17px/1.65 Inter,system-ui,sans-serif}
.bar{position:sticky;top:0;z-index:10;background:#fffffff2;backdrop-filter:blur(8px);border-bottom:1px solid #e6e8ec}.bar .in{max-width:1180px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:24px}
.brand{display:flex;align-items:center;gap:10px;font:24px 'DM Serif Display',serif;color:${ink};text-decoration:none;margin-right:auto}.brand .logo{width:38px;height:38px;object-fit:contain}
.bar nav{display:flex;gap:20px}.bar nav a{color:${ink};text-decoration:none;font-weight:600;font-size:15px}.bar nav a:hover{color:${acc}}
.cta{background:${b};color:${on};padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px}
.split{display:grid;grid-template-columns:1.05fr 1fr;min-height:min(78vh,720px)}.split .words{padding:clamp(40px,7vw,96px) clamp(20px,5vw,72px);display:flex;flex-direction:column;justify-content:center}
.kicker{font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:13px;color:${acc}}h1{font:clamp(44px,6.5vw,80px)/1.02 'DM Serif Display',serif;margin:14px 0 18px}.lead{font-size:20px;color:#4a505c;max-width:36ch}
.btns{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}.b1{background:${b};color:${on};padding:15px 24px;border-radius:12px;text-decoration:none;font-weight:700}.b2{border:2px solid ${ink};color:${ink};padding:13px 22px;border-radius:12px;text-decoration:none;font-weight:700}
.split .art{background:${d.photos[0] ? "#ddd" : `linear-gradient(135deg,${b},${mix(b, "#000000", .35)})`};position:relative;overflow:hidden;min-height:320px}.split .art img{width:100%;height:100%;object-fit:cover}
.split .art .ring{position:absolute;border-radius:50%;border:2px solid ${on}55}.r1{width:420px;height:420px;right:-90px;top:-60px}.r2{width:260px;height:260px;left:40px;bottom:-80px}.big{position:absolute;left:8%;bottom:10%;font:clamp(64px,10vw,140px)/1 'DM Serif Display',serif;color:${on};opacity:.9;max-width:84%}
main{max-width:1180px;margin:0 auto;padding:0 20px}h2{font:clamp(34px,4.5vw,52px)/1.1 'DM Serif Display',serif;margin:96px 0 28px}
.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}.tabs a{padding:8px 14px;border-radius:999px;background:${soft};color:${ink};text-decoration:none;font-weight:600;font-size:14px}
.mhead{font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:13px;color:${acc};margin:36px 0 14px;scroll-margin-top:84px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;padding:0;margin:0}.cards .item{border:1px solid #e6e8ec;border-radius:16px;padding:18px 18px 16px;background:#fff;box-shadow:0 1px 2px #0000000a}.cards .item-price{color:${acc}}
.two{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}.panel{background:${soft};border-radius:20px;padding:30px}.hours{display:grid;grid-template-columns:auto 1fr;gap:8px 22px}.hours .wide{grid-column:1/3}.panel a{color:${ink};font-weight:600}
footer{margin-top:96px;border-top:1px solid #e6e8ec;padding:28px 20px;text-align:center;color:#5b616d;font-size:15px}
@media(max-width:820px){.split,.two{grid-template-columns:1fr}.bar nav{display:none}.split .art{min-height:260px}}`;
    const body = `<header class="bar"><div class="in"><a class="brand" href="#main">${logoImg(d, "logo", 38)}<span>${esc(d.name)}</span></a><nav aria-label="Main">${nav(d)}</nav>${d.order ? orderBtn(d, "cta") : d.phone ? `<a class="cta" href="tel:${esc(d.tel)}">Call</a>` : ""}</div></header>
<div class="split" id="main" data-hero><div class="words"><span class="kicker">${esc(d.address ? d.address.split(",").slice(-2, -1)[0] || "Welcome" : "Welcome")}</span><h1>${esc(d.tagline || d.name)}</h1><p class="lead">${esc(d.intro)}</p><div class="btns">${menuBtn(d, "b1")}${d.phone ? `<a class="b2" href="tel:${esc(d.tel)}">Call us</a>` : ""}</div></div>
<div class="art" aria-hidden="true">${d.photos[0] ? photo(d, 0) : `<span class="ring r1"></span><span class="ring r2"></span><span class="big">${esc(d.name)}</span>`}</div></div>
<main>${d.sections.length ? `<section id="menu"><h2>${d.menuLabel}</h2>${d.sections.length > 1 ? `<nav class="tabs" aria-label="${d.menuLabel} sections">${sections(d, (s, i) => `<a href="#m${i}">${esc(s.name || d.menuLabel)}</a>`)}</nav>` : ""}${sections(d, (s, i) => `<h3 class="mhead" id="m${i}">${esc(s.name || d.menuLabel)}</h3><ul class="cards">${s.items.map((x) => item(x)).join("")}</ul>`)}</section>` : ""}
<section id="about" class="two"><div><h2>About us</h2>${aboutHtml(d)}</div>${d.photos[1] ? photo(d, 1) : ""}</section>
<section id="visit"><h2>${d.address ? "Come by" : "Contact"}</h2><div class="two"><div class="panel"><h3>Hours</h3>${hoursList(d)}</div><div class="panel">${contactLines(d)}</div></div></section></main>
<footer>© ${year()} ${esc(d.name)}${d.address ? ` · ${esc(d.address)}` : ""}</footer>`;
    return { css, body, theme: b };
  }
};

// 3. Night Market: dark, loud, uppercase display type, accent glow, menu in a numbered list per section.
const nightMarket = {
  key: "night", label: "Night Market", blurb: "Dark and loud, huge type, late-night energy", defaultBrand: "#ffb000",
  fonts: "family=Bebas+Neue&family=Inter:wght@400;600",
  render(d, brandIn) {
    const b = brandOr(brandIn, this.defaultBrand), bg = "#0d0d0f", ink = "#f2f2f2", acc = textOn(b, bg, "#ffd166"), on = inkOn(acc);
    const css = `body{background:${bg};color:${ink};font:17px/1.6 Inter,system-ui,sans-serif}
header.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px clamp(18px,4vw,48px);border-bottom:1px solid #ffffff1a}
.brand{font:34px/1 'Bebas Neue',Impact,sans-serif;letter-spacing:.04em;color:${ink};text-decoration:none;display:flex;gap:12px;align-items:center}.brand .logo{width:40px;height:40px;object-fit:contain}
header.top nav{display:flex;gap:22px}header.top nav a{color:${ink};text-decoration:none;font:22px 'Bebas Neue',sans-serif;letter-spacing:.06em}header.top nav a:hover{color:${acc}}
.hero{padding:clamp(48px,9vw,120px) clamp(18px,4vw,48px) 64px;position:relative;overflow:hidden}.hero:before{content:"";position:absolute;width:60vw;height:60vw;max-width:760px;max-height:760px;right:-12vw;top:-20vw;background:radial-gradient(circle,${acc}55,transparent 65%);filter:blur(10px)}
.hero h1{position:relative;font:clamp(72px,15vw,200px)/.88 'Bebas Neue',Impact,sans-serif;margin:0;text-transform:uppercase;letter-spacing:.01em}.hero h1 span{color:${acc}}
.hero p{position:relative;font-size:clamp(19px,2.4vw,24px);max-width:38ch;color:#cfcfd4;margin:22px 0 28px}
.go{display:inline-block;background:${acc};color:${on};font:26px/1 'Bebas Neue',sans-serif;letter-spacing:.06em;padding:16px 26px;text-decoration:none;margin:0 10px 10px 0}.go.ghost{background:transparent;color:${ink};box-shadow:inset 0 0 0 2px ${ink}}
.strip{white-space:nowrap;overflow:hidden;border-block:1px solid #ffffff1a;margin:0 calc(-1 * clamp(18px,4vw,48px));font:28px/1 'Bebas Neue',sans-serif;letter-spacing:.08em;color:${acc};padding:14px 0}
main{padding:0 clamp(18px,4vw,48px)}h2{font:clamp(56px,9vw,120px)/.9 'Bebas Neue',sans-serif;margin:90px 0 30px;text-transform:uppercase}
.msec{display:grid;grid-template-columns:minmax(160px,280px) 1fr;gap:24px;border-top:1px solid #ffffff22;padding:28px 0}.msec h3{font:36px/1 'Bebas Neue',sans-serif;letter-spacing:.04em;color:${acc};margin:0}
.msec ol{margin:0;padding:0;counter-reset:n}.msec .item{counter-increment:n;padding:12px 0;border-bottom:1px dashed #ffffff22}.msec .item-name:before{content:counter(n,decimal-leading-zero) "  ";color:#77777f;font-weight:600}.msec .item-price{color:${acc}}
.about{font-size:clamp(20px,2.6vw,28px);line-height:1.5;max-width:30em;color:#e4e4e8}
.visit{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:2px;background:#ffffff22;margin-bottom:80px}.visit>div{background:${bg};padding:28px}.visit h3{font:32px 'Bebas Neue',sans-serif;color:${acc};margin:0 0 12px}.hours{display:grid;grid-template-columns:auto 1fr;gap:6px 20px}.hours .wide{grid-column:1/3}.visit a{color:${ink}}
footer{padding:26px;text-align:center;color:#8a8a92;border-top:1px solid #ffffff1a;font-size:14px}
@media(max-width:700px){header.top nav{display:none}.msec{grid-template-columns:1fr}}`;
    const words = String(d.name).split(/\s+/);
    const title = words.length > 1 ? `${esc(words.slice(0, -1).join(" "))} <span>${esc(words.at(-1))}</span>` : `<span>${esc(d.name)}</span>`;
    const body = `<header class="top"><a class="brand" href="#main">${logoImg(d, "logo", 40)}${esc(d.name)}</a><nav aria-label="Main">${nav(d)}</nav></header>
<div class="hero" id="main" data-hero><h1>${title}</h1><p>${esc(d.tagline)}${d.intro ? ` ${esc(d.intro)}` : ""}</p>${menuBtn(d, "go")}${orderBtn(d, "go ghost")}${callBtn(d, "go ghost")}</div>
<main>${d.sections.length ? `<section id="menu"><div class="strip" aria-hidden="true">${esc(sections(d, (s) => `${s.name || d.menuLabel} ★ `).repeat(4))}</div><h2>${d.menuLabel}</h2>${sections(d, (s) => `<div class="msec"><h3>${esc(s.name || d.menuLabel)}</h3><ol>${s.items.map((x) => item(x)).join("")}</ol></div>`)}</section>` : ""}
<section id="about"><h2>The story</h2><div class="about">${aboutHtml(d)}</div></section>
<section id="visit"><h2>${d.address ? "Pull up" : "Holler"}</h2><div class="visit">${d.hours.length || d.phone ? `<div><h3>Hours</h3>${hoursList(d)}</div>` : ""}<div><h3>${d.address ? "Where" : "Contact"}</h3>${contactLines(d)}</div></div></section></main>
<footer>© ${year()} ${esc(d.name)}</footer>`;
    return { css, body, theme: bg };
  }
};

// 4. Farmhouse: paper and chalkboard. Handwritten headings, menu on chalkboard panels, kraft-paper background.
const farmhouse = {
  key: "farmhouse", label: "Farmhouse", blurb: "Hand-made feel, chalkboard menu, paper background", defaultBrand: "#a0522d",
  fonts: "family=Caveat:wght@600;700&family=Nunito:wght@400;700",
  render(d, brandIn) {
    const b = brandOr(brandIn, this.defaultBrand), bg = "#efe4cf", ink = "#33261a", acc = textOn(b, bg, ink), chalk = "#2f3a33", on = inkOn(b);
    const css = `body{background:${bg} repeating-linear-gradient(45deg,#00000005 0 2px,transparent 2px 7px);color:${ink};font:18px/1.7 Nunito,system-ui,sans-serif}
header.top{text-align:center;padding:36px 20px 10px}.top .logo{margin:0 auto 6px;width:90px;height:90px;object-fit:contain}
.top .name{font:700 clamp(54px,9vw,96px)/1 Caveat,cursive;color:${ink};margin:0}.top .tag{font-size:20px;margin:6px 0 18px}
.top nav{display:inline-flex;gap:8px;flex-wrap:wrap;justify-content:center;border-block:2px dashed ${ink}55;padding:10px 6px}.top nav a{font:700 26px Caveat,cursive;color:${ink};text-decoration:none;padding:0 12px}.top nav a:hover{color:${acc}}
.welcome{max-width:900px;margin:30px auto 0;padding:0 20px;display:grid;grid-template-columns:${d.photos[0] ? "1fr 1fr" : "1fr"};gap:28px;align-items:center;text-align:${d.photos[0] ? "left" : "center"}}
.welcome img{border:10px solid #fff;box-shadow:0 8px 20px #0002;transform:rotate(-2deg)}.welcome p{font-size:20px}
.btn{display:inline-block;background:${b};color:${on};padding:13px 22px;border-radius:6px;text-decoration:none;font-weight:700;margin:6px;box-shadow:0 3px 0 ${mix(b, "#000000", .35)}}
main{max-width:1100px;margin:0 auto;padding:0 20px}h2{font:700 clamp(46px,7vw,72px)/1 Caveat,cursive;text-align:center;margin:70px 0 24px;color:${ink}}
.board{background:${chalk};color:#f4f1e8;border:14px solid #7a5534;border-radius:6px;box-shadow:inset 0 0 60px #0006,0 10px 24px #0003;padding:clamp(20px,4vw,44px);display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:30px 48px}
.board h3{font:700 38px/1 Caveat,cursive;color:#ffe9a8;margin:0 0 10px}.board ul{margin:0;padding:0}.board .item{padding:8px 0}.board .item-desc{color:#d9d4c6}
.about{max-width:720px;margin:0 auto;background:#fffaf0;padding:28px 32px;box-shadow:0 6px 16px #0002;transform:rotate(.4deg)}
.visit{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;margin-bottom:70px}.card{background:#fffaf0;padding:24px;border-radius:4px;box-shadow:0 6px 16px #0002}.card h3{font:700 34px Caveat,cursive;margin:0 0 8px}.hours{display:grid;grid-template-columns:auto 1fr;gap:6px 20px}.hours .wide{grid-column:1/3}.card a{color:${acc}}
footer{text-align:center;padding:24px;font:700 24px Caveat,cursive}`;
    const body = `<header class="top">${logoImg(d, "logo", 90)}<p class="name">${esc(d.name)}</p><p class="tag">${esc(d.tagline)}</p><nav aria-label="Main">${nav(d)}</nav></header>
<div class="welcome" id="main" data-hero>${photo(d, 0)}<div><p>${esc(d.intro)}</p>${menuBtn(d, "btn")}${orderBtn(d, "btn")}${callBtn(d, "btn")}</div></div>
<main>${d.sections.length ? `<section id="menu"><h2>On the ${d.services ? "list" : "board"} today</h2><div class="board">${sections(d, (s) => `<div>${s.name ? `<h3>${esc(s.name)}</h3>` : ""}<ul>${s.items.map((x) => item(x, { leader: true })).join("")}</ul></div>`)}</div></section>` : ""}
<section id="about"><h2>Our story</h2><div class="about">${aboutHtml(d)}</div></section>
<section id="visit"><h2>${d.address ? "Come on in" : "Say hello"}</h2><div class="visit">${d.hours.length || d.phone ? `<div class="card"><h3>Hours</h3>${hoursList(d)}</div>` : ""}<div class="card"><h3>${d.address ? "Find us" : "Contact"}</h3>${contactLines(d)}</div></div></section></main>
<footer>${esc(d.name)} · ${year()}</footer>`;
    return { css, body, theme: b };
  }
};

// 5. Fine Dining: quiet and refined. Lots of space, thin rules, spaced capitals, one centred column, courses.
const fineDining = {
  key: "fine", label: "Fine Dining", blurb: "Quiet and refined, spaced capitals, lots of space", defaultBrand: "#8a6d3b",
  fonts: "family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Jost:wght@300;400;500",
  render(d, brandIn) {
    const b = brandOr(brandIn, this.defaultBrand), bg = "#f8f6f2", ink = "#1d1b19", acc = textOn(b, bg, ink);
    const css = `body{background:${bg};color:${ink};font:300 17px/1.8 Jost,system-ui,sans-serif}
header.top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:26px clamp(18px,5vw,64px)}.top nav{display:flex;gap:26px}.top nav a,.top .r a{color:${ink};text-decoration:none;font:500 12px Jost,sans-serif;letter-spacing:.28em;text-transform:uppercase}.top .r{text-align:right}
.mark{text-align:center;font:600 22px 'Cormorant Garamond',serif;letter-spacing:.32em;text-transform:uppercase;color:${ink};text-decoration:none}.mark .logo{margin:0 auto 4px;width:44px;height:44px;object-fit:contain}
.hero{text-align:center;padding:clamp(60px,12vw,160px) 20px clamp(60px,10vw,130px);border-block:1px solid ${ink}22;${d.photos[0] ? "position:relative;color:#fff;background:#111;overflow:hidden" : ""}}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}.hero .in{position:relative}
.eyebrow{font:500 12px Jost,sans-serif;letter-spacing:.42em;text-transform:uppercase;color:${d.photos[0] ? "#fff" : acc}}
.hero h1{font:400 clamp(48px,8.5vw,108px)/1 'Cormorant Garamond',serif;margin:22px 0;letter-spacing:.02em}.hero p{font:italic 400 clamp(20px,2.4vw,26px) 'Cormorant Garamond',serif;max-width:32ch;margin:0 auto 34px}
.line{display:inline-block;padding:14px 30px;border:1px solid currentColor;color:inherit;text-decoration:none;font:500 12px Jost,sans-serif;letter-spacing:.3em;text-transform:uppercase;margin:6px}
main{max-width:760px;margin:0 auto;padding:0 20px;text-align:center}h2{font:400 clamp(38px,5vw,56px) 'Cormorant Garamond',serif;margin:110px 0 8px}.rule{display:block;width:40px;height:1px;background:${acc};margin:18px auto 40px}
.course{margin:0 0 54px}.course h3{font:500 12px Jost,sans-serif;letter-spacing:.42em;text-transform:uppercase;color:${acc};margin:0 0 22px}.course ul{padding:0;margin:0}.course .item{padding:12px 0}.course .item-top{justify-content:center;flex-wrap:wrap;gap:4px 14px}.course .item-name{font:600 22px 'Cormorant Garamond',serif}.course .item-price{margin:0;font-weight:400}.course .item-desc{font-style:italic;font-family:'Cormorant Garamond',serif;font-size:19px}
.about p{font:400 22px/1.7 'Cormorant Garamond',serif}
.visit{display:grid;grid-template-columns:1fr 1fr;gap:40px;text-align:left;border-top:1px solid ${ink}22;padding-top:40px;margin-bottom:100px}.visit h3{font:500 12px Jost,sans-serif;letter-spacing:.42em;text-transform:uppercase;color:${acc}}.hours{display:grid;grid-template-columns:auto 1fr;gap:6px 22px}.hours .wide{grid-column:1/3}.visit a{color:${ink}}
footer{text-align:center;padding:30px;font:500 11px Jost,sans-serif;letter-spacing:.3em;text-transform:uppercase;border-top:1px solid ${ink}22}
@media(max-width:720px){header.top{grid-template-columns:1fr}.top nav,.top .r{display:none}.visit{grid-template-columns:1fr}}`;
    const body = `<header class="top"><nav aria-label="Main">${nav(d)}</nav><a class="mark" href="#main">${logoImg(d, "logo", 44)}${esc(d.name)}</a><div class="r">${d.phone ? `<a href="tel:${esc(d.tel)}">${esc(d.phone)}</a>` : ""}</div></header>
<div class="hero" id="main" data-hero>${photo(d, 0)}<div class="in"><span class="eyebrow">${d.address ? esc(d.address.split(",")[0]) : "Welcome"}</span><h1>${esc(d.name)}</h1><p>${esc(d.tagline)}</p>${menuBtn(d, "line")}${orderBtn(d, "line")}</div></div>
<main>${d.sections.length ? `<section id="menu"><h2>${d.menuLabel}</h2><span class="rule"></span>${sections(d, (s) => `<div class="course">${s.name ? `<h3>${esc(s.name)}</h3>` : ""}<ul>${s.items.map((x) => item(x)).join("")}</ul></div>`)}</section>` : ""}
<section id="about" class="about"><h2>The house</h2><span class="rule"></span><p>${esc(d.intro)}</p>${aboutHtml(d)}</section>
<section id="visit"><h2>${d.address ? "Visit" : "Contact"}</h2><span class="rule"></span><div class="visit">${d.hours.length || d.phone ? `<div><h3>Hours</h3>${hoursList(d)}</div>` : ""}<div><h3>${d.address ? "Address" : "Contact"}</h3>${contactLines(d)}</div></div></section></main>
<footer>© ${year()} ${esc(d.name)}</footer>`;
    return { css, body, theme: bg };
  }
};

// 6. Fresh: bright and friendly. Rounded cards, colour-blocked sections, pill buttons, menu cards with section badges.
const fresh = {
  key: "fresh", label: "Fresh", blurb: "Bright and friendly, rounded cards, colour blocks", defaultBrand: "#2e7d32",
  fonts: "family=Poppins:wght@400;600;700;800",
  render(d, brandIn) {
    const b = brandOr(brandIn, this.defaultBrand), bg = "#ffffff", ink = "#17251b", acc = textOn(b, bg, ink), on = inkOn(b), tint = mix(b, "#ffffff", .88), tint2 = mix(b, "#ffffff", .94);
    const css = `body{background:${bg};color:${ink};font:17px/1.65 Poppins,system-ui,sans-serif}
header.top{max-width:1180px;margin:14px auto 0;padding:10px 14px 10px 20px;display:flex;align-items:center;gap:20px;background:${tint2};border-radius:999px;width:calc(100% - 28px)}
.brand{display:flex;gap:10px;align-items:center;font:800 20px Poppins,sans-serif;color:${ink};text-decoration:none;margin-right:auto}.brand .logo{width:36px;height:36px;object-fit:contain;border-radius:50%}
header.top nav{display:flex;gap:6px}header.top nav a{color:${ink};text-decoration:none;font-weight:600;padding:8px 14px;border-radius:999px}header.top nav a:hover{background:${tint}}
.pill{display:inline-block;background:${b};color:${on};text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px;margin:6px 8px 6px 0}.pill.alt{background:#fff;color:${ink};box-shadow:inset 0 0 0 2px ${ink}}
.hero{max-width:1180px;margin:22px auto 0;width:calc(100% - 28px);border-radius:32px;background:${tint};padding:clamp(36px,7vw,90px) clamp(22px,6vw,80px);display:grid;grid-template-columns:${d.photos[0] ? "1.1fr .9fr" : "1fr"};gap:36px;align-items:center;position:relative;overflow:hidden}
.hero:after{content:"";position:absolute;width:340px;height:340px;border-radius:50%;background:${b};opacity:.14;right:-80px;bottom:-120px}
.hero h1{font:800 clamp(40px,6.5vw,76px)/1.05 Poppins,sans-serif;margin:0 0 16px}.hero p{font-size:20px;max-width:40ch;margin:0 0 20px}.hero img{border-radius:24px;aspect-ratio:4/3;object-fit:cover;width:100%}
main{max-width:1180px;margin:0 auto;padding:0 20px}h2{font:800 clamp(32px,4.5vw,48px)/1.1 Poppins,sans-serif;margin:84px 0 24px}
.badge{display:inline-block;background:${b};color:${on};font-weight:700;font-size:14px;padding:6px 14px;border-radius:999px;margin:30px 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;padding:0;margin:0}.grid .item{background:${tint2};border-radius:20px;padding:18px}.grid .item-price{background:#fff;padding:2px 10px;border-radius:999px;font-size:15px}
.aboutbox{background:${ink};color:#f3f7f3;border-radius:32px;padding:clamp(28px,5vw,60px);font-size:19px}.aboutbox h2{margin-top:0;color:#fff}
.visit{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:60px}.visit>div{background:${tint2};border-radius:24px;padding:26px}.visit h3{margin:0 0 10px}.hours{display:grid;grid-template-columns:auto 1fr;gap:6px 20px}.hours .wide{grid-column:1/3}.visit a{color:${acc};font-weight:600}
footer{text-align:center;padding:28px;color:#4d5a51;font-size:15px}
@media(max-width:820px){header.top nav{display:none}.hero{grid-template-columns:1fr}}`;
    const body = `<header class="top"><a class="brand" href="#main">${logoImg(d, "logo", 36)}${esc(d.name)}</a><nav aria-label="Main">${nav(d)}</nav>${d.order ? orderBtn(d, "pill") : ""}</header>
<div class="hero" id="main" data-hero><div><h1>${esc(d.tagline || d.name)}</h1><p>${esc(d.intro)}</p>${menuBtn(d, "pill")}${callBtn(d, "pill alt")}</div>${photo(d, 0)}</div>
<main>${d.sections.length ? `<section id="menu"><h2>${d.menuLabel}</h2>${sections(d, (s) => `${s.name ? `<h3 class="badge">${esc(s.name)}</h3>` : ""}<ul class="grid">${s.items.map((x) => item(x)).join("")}</ul>`)}</section>` : ""}
<section id="about"><h2 class="vh">About</h2><div class="aboutbox"><h2>About ${esc(d.name)}</h2>${aboutHtml(d)}</div></section>
<section id="visit"><h2>${d.address ? "Visit us" : "Contact us"}</h2><div class="visit">${d.hours.length || d.phone ? `<div><h3>Hours</h3>${hoursList(d)}</div>` : ""}<div><h3>${d.address ? "Where we are" : "Reach us"}</h3>${contactLines(d)}</div></div></section></main>
<footer>© ${year()} ${esc(d.name)}</footer>`;
    return { css, body, theme: b };
  }
};

// 7. Café Pop: playful. Pastel colour bands with wavy edges, chunky rounded type, sticker-style menu sections.
const cafePop = {
  key: "pop", label: "Café Pop", blurb: "Playful, pastel colour bands, wavy edges", defaultBrand: "#d81b60",
  fonts: "family=Fredoka:wght@500;600;700&family=Nunito:wght@400;700",
  render(d, brandIn) {
    const b = brandOr(brandIn, this.defaultBrand), cream = "#fff7e8", ink = "#2b2140", acc = textOn(b, cream, ink), on = inkOn(b);
    const pastels = ["#ffe1ec", "#e0f2ff", "#e6f8e0", "#fff0c9", "#efe5ff"];
    const wave = (fill) => `<svg class="wave" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 Q 120 0 240 30 T 480 30 T 720 30 T 960 30 T 1200 30 T 1440 30 V60 H0Z" fill="${fill}"/></svg>`;
    const css = `body{background:${cream};color:${ink};font:18px/1.65 Nunito,system-ui,sans-serif}
header.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px clamp(16px,4vw,40px)}
.brand{display:flex;align-items:center;gap:10px;font:700 26px Fredoka,sans-serif;color:${ink};text-decoration:none}.brand .logo{width:46px;height:46px;object-fit:contain;border-radius:14px;background:#fff;padding:4px}
header.top nav{display:flex;gap:10px}header.top nav a{font:600 17px Fredoka,sans-serif;color:${ink};text-decoration:none;background:#fff;padding:8px 16px;border-radius:14px;box-shadow:0 3px 0 ${ink}22}
.hero{text-align:center;padding:40px 20px 70px;background:${pastels[0]}}.hero h1{font:700 clamp(46px,9vw,100px)/1 Fredoka,sans-serif;margin:10px 0 12px;color:${ink}}.hero p{font-size:21px;max-width:36ch;margin:0 auto 24px}
.blob{display:inline-block;background:${b};color:${on};font:600 20px Fredoka,sans-serif;padding:14px 26px;border-radius:22px;text-decoration:none;margin:6px;box-shadow:0 5px 0 ${mix(b, "#000000", .3)}}.blob.w{background:#fff;color:${ink};box-shadow:0 5px 0 ${ink}33}
.wave{display:block;width:calc(100% + 40px);height:46px;margin:-76px -20px 30px}.band{padding:30px 20px 70px;margin-top:46px}.band .in{max-width:1080px;margin:0 auto}
h2{font:700 clamp(36px,6vw,58px) Fredoka,sans-serif;text-align:center;margin:10px 0 30px}
.stickers{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px}.sticker{background:#fff;border-radius:28px;padding:24px;box-shadow:0 6px 0 ${ink}1f;border:3px solid ${ink}}
.sticker h3{font:700 26px Fredoka,sans-serif;margin:0 0 8px;display:inline-block;background:${pastels[3]};padding:2px 12px;border-radius:10px;transform:rotate(-2deg)}.sticker ul{margin:0;padding:0}.sticker .item{padding:8px 0;border-bottom:2px dotted ${ink}33}.sticker .item:last-child{border:0}.sticker .item-price{color:${acc}}
.about{max-width:720px;margin:0 auto;font-size:20px;text-align:center}
.visit{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px}.visit>div{background:#fff;border:3px solid ${ink};border-radius:28px;padding:24px}.visit h3{font:700 26px Fredoka,sans-serif;margin:0 0 8px}.hours{display:grid;grid-template-columns:auto 1fr;gap:6px 20px}.hours .wide{grid-column:1/3}.visit a{color:${acc};font-weight:700}
footer{text-align:center;padding:26px;font:600 18px Fredoka,sans-serif;background:${pastels[4]}}
@media(max-width:700px){header.top nav{display:none}}`;
    const bands = [];
    if (d.sections.length) bands.push(["menu", `<h2>Our ${d.menuLabel.toLowerCase()}</h2><div class="stickers">${sections(d, (s) => `<div class="sticker">${s.name ? `<h3>${esc(s.name)}</h3>` : ""}<ul>${s.items.map((x) => item(x)).join("")}</ul></div>`)}</div>`]);
    bands.push(["about", `<h2>Hello from ${esc(d.name)}</h2><div class="about">${aboutHtml(d)}</div>`]);
    bands.push(["visit", `<h2>${d.address ? "Come say hi" : "Say hi"}</h2><div class="visit">${d.hours.length || d.phone ? `<div><h3>Hours</h3>${hoursList(d)}</div>` : ""}<div><h3>${d.address ? "Find us" : "Contact"}</h3>${contactLines(d)}</div></div>`]);
    const body = `<header class="top" style="background:${pastels[0]}"><a class="brand" href="#main">${logoImg(d, "logo", 46)}${esc(d.name)}</a><nav aria-label="Main">${nav(d)}</nav></header>
<div class="hero" id="main" data-hero><h1>${esc(d.name)}</h1><p>${esc(d.tagline)}${d.intro ? `. ${esc(d.intro)}` : ""}</p>${menuBtn(d, "blob")}${orderBtn(d, "blob w")}${callBtn(d, "blob w")}</div>
<main>${bands.map(([id, html], i) => `<section id="${id}" class="band" style="background:${pastels[(i + 1) % pastels.length]}">${wave(pastels[(i + 1) % pastels.length])}<div class="in">${html}</div></section>`).join("")}</main>
<footer>Made with love by ${esc(d.name)} · ${year()}</footer>`;
    return { css, body, theme: pastels[0] };
  }
};

// 8. Coastal: a side rail on wide screens (name, nav and call button fixed on the left), sand and navy, menu in a ledger.
const coastal = {
  key: "coastal", label: "Coastal", blurb: "Side navigation, sand and navy, relaxed", defaultBrand: "#1f5f8b",
  fonts: "family=Montserrat:wght@500;700;800&family=Merriweather:wght@300;400;700",
  render(d, brandIn) {
    const b = brandOr(brandIn, this.defaultBrand), navy = mix(b, "#0b1a2b", .7), sand = "#f4efe6", ink = "#1b2633", acc = textOn(b, sand, ink), on = inkOn(b);
    const css = `body{background:${sand};color:${ink};font:300 17px/1.8 Merriweather,Georgia,serif}
.rail{position:fixed;inset:0 auto 0 0;width:300px;background:${navy};color:#eef3f8;padding:36px 30px;display:flex;flex-direction:column;gap:26px;z-index:5}
.rail .logo{width:72px;height:72px;object-fit:contain;background:#fff;border-radius:16px;padding:6px}.rail .name{font:800 30px/1.1 Montserrat,sans-serif;margin:0;color:#fff}.rail .tag{font-size:15px;color:#c6d3e1;margin:0}
.rail nav{display:flex;flex-direction:column;gap:2px}.rail nav a{color:#eef3f8;text-decoration:none;font:700 14px Montserrat,sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:10px 0;border-bottom:1px solid #ffffff22}.rail nav a:hover{color:#fff;padding-left:6px}
.rail .callme{margin-top:auto;background:${b};color:${on};text-decoration:none;text-align:center;font:700 15px Montserrat,sans-serif;padding:14px;border-radius:10px}
.content{margin-left:300px}.hero{min-height:72vh;display:flex;align-items:flex-end;padding:clamp(28px,6vw,80px);position:relative;color:#fff;background:${d.photos[0] ? "#122" : `linear-gradient(180deg,${mix(b, "#ffffff", .25)},${navy})`};overflow:hidden}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.6}.hero .in{position:relative;max-width:640px}.hero h1{font:800 clamp(40px,6vw,74px)/1.05 Montserrat,sans-serif;margin:0 0 14px}.hero p{font-size:20px;margin:0 0 22px}
.hero svg{position:absolute;left:0;right:0;bottom:-1px;width:100%;height:70px}
.tide{display:inline-block;background:#fff;color:${ink};text-decoration:none;font:700 15px Montserrat,sans-serif;padding:13px 22px;border-radius:10px;margin:6px 8px 6px 0}
.wrap{padding:0 clamp(24px,6vw,80px);max-width:980px}h2{font:800 clamp(30px,4vw,44px) Montserrat,sans-serif;margin:80px 0 24px;color:${navy}}
.ledger{border-top:3px solid ${navy}}.ledger h3{font:700 14px Montserrat,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:${acc};margin:28px 0 6px}.ledger ul{margin:0;padding:0}.ledger .item{display:grid;grid-template-columns:1fr auto;gap:2px 16px;padding:14px 0;border-bottom:1px solid ${ink}1f}.ledger .item-top{display:contents}.ledger .item-desc{grid-column:1/2}
.visit{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;margin-bottom:80px}.visit>div{background:#fff;padding:26px;border-radius:14px;border-left:6px solid ${b}}.visit h3{font:700 16px Montserrat,sans-serif;letter-spacing:.12em;text-transform:uppercase;margin:0 0 10px}.hours{display:grid;grid-template-columns:auto 1fr;gap:6px 20px}.hours .wide{grid-column:1/3}.visit a{color:${acc}}
footer{padding:24px clamp(24px,6vw,80px);font:500 13px Montserrat,sans-serif;color:#5b6775}
@media(max-width:900px){.rail{position:static;width:auto;flex-direction:row;flex-wrap:wrap;align-items:center;padding:18px}.rail nav{flex-direction:row;gap:14px}.rail nav a{border:0;padding:4px 0}.rail .tag,.rail .callme{display:none}.content{margin-left:0}}`;
    const body = `<aside class="rail">${logoImg(d, "logo", 72)}<div><p class="name">${esc(d.name)}</p><p class="tag">${esc(d.tagline)}</p></div><nav aria-label="Main">${nav(d)}</nav>${d.phone ? `<a class="callme" href="tel:${esc(d.tel)}">Call ${esc(d.phone)}</a>` : d.order ? orderBtn(d, "callme") : ""}</aside>
<div class="content"><div class="hero" id="main" data-hero>${photo(d, 0)}<div class="in"><h1>${esc(d.tagline || d.name)}</h1><p>${esc(d.intro)}</p>${menuBtn(d, "tide")}${orderBtn(d, "tide")}</div><svg viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 C 240 0 480 70 720 40 S 1200 10 1440 40 V70 H0Z" fill="${sand}"/></svg></div>
<main class="wrap">${d.sections.length ? `<section id="menu"><h2>${d.menuLabel}</h2><div class="ledger">${sections(d, (s) => `${s.name ? `<h3>${esc(s.name)}</h3>` : ""}<ul>${s.items.map((x) => item(x)).join("")}</ul>`)}</div></section>` : ""}
<section id="about"><h2>About</h2>${aboutHtml(d)}</section>
<section id="visit"><h2>${d.address ? "Visit" : "Contact"}</h2><div class="visit">${d.hours.length || d.phone ? `<div><h3>Hours</h3>${hoursList(d)}</div>` : ""}<div><h3>${d.address ? "Location" : "Contact"}</h3>${contactLines(d)}</div></div></section></main>
<footer>© ${year()} ${esc(d.name)}</footer></div>`;
    return { css, body, theme: navy };
  }
};

// 9. Taproom: a bar. Deep green and brass, a crest hero with the hours right under it, the menu as a tap board
// (each section a board with rows), and a "Tonight" strip. Slab type.
const taproom = {
  key: "taproom", label: "Taproom", blurb: "A bar: crest sign, tap-board menu, hours up front", defaultBrand: "#c9a227",
  fonts: "family=Alfa+Slab+One&family=Source+Sans+3:wght@400;600;700",
  render(d, brandIn) {
    const b = brandOr(brandIn, this.defaultBrand), green = "#13261f", panel = "#1b3329", cream = "#f3ead6", brass = textOn(b, green, "#e6c45a"), on = inkOn(brass);
    const today = d.hours.slice(0, 3);
    const css = `body{background:${green};color:${cream};font:18px/1.65 'Source Sans 3',system-ui,sans-serif}
header.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px clamp(16px,4vw,44px);border-bottom:3px double ${brass}66}
.brand{display:flex;align-items:center;gap:10px;font:22px 'Alfa Slab One',Georgia,serif;color:${cream};text-decoration:none;letter-spacing:.02em}.brand .logo{width:40px;height:40px;object-fit:contain}
header.top nav{display:flex;gap:22px}header.top nav a{color:${cream};text-decoration:none;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:14px}header.top nav a:hover{color:${brass}}
.hero{position:relative;text-align:center;padding:clamp(48px,8vw,100px) 20px clamp(40px,6vw,70px);${d.photos[0] ? "overflow:hidden" : `background:radial-gradient(ellipse at 50% 0,${panel},${green} 70%)`}}
.hero img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.3}.hero .in{position:relative}
.crest{display:inline-block;border:3px solid ${brass};outline:1px solid ${brass};outline-offset:6px;border-radius:24px;padding:clamp(22px,4vw,40px) clamp(24px,6vw,64px);background:${green}cc}
.crest .logo{margin:0 auto 10px;width:80px;height:80px;object-fit:contain}.crest small{display:block;color:${brass};font-weight:700;letter-spacing:.3em;text-transform:uppercase;font-size:13px}
.crest h1{font:clamp(44px,8vw,92px)/1 'Alfa Slab One',Georgia,serif;margin:12px 0;color:${cream};text-shadow:0 3px 0 #0007}.crest p{margin:0;font-size:20px;color:#d8cfbb}
.hours-strip{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 28px;margin:28px auto 0;max-width:900px}.hours-strip span{font-weight:700}.hours-strip b{color:${brass};margin-right:6px;text-transform:uppercase;letter-spacing:.1em;font-size:14px}
.go{display:inline-block;margin:24px 6px 0;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:15px;background:${brass};color:${on}}.go.out{background:transparent;color:${cream};box-shadow:inset 0 0 0 2px ${cream}}
main{max-width:1120px;margin:0 auto;padding:0 20px}h2{font:clamp(36px,5.5vw,60px) 'Alfa Slab One',Georgia,serif;text-align:center;margin:80px 0 10px}.sub{text-align:center;color:${brass};letter-spacing:.24em;text-transform:uppercase;font-weight:700;font-size:14px;margin:0 0 34px}
.boards{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px}.board{background:${panel};border:2px solid ${brass}55;border-radius:14px;overflow:hidden}
.board h3{margin:0;padding:14px 20px;font:22px 'Alfa Slab One',Georgia,serif;background:${brass};color:${on}}.board ul{margin:0;padding:6px 20px 14px}.board .item{padding:12px 0;border-bottom:1px solid ${cream}22}.board .item:last-child{border:0}.board .item-price{color:${brass};font-size:19px}.board .item-desc{color:#cfc6b1}
.tonight{margin:70px 0 0;border-block:3px double ${brass}66;padding:22px;text-align:center;font:clamp(22px,3vw,30px) 'Alfa Slab One',serif}
.about{max-width:720px;margin:0 auto;font-size:20px;text-align:center}
.visit{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;margin-bottom:70px}.visit>div{background:${panel};border:2px solid ${brass}55;border-radius:14px;padding:24px}.visit h3{font:22px 'Alfa Slab One',serif;color:${brass};margin:0 0 10px}.hours{display:grid;grid-template-columns:auto 1fr;gap:6px 20px}.hours .wide{grid-column:1/3}.visit a{color:${cream}}
footer{text-align:center;padding:24px;border-top:3px double ${brass}66;color:#b9b09c;font-size:15px}
@media(max-width:720px){header.top nav{display:none}}`;
    const body = `<header class="top"><a class="brand" href="#main">${logoImg(d, "logo", 40)}${esc(d.name)}</a><nav aria-label="Main">${nav(d)}</nav></header>
<div class="hero" id="main" data-hero>${photo(d, 0, "bg")}<div class="in"><div class="crest">${logoImg(d, "logo", 80)}<small>${d.address ? esc(d.address.split(",").slice(-2, -1)[0] || "Est. here") : "Welcome in"}</small><h1>${esc(d.name)}</h1><p>${esc(d.tagline)}</p></div>
${today.length ? `<p class="hours-strip">${today.map((h) => `<span>${h.day ? `<b>${esc(h.day)}</b>` : ""}${esc(h.time)}</span>`).join("")}</p>` : ""}<div>${menuBtn(d, "go")}${orderBtn(d, "go out")}${callBtn(d, "go out")}</div></div></div>
<main>${d.sections.length ? `<section id="menu"><h2>${d.services ? "Services" : "On tap and on the menu"}</h2><p class="sub">${esc(d.name)}</p><div class="boards">${sections(d, (s) => `<div class="board">${s.name ? `<h3>${esc(s.name)}</h3>` : ""}<ul>${s.items.map((x) => item(x)).join("")}</ul></div>`)}</div></section>` : ""}
${d.intro ? `<p class="tonight">${esc(d.intro)}</p>` : ""}
<section id="about"><h2>The bar</h2><p class="sub">Our story</p><div class="about">${aboutHtml(d)}</div></section>
<section id="visit"><h2>${d.address ? "Pull up a stool" : "Get in touch"}</h2><p class="sub">${d.address ? "Hours and directions" : "Contact"}</p><div class="visit">${d.hours.length || d.phone ? `<div><h3>Hours</h3>${hoursList(d)}</div>` : ""}<div><h3>${d.address ? "Find us" : "Reach us"}</h3>${contactLines(d)}</div></div></section></main>
<footer>© ${year()} ${esc(d.name)} · Please drink responsibly</footer>`;
    return { css, body, theme: green };
  }
};

const DESIGNS = [trattoria, bistro, nightMarket, farmhouse, fineDining, fresh, cafePop, coastal, taproom];
const DESIGN_KEYS = DESIGNS.map((x) => x.key);
const designFor = (key) => DESIGNS.find((x) => x.key === key) || null;

export { DESIGNS, DESIGN_KEYS, designFor };
