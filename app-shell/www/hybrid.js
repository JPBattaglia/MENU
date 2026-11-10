// Hybrid app screens (owner decision Nov 8, 2026; design: the "Hybrid apps: Menu-made and Nino Battaglia" canvas).
// Real app screens drawn from live JSON (config.hybrid_url = booking-api/src/store-app/hybrid.js), so a change on the
// website shows here the next time the app opens, with no store build. The website opens in the in-app browser
// (@capacitor/browser) only where a screen would just copy it: checkout, the cart, the account, long pages.
// Two layouts: "services" (Menu-made: Home, Preview, Plans, Account) and "shop" (Nino: Shop, Work, Rewards, Cart).
// Started by app.js, which passes its small helpers. All text goes in with textContent; images come only from https
// addresses the worker checked.
(function () {
  "use strict";
  var SVG = "http://www.w3.org/2000/svg";
  var ICONS = {
    home: "M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    preview: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6",
    plans: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M3 10h18",
    account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
    shop: "M6 2l-3 6v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-3-6z M3 8h18 M16 12a4 4 0 0 1-8 0",
    work: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M21 15l-5-5L5 21",
    rewards: "M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5L5.5 21l2-7.5L2 9h7z",
    cart: "M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6 M9 21h.01 M20 21h.01",
    back: "M15 18l-6-6 6-6",
    bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0",
    ideas: "M9 18h6 M10 22h4 M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2.3h6c0-1.1.4-1.8 1-2.3A7 7 0 0 0 12 2z",
    up: "M12 19V5 M5 12l7-7 7 7"
  };
  var LABELS = { home: "Home", preview: "Preview", plans: "Plans", account: "Account", shop: "Shop", work: "Work", rewards: "Rewards", cart: "Cart", ideas: "Ideas" };

  var t, cfg, data, root, screen, current = null, currentOpts = {}, interval = "month", chosenPlan = null, filter = "all", query = "";

  function icon(name, size) {
    var s = document.createElementNS(SVG, "svg");
    s.setAttribute("width", size || 22); s.setAttribute("height", size || 22); s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(SVG, "path"); p.setAttribute("d", ICONS[name] || ""); s.appendChild(p);
    return s;
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function button(text, cls, onClick) { var b = el("button", cls || "hy-btn", text); b.type = "button"; if (onClick) b.addEventListener("click", onClick); return b; }
  function money(cents) { var d = (Number(cents) || 0) / 100; return "$" + d.toLocaleString("en-US", { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 }); }

  // The in-app browser: the website without leaving the app. In a plain browser (store screenshots) a new tab.
  function openWeb(url) {
    if (!/^https:\/\//.test(String(url || ""))) return;
    // Nino's shop links carry this phone's member key, so what's bought counts toward the app rewards.
    if (data && data.app_param && /^https:\/\/ninobattaglia\.com\//.test(url)) url += (url.indexOf("?") < 0 ? "?" : "&") + data.app_param + "=" + encodeURIComponent(t.memberKey());
    var C = window.Capacitor;
    var plugin = C && C.isNativePlatform && C.isNativePlatform() ? ((C.Plugins && C.Plugins.Browser) || (C.registerPlugin ? C.registerPlugin("Browser") : null)) : null;
    if (plugin) { plugin.open({ url: url, toolbarColor: cfg.brand_color }).catch(function () { window.open(url, "_blank"); }); return; }
    window.open(url, "_blank", "noopener");
  }

  // ---- Nino's shop API (rewards card, ideas): each member's own data, straight from the shop ----
  function fans(path, body) {
    var init = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" };
    return fetch(data.fans_api + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._ok = r.ok; return j; });
    });
  }

  // ---- notifications (the same native push the restaurant apps use: <api_base>/push/native) ----
  var push = { plugin: null, state: "off", listeners: [] };
  function pushChanged() { push.listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
  function sendToken(tok) {
    var platform = window.Capacitor.getPlatform();
    var token = String(tok && tok.value || "");
    if (platform === "ios") token = token.toLowerCase();
    if (!(platform === "ios" ? /^[0-9a-f]{64,200}$/ : /^[A-Za-z0-9_:-]{100,4096}$/).test(token)) return;
    var sent = t.store.get("push-sent") || {};
    push.state = "on"; pushChanged();
    if (sent.token === token && Date.now() - (sent.at || 0) < 7 * 86400000) return;
    t.api("push/native", { platform: platform, token: token, bundle_id: cfg.app_id, environment: cfg.push_environment || "production" })
      .then(function (r) { if (r.ok) t.store.set("push-sent", { token: token, at: Date.now() }); }).catch(function () {});
  }
  function startPush() {
    push.plugin = t.pushPlugin();
    if (!push.plugin) return;
    push.plugin.addListener("registration", sendToken);
    push.plugin.addListener("registrationError", function () { push.state = "ask"; pushChanged(); });
    push.plugin.checkPermissions().then(function (p) {
      if (p.receive === "granted") { push.state = "on"; push.plugin.register(); }
      else push.state = p.receive === "denied" ? "denied" : "ask";
      pushChanged();
    }).catch(function () {});
  }
  function askPush(msg) {
    if (!push.plugin) return;
    push.plugin.requestPermissions().then(function (r) {
      if (r.receive === "granted") { push.state = "on"; push.plugin.register(); msg.textContent = "Notifications are on."; }
      else { push.state = "denied"; msg.textContent = "Notifications are off. You can turn them on later in Settings."; }
      pushChanged();
    }).catch(function () { msg.textContent = "Couldn't turn on notifications."; });
  }
  // A card that offers notifications while they're off (never shown in a plain browser).
  function pushCard(title, text) {
    var card = el("div", "hy-card hy-push");
    function draw() {
      while (card.firstChild) card.removeChild(card.firstChild);
      card.hidden = !push.plugin || push.state === "denied";
      var row = el("div", "hy-row"); row.appendChild(icon("bell", 22));
      var body = el("div"); body.appendChild(el("strong", null, title));
      body.appendChild(el("p", "hy-muted", push.state === "on" ? "Notifications are on." : text));
      row.appendChild(body); card.appendChild(row);
      if (push.state === "ask") { var msg = el("p", "hy-muted"); card.appendChild(button("Turn on notifications", "hy-btn", function () { askPush(msg); })); card.appendChild(msg); }
    }
    push.listeners.push(draw); draw();
    return card;
  }

  // ---- shell ----
  // The top bar: the brand (logo, as on the website) on every screen, then the screen's own title.
  function header(title, sub) {
    var h = el("header", "hy-head");
    var bar = el("div", "hy-brandbar");
    var logo = data.assets && data.assets.logo;
    if (data.theme === "nino") {
      if (logo) { var m = el("img", "hy-mark"); m.src = logo; m.alt = ""; bar.appendChild(m); }
      var word = el("span", "hy-word"); word.appendChild(el("strong", null, "NINO")); word.appendChild(el("small", null, "BATTAGLIA"));
      var wrap = el("span", "hy-wordwrap"); wrap.appendChild(word); bar.appendChild(wrap);
      // The tagline sits on the right of the bar (owner, Nov 9, 2026): the app has no menu button there.
      var tag = el("span", "hy-tagline hy-tagline-side"); tag.appendChild(el("span", null, "Graphic Design")); tag.appendChild(el("span", null, "& Branding"));
      bar.appendChild(tag);
    } else if (logo) {
      var l = el("img", "hy-logo"); l.src = logo; l.alt = data.name; bar.appendChild(l);
      if (data.assets.mark) { var g = el("img", "hy-gear"); g.src = data.assets.mark; g.alt = ""; bar.appendChild(g); }
    }
    else bar.appendChild(el("strong", "hy-word", data.name));
    h.appendChild(bar);
    if (title) {
      var box = el("div", "hy-titlebox"); box.appendChild(el("h1", null, title)); if (sub) box.appendChild(el("p", null, sub));
      h.appendChild(box);
    }
    return h;
  }
  function applyTheme() {
    if (!data.theme || document.body.classList.contains("hy-theme-" + data.theme)) return;
    document.body.classList.add("hy-theme-" + data.theme);
    var fonts = { nino: "family=Barlow+Condensed:wght@600;700;800&family=DM+Sans:wght@400;500;600;700", menumade: "family=Aldrich&family=Philosopher:wght@400;700" }[data.theme];
    if (fonts) { var link = el("link"); link.rel = "stylesheet"; link.href = "https://fonts.googleapis.com/css2?" + fonts + "&display=swap"; document.head.appendChild(link); }
    var a = data.assets || {};
    var root = document.documentElement.style;
    if (/^https:\/\//.test(a.backdrop || "")) root.setProperty("--hy-backdrop", "url(\"" + a.backdrop + "\")");
    if (/^https:\/\//.test(a.grain || "")) root.setProperty("--hy-grain", "url(\"" + a.grain + "\")");
  }
  function show(tab, opts) {
    if (!opts || !opts.keep) window.scrollTo(0, 0);
    current = tab; currentOpts = opts || {};
    Array.prototype.forEach.call(root.querySelectorAll(".hy-tabs button"), function (b) {
      if (b.getAttribute("data-tab") === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    push.listeners = [];
    while (screen.firstChild) screen.removeChild(screen.firstChild);
    var draw = (data.kind === "shop" ? SHOP : SERVICES)[tab];
    if (draw) draw(screen, opts || {});
  }
  function build() {
    applyTheme();
    while (root.firstChild) root.removeChild(root.firstChild);
    screen = el("div", "hy-screen"); screen.id = "hy-screen"; screen.setAttribute("role", "main");
    var nav = el("nav", "hy-tabs"); nav.setAttribute("aria-label", "Sections");
    nav.style.gridTemplateColumns = "repeat(" + data.tabs.length + ", minmax(0, 1fr))";
    data.tabs.forEach(function (tab) {
      var b = el("button"); b.type = "button"; b.id = "hy-t-" + tab; b.setAttribute("data-tab", tab);
      b.appendChild(icon(tab)); b.appendChild(el("span", null, LABELS[tab] || tab));
      b.addEventListener("click", function () { show(tab); });
      nav.appendChild(b);
    });
    root.appendChild(screen); root.appendChild(nav);
    if (data.kind === "shop") cartBadge();
  }

  // ---- Menu-made (services) ----
  var SERVICES = {
    home: function (s) {
      s.appendChild(header());
      var hero = el("div", "hy-hero");
      hero.appendChild(el("p", "hy-pill", data.tagline));
      hero.appendChild(el("h2", null, data.hero.title));
      hero.appendChild(button(data.hero.action, "hy-btn hy-btn-big", function () { show("preview"); }));
      hero.appendChild(button("See the plans", "hy-btn hy-btn-ghost hy-btn-big", function () { show("plans"); }));
      s.appendChild(hero);
      s.appendChild(el("h3", "hy-label", "Three steps"));
      var list = el("ol", "hy-steps");
      data.steps.forEach(function (step, i) {
        var li = el("li"); var b = el("button", "hy-step"); b.type = "button";
        b.appendChild(el("span", "hy-num", String(i + 1)));
        var txt = el("span", "hy-step-text"); txt.appendChild(el("strong", null, step.title)); txt.appendChild(el("span", "hy-muted", step.text));
        b.appendChild(txt);
        b.addEventListener("click", function () { if (step.tab) show(step.tab); else openWeb(step.url); });
        li.appendChild(b); list.appendChild(li);
      });
      s.appendChild(list);
      s.appendChild(pushCard("News from Menu-made", "Get a notification when your preview is ready and when there's something new."));
    },
    preview: function (s) {
      s.appendChild(header("Free menu preview", "See it before you checkout"));
      var p = data.preview;
      var form = el("form", "hy-card hy-form"); form.noValidate = true;
      form.appendChild(el("p", null, "Upload the menu you have now. We turn it into a phone-friendly menu with a QR code, and you see it before you checkout."));
      function field(id, label, type, extra) {
        var l = el("label", null, label); l.setAttribute("for", id); form.appendChild(l);
        var i = el("input"); i.id = id; i.type = type; for (var k in extra || {}) i.setAttribute(k, extra[k]); form.appendChild(i);
        return i;
      }
      var biz = field("hy-biz", "Business name", "text", { autocomplete: "organization", maxlength: "120" });
      var email = field("hy-email", "Email (we send you the link)", "email", { autocomplete: "email", inputmode: "email", maxlength: "200" });
      var fileLabel = el("p", "hy-file-label", "Your menu: a PDF or a photo, up to 5 MB");
      form.appendChild(fileLabel);
      var pick = el("input"); pick.type = "file"; pick.accept = "application/pdf,image/png,image/jpeg,image/webp"; pick.hidden = true; pick.id = "hy-file";
      var cam = el("input"); cam.type = "file"; cam.accept = "image/*"; cam.setAttribute("capture", "environment"); cam.hidden = true;
      var chosen = null; var fileName = el("p", "hy-muted", "No file chosen yet.");
      [pick, cam].forEach(function (input) {
        input.addEventListener("change", function () { chosen = input.files[0] || null; fileName.textContent = chosen ? "Chosen: " + (chosen.name || "photo") : "No file chosen yet."; });
        form.appendChild(input);
      });
      var row = el("div", "hy-row hy-wrap");
      row.appendChild(button("Choose file", "hy-btn hy-btn-ghost", function () { pick.click(); }));
      row.appendChild(button("Take a photo", "hy-btn hy-btn-ghost", function () { cam.click(); }));
      form.appendChild(row); form.appendChild(fileName);
      var go = button("Make my preview", "hy-btn hy-btn-big"); go.type = "submit"; form.appendChild(go);
      var status = el("div", "hy-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); form.appendChild(status);
      var upload = null, busy = false;
      function say(text, isError) { status.textContent = text || ""; status.className = "hy-status" + (isError ? " is-error" : ""); }
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (busy) return;
        var b = biz.value.trim(), e = email.value.trim();
        if (!b) { say("Add your business name.", true); biz.focus(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { say("Add an email address we can send the link to.", true); email.focus(); return; }
        if (!chosen) { say("Choose your menu file or take a photo.", true); return; }
        if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(chosen.type) || !chosen.size || chosen.size > 5 * 1024 * 1024) { say("Previews work from a PDF or a photo (PNG, JPEG or WebP) up to 5 MB.", true); return; }
        busy = true; go.disabled = true; go.textContent = "Sending your menu…"; say("");
        var key = [b, e.toLowerCase(), chosen.name, chosen.size].join("|");
        var sending = (upload && upload.key === key) ? Promise.resolve(upload) : (function () {
          var requestId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
          var name = chosen.name && /\.(pdf|png|jpe?g|webp)$/i.test(chosen.name) ? chosen.name : "menu." + ({ "application/pdf": "pdf", "image/png": "png", "image/webp": "webp" }[chosen.type] || "jpg");
          var body = new FormData();
          body.append("payload", JSON.stringify({ type: "inquiry", purpose: "checkout", service: "Other project", name: b, business: b, email: e, notes: "Free menu preview (Menu-made app)", website: "", requestId: requestId }));
          body.append("document", chosen, name);
          return fetch(p.upload_url, { method: "POST", body: body }).then(function (r) {
            return r.json().catch(function () { return null; }).then(function (j) {
              if (!r.ok || !j || j.ok !== true) throw new Error(r.status === 429 ? "Too many tries. Please wait an hour and try again." : "Your menu couldn't be sent. Please try again.");
              upload = { key: key, requestId: requestId }; return upload;
            });
          });
        })();
        sending.then(function (u) {
          go.textContent = "Reading your menu…";
          say("Reading your menu. This takes about a minute; keep the app open.");
          return fetch(p.create_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: u.requestId, email: e, business: b, tracking: {} }) })
            .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { r: r, j: j }; }); });
        }).then(function (out) {
          var j = out.j || {};
          while (status.firstChild) status.removeChild(status.firstChild);
          if (out.r.ok && j.ok && j.url) {
            status.className = "hy-status is-ok";
            status.appendChild(el("p", null, j.reused ? "You already have a preview of this menu." : "Your preview is ready. We've emailed you the link too."));
            status.appendChild(button("Open my menu", "hy-btn hy-btn-big", function () { openWeb(j.url); }));
            return;
          }
          if (j.used && j.start) { status.className = "hy-status is-error"; status.appendChild(el("p", null, j.error || "")); status.appendChild(button("Start my order", "hy-btn", function () { openWeb(j.start); })); return; }
          if (out.r.status === 404 || out.r.status === 410) upload = null;
          say(j.error || "Something went wrong making your preview. Please try again.", true);
        }).catch(function (err) {
          say(err && err.message && !/fetch|network/i.test(err.message) ? err.message : "You need a connection to make a preview.", true);
        }).then(function () { busy = false; go.disabled = false; go.textContent = "Make my preview"; });
      });
      s.appendChild(form);
      var more = el("div", "hy-card"); more.appendChild(el("strong", null, "What happens next"));
      more.appendChild(el("p", "hy-muted", "Your preview opens right here in the app, with designs to choose from. It stays free for 3 days."));
      more.appendChild(button("More about Online Menu + QR", "hy-link", function () { openWeb(p.more_url); }));
      s.appendChild(more);
    },
    plans: function (s) {
      s.appendChild(header("Plans", "Every plan starts with your menu"));
      var toggle = el("div", "hy-toggle"); toggle.setAttribute("role", "group"); toggle.setAttribute("aria-label", "Billing");
      [["month", "Monthly"], ["year", "Yearly, menu setup free"]].forEach(function (o) {
        var b = button(o[1], "hy-toggle-btn", function () { interval = o[0]; show("plans", { keep: true }); });
        b.setAttribute("aria-pressed", String(interval === o[0])); toggle.appendChild(b);
      });
      s.appendChild(toggle);
      if (!data.plans.length) s.appendChild(el("div", "hy-card", "Plans will show here soon."));
      if (!chosenPlan && data.plans.length) chosenPlan = data.plans[Math.min(1, data.plans.length - 1)].code;
      data.plans.forEach(function (plan) {
        var b = el("button", "hy-plan"); b.type = "button"; b.setAttribute("aria-pressed", String(chosenPlan === plan.code));
        var top = el("span", "hy-plan-top"); top.appendChild(el("strong", null, plan.name));
        var price = interval === "year" && plan.year_cents ? money(plan.year_cents) + "/yr" : money(plan.month_cents) + "/mo";
        top.appendChild(el("strong", null, price)); b.appendChild(top);
        if (plan.description) b.appendChild(el("span", "hy-muted", plan.description));
        b.addEventListener("click", function () { chosenPlan = plan.code; show("plans", { keep: true }); });
        s.appendChild(b);
      });
      var plan = data.plans.filter(function (p) { return p.code === chosenPlan; })[0];
      if (plan) {
        var box = el("div", "hy-card hy-checkout");
        box.appendChild(el("p", "hy-muted", "Checkout is Stripe's secure page, opened inside the app. " + (data.plans_note || "")));
        box.appendChild(button("Checkout with " + plan.name, "hy-btn hy-btn-big", function () { openWeb(interval === "year" ? plan.checkout_year : plan.checkout_month); }));
        s.appendChild(box);
      }
    },
    account: function (s) {
      s.appendChild(header("Account", "Your orders, plans and help"));
      var list = el("div", "hy-list");
      data.links.forEach(function (l) {
        var b = el("button", "hy-list-item"); b.type = "button";
        b.appendChild(el("strong", null, l.label)); b.appendChild(el("span", "hy-muted", l.text));
        b.addEventListener("click", function () { openWeb(l.url); });
        list.appendChild(b);
      });
      s.appendChild(list);
      s.appendChild(pushCard("Notifications", "Hear when your preview is ready and when there's something new."));
    }
  };

  // ---- Nino (shop) ----
  function productCard(p) {
    var b = el("button", "hy-tile"); b.type = "button";
    var img = el("img"); img.src = p.image; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    if (p.accent) img.style.background = p.accent + "22";
    b.appendChild(img);
    if (p.early) b.appendChild(el("span", "hy-badge", "App first"));
    b.appendChild(el("strong", null, p.title));
    b.appendChild(el("span", "hy-muted", (p.category ? p.category + " · " : "") + "From " + money(p.price_cents)));
    b.addEventListener("click", function () { show("shop", { product: p.slug }); });
    return b;
  }
  // ---- Nino: buying inside the app (owner, Nov 10, 2026: "when you tap a color nothing happens ... the cart is only on
  // the site so buyers have to go back and forth"). The product, color, size and quantity are picked on this screen,
  // the cart lives in the app, delivery prices come from the shop, and only Stripe's payment page opens in the in-app
  // browser. Prices shown here are the shop's; its checkout re-reads every one before charging.
  var CART_KEY = "nino-cart", MAX_EACH = 10, MAX_UNITS = 50, MAX_LINES = 20;
  var picks = {}, designs = {}, step = "cart", addr = null, quote = null, rateId = null, attempt = null, thanks = null, countries = null, cartNote = "";
  function cartItems() {
    var c = t.store.get(CART_KEY);
    return (Array.isArray(c) ? c : []).filter(function (i) { return i && /^\d{1,20}$/.test(i.variant_id) && /^\d{1,20}$/.test(i.product_id) && i.quantity >= 1 && i.quantity <= MAX_EACH; });
  }
  function cartUnits(items) { return (items || cartItems()).reduce(function (n, i) { return n + i.quantity; }, 0); }
  function cartTotal(items) { return items.reduce(function (n, i) { return n + i.price_cents * i.quantity; }, 0); }
  function cartBadge() {
    var tab = document.getElementById("hy-t-cart"); if (!tab) return;
    var dot = tab.querySelector(".hy-tabcount"); var n = cartUnits();
    if (!dot) { dot = el("span", "hy-tabcount"); tab.appendChild(dot); }
    dot.textContent = n ? String(n) : ""; dot.hidden = !n;
    tab.setAttribute("aria-label", n ? "Cart, " + n + (n === 1 ? " item" : " items") : "Cart");
  }
  // A changed cart needs new delivery prices (the shop ties a quote to the exact cart).
  function saveCart(items) { t.store.set(CART_KEY, items); quote = null; rateId = null; attempt = null; if (step === "rates") step = "address"; cartBadge(); }
  function cartPayload(items) { return items.map(function (i) { return { product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity }; }); }
  function loadDesign(id) {
    var hit = designs[id];
    if (hit && Date.now() - hit.at < 300000) return Promise.resolve(hit.value);
    return fetch(data.fans_api + "/api/app/design/" + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok || !Array.isArray(d.options) || !d.options.length) throw new Error("design");
      designs[id] = { at: Date.now(), value: d };
      return d;
    });
  }
  function stepper(value, max, onChange) {
    var box = el("div", "hy-qty"); box.setAttribute("role", "group"); box.setAttribute("aria-label", "Quantity");
    var less = button("−", "hy-qty-btn", function () { if (value > 1) { value--; draw(); onChange(value); } }); less.setAttribute("aria-label", "One fewer");
    var out = el("span", "hy-qty-n"); out.setAttribute("aria-live", "polite");
    var more = button("+", "hy-qty-btn", function () { if (value < max) { value++; draw(); onChange(value); } }); more.setAttribute("aria-label", "One more");
    function draw() { out.textContent = String(value); less.disabled = value <= 1; more.disabled = value >= max; }
    box.appendChild(less); box.appendChild(out); box.appendChild(more); draw();
    return box;
  }
  function productPage(s, p) {
    var bar = el("div", "hy-bar");
    var back = el("button", "hy-icon-btn"); back.type = "button"; back.setAttribute("aria-label", "Back to the shop"); back.appendChild(icon("back"));
    back.addEventListener("click", function () { show("shop"); });
    bar.appendChild(back); bar.appendChild(el("strong", null, p.title)); s.appendChild(bar);
    var img = el("img", "hy-hero-img"); img.src = p.image; img.alt = p.title + " shirt"; s.appendChild(img);
    var body = el("div", "hy-pad");
    if (p.early) body.appendChild(el("p", "hy-badge", "App first: on the website in 24 hours"));
    var top = el("div", "hy-plan-top"); top.appendChild(el("h2", null, p.title));
    var price = el("strong", "hy-price", "From " + money(p.price_cents)); top.appendChild(price);
    body.appendChild(top);
    if (p.description) body.appendChild(el("p", null, p.description));
    var pick = el("div", "hy-pick"); body.appendChild(pick);
    if (data.shop_note) body.appendChild(el("p", "hy-muted", data.shop_note));
    s.appendChild(body);
    // If the shop can't be reached, the website's own picker still works inside the app.
    function fallback() {
      while (pick.firstChild) pick.removeChild(pick.firstChild);
      pick.appendChild(el("p", "hy-muted", "The shop's choices couldn't load here. You can still pick on Nino's website, inside the app."));
      pick.appendChild(button("Choose on the website", "hy-btn hy-btn-big", function () { openWeb(p.buy_url); }));
    }
    if (!p.id || !data.fans_api) { fallback(); return; }
    pick.appendChild(inlineLoader());
    loadDesign(p.id).then(function (d) { if (pick.parentNode && document.body.contains(pick)) drawPick(d); }).catch(function () { if (document.body.contains(pick)) fallback(); });

    function drawPick(d) {
      var st = picks[p.id] || (picks[p.id] = { type: d.options[0].type, color: null, size: null, qty: 1 });
      var note = "";
      function render() {
        while (pick.firstChild) pick.removeChild(pick.firstChild);
        var option = d.options.filter(function (o) { return o.type === st.type; })[0] || d.options[0];
        st.type = option.type;
        if (!option.colors.some(function (c) { return c.name === st.color; })) st.color = option.colors.length ? option.colors[0].name : "";
        var inColor = option.variants.filter(function (v) { return !option.colors.length || v.color === st.color; });
        var sizes = option.sizes.filter(function (z) { return inColor.some(function (v) { return v.size === z; }); });
        if (sizes.indexOf(st.size) < 0) st.size = sizes.length === 1 ? sizes[0] : null;
        var variant = inColor.filter(function (v) { return !sizes.length || v.size === st.size; })[0] || null;
        if (sizes.length && !st.size) variant = null;
        var shown = (variant && variant.image) || (option.colors.filter(function (c) { return c.name === st.color; })[0] || {}).image || option.image || p.image;
        if (shown && img.getAttribute("src") !== shown) img.src = shown;
        img.alt = p.title + " " + option.label.toLowerCase() + (st.color ? ", " + st.color : "");
        price.textContent = variant ? money(variant.price_cents) : "From " + money(option.from_cents);

        if (d.options.length > 1) {
          pick.appendChild(el("h3", "hy-label", "Product"));
          var types = el("div", "hy-chips hy-chips-wrap"); types.setAttribute("role", "group"); types.setAttribute("aria-label", "Choose a product");
          d.options.forEach(function (o) {
            var b = button(o.label, "hy-chip", function () { st.type = o.type; st.color = null; st.size = null; note = ""; render(); });
            b.setAttribute("aria-pressed", String(o.type === option.type)); types.appendChild(b);
          });
          pick.appendChild(types);
        }
        // One color (a sticker's white backing) is not a choice, so it isn't asked.
        if (option.colors.length > 1) {
          var cl = el("h3", "hy-label", "Color: "); cl.appendChild(el("span", "hy-label-value", st.color)); pick.appendChild(cl);
          var sw = el("div", "hy-swatches"); sw.setAttribute("role", "group"); sw.setAttribute("aria-label", "Choose a color");
          option.colors.forEach(function (c) {
            var b = el("button", /^#[0-9a-f]{6}$/i.test(c.hex || "") ? "hy-swatch" : "hy-chip"); b.type = "button";
            if (b.className === "hy-swatch") b.style.background = c.hex; else b.textContent = c.name;
            b.setAttribute("aria-label", c.name); b.setAttribute("aria-pressed", String(c.name === st.color)); b.title = c.name;
            b.addEventListener("click", function () { st.color = c.name; note = ""; render(); });
            sw.appendChild(b);
          });
          pick.appendChild(sw);
        }
        if (option.sizes.length > 1) {
          pick.appendChild(el("h3", "hy-label", "Size"));
          var sz = el("div", "hy-chips hy-chips-wrap"); sz.setAttribute("role", "group"); sz.setAttribute("aria-label", "Choose a size");
          option.sizes.forEach(function (z) {
            var b = button(z, "hy-chip", function () { st.size = z; note = ""; render(); });
            b.setAttribute("aria-pressed", String(z === st.size)); b.disabled = sizes.indexOf(z) < 0; sz.appendChild(b);
          });
          pick.appendChild(sz);
        }
        pick.appendChild(el("h3", "hy-label", "Quantity"));
        pick.appendChild(stepper(st.qty, MAX_EACH, function (n) { st.qty = n; }));
        var msg = el("p", "hy-status", note); msg.setAttribute("role", "status"); msg.setAttribute("aria-live", "polite");
        var add = button(d.available === false ? "Shop is updating" : "Add to cart", "hy-btn hy-btn-big", function () {
          if (!variant) { msg.textContent = "Choose a size first."; msg.className = "hy-status is-error"; return; }
          var items = cartItems();
          var line = items.filter(function (i) { return i.variant_id === variant.id; })[0];
          if (!line && items.length >= MAX_LINES) { msg.textContent = "Your cart is full. Check out, then add more."; msg.className = "hy-status is-error"; return; }
          if (cartUnits(items) + st.qty > MAX_UNITS || (line && line.quantity + st.qty > MAX_EACH)) { msg.textContent = "That's more than one order can hold (" + MAX_EACH + " of one item, " + MAX_UNITS + " in all)."; msg.className = "hy-status is-error"; return; }
          if (line) line.quantity += st.qty;
          else items.push({ product_id: variant.product_id, variant_id: variant.id, quantity: st.qty, title: d.title, label: option.label, color: variant.color || "", size: variant.size || "", price_cents: variant.price_cents, image: shown || "", slug: p.slug });
          saveCart(items); thanks = null;
          note = "Added to your cart."; st.qty = 1; render();
        });
        add.disabled = d.available === false;
        pick.appendChild(add); pick.appendChild(msg);
        if (cartUnits()) pick.appendChild(button("View cart (" + cartUnits() + ")", "hy-btn hy-btn-ghost hy-btn-big", function () { show("cart"); }));
      }
      render();
    }
  }
  var SHOP = {
    shop: function (s, opts) {
      if (opts.product) {
        var p = data.products.filter(function (x) { return x.slug === opts.product; })[0];
        if (p) { productPage(s, p); return; }
      }
      s.appendChild(header());
      var hero = el("div", "hy-hero");
      var h = data.hero || {};
      if (h.eyebrow) hero.appendChild(el("p", "hy-eyebrow", h.eyebrow));
      var big = el("h2", "hy-display"); big.appendChild(document.createTextNode(h.line1 || "")); big.appendChild(el("br"));
      big.appendChild(el("span", "hy-hot", h.line2 || "")); hero.appendChild(big);
      if (h.text) hero.appendChild(el("p", "hy-lead", h.text));
      var feat = data.products.filter(function (p) { return p.featured; })[0] || data.products[0];
      if (feat && !query && filter === "all") {
        var card = el("button", "hy-feature"); card.type = "button";
        var fi = el("img"); fi.src = feat.image; fi.alt = ""; card.appendChild(fi);
        var ft = el("span", "hy-feature-text"); ft.appendChild(el("span", "hy-eyebrow", "Featured design"));
        ft.appendChild(el("strong", "hy-display-sm", feat.title)); ft.appendChild(el("span", "hy-hot-text", "From " + money(feat.price_cents)));
        ft.appendChild(el("span", "hy-btn hy-btn-small", "Shop now")); card.appendChild(ft);
        card.addEventListener("click", function () { show("shop", { product: feat.slug }); });
        hero.appendChild(card);
      }
      s.appendChild(hero);
      var label = el("label", "hy-sr", "Search designs"); label.setAttribute("for", "hy-q");
      var q = el("input", "hy-search"); q.id = "hy-q"; q.type = "search"; q.placeholder = "Find your design"; q.value = query;
      var sb = el("div", "hy-searchbox"); sb.appendChild(label); sb.appendChild(q); s.appendChild(sb);
      var chips = el("div", "hy-chips"); chips.setAttribute("role", "group"); chips.setAttribute("aria-label", "Collections");
      [{ id: "all", name: "All" }].concat(data.collections).forEach(function (c) {
        var b = button(c.name, "hy-chip", function () { filter = c.id; show("shop", { keep: true }); });
        b.setAttribute("aria-pressed", String(filter === c.id)); chips.appendChild(b);
      });
      s.appendChild(chips);
      var grid = el("div", "hy-grid"); var empty = el("p", "hy-muted hy-pad", "No designs match that search.");
      function fill() {
        while (grid.firstChild) grid.removeChild(grid.firstChild);
        var words = query.toLowerCase().split(/\s+/).filter(Boolean);
        var list = data.products.filter(function (p) {
          if (filter !== "all" && p.collections.indexOf(filter) < 0) return false;
          var hay = (p.title + " " + p.category + " " + p.description).toLowerCase();
          return words.every(function (w) { return hay.indexOf(w) >= 0; });
        });
        list.slice(0, 120).forEach(function (p) { grid.appendChild(productCard(p)); });
        empty.hidden = list.length > 0;
      }
      q.addEventListener("input", function () { query = q.value; fill(); });
      fill(); s.appendChild(grid); s.appendChild(empty);
    },
    work: function (s, opts) {
      var pieces = data.work || [];
      if (opts && opts.piece != null && pieces[opts.piece]) {
        var w = pieces[opts.piece];
        var bar = el("div", "hy-bar");
        var back = el("button", "hy-icon-btn"); back.type = "button"; back.setAttribute("aria-label", "Back to Work"); back.appendChild(icon("back"));
        back.addEventListener("click", function () { show("work"); });
        bar.appendChild(back); bar.appendChild(el("strong", null, w.title)); s.appendChild(bar);
        var big = el("img", "hy-hero-img hy-work-full"); big.src = w.full || w.image; big.alt = w.title; s.appendChild(big);
        var about = el("div", "hy-pad"); about.appendChild(el("p", "hy-eyebrow", w.category || "")); about.appendChild(el("h2", null, w.title));
        var ask = button("Start a project like this", "hy-btn"); ask.addEventListener("click", function () { openWeb(data.links.services); });
        about.appendChild(ask); s.appendChild(about);
        return;
      }
      s.appendChild(header("Work", "Nino's design and branding"));
      if (pieces.length) {
        var grid = el("div", "hy-grid");
        pieces.forEach(function (w, i) {
          var b = el("button", "hy-tile"); b.type = "button"; b.setAttribute("aria-label", w.title + ", " + (w.category || ""));
          var img = el("img"); img.src = w.image; img.alt = ""; img.loading = "lazy"; img.decoding = "async"; b.appendChild(img);
          b.appendChild(el("strong", null, w.title)); b.appendChild(el("span", "hy-muted", w.category || ""));
          b.addEventListener("click", function () { show("work", { piece: i }); });
          grid.appendChild(b);
        });
        s.appendChild(grid);
      }
      [["Selected work", "Logos, branding, illustration and menus Nino has made", data.links.work],
       ["Design services", "A logo, flyer, menu redesign or social graphics pack", data.links.services]].forEach(function (c) {
        var b = el("button", "hy-list-item"); b.type = "button";
        b.appendChild(el("strong", null, c[0])); b.appendChild(el("span", "hy-muted", c[1]));
        b.addEventListener("click", function () { openWeb(c[2]); }); s.appendChild(b);
      });
    },
    rewards: function (s) {
      s.appendChild(header("Rewards", "Free stuff for shirts bought in the app"));
      var r = data.rewards || {};
      var steps = r.steps || [];
      var cycle = steps.length ? steps[steps.length - 1].at : 6;
      var card = el("div", "hy-member");
      card.appendChild(el("p", "hy-eyebrow", "Nino member"));
      var count = el("h2", null, "0 of " + cycle + " shirts");
      card.appendChild(count);
      var bar = el("div", "hy-ladder"); var fill = el("span", "hy-ladder-fill"); bar.appendChild(fill);
      bar.setAttribute("aria-hidden", "true");
      steps.forEach(function (st) { var m = el("span", "hy-ladder-mark", String(st.at)); m.style.left = (100 * st.at / cycle) + "%"; bar.appendChild(m); });
      card.appendChild(bar);
      var next = el("p", null, r.note || ""); card.appendChild(next);
      s.appendChild(card);
      var list = el("div", "hy-list");
      var rows = steps.map(function (st) {
        var item = el("div", "hy-list-item hy-step-reward");
        item.appendChild(el("strong", null, st.title)); item.appendChild(el("span", "hy-muted", st.text));
        list.appendChild(item); return item;
      });
      s.appendChild(list);
      var history = el("div", "hy-card"); history.hidden = true; s.appendChild(history);
      var early = el("div", "hy-card"); early.appendChild(el("strong", null, "24-hour early access")); early.appendChild(el("p", "hy-muted", r.early || "")); s.appendChild(early);
      s.appendChild(pushCard("New drop alerts", "Get a notification when Nino releases a new design."));
      function draw(c) {
        var pos = Number(c.position) || 0;
        count.textContent = pos + " of " + cycle + " shirts";
        fill.style.width = Math.min(100, 100 * pos / cycle) + "%";
        if (c.next) next.textContent = c.next.remaining + (c.next.remaining === 1 ? " more shirt" : " more shirts") + " to your free " + (c.next.tier === "canvas" ? "canvas print" : "hoodie") + ". " + (r.note || "");
        steps.forEach(function (st, i) { rows[i].classList.toggle("is-done", pos >= st.at); });
        while (history.firstChild) history.removeChild(history.firstChild);
        var got = c.rewards || [];
        history.hidden = !got.length;
        if (got.length) {
          history.appendChild(el("strong", null, "Your rewards"));
          got.forEach(function (g) {
            history.appendChild(el("p", "hy-muted", (g.tier === "canvas" ? "Free canvas print" : "Free hoodie") + ": " + (g.status === "sent" ? "on its way to you" : "ships after the order that earned it")));
          });
        }
      }
      var cached = t.store.get("card");
      if (cached && cached.next) draw(cached);
      var spin = cached ? null : inlineLoader();
      if (spin) card.appendChild(spin);
      if (data.fans_api) fans("/api/app/card?member=" + encodeURIComponent(t.memberKey())).then(function (c) { if (c._ok && c.next) { t.store.set("card", c); if (current === "rewards") draw(c); } }).catch(function () {})
        .then(function () { if (spin && spin.parentNode) spin.parentNode.removeChild(spin); });
    },
    ideas: function (s) {
      var info = data.ideas || {};
      s.appendChild(header(info.title || "Ideas board", "What should Nino draw next?"));
      var form = el("form", "hy-card hy-form"); form.noValidate = true;
      form.appendChild(el("p", null, info.text || ""));
      var l1 = el("label", null, "Your idea"); l1.setAttribute("for", "hy-idea"); form.appendChild(l1);
      var box = el("textarea", "hy-textarea"); box.id = "hy-idea"; box.maxLength = 280; box.rows = 3; box.placeholder = "A skeleton surfing past the Golden Gate…"; form.appendChild(box);
      var l2 = el("label", null, "Your first name (optional)"); l2.setAttribute("for", "hy-idea-name"); form.appendChild(l2);
      var nm = el("input"); nm.id = "hy-idea-name"; nm.type = "text"; nm.maxLength = 30; nm.autocomplete = "given-name"; form.appendChild(nm);
      var send = button("Send to Nino", "hy-btn hy-btn-big"); send.type = "submit"; form.appendChild(send);
      var msg = el("p", "hy-status"); msg.setAttribute("role", "status"); msg.setAttribute("aria-live", "polite"); form.appendChild(msg);
      s.appendChild(form);
      var pending = el("div", "hy-card"); pending.hidden = true; s.appendChild(pending);
      s.appendChild(el("h3", "hy-label", "Fan favorites"));
      var list = el("div", "hy-list"); s.appendChild(list);
      var empty = el("p", "hy-muted hy-pad", "No ideas on the board yet. Be the first!"); s.appendChild(empty);
      // App Store guideline 1.2 (user posts): every idea can be reported (it leaves the board at once and Nino decides)
      // and a fan can hide one person's ideas on this device. Ideas are also held for Nino's OK before they show.
      var HIDDEN_KEY = "nino-hidden-authors";
      function hiddenAuthors() { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"); } catch (e) { return []; } }
      function hideAuthor(tag) { try { var h = hiddenAuthors(); if (h.indexOf(tag) < 0) h.push(tag); localStorage.setItem(HIDDEN_KEY, JSON.stringify(h.slice(-200))); } catch (e) {} }
      var lastBoard = null;
      function drawIdeas(b) {
        lastBoard = b;
        while (list.firstChild) list.removeChild(list.firstChild);
        var hidden = hiddenAuthors();
        b = { ideas: (b.ideas || []).filter(function (i) { return !i.author || hidden.indexOf(i.author) < 0; }), pending: b.pending };
        (b.ideas || []).forEach(function (idea) {
          var item = el("div", "hy-idea");
          var txt = el("div", "hy-idea-text"); txt.appendChild(el("p", null, idea.text)); if (idea.name) txt.appendChild(el("span", "hy-muted", idea.name));
          var acts = el("div", "hy-idea-actions");
          var rep = el("button", "hy-linkbtn", "Report"); rep.type = "button"; rep.setAttribute("aria-label", "Report this idea");
          rep.addEventListener("click", function () {
            if (!window.confirm("Report this idea? It comes off the board right away and Nino reviews it.")) return;
            rep.disabled = true;
            fans("/api/ideas/report", { member: t.memberKey(), id: idea.id }).then(function (r) {
              if (r._ok) { msg.textContent = "Thanks. That idea is off the board while Nino reviews it."; msg.className = "hy-status"; loadIdeas(); }
              else { rep.disabled = false; }
            }).catch(function () { rep.disabled = false; });
          });
          acts.appendChild(rep);
          if (idea.author) {
            var hide = el("button", "hy-linkbtn", "Hide this person"); hide.type = "button"; hide.setAttribute("aria-label", "Hide ideas from this person");
            hide.addEventListener("click", function () {
              if (!window.confirm("Hide all ideas from this person on this phone?")) return;
              hideAuthor(idea.author); if (lastBoard) drawIdeas(lastBoard);
            });
            acts.appendChild(hide);
          }
          txt.appendChild(acts);
          var v = el("button", "hy-vote"); v.type = "button"; v.setAttribute("aria-pressed", String(Boolean(idea.voted)));
          v.setAttribute("aria-label", "Vote for this idea, " + (idea.votes || 0) + " votes");
          v.appendChild(icon("up", 18)); var n = el("span", null, String(idea.votes || 0)); v.appendChild(n);
          v.addEventListener("click", function () {
            v.disabled = true;
            fans("/api/ideas/vote", { member: t.memberKey(), id: idea.id }).then(function (r) {
              if (r._ok) { v.setAttribute("aria-pressed", String(r.voted)); n.textContent = String(r.votes); v.setAttribute("aria-label", "Vote for this idea, " + r.votes + " votes"); }
            }).catch(function () {}).then(function () { v.disabled = false; });
          });
          item.appendChild(txt); item.appendChild(v); list.appendChild(item);
        });
        empty.hidden = (b.ideas || []).length > 0;
        while (pending.firstChild) pending.removeChild(pending.firstChild);
        pending.hidden = !(b.pending || []).length;
        if (!pending.hidden) {
          pending.appendChild(el("strong", null, "Waiting for Nino's OK"));
          b.pending.forEach(function (p) { pending.appendChild(el("p", "hy-muted", "“" + p.text + "”")); });
        }
      }
      function loadIdeas() {
        var spin = list.firstChild ? null : inlineLoader();
        if (spin) { empty.hidden = true; list.appendChild(spin); }
        return fans("/api/ideas?member=" + encodeURIComponent(t.memberKey())).then(function (b) { if (b._ok) drawIdeas(b); })
          .catch(function () { if (spin && spin.parentNode) spin.parentNode.removeChild(spin); empty.hidden = false; empty.textContent = "You need a connection to see the ideas board."; });
      }
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var text = box.value.trim();
        if (text.length < 8) { msg.textContent = "Tell Nino a little more about your idea."; msg.className = "hy-status is-error"; return; }
        send.disabled = true; msg.textContent = "Sending…"; msg.className = "hy-status";
        fans("/api/ideas", { member: t.memberKey(), text: text, name: nm.value.trim() }).then(function (r) {
          if (r._ok) { box.value = ""; msg.textContent = "Thanks! Nino reads every idea. It shows on the board once he OKs it."; loadIdeas(); }
          else { msg.textContent = r.message || "That didn't send. Please try again."; msg.className = "hy-status is-error"; }
        }).catch(function () { msg.textContent = "You need a connection to send an idea."; msg.className = "hy-status is-error"; })
          .then(function () { send.disabled = false; });
      });
      loadIdeas();
    },
    cart: function (s) {
      var items = cartItems();
      if (thanks) {
        s.appendChild(header("Thank you", "Your order is in"));
        var done = el("div", "hy-card");
        done.appendChild(el("p", null, "Your payment went through. A confirmation email with your order details is on its way."));
        if (data.shop_note) done.appendChild(el("p", "hy-muted", data.shop_note));
        done.appendChild(button("Keep shopping", "hy-btn hy-btn-big", function () { thanks = null; show("shop"); }));
        s.appendChild(done);
        return;
      }
      s.appendChild(header("Cart", items.length ? cartUnits(items) + (cartUnits(items) === 1 ? " item" : " items") : "Nothing here yet"));
      if (!items.length) {
        var none = el("div", "hy-card");
        none.appendChild(el("p", null, "Your cart is empty. Pick a design, then the product, color and size."));
        none.appendChild(button("Browse the shop", "hy-btn hy-btn-big", function () { show("shop"); }));
        none.appendChild(button("Sizing, delivery and order help", "hy-link", function () { openWeb(data.links.help); }));
        s.appendChild(none);
        return;
      }
      var list = el("div", "hy-cart");
      items.forEach(function (i) {
        var row = el("div", "hy-cart-line");
        var pic = el("img"); pic.src = i.image || ""; pic.alt = ""; pic.loading = "lazy"; row.appendChild(pic);
        var info = el("div", "hy-cart-info");
        info.appendChild(el("strong", null, i.title));
        info.appendChild(el("span", "hy-muted", [i.label, [i.color, i.size].filter(Boolean).join(" / ")].filter(Boolean).join(" · ")));
        info.appendChild(el("span", "hy-price", money(i.price_cents) + " each"));
        var tools = el("div", "hy-cart-tools");
        tools.appendChild(stepper(i.quantity, Math.min(MAX_EACH, i.quantity + MAX_UNITS - cartUnits(items)), function (n) {
          var all = cartItems(); all.forEach(function (x) { if (x.variant_id === i.variant_id) x.quantity = n; }); saveCart(all); show("cart", { keep: true });
        }));
        var rm = button("Remove", "hy-linkbtn", function () { saveCart(cartItems().filter(function (x) { return x.variant_id !== i.variant_id; })); show("cart", { keep: true }); });
        rm.setAttribute("aria-label", "Remove " + i.title + " " + i.label);
        tools.appendChild(rm); info.appendChild(tools);
        row.appendChild(info); list.appendChild(row);
      });
      s.appendChild(list);

      var sum = el("div", "hy-card hy-sum");
      function line(label, value, cls) { var r = el("div", "hy-sum-row" + (cls ? " " + cls : "")); r.appendChild(el("span", null, label)); r.appendChild(el("strong", null, value)); sum.appendChild(r); }
      var subtotal = cartTotal(items);
      line("Items", money(subtotal));
      var rate = quote && rateId ? quote.rates.filter(function (r) { return r.id === rateId; })[0] : null;
      if (step === "rates" && rate) { line("Delivery", money(rate.amount)); line("Total before tax", money(subtotal + rate.amount), "hy-sum-total"); }
      if (data.shop_note) sum.appendChild(el("p", "hy-muted", data.shop_note));
      var msg = el("p", "hy-status" + (cartNote && /^!/.test(cartNote) ? " is-error" : ""), cartNote.replace(/^!/, "")); msg.setAttribute("role", "status"); msg.setAttribute("aria-live", "polite");
      function say(text, bad) { cartNote = (bad ? "!" : "") + text; msg.textContent = text; msg.className = "hy-status" + (bad ? " is-error" : ""); }
      s.appendChild(sum);

      if (step === "cart") {
        sum.appendChild(button("Checkout", "hy-btn hy-btn-big", function () { step = "address"; cartNote = ""; show("cart", { keep: true }); var f = document.getElementById("hy-address"); if (f && f.scrollIntoView) f.scrollIntoView({ block: "start" }); }));
        sum.appendChild(msg);
        sum.appendChild(button("Keep shopping", "hy-link", function () { show("shop"); }));
        return;
      }

      // ---- delivery address, then the shop's delivery prices for it ----
      if (!addr) addr = t.store.get("nino-address") || { name: "", address1: "", address2: "", city: "", state_code: "", zip: "", country_code: "US" };
      var form = el("form", "hy-card hy-form"); form.id = "hy-address"; form.noValidate = true;
      form.appendChild(el("h3", "hy-label hy-label-in", "Delivery address"));
      function field(key, label, auto, extra) {
        var l = el("label", null, label); l.setAttribute("for", "hy-a-" + key); form.appendChild(l);
        var i = el("input"); i.id = "hy-a-" + key; i.type = "text"; i.maxLength = 150; i.value = addr[key] || ""; i.setAttribute("autocomplete", "shipping " + auto);
        for (var k in extra || {}) i.setAttribute(k, extra[k]);
        i.addEventListener("input", function () { addr[key] = i.value; if (quote) { quote = null; rateId = null; attempt = null; step = "address"; } });
        form.appendChild(i); return i;
      }
      field("name", "Full name", "name");
      field("address1", "Street address", "address-line1");
      field("address2", "Apartment or suite (optional)", "address-line2");
      field("city", "City", "address-level2");
      field("state_code", "State or province", "address-level1", { autocapitalize: "characters", placeholder: "CA" });
      field("zip", "ZIP or postal code", "postal-code");
      var cl = el("label", null, "Country"); cl.setAttribute("for", "hy-a-country"); form.appendChild(cl);
      var sel = el("select"); sel.id = "hy-a-country"; sel.setAttribute("autocomplete", "shipping country");
      function fillCountries(codes) {
        while (sel.firstChild) sel.removeChild(sel.firstChild);
        var names = null; try { names = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) {}
        codes.map(function (c) { var n = c; try { n = (names && names.of(c)) || c; } catch (e) {} return { code: c, name: n }; })
          .sort(function (a, b) { return a.code === "US" ? -1 : b.code === "US" ? 1 : a.name.localeCompare(b.name); })
          .forEach(function (c) { var o = el("option", null, c.name); o.value = c.code; sel.appendChild(o); });
        sel.value = codes.indexOf(addr.country_code) >= 0 ? addr.country_code : codes[0]; addr.country_code = sel.value;
      }
      fillCountries(countries || ["US"]);
      if (!countries) fetch(data.fans_api + "/api/commerce-config").then(function (r) { return r.json(); }).then(function (c) {
        if (c && Array.isArray(c.shipping_countries) && c.shipping_countries.length) { countries = c.shipping_countries; if (document.body.contains(sel)) fillCountries(countries); }
      }).catch(function () {});
      sel.addEventListener("change", function () { addr.country_code = sel.value; if (quote) { quote = null; rateId = null; attempt = null; step = "address"; show("cart", { keep: true }); } });
      form.appendChild(sel);
      var get = button(step === "rates" ? "Update delivery prices" : "See delivery prices", step === "rates" ? "hy-btn hy-btn-ghost hy-btn-big" : "hy-btn hy-btn-big"); get.type = "submit";
      form.appendChild(get);
      if (step !== "rates") form.appendChild(msg);
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var a = {}; ["name", "address1", "address2", "city", "state_code", "zip", "country_code"].forEach(function (k) { a[k] = String(addr[k] || "").trim(); });
        a.state_code = a.state_code.toUpperCase();
        if (!a.name || !a.address1 || !a.city || !a.zip) { say("Fill in your name, street address, city and ZIP or postal code.", true); return; }
        if (a.country_code === "US" && !/^[A-Z]{2}$/.test(a.state_code)) { say("Use the two-letter state, like CA or NY.", true); return; }
        if ((a.country_code === "CA" || a.country_code === "AU") && !a.state_code) { say("Add the state or province.", true); return; }
        addr = a; t.store.set("nino-address", a);
        get.disabled = true; say("Getting delivery prices…");
        fans("/api/shipping-quotes", { items: cartPayload(cartItems()), recipient: a }).then(function (r) {
          if (r._ok && r.quote_id && Array.isArray(r.rates) && r.rates.length) {
            quote = r; rateId = r.rates.slice().sort(function (x, y) { return x.amount - y.amount; })[0].id; attempt = null; step = "rates"; cartNote = "";
            show("cart", { keep: true });
            var box = document.getElementById("hy-rates"); if (box && box.scrollIntoView) box.scrollIntoView({ block: "start" });
          } else { get.disabled = false; say(r.message || "Delivery prices couldn't be worked out for that address. Check it and try again.", true); }
        }).catch(function () { get.disabled = false; say("You need a connection to get delivery prices.", true); });
      });
      s.appendChild(form);
      if (step !== "rates" || !quote) return;

      var pay = el("div", "hy-card"); pay.id = "hy-rates";
      pay.appendChild(el("h3", "hy-label hy-label-in", "Delivery"));
      var opts = el("div", "hy-list hy-list-in"); opts.setAttribute("role", "radiogroup"); opts.setAttribute("aria-label", "Delivery");
      quote.rates.forEach(function (r) {
        var b = el("button", "hy-list-item hy-rate"); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(r.id === rateId));
        b.appendChild(el("strong", null, r.name)); b.appendChild(el("span", "hy-price", money(r.amount)));
        b.addEventListener("click", function () { rateId = r.id; attempt = null; show("cart", { keep: true }); });
        opts.appendChild(b);
      });
      pay.appendChild(opts);
      pay.appendChild(el("p", "hy-muted", "Sales tax, where it applies, is added on the payment page. Payment is on Stripe's secure page, opened inside the app."));
      var go = button("Continue to payment", "hy-btn hy-btn-big", function () {
        var list = cartPayload(cartItems());
        var sig = JSON.stringify([list, quote.quote_id, rateId]);
        // The same cart, address and delivery choice reopen the same payment page instead of starting a second order.
        if (!attempt || attempt.sig !== sig) attempt = { sig: sig, id: (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2) + "-nino-app").replace(/[^A-Za-z0-9_-]/g, "") };
        go.disabled = true; say("Opening the payment page…");
        fans("/api/checkout", { items: list, request_id: attempt.id, shipping_quote_id: quote.quote_id, shipping_rate_id: rateId, app_member: t.memberKey() }).then(function (r) {
          go.disabled = false;
          if (r._ok && /^https:\/\/checkout\.stripe\.com\//.test(r.checkout_url || "")) {
            t.store.set("nino-order", { id: r.order_id, token: r.receipt_token, at: Date.now() });
            say("Finish on the payment page. Your cart stays here until the payment goes through.");
            openWeb(r.checkout_url);
          } else if (r.error === "shipping_quote_expired" || r.error === "checkout_expired") { quote = null; rateId = null; attempt = null; step = "address"; cartNote = "!Delivery prices are only held for 15 minutes. Tap See delivery prices again."; show("cart", { keep: true }); }
          else say(r.message || "Payment couldn't be started. Please try again in a moment.", true);
        }).catch(function () { go.disabled = false; say("You need a connection to check out.", true); });
      });
      pay.appendChild(go); pay.appendChild(msg);
      s.appendChild(pay);
    }
  };

  // After the payment page closes: ask the shop whether that order was paid. If so the cart empties and the Cart tab
  // says thank you; if not, nothing changes and the buyer can go on.
  var orderCheck = null;
  function checkOrder(tries) {
    var o = t.store.get("nino-order");
    if (!o || !/^ord_[a-f0-9]{24}$/.test(o.id || "") || !o.token || Date.now() - (o.at || 0) > 2 * 3600000) { if (o) t.store.set("nino-order", null); return; }
    clearTimeout(orderCheck);
    fans("/api/orders/" + o.id + "?token=" + encodeURIComponent(o.token)).then(function (r) {
      if (r._ok && r.payment_status === "paid") {
        t.store.set("nino-order", null); t.store.set(CART_KEY, []);
        quote = null; rateId = null; attempt = null; step = "cart"; cartNote = ""; thanks = { id: o.id };
        cartBadge(); if (current === "cart") show("cart"); else if (current === "rewards") show("rewards", { keep: true });
      } else if (tries > 0) orderCheck = setTimeout(function () { checkOrder(tries - 1); }, 2500);
    }).catch(function () { if (tries > 0) orderCheck = setTimeout(function () { checkOrder(tries - 1); }, 2500); });
  }
  function watchPayment() {
    if (!data || data.kind !== "shop") return;
    var C = window.Capacitor;
    var plugin = C && C.isNativePlatform && C.isNativePlatform() ? ((C.Plugins && C.Plugins.Browser) || (C.registerPlugin ? C.registerPlugin("Browser") : null)) : null;
    if (plugin && plugin.addListener) { try { plugin.addListener("browserFinished", function () { checkOrder(6); }); } catch (e) {} }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) checkOrder(3); });
    checkOrder(1);
  }

  function load() {
    return fetch(cfg.hybrid_url, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (c) {
      if (!c || !c.ok || !Array.isArray(c.tabs) || !c.tabs.length) throw new Error("content");
      t.store.set("hybrid", c);
      var first = !data; data = c;
      if (first) { build(); show(c.tabs[0]); } else if (current) show(current, { keep: true, product: currentOpts.product });
      t.status("");
      document.body.classList.add("hy-ready");
      hideLoader();
    }).catch(function () {
      hideLoader();
      t.status(data ? "You're offline. Showing what we had last time." : "Couldn't load. Check your connection and try again.");
    });
  }

  // The loading screen: the app's own picture, spinning, until the first content is on screen.
  var loader = null, loaderAt = 0;
  // The loading picture: the app's own loading animation when it has one (Nino: the ring of fire, already animated),
  // else its logo, spinning (Menu-made's gear).
  function loaderPicture(cls) {
    var anim = /^https:\/\//.test(cfg.loader_url || "");
    if (!anim && !/^https:\/\//.test(cfg.logo_url || "")) return null;
    var img = el("img", cls + (anim ? " is-animated" : "")); img.src = anim ? cfg.loader_url : cfg.logo_url; img.alt = "";
    return img;
  }
  function showLoader() {
    var img = loaderPicture("hy-loader-img");
    if (!img) return;
    loader = el("div", "hy-loader"); loader.setAttribute("role", "status"); loader.setAttribute("aria-label", "Loading");
    loader.appendChild(img); document.body.appendChild(loader); loaderAt = Date.now();
  }
  // A small loading picture inside a screen (ideas, rewards), removed by the caller.
  function inlineLoader() {
    var box = el("div", "hy-inline-loader"); box.setAttribute("role", "status"); box.setAttribute("aria-label", "Loading");
    var img = loaderPicture("hy-inline-loader-img"); if (img) box.appendChild(img); else box.appendChild(el("span", "hy-muted", "Loading…"));
    return box;
  }

  // The opening clip (owner, Nov 8: Nino's logo animation), once per app start, no sound, with Skip. If it can't start
  // within a few seconds (no connection, the phone refuses autoplay) the app just goes on.
  function playIntro(done) {
    if (!/^https:\/\//.test(cfg.intro_url || "")) { done(); return; }
    var finished = false;
    var wrap = el("div", "hy-intro");
    var v = el("video", "hy-intro-video");
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = "auto";
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", ""); v.setAttribute("aria-hidden", "true");
    v.src = cfg.intro_url;
    var skip = button("Skip", "hy-intro-skip", function () { end(); });
    wrap.appendChild(v); wrap.appendChild(skip);
    document.body.appendChild(wrap);
    function end() {
      if (finished) return; finished = true;
      wrap.classList.add("is-done");
      setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 450);
      done();
    }
    var start = setTimeout(end, 3500);
    v.addEventListener("playing", function () { clearTimeout(start); setTimeout(end, 9000); });
    v.addEventListener("ended", end);
    v.addEventListener("error", end);
    var p = v.play(); if (p && p.catch) p.catch(end);
  }
  function hideLoader() {
    if (!loader) return;
    var l = loader; loader = null;
    setTimeout(function () { l.classList.add("is-done"); setTimeout(function () { if (l.parentNode) l.parentNode.removeChild(l); }, 400); }, Math.max(0, 900 - (Date.now() - loaderAt)));
  }

  window.MMHybrid = {
    start: function (config, tools) {
      cfg = config; t = tools;
      document.body.classList.add("hybrid");
      root = document.getElementById("hybrid"); root.hidden = false;
      showLoader();
      playIntro(function () {});
      var cached = t.store.get("hybrid");
      if (cached && cached.ok && Array.isArray(cached.tabs) && cached.tabs.length) { data = cached; build(); show(cached.tabs[0]); document.body.classList.add("hy-ready"); hideLoader(); }
      startPush();
      load().then(watchPayment);
      // Fresh content each time the app comes back to the front (the website may have changed).
      document.addEventListener("visibilitychange", function () { if (!document.hidden && current !== "preview") load(); });
    }
  };
})();
