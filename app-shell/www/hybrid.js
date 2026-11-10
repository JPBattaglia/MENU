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
      var wrap = el("span", "hy-wordwrap"); wrap.appendChild(word); wrap.appendChild(el("span", "hy-tagline", "Graphic Design & Branding"));
      bar.appendChild(wrap);
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
  function productPage(s, p) {
    var bar = el("div", "hy-bar");
    var back = el("button", "hy-icon-btn"); back.type = "button"; back.setAttribute("aria-label", "Back to the shop"); back.appendChild(icon("back"));
    back.addEventListener("click", function () { show("shop"); });
    bar.appendChild(back); bar.appendChild(el("strong", null, p.title)); s.appendChild(bar);
    var img = el("img", "hy-hero-img"); img.src = p.image; img.alt = p.title + " shirt"; s.appendChild(img);
    var body = el("div", "hy-pad");
    if (p.early) body.appendChild(el("p", "hy-badge", "App first: on the website in 24 hours"));
    var top = el("div", "hy-plan-top"); top.appendChild(el("h2", null, p.title)); top.appendChild(el("strong", "hy-price", "From " + money(p.price_cents)));
    body.appendChild(top);
    if (p.description) body.appendChild(el("p", null, p.description));
    if (p.colors.length) {
      body.appendChild(el("h3", "hy-label", p.colors.length + " colors"));
      var sw = el("div", "hy-swatches");
      p.colors.forEach(function (c) { var d = el("span", "hy-swatch"); d.style.background = c.hex; d.setAttribute("role", "img"); d.setAttribute("aria-label", c.name); d.title = c.name; sw.appendChild(d); });
      body.appendChild(sw);
    }
    if (p.sizes.length) { body.appendChild(el("h3", "hy-label", "Sizes")); body.appendChild(el("p", null, p.sizes.join(", "))); }
    body.appendChild(button("Choose size, color and product", "hy-btn hy-btn-big", function () { openWeb(p.buy_url); }));
    body.appendChild(el("p", "hy-muted", "Opens Nino's shop inside the app: pick the product (shirt, mug, sticker and more), size and color, then checkout with Stripe. " + (data.shop_note || "")));
    body.appendChild(button("See the design page", "hy-link", function () { openWeb(p.url); }));
    s.appendChild(body);
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
    work: function (s) {
      s.appendChild(header("Work", "Nino's design and branding"));
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
      s.appendChild(header("Cart", "Checkout with Stripe, inside the app"));
      var card = el("div", "hy-card");
      card.appendChild(el("p", null, "Your cart keeps what you picked in the shop. Shipping for your address is shown before you pay."));
      card.appendChild(button("Open my cart", "hy-btn hy-btn-big", function () { openWeb(data.links.cart); }));
      card.appendChild(button("Sizing, delivery and order help", "hy-link", function () { openWeb(data.links.help); }));
      s.appendChild(card);
    }
  };

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
      load();
      // Fresh content each time the app comes back to the front (the website may have changed).
      document.addEventListener("visibilitychange", function () { if (!document.hidden && current !== "preview") load(); });
    }
  };
})();
