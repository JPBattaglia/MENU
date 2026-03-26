/* Menu-Made Accessibility Widget (portable) — PRODUCTION BUILD */
(function(){
  if (window.MenuMadeAccessibilityWidgetLoaded) return;
  window.MenuMadeAccessibilityWidgetLoaded = true;

  var KEY = "mm_a11y_widget_v4";
  var ICON_SRC = window.MM_A11Y_ICON_SRC || "Brainard Icon menu Ruby.png";

  var DEFAULTS = {
    open: false,

    text: 0,
    contentScale: 0,
    lineHeight: 0,
    letterSpacing: 0,

    contrastMode: "",
    saturationMode: "",

    underline: false,
    reduceMotion: false,
    grayscale: false,
    guide: false,

    readableFont: false,
    highlightTitles: false,
    highlightLinks: false,
    focusHighlight: false,
    hideImages: false,
    muteSounds: false,

    textColor: "",
    titleColor: "",
    bgColor: "",

    align: ""
  };

  var COLORS = {
    blue: "#0b7ac5",
    purple: "#7c4dff",
    red: "#d93025",
    orange: "#ef6c00",
    teal: "#00897b",
    green: "#2e7d32",
    white: "#ffffff",
    black: "#000000"
  };

  var state = load();

  function clone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  function load(){
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULTS);
      return Object.assign(clone(DEFAULTS), JSON.parse(raw));
    } catch(e){
      return clone(DEFAULTS);
    }
  }

  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e){}
  }

  function setAttr(name, val){
    var html = document.documentElement;
    if (
      val === false ||
      val === 0 ||
      val === null ||
      typeof val === "undefined" ||
      val === ""
    ){
      html.removeAttribute(name);
    } else {
      html.setAttribute(name, String(val));
    }
  }

  function press(id, v){
    var el = document.getElementById(id);
    if (el) el.setAttribute("aria-pressed", v ? "true" : "false");
  }

  function current(id, isCurrent){
    var el = document.getElementById(id);
    if (el) el.setAttribute("aria-pressed", isCurrent ? "true" : "false");
  }

  function cap(str){
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function labelFor(n){
    if (n === 0) return "Default";
    if (n === 1) return "10%";
    if (n === 2) return "25%";
    return "50%";
  }

  function applyColorVars(){
    var html = document.documentElement;
    html.style.setProperty("--mm-a11y-user-text-color", state.textColor ? COLORS[state.textColor] : "");
    html.style.setProperty("--mm-a11y-user-title-color", state.titleColor ? COLORS[state.titleColor] : "");
    html.style.setProperty("--mm-a11y-user-bg-color", state.bgColor ? COLORS[state.bgColor] : "");

    setAttr("data-mm-a11y-has-text-color", state.textColor ? "1" : "");
    setAttr("data-mm-a11y-has-title-color", state.titleColor ? "1" : "");
    setAttr("data-mm-a11y-has-bg-color", state.bgColor ? "1" : "");
  }

  function applyMediaMute(){
    if (!state.muteSounds) return;
    var media = document.querySelectorAll("audio, video");
    media.forEach(function(el){
      try { el.muted = true; } catch(e){}
    });
  }

  function updateValueLabels(){
    var map = {
      mmA11yTextValue: labelFor(state.text),
      mmA11yContentValue: labelFor(state.contentScale),
      mmA11yLineValue: labelFor(state.lineHeight),
      mmA11yLetterValue: labelFor(state.letterSpacing)
    };

    Object.keys(map).forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.textContent = map[id];
    });
  }

  function updateTextButtons(){
    ["0","1","2","3"].forEach(function(n){
      var el = document.getElementById("mmA11yText" + n);
      if (el) el.setAttribute("aria-pressed", state.text === Number(n) ? "true" : "false");
    });
  }

  function updateColorButtons(){
    var groups = [
      { prefix: "mmTextColor", value: state.textColor },
      { prefix: "mmTitleColor", value: state.titleColor },
      { prefix: "mmBgColor", value: state.bgColor }
    ];

    groups.forEach(function(group){
      ["blue","purple","red","orange","teal","green","white","black"].forEach(function(name){
        var el = document.getElementById(group.prefix + cap(name));
        if (el) el.setAttribute("aria-pressed", group.value === name ? "true" : "false");
      });
    });
  }

  function apply(){
    setAttr("data-mm-a11y-text", state.text ? String(state.text) : "");
    setAttr("data-mm-a11y-content-scale", state.contentScale ? String(state.contentScale) : "");
    setAttr("data-mm-a11y-line-height", state.lineHeight ? String(state.lineHeight) : "");
    setAttr("data-mm-a11y-letter-spacing", state.letterSpacing ? String(state.letterSpacing) : "");

    setAttr("data-mm-a11y-contrast", state.contrastMode || "");
    setAttr("data-mm-a11y-saturation", state.saturationMode || "");

    setAttr("data-mm-a11y-underline", state.underline ? "1" : "");
    setAttr("data-mm-a11y-reduce-motion", state.reduceMotion ? "1" : "");
    setAttr("data-mm-a11y-grayscale", state.grayscale ? "1" : "");
    setAttr("data-mm-a11y-guide", state.guide ? "1" : "");

    setAttr("data-mm-a11y-readable-font", state.readableFont ? "1" : "");
    setAttr("data-mm-a11y-highlight-titles", state.highlightTitles ? "1" : "");
    setAttr("data-mm-a11y-highlight-links", state.highlightLinks ? "1" : "");
    setAttr("data-mm-a11y-focus", state.focusHighlight ? "1" : "");
    setAttr("data-mm-a11y-hide-images", state.hideImages ? "1" : "");
    setAttr("data-mm-a11y-align", state.align || "");

    press("mmA11yUnderline", state.underline);
    press("mmA11yMotion", state.reduceMotion);
    press("mmA11yGray", state.grayscale);
    press("mmA11yGuideBtn", state.guide);
    press("mmA11yReadable", state.readableFont);
    press("mmA11yTitles", state.highlightTitles);
    press("mmA11yLinks", state.highlightLinks);
    press("mmA11yFocus", state.focusHighlight);
    press("mmA11yImages", state.hideImages);
    press("mmA11yMute", state.muteSounds);

    current("mmA11yAlignLeft", state.align === "left");
    current("mmA11yAlignCenter", state.align === "center");
    current("mmA11yAlignRight", state.align === "right");

    current("mmA11yDarkContrast", state.contrastMode === "dark");
    current("mmA11yLightContrast", state.contrastMode === "light");
    current("mmA11yHighContrast", state.contrastMode === "high");

    current("mmA11yLowSat", state.saturationMode === "low");
    current("mmA11yHighSat", state.saturationMode === "high");
    current("mmA11yMono", state.saturationMode === "mono");

    updateTextButtons();
    updateColorButtons();
    updateValueLabels();
    applyColorVars();
    applyMediaMute();
  }

  function resetState(){
    state = clone(DEFAULTS);
    save();
    apply();
  }

  function section(title, inner){
    return (
      '<section class="mm-a11y-section">' +
        '<h3 class="mm-a11y-section-title">' + title + '</h3>' +
        inner +
      '</section>'
    );
  }

  function btn(id, text, cls){
    return '<button type="button" class="' + (cls || 'mm-a11y-btn') + '" id="' + id + '" aria-pressed="false">' + text + '</button>';
  }

  function sliderRow(label, downId, upId, valueId){
    return (
      '<div class="mm-a11y-slider-row">' +
        '<div class="mm-a11y-slider-label">' + label + '</div>' +
        '<div class="mm-a11y-slider-controls">' +
          '<button type="button" class="mm-a11y-step" id="' + downId + '" aria-label="' + label + ' down">−</button>' +
          '<div class="mm-a11y-step-value" id="' + valueId + '">Default</div>' +
          '<button type="button" class="mm-a11y-step" id="' + upId + '" aria-label="' + label + ' up">+</button>' +
        '</div>' +
      '</div>'
    );
  }

  function colorRow(label, prefix){
    var names = ["blue","purple","red","orange","teal","green","white","black"];
    var html =
      '<div class="mm-a11y-color-row">' +
        '<div class="mm-a11y-color-label">' + label + '</div>' +
        '<div class="mm-a11y-swatches">';

    names.forEach(function(name){
      html +=
        '<button type="button" class="mm-a11y-swatch mm-a11y-swatch-' + name + '"' +
        ' id="' + prefix + cap(name) + '"' +
        ' aria-label="' + label + ' ' + name + '"' +
        ' aria-pressed="false"></button>';
    });

    html +=
        '</div>' +
        '<button type="button" class="mm-a11y-cancel" id="' + prefix + 'Cancel">Cancel</button>' +
      '</div>';

    return html;
  }

  function bindColors(prefix, key){
    ["blue","purple","red","orange","teal","green","white","black"].forEach(function(name){
      on(prefix + cap(name), function(){
        state[key] = state[key] === name ? "" : name;
        save();
        apply();
      });
    });

    on(prefix + "Cancel", function(){
      state[key] = "";
      save();
      apply();
    });
  }

  function step(id, key, delta, min, max){
    on(id, function(){
      state[key] = Math.max(min, Math.min(max, state[key] + delta));
      save();
      apply();
    });
  }

  function on(id, fn){
    var el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  }

  function ensureCssLoaded(){
    var href = window.MM_A11Y_CSS_HREF;
    if (!href) return;
    if (document.querySelector('link[data-mm-a11y-css="1"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-mm-a11y-css", "1");
    document.head.appendChild(link);
  }

  function build(){
    if (document.getElementById("mmA11yLauncher")) return;

    ensureCssLoaded();

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "mm-a11y-launcher";
    launcher.id = "mmA11yLauncher";
    launcher.setAttribute("aria-label", "Accessibility tools");
    launcher.innerHTML =
      '<img src="' + ICON_SRC + '" alt="Accessibility" class="mm-a11y-launcher-img">';

    var panel = document.createElement("aside");
    panel.className = "mm-a11y-panel";
    panel.id = "mmA11yPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Accessibility tools panel");
    panel.setAttribute("aria-hidden", state.open ? "false" : "true");

    panel.innerHTML =
      '<div class="mm-a11y-head">' +
        '<div class="mm-a11y-head-copy">' +
          '<p class="mm-a11y-title">Menu-Made Accessibility</p>' +
          '<p class="mm-a11y-sub">Usability controls that improve readability, contrast, focus, and interaction.</p>' +
        '</div>' +
        '<button type="button" class="mm-a11y-close" id="mmA11yClose" aria-label="Close">Close</button>' +
      '</div>' +

      '<div class="mm-a11y-body">' +

        section(
          "Content Adjustments",
          sliderRow("Text Size", "mmA11yTextDown", "mmA11yTextUp", "mmA11yTextValue") +
          '<div class="mm-a11y-grid mm-a11y-grid-4" aria-label="Text presets">' +
            btn("mmA11yText0", "Default") +
            btn("mmA11yText1", "Large") +
            btn("mmA11yText2", "XL") +
            btn("mmA11yText3", "XXL") +
          '</div>' +

          sliderRow("Content Scaling", "mmA11yContentDown", "mmA11yContentUp", "mmA11yContentValue") +
          sliderRow("Line Height", "mmA11yLineDown", "mmA11yLineUp", "mmA11yLineValue") +
          sliderRow("Letter Spacing", "mmA11yLetterDown", "mmA11yLetterUp", "mmA11yLetterValue") +

          '<div class="mm-a11y-grid">' +
            btn("mmA11yReadable", "Readable Font") +
            btn("mmA11yTitles", "Highlight Titles") +
            btn("mmA11yLinks", "Highlight Links") +
            btn("mmA11yUnderline", "Underline Links") +
          '</div>' +

          '<div class="mm-a11y-align-row">' +
            btn("mmA11yAlignLeft", "Align Left", "mm-a11y-btn mm-a11y-pill-btn") +
            btn("mmA11yAlignCenter", "Align Center", "mm-a11y-btn mm-a11y-pill-btn") +
            btn("mmA11yAlignRight", "Align Right", "mm-a11y-btn mm-a11y-pill-btn") +
          '</div>'
        ) +

        section(
          "Color Adjustments",
          '<div class="mm-a11y-grid">' +
            btn("mmA11yDarkContrast", "Dark Contrast") +
            btn("mmA11yLightContrast", "Light Contrast") +
            btn("mmA11yHighContrast", "High Contrast") +
            btn("mmA11yGray", "Grayscale") +
            btn("mmA11yLowSat", "Low Saturation") +
            btn("mmA11yHighSat", "High Saturation") +
            btn("mmA11yMono", "Monochrome") +
            btn("mmA11yImages", "Hide Images") +
          '</div>' +

          colorRow("Text Color", "mmTextColor") +
          colorRow("Title Color", "mmTitleColor") +
          colorRow("Background Color", "mmBgColor")
        ) +

        section(
          "Orientation & Interaction",
          '<div class="mm-a11y-grid">' +
            btn("mmA11yMotion", "Stop Animations") +
            btn("mmA11yFocus", "Highlight Focus") +
            btn("mmA11yGuideBtn", "Reading Guide") +
            btn("mmA11yMute", "Mute Sounds") +
          '</div>'
        ) +

        section(
          "Actions",
          '<div class="mm-a11y-grid">' +
            btn("mmA11yReset", "Reset Settings", "mm-a11y-btn mm-a11y-wide") +
          '</div>'
        ) +

      '</div>';

    var guide = document.createElement("div");
    guide.className = "mm-a11y-guide";
    guide.id = "mmA11yGuide";

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    document.body.appendChild(guide);

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
        panel.setAttribute("aria-hidden", "true");
        launcher.focus();
      }
    });

    on("mmA11yClose", function(){
      state.open = false;
      save();
      panel.setAttribute("aria-hidden", "true");
      launcher.focus();
    });

    on("mmA11yText0", function(){ state.text = 0; save(); apply(); });
    on("mmA11yText1", function(){ state.text = 1; save(); apply(); });
    on("mmA11yText2", function(){ state.text = 2; save(); apply(); });
    on("mmA11yText3", function(){ state.text = 3; save(); apply(); });

    step("mmA11yTextDown", "text", -1, 0, 3);
    step("mmA11yTextUp", "text", 1, 0, 3);
    step("mmA11yContentDown", "contentScale", -1, 0, 3);
    step("mmA11yContentUp", "contentScale", 1, 0, 3);
    step("mmA11yLineDown", "lineHeight", -1, 0, 3);
    step("mmA11yLineUp", "lineHeight", 1, 0, 3);
    step("mmA11yLetterDown", "letterSpacing", -1, 0, 3);
    step("mmA11yLetterUp", "letterSpacing", 1, 0, 3);

    on("mmA11yUnderline", function(){ state.underline = !state.underline; save(); apply(); });
    on("mmA11yMotion", function(){ state.reduceMotion = !state.reduceMotion; save(); apply(); });
    on("mmA11yGray", function(){ state.grayscale = !state.grayscale; save(); apply(); });
    on("mmA11yGuideBtn", function(){ state.guide = !state.guide; save(); apply(); });
    on("mmA11yReadable", function(){ state.readableFont = !state.readableFont; save(); apply(); });
    on("mmA11yTitles", function(){ state.highlightTitles = !state.highlightTitles; save(); apply(); });
    on("mmA11yLinks", function(){ state.highlightLinks = !state.highlightLinks; save(); apply(); });
    on("mmA11yFocus", function(){ state.focusHighlight = !state.focusHighlight; save(); apply(); });
    on("mmA11yImages", function(){ state.hideImages = !state.hideImages; save(); apply(); });

    on("mmA11yMute", function(){
      state.muteSounds = !state.muteSounds;
      save();
      apply();
    });

    on("mmA11yDarkContrast", function(){ state.contrastMode = state.contrastMode === "dark" ? "" : "dark"; save(); apply(); });
    on("mmA11yLightContrast", function(){ state.contrastMode = state.contrastMode === "light" ? "" : "light"; save(); apply(); });
    on("mmA11yHighContrast", function(){ state.contrastMode = state.contrastMode === "high" ? "" : "high"; save(); apply(); });

    on("mmA11yLowSat", function(){ state.saturationMode = state.saturationMode === "low" ? "" : "low"; save(); apply(); });
    on("mmA11yHighSat", function(){ state.saturationMode = state.saturationMode === "high" ? "" : "high"; save(); apply(); });
    on("mmA11yMono", function(){ state.saturationMode = state.saturationMode === "mono" ? "" : "mono"; save(); apply(); });

    on("mmA11yAlignLeft", function(){ state.align = state.align === "left" ? "" : "left"; save(); apply(); });
    on("mmA11yAlignCenter", function(){ state.align = state.align === "center" ? "" : "center"; save(); apply(); });
    on("mmA11yAlignRight", function(){ state.align = state.align === "right" ? "" : "right"; save(); apply(); });

    bindColors("mmTextColor", "textColor");
    bindColors("mmTitleColor", "titleColor");
    bindColors("mmBgColor", "bgColor");

    on("mmA11yReset", function(){
      resetState();
    });

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

    apply();
  }

  function ready(fn){
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(build);
})();
