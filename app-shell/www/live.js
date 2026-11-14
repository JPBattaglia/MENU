// Live screen updates (owner, Nov 14, 2026: "every site change on menu or Nino website must automatically update the
// apps"). The app's screens (hybrid.js, app.js, app.css) are also served by the website at
// https://menu-made.com/app-shell/www/, redeployed on every merge to the MENU repo. This loader runs the newest copy
// it has: at launch it uses the copy saved on the phone (works offline), checks the website for a newer one in the
// background, saves it, and switches to it the next time the app comes back to the screen. So a screen change merged
// to the MENU repo reaches every installed app with no App Store / Google Play build. Only native changes (icon,
// splash, a new phone feature or plugin) still need a store build.
//
// Safety:
//  - Each live file names the oldest app build it can run on ("live-shell-min: N" in its first lines). A file that
//    needs a newer build than this one (SHELL below) is ignored, and the bundled copy runs instead.
//  - If a saved copy throws an error while starting, the next launch runs the bundled copy and that copy is skipped
//    until the website has a different one.
//  - Script code only runs from this app's own files or from a blob made of text fetched over https from
//    menu-made.com (CSP: script-src 'self' blob:).
(function () {
  "use strict";
  var SHELL = 2; // raise this when a build adds something native that live code then relies on
  var BASE = "https://menu-made.com/app-shell/www/";
  var FILES = ["hybrid.js", "app.js", "app.css"];
  var KEY = "mm-live-code", BAD = "mm-live-bad", TRY = "mm-live-trying";
  function get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function put(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function shellMin(text) { var m = /live-shell-min:\s*(\d+)/.exec(String(text).slice(0, 4000)); return m ? Number(m[1]) : 1; }
  function hash(text) { var h = 2166136261; for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + "." + text.length; }
  function usable(set) {
    if (!set || set.shell !== SHELL || !set.files) return false;
    for (var i = 0; i < FILES.length; i++) if (typeof set.files[FILES[i]] !== "string" || !set.files[FILES[i]]) return false;
    var bad = get(BAD); return !(bad && bad === set.id);
  }

  // A saved copy that was started last time and never reported a clean start is marked bad.
  var saved = get(KEY), trying = get(TRY);
  if (trying && saved && trying === saved.id) put(BAD, saved.id);
  put(TRY, null);
  var running = usable(saved) ? saved : null;

  function load() {
    if (running) {
      put(TRY, running.id);
      var style = document.createElement("style"); style.textContent = running.files["app.css"];
      var link = document.querySelector('link[href="app.css"]'); if (link) link.disabled = true;
      document.head.appendChild(style);
    }
    ["hybrid.js", "app.js"].forEach(function (f) {
      var sc = document.createElement("script"); sc.async = false;
      sc.src = running ? URL.createObjectURL(new Blob([running.files[f]], { type: "text/javascript" })) : f;
      document.body.appendChild(sc);
    });
    if (running) {
      var failed = false;
      window.addEventListener("error", function (ev) { if (ev && /^blob:/.test(ev.filename || "")) failed = true; });
      setTimeout(function () { if (!failed) put(TRY, null); }, 6000);
    }
  }
  load();

  // Background check for newer screens; applied when the app next comes back to the screen (or next launch).
  var fresh = null, hiddenAt = 0;
  function check() {
    var stamp = Date.now();
    Promise.all(FILES.map(function (f) {
      return fetch(BASE + f + "?t=" + stamp, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(f); return r.text(); });
    })).then(function (texts) {
      var files = {}, id = "", need = 1;
      FILES.forEach(function (f, i) { files[f] = texts[i]; id += hash(texts[i]); need = Math.max(need, shellMin(texts[i])); });
      if (need > SHELL || texts[0].indexOf("MMHybrid") < 0 || texts[1].indexOf("hybrid_url") < 0) return;
      if (running && running.id === id) return;
      if (!running && saved && saved.id === id && get(BAD) === id) return;
      var set = { id: id, shell: SHELL, files: files, at: stamp };
      if (put(KEY, set)) fresh = set;
    }).catch(function () {});
  }
  setTimeout(check, 2500);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (fresh && hiddenAt && Date.now() - hiddenAt > 20000) { location.reload(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 600000) check();
  });
  window.MMLive = { shell: SHELL, running: running ? running.id : "bundled" };
})();
