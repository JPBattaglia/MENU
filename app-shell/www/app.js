// Store App screens (stage 11 part 2). Content comes from the restaurant's live app, <app>/api/content
// (booking-api/src/producers/guest-app/native.js), so menu and special changes reach the app with no store update.
// The last copy is kept on the phone and shown when offline. Rewards use the same card rules and counter code as the
// Guest App (<app>/api/loyalty); the card is a random key kept only on this phone. Notifications: native push (Apple or
// Firebase token registered at <app>/api/push/native; sent by booking-api/src/store-app/native-push.js). Android only
// when the build had google-services.json (config.push_android), or the push plugin would crash without Firebase.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem("mm-" + k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem("mm-" + k, JSON.stringify(v)); } catch (e) {} }
  };
  var cfg = null;

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    for (var k in attrs || {}) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function status(text) { var s = $("status"); s.textContent = text || ""; s.hidden = !text; }
  function api(path, body) {
    var init = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" };
    return fetch(cfg.api_base + "/" + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) { data._status = r.status; return data; });
    });
  }
  // Text on the brand colour: dark or light, whichever reads better.
  function inkOn(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#fff";
    var n = parseInt(m[1], 16), lum = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lum(n >> 16 & 255) + 0.7152 * lum(n >> 8 & 255) + 0.0722 * lum(n & 255);
    return L > 0.4 ? "#1b1f23" : "#fff";
  }
  function brand(hex) {
    document.documentElement.style.setProperty("--brand", hex);
    document.documentElement.style.setProperty("--ink-on-brand", inkOn(hex));
  }

  // ---- tabs ----
  function show(tab) {
    ["home", "menu", "rewards"].forEach(function (t) {
      $("tab-" + t).hidden = t !== tab;
      if (t === tab) $("t-" + t).setAttribute("aria-current", "page"); else $("t-" + t).removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
    if (tab === "rewards") refreshCard();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".tabs button"), function (b) {
    b.addEventListener("click", function () { show(b.getAttribute("data-tab")); });
  });

  // ---- content ----
  function render(c) {
    document.title = c.name || cfg.app_name;
    $("name").textContent = c.name || cfg.app_name;
    $("address").textContent = c.address || "";
    if (c.brand_color) brand(c.brand_color);
    if (c.icon_url) { $("logo").src = c.icon_url; $("logo").hidden = false; }
    var actions = $("actions"); clear(actions);
    [["Call", c.tel ? "tel:" + c.tel : ""], ["Directions", c.map_url], ["Order online", c.order_url], ["Book a table", c.reserve_url]].forEach(function (a) {
      if (!a[1]) return;
      var li = el("li"); li.appendChild(el("a", { href: a[1] }, a[0])); actions.appendChild(li);
    });
    $("specials").textContent = c.specials || "";
    $("specials-box").hidden = !c.specials;
    var hours = $("hours"); clear(hours);
    (c.hours || []).forEach(function (h) { hours.appendChild(el("dt", null, h.day || "Hours")); hours.appendChild(el("dd", null, h.time)); });
    var menu = $("menu"); clear(menu);
    if (!(c.menu || []).length) menu.appendChild(el("div", { "class": "card" }, "The menu will appear here soon."));
    (c.menu || []).forEach(function (s) {
      var card = el("div", { "class": "card" });
      if (s.name) card.appendChild(el("h2", null, s.name));
      var ul = el("ul");
      (s.items || []).forEach(function (i) {
        var li = el("li"); li.appendChild(el("span", { "class": "n" }, i.name));
        if (i.price) li.appendChild(el("span", { "class": "p" }, i.price));
        if (i.description) li.appendChild(el("span", { "class": "d" }, i.description));
        ul.appendChild(li);
      });
      card.appendChild(ul); menu.appendChild(card);
    });
    var loyalty = c.loyalty || {};
    $("rewards-on").hidden = !loyalty.enabled;
    $("rewards-off").hidden = !!loyalty.enabled;
    if (loyalty.enabled) $("reward-text").textContent = "Collect " + loyalty.goal + " visits for " + loyalty.reward + ".";
  }
  function loadContent() {
    return api("content").then(function (c) {
      if (!c.ok) throw new Error("content " + c._status);
      store.set("content", c); render(c); status("");
    }).catch(function () {
      status(store.get("content") ? "You're offline. Showing what we had last time." : "Couldn't load. Check your connection and try again.");
    });
  }

  // ---- rewards ----
  function memberKey() {
    var key = store.get("member");
    if (typeof key === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(key)) return key;
    var bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
    key = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    store.set("member", key);
    return key;
  }
  function showCard(card) {
    if (!card) return;
    store.set("card", card);
    $("reward-bar").style.width = Math.min(100, Math.round(100 * card.points / card.goal)) + "%";
    $("reward-count").textContent = card.points + " of " + card.goal + " visits";
    $("redeem").hidden = !card.can_redeem;
  }
  function refreshCard() {
    var c = store.get("content");
    if (!c || !c.loyalty || !c.loyalty.enabled) return;
    showCard(store.get("card"));
    api("loyalty", { action: "me", member: memberKey() }).then(function (r) { if (r.ok) showCard(r.card); }).catch(function () {});
  }
  function act(action) {
    var code = $("code").value.replace(/\D/g, "");
    var msg = $("reward-msg");
    if (code.length !== 6) { msg.textContent = "Type the 6-digit code shown at the counter."; return; }
    $("earn").disabled = $("redeem").disabled = true;
    msg.textContent = "Checking…";
    api("loyalty", { action: action, member: memberKey(), code: code }).then(function (r) {
      if (r.card) showCard(r.card);
      msg.textContent = r.ok ? (action === "earn" ? "Visit collected. Thank you!" : "Reward used. Enjoy!") : (r.error || "That didn't work. Please try again.");
      if (r.ok) $("code").value = "";
    }).catch(function () {
      msg.textContent = "You need a connection to collect a visit.";
    }).then(function () { $("earn").disabled = $("redeem").disabled = false; });
  }
  $("earn").addEventListener("click", function () { act("earn"); });
  $("redeem").addEventListener("click", function () { act("redeem"); });

  // ---- notifications ----
  // Capacitor's native bridge provides window.Capacitor; the plugin is reached without a bundler.
  function pushPlugin() {
    var C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    var p = C.getPlatform();
    if (p !== "ios" && !(p === "android" && cfg.push_android)) return null;
    return (C.Plugins && C.Plugins.PushNotifications) || (C.registerPlugin ? C.registerPlugin("PushNotifications") : null);
  }
  function pushMsg(text) { $("push-msg").textContent = text || ""; }
  function startPush() {
    var push = pushPlugin();
    if (!push) return;
    push.addListener("registration", function (t) {
      var platform = window.Capacitor.getPlatform();
      var token = String(t && t.value || "");
      if (platform === "ios") token = token.toLowerCase();
      if (!(platform === "ios" ? /^[0-9a-f]{64,200}$/ : /^[A-Za-z0-9_:-]{100,4096}$/).test(token)) return;
      // Re-sent when the token changes, and once a week so the restaurant's count stays right.
      var sent = store.get("push-sent") || {};
      if (sent.token === token && Date.now() - (sent.at || 0) < 7 * 86400000) { $("push-box").hidden = true; return; }
      api("push/native", { platform: platform, token: token, bundle_id: cfg.app_id, environment: cfg.push_environment || "production" }).then(function (r) {
        if (r.ok) { store.set("push-sent", { token: token, at: Date.now() }); pushMsg("Notifications are on."); setTimeout(function () { $("push-box").hidden = true; }, 2500); }
        else pushMsg(r.error || "Couldn't turn on notifications. Please try again later.");
      }).catch(function () { pushMsg("You need a connection to turn on notifications."); });
    });
    push.addListener("registrationError", function () { pushMsg("Couldn't turn on notifications. Please try again later."); });
    push.checkPermissions().then(function (p) {
      if (p.receive === "granted") { push.register(); return; }
      if (p.receive === "denied") return; // the guest said no; Settings is the only way back, so don't nag
      $("push-box").hidden = false;
      $("push-on").addEventListener("click", function () {
        $("push-on").disabled = true;
        push.requestPermissions().then(function (r) {
          if (r.receive === "granted") { pushMsg("Turning on…"); push.register(); }
          else { pushMsg("Notifications are off. You can turn them on later in Settings."); }
        }).catch(function () { pushMsg("Couldn't turn on notifications."); }).then(function () { $("push-on").disabled = false; });
      });
    }).catch(function () {});
  }

  // ---- start ----
  fetch("config.json").then(function (r) { return r.json(); }).then(function (c) {
    cfg = c;
    brand(c.brand_color);
    $("name").textContent = c.app_name;
    var cached = store.get("content");
    if (cached) render(cached);
    loadContent();
    document.addEventListener("visibilitychange", function () { if (!document.hidden) loadContent(); });
    startPush();
  }).catch(function () { status("This app couldn't start. Please reinstall it."); });
})();
