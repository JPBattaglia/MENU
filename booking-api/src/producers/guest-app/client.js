// The Guest App's own script (app.js) and the push part of its service worker (stage 11 part 1).
// Served from the current code for every live app (serve.js), so apps built before stage 11 get notifications and
// rewards without a rebuild. The page allows only scripts from its own origin, so all of this lives in app.js.
// It adds two sections under the quick actions:
//   Notifications - "Turn on notifications" (Android and desktop browsers; iPhone once the app is on the Home Screen,
//                   iOS 16.4+). The subscription goes to ./api/push/subscribe.
//   Rewards       - only when the owner has set a reward: the card (visits so far / needed), a field for the code
//                   shown at the counter, Collect a visit, Use my reward. The card key stays in this phone's storage.
// Offline: the last known config and card are kept in localStorage and shown; the buttons say they need a connection.

const CLIENT_JS = `// Guest App: offline worker, notifications and rewards. Kept as a file because the page allows no inline script.
(function () {
  "use strict";
  var swReady = null;
  if ("serviceWorker" in navigator) swReady = navigator.serviceWorker.register("sw.js", { scope: "./" }).then(function () { return navigator.serviceWorker.ready; }).catch(function () { return null; });

  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem("mm-" + k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem("mm-" + k, JSON.stringify(v)); } catch (e) {} }
  };
  function api(path, body) {
    var init = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" } : { credentials: "same-origin", cache: "no-store" };
    return fetch("api/" + path, init).then(function (r) { return r.json().then(function (data) { data._status = r.status; return data; }); });
  }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    for (var k in attrs || {}) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    return node;
  }
  function keyBytes(b64) {
    var s = b64.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function memberKey() {
    var key = store.get("member");
    if (typeof key === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(key)) return key;
    var bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
    key = btoa(String.fromCharCode.apply(null, bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    store.set("member", key);
    return key;
  }

  var style = el("style");
  style.textContent = ".mm-btn{display:inline-block;font:inherit;font-weight:700;padding:12px 16px;border-radius:12px;border:2px solid currentColor;background:#fff;color:#1b1f23;margin:6px 8px 0 0;cursor:pointer}.mm-btn[disabled]{opacity:.5;cursor:default}.mm-note{color:#4b5560;font-size:15px;margin:8px 0 0}.mm-bar{height:12px;border-radius:6px;background:#e8ebee;overflow:hidden;margin:8px 0}.mm-bar span{display:block;height:100%;background:#1b1f23}.mm-code{font:inherit;font-size:22px;letter-spacing:4px;width:9em;max-width:100%;padding:8px 10px;border:2px solid #4b5560;border-radius:10px}.mm-done{border:3px solid #1b1f23;border-radius:12px;padding:12px;margin-top:10px;font-weight:700}";
  document.head.appendChild(style);
  var anchor = document.querySelector(".actions");
  function place(section) { if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(section, anchor.nextSibling); else document.body.appendChild(section); }

  // ---- notifications ----
  function pushSection(config) {
    if (!config.push || !config.push.enabled || !config.push.key) return;
    var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    var section = el("section", { "aria-labelledby": "mm-push-h" });
    section.appendChild(el("h2", { id: "mm-push-h" }, "News from us"));
    var note = el("p", { "class": "mm-note", "aria-live": "polite" });
    if (ios && !standalone) {
      note.textContent = "To get our specials and news as notifications on iPhone, first add this app to your Home Screen (Share, then Add to Home Screen), open it from there, and turn notifications on.";
      section.appendChild(note); place(section); return;
    }
    if (!supported) { return; }
    var button = el("button", { type: "button", "class": "mm-btn" }, "Turn on notifications");
    section.appendChild(button); section.appendChild(note); place(section);
    function show(on, text) { button.textContent = on ? "Turn off notifications" : "Turn on notifications"; button.setAttribute("aria-pressed", on ? "true" : "false"); note.textContent = text || (on ? "Notifications are on. We'll only send our specials and news." : "Get our specials and news on this phone."); }
    function current() { return swReady ? swReady.then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }) : Promise.resolve(null); }
    current().then(function (sub) { show(Boolean(sub) && Notification.permission === "granted"); });
    button.addEventListener("click", function () {
      button.disabled = true;
      current().then(function (sub) {
        if (sub) {
          var endpoint = sub.endpoint;
          return sub.unsubscribe().then(function () { return api("push/unsubscribe", { endpoint: endpoint }).catch(function () {}); }).then(function () { show(false, "Notifications are off."); });
        }
        return Notification.requestPermission().then(function (permission) {
          if (permission !== "granted") { show(false, "Notifications are blocked. You can allow them in this phone's settings for this app."); return; }
          return swReady.then(function (reg) {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.push.key) });
          }).then(function (newSub) {
            var data = newSub.toJSON();
            return api("push/subscribe", { endpoint: data.endpoint, keys: data.keys }).then(function (res) {
              if (res.ok) show(true); else { newSub.unsubscribe(); show(false, res.error || "That didn't work. Please try again."); }
            });
          });
        });
      }).catch(function () { show(false, "That didn't work. Check your connection and try again."); })
        .then(function () { button.disabled = false; });
    });
  }

  // ---- rewards ----
  function rewardsSection(config) {
    var loyalty = config.loyalty;
    if (!loyalty || !loyalty.enabled) return;
    var section = el("section", { "aria-labelledby": "mm-rewards-h" });
    section.appendChild(el("h2", { id: "mm-rewards-h" }, "Rewards"));
    var summary = el("p", { "aria-live": "polite" });
    var bar = el("div", { "class": "mm-bar", role: "progressbar", "aria-label": "Visits collected", "aria-valuemin": "0" }); var fill = el("span"); bar.appendChild(fill);
    var label = el("label", { "for": "mm-code" }, "Code shown at the counter");
    var input = el("input", { id: "mm-code", "class": "mm-code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", pattern: "[0-9 ]*" });
    var earn = el("button", { type: "button", "class": "mm-btn" }, "Collect a visit");
    var redeem = el("button", { type: "button", "class": "mm-btn" }, "Use my reward");
    var note = el("p", { "class": "mm-note", "aria-live": "polite" }, "Ask for the code when you pay, type it here, and collect a visit.");
    var done = el("div", { "class": "mm-done", role: "status", hidden: "" });
    section.appendChild(summary); section.appendChild(bar);
    var p = el("p"); p.appendChild(label); p.appendChild(el("br")); p.appendChild(input); section.appendChild(p);
    section.appendChild(earn); section.appendChild(redeem); section.appendChild(note); section.appendChild(done);
    place(section);
    function draw(card) {
      card = card || { points: 0, goal: loyalty.goal, reward: loyalty.reward };
      store.set("card", card);
      var goal = card.goal || loyalty.goal, points = Math.min(card.points || 0, goal);
      summary.textContent = (card.points || 0) + " of " + goal + " visits. Reward: " + (card.reward || loyalty.reward) + ".";
      fill.style.width = Math.round(points / goal * 100) + "%";
      bar.setAttribute("aria-valuemax", String(goal)); bar.setAttribute("aria-valuenow", String(points));
      redeem.disabled = (card.points || 0) < goal;
    }
    draw(store.get("card"));
    var member = store.get("member");
    if (member) api("loyalty", { action: "me", member: member }).then(function (res) { if (res.ok) draw(res.card); }).catch(function () {});
    function act(action) {
      var code = input.value.replace(/\\D/g, "");
      if (code.length !== 6) { note.textContent = "Please type the 6-digit code shown at the counter."; input.focus(); return; }
      earn.disabled = true; redeem.disabled = true; done.hidden = true;
      api("loyalty", { action: action, member: memberKey(), code: code }).then(function (res) {
        if (res.card) draw(res.card);
        if (!res.ok) { note.textContent = res.error || "That didn't work. Please try again."; return; }
        input.value = "";
        if (action === "earn") note.textContent = "Visit collected. Thank you!";
        else {
          note.textContent = "";
          done.textContent = "Reward used: " + loyalty.reward + ". Show this screen at the counter. " + new Date(res.at).toLocaleString();
          done.hidden = false;
        }
      }).catch(function () { note.textContent = "You need a connection to collect a visit. Please try again."; })
        .then(function () { earn.disabled = false; draw(store.get("card")); });
    }
    earn.addEventListener("click", function () { act("earn"); });
    redeem.addEventListener("click", function () { act("redeem"); });
  }

  function start(config) { if (!config) return; pushSection(config); rewardsSection(config); }
  var cached = store.get("config");
  api("config").then(function (config) { store.set("config", config); start(config); }).catch(function () { start(cached); });
})();
`;

// Appended to the offline worker: shows a notification and opens the app when it is tapped.
const PUSH_SW = `
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "News", {
    body: data.body || "", tag: data.tag || undefined, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: data.url || "./" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) if (client.url.startsWith(self.registration.scope) && "focus" in client) { client.navigate(target).catch(() => {}); return client.focus(); }
    return self.clients.openWindow(target);
  }));
});
`;

// Bumped when CLIENT_JS or PUSH_SW change, so installed apps pick up the new worker.
const CLIENT_VERSION = "e1";

export { CLIENT_JS, CLIENT_VERSION, PUSH_SW };
