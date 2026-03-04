/* Menu-Made Accessibility Widget (site-wide) */
(function(){
  var KEY = "mm_a11y_widget_v1";
  var ICON_SRC = "Brainard Icon menu Ruby.png";

  var state = load() || {
    open: false,
    text: 0,           // 0..3
    contrast: false,
    underline: false,
    reduceMotion: false,
    grayscale: false,
    guide: false
  };

  function load(){
    try { return JSON.parse(localStorage.getItem(KEY) || ""); }
    catch(e){ return null; }
  }
  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e){}
  }

  function setAttr(name, val){
    var html = document.documentElement;
    if (val === false || val === 0 || val === null || typeof val === "undefined" || val === ""){
      html.removeAttribute(name);
    } else {
      html.setAttribute(name, String(val));
    }
  }

  function press(id, v){
    var el = document.getElementById(id);
    if (el) el.setAttribute("aria-pressed", v ? "true" : "false");
  }

  function apply(){
    setAttr("data-mm-a11y-text", state.text ? String(state.text) : "");
    setAttr("data-mm-a11y-contrast", state.contrast ? "1" : "");
    setAttr("data-mm-a11y-underline", state.underline ? "1" : "");
    setAttr("data-mm-a11y-reduce-motion", state.reduceMotion ? "1" : "");
    setAttr("data-mm-a11y-grayscale", state.grayscale ? "1" : "");
    setAttr("data-mm-a11y-guide", state.guide ? "1" : "");

    press("mmA11yContrast", state.contrast);
    press("mmA11yUnderline", state.underline);
    press("mmA11yMotion", state.reduceMotion);
    press("mmA11yGray", state.grayscale);
    press("mmA11yGuideBtn", state.guide);

    var t0 = document.getElementById("mmA11yText0");
    var t1 = document.getElementById("mmA11yText1");
    var t2 = document.getElementById("mmA11yText2");
    var t3 = document.getElementById("mmA11yText3");
    if (t0) t0.setAttribute("aria-pressed", state.text===0 ? "true":"false");
    if (t1) t1.setAttribute("aria-pressed", state.text===1 ? "true":"false");
    if (t2) t2.setAttribute("aria-pressed", state.text===2 ? "true":"false");
    if (t3) t3.setAttribute("aria-pressed", state.text===3 ? "true":"false");
  }

  function build(){
    if (document.getElementById("mmA11yLauncher")) return;

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "mm-a11y-launcher";
    launcher.id = "mmA11yLauncher";
    launcher.setAttribute("aria-label", "Accessibility tools");
    launcher.innerHTML = '<img src="' + ICON_SRC + '" alt="" aria-hidden="true">';

    var panel = document.createElement("aside");
    panel.className = "mm-a11y-panel";
    panel.id = "mmA11yPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Accessibility tools panel");
    panel.setAttribute("aria-hidden", state.open ? "false" : "true");

    panel.innerHTML =
      '<div class="mm-a11y-head">' +
        '<div>' +
          '<p class="mm-a11y-title">Menu-Made Accessibility</p>' +
          '<p class="mm-a11y-sub">We offer this as a paid service (widget + audit + fixes). These tools adjust the current site.</p>' +
        '</div>' +
        '<button type="button" class="mm-a11y-close" id="mmA11yClose" aria-label="Close">Close</button>' +
      '</div>' +
      '<div class="mm-a11y-body">' +

        '<div class="mm-a11y-grid" aria-label="Text size">' +
          '<button type="button" class="mm-a11y-btn" id="mmA11yText0" aria-pressed="false">Text: Default</button>' +
          '<button type="button" class="mm-a11y-btn" id="mmA11yText1" aria-pressed="false">Text: Large</button>' +
          '<button type="button" class="mm-a11y-btn" id="mmA11yText2" aria-pressed="false">Text: XL</button>' +
          '<button type="button" class="mm-a11y-btn" id="mmA11yText3" aria-pressed="false">Text: XXL</button>' +
        '</div>' +

        '<div class="mm-a11y-divider"></div>' +

        '<div class="mm-a11y-grid" aria-label="Visual controls">' +
          '<button type="button" class="mm-a11y-btn" id="mmA11yContrast" aria-pressed="false">High Contrast</button>' +
          '<button type="button" class="mm-a11y-btn" id="mmA11yUnderline" aria-pressed="false">Underline Links</button>' +
          '<button type="button" class="mm-a11y-btn" id="mmA11yMotion" aria-pressed="false">Reduce Motion</button>' +
          '<button type="button" class="mm-a11y-btn" id="mmA11yGray" aria-pressed="false">Grayscale</button>' +
          '<button type="button" class="mm-a11y-btn mm-a11y-wide" id="mmA11yGuideBtn" aria-pressed="false">Reading Guide</button>' +
        '</div>' +

        '<div class="mm-a11y-divider"></div>' +

        '<div class="mm-a11y-grid" aria-label="Actions">' +
          '<button type="button" class="mm-a11y-btn mm-a11y-wide" id="mmA11yReset" aria-pressed="false">Reset</button>' +
        '</div>' +

        '<div class="mm-a11y-divider"></div>' +

        '<div class="mm-a11y-footer">' +
          '<div><strong>Service options:</strong> (1) Menu-Made Toolkit (this widget + remediation) or (2) accessiBe install.</div>' +
          '<div style="margin-top:8px;"><a href="contact.html?service=accessibility">Request accessibility service</a> • <a href="accessability.html">Statement</a></div>' +
        '</div>' +

      '</div>';

    var guide = document.createElement("div");
    guide.className = "mm-a11y-guide";
    guide.id = "mmA11yGuide";

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    document.body.appendChild(guide);

    // Open/close
    launcher.addEventListener("click", function(){
      state.open = !state.open;
      save();
      panel.setAttribute("aria-hidden", state.open ? "false" : "true");
      if (state.open){
        var close = document.getElementById("mmA11yClose");
        if (close) close.focus();
      }
    });

    panel.addEventListener("keydown", function(e){
      if (e.key === "Escape"){
        state.open = false;
        save();
        panel.setAttribute("aria-hidden","true");
        launcher.focus();
      }
    });

    var closeBtn = document.getElementById("mmA11yClose");
    if (closeBtn){
      closeBtn.addEventListener("click", function(){
        state.open = false;
        save();
        panel.setAttribute("aria-hidden","true");
        launcher.focus();
      });
    }

    // Actions
    on("mmA11yText0", function(){ state.text = 0; save(); apply(); });
    on("mmA11yText1", function(){ state.text = 1; save(); apply(); });
    on("mmA11yText2", function(){ state.text = 2; save(); apply(); });
    on("mmA11yText3", function(){ state.text = 3; save(); apply(); });

    on("mmA11yContrast", function(){ state.contrast = !state.contrast; save(); apply(); });
    on("mmA11yUnderline", function(){ state.underline = !state.underline; save(); apply(); });
    on("mmA11yMotion", function(){ state.reduceMotion = !state.reduceMotion; save(); apply(); });
    on("mmA11yGray", function(){ state.grayscale = !state.grayscale; save(); apply(); });
    on("mmA11yGuideBtn", function(){ state.guide = !state.guide; save(); apply(); });

    on("mmA11yReset", function(){
      state.text = 0;
      state.contrast = false;
      state.underline = false;
      state.reduceMotion = false;
      state.grayscale = false;
      state.guide = false;
      save();
      apply();
    });

    // Move guide line
    window.addEventListener("mousemove", function(e){
      if (!state.guide) return;
      guide.style.top = Math.max(0, Math.min(window.innerHeight - 34, e.clientY - 17)) + "px";
    }, { passive:true });

    window.addEventListener("touchmove", function(e){
      if (!state.guide) return;
      if (!e.touches || !e.touches[0]) return;
      var y = e.touches[0].clientY;
      guide.style.top = Math.max(0, Math.min(window.innerHeight - 34, y - 17)) + "px";
    }, { passive:true });

    function on(id, fn){
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", fn);
    }

    apply();
  }

  function ready(fn){
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(build);
})();