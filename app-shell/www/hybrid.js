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
    bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0"
  };
  var LABELS = { home: "Home", preview: "Preview", plans: "Plans", account: "Account", shop: "Shop", work: "Work", rewards: "Rewards", cart: "Cart" };

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
    var C = window.Capacitor;
    var plugin = C && C.isNativePlatform && C.isNativePlatform() ? ((C.Plugins && C.Plugins.Browser) || (C.registerPlugin ? C.registerPlugin("Browser") : null)) : null;
    if (plugin) { plugin.open({ url: url, toolbarColor: cfg.brand_color }).catch(function () { window.open(url, "_blank"); }); return; }
    window.open(url, "_blank", "noopener");
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
  function header(title, sub) {
    var h = el("header", "hy-head");
    var box = el("div"); box.appendChild(el("h1", null, title)); if (sub) box.appendChild(el("p", null, sub));
    h.appendChild(box);
    return h;
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
      s.appendChild(header(data.name, data.tagline));
      var hero = el("div", "hy-hero");
      hero.appendChild(el("p", "hy-eyebrow", data.tagline));
      hero.appendChild(el("h2", null, data.hero.title));
      hero.appendChild(button(data.hero.action, "hy-btn hy-btn-light", function () { show("preview"); }));
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
      var head = header(data.name, data.tagline);
      var label = el("label", "hy-sr", "Search designs"); label.setAttribute("for", "hy-q");
      var q = el("input", "hy-search"); q.id = "hy-q"; q.type = "search"; q.placeholder = "Search designs"; q.value = query;
      head.appendChild(label); head.appendChild(q); s.appendChild(head);
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
      s.appendChild(header("Rewards", "For Nino's regulars"));
      var card = el("div", "hy-member");
      card.appendChild(el("p", "hy-eyebrow", "NINO MEMBER"));
      card.appendChild(el("h2", null, data.rewards && data.rewards.enabled ? "Your points" : "Coming soon"));
      card.appendChild(el("p", null, (data.rewards && data.rewards.note) || ""));
      s.appendChild(card);
      s.appendChild(pushCard("New drop alerts", "Get a notification when Nino releases a new design."));
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
    }).catch(function () {
      t.status(data ? "You're offline. Showing what we had last time." : "Couldn't load. Check your connection and try again.");
    });
  }

  window.MMHybrid = {
    start: function (config, tools) {
      cfg = config; t = tools;
      document.body.classList.add("hybrid");
      root = document.getElementById("hybrid"); root.hidden = false;
      var cached = t.store.get("hybrid");
      if (cached && cached.ok && Array.isArray(cached.tabs) && cached.tabs.length) { data = cached; build(); show(cached.tabs[0]); document.body.classList.add("hy-ready"); }
      startPush();
      load();
      // Fresh content each time the app comes back to the front (the website may have changed).
      document.addEventListener("visibilitychange", function () { if (!document.hidden && current !== "preview") load(); });
    }
  };
})();
