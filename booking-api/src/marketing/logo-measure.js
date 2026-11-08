// Measures a logo the buyer chooses, in their browser (no extra upload), for the logo backdrop (menu-qr/design.js
// logoTreatment): t = has see-through parts, l = average brightness, c = ink coverage of its outline box, b = a solid
// box. Writes "t=..;l=..;c=..;b=.." into the form's hidden logo_info field. Used by the website generator's Customize
// (the menu generator has the same code inline in public-preview.js).
const logoMeasureScript = (inputSelector) => `<script>
(function () {
  var input = document.querySelector(${JSON.stringify(inputSelector)}); if (!input) return;
  input.addEventListener("change", function () {
    var out = input.form.elements.logo_info; if (!out) return; out.value = "";
    var file = input.files && input.files[0]; if (!file || !window.createImageBitmap) return;
    createImageBitmap(file).then(function (bmp) {
      var k = Math.min(1, 160 / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d"); x.drawImage(bmp, 0, 0, w, h);
      var d = x.getImageData(0, 0, w, h).data, lin = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      var ink = 0, clear = 0, sum = 0, edge = 0, edgeSolid = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var y = 0; y < h; y++) for (var i = 0; i < w; i++) {
        var p = (y * w + i) * 4, a = d[p + 3];
        if (y === 0 || y === h - 1 || i === 0 || i === w - 1) { edge++; if (a > 200) edgeSolid++; }
        if (a < 16) { clear++; continue; }
        if (a > 128) { ink++; sum += 0.2126 * lin(d[p]) + 0.7152 * lin(d[p + 1]) + 0.0722 * lin(d[p + 2]); if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      var box = (x1 - x0 + 1) * (y1 - y0 + 1);
      out.value = "t=" + (clear / (w * h) > 0.05 ? 1 : 0) + ";l=" + (ink ? (sum / ink).toFixed(3) : "0.5") + ";c=" + (box > 0 ? (ink / box).toFixed(2) : "1") + ";b=" + (edge && edgeSolid / edge > 0.9 ? 1 : 0);
    }).catch(function () {});
  });
})();
</script>`;

// The "Logo background" choice, shared by the menu and website Customize forms.
const LOGO_BG_OPTIONS = [["auto", "Automatic"], ["none", "None"], ["light", "Light badge"], ["dark", "Dark badge"], ["accent", "Brand colour badge"]];
const logoBgSelect = (current = "auto", { style = "" } = {}) => `<select name="logo_bg"${style ? ` style="${style}"` : ""}>${LOGO_BG_OPTIONS.map(([v, t]) => `<option value="${v}"${(current || "auto") === v ? " selected" : ""}>${t}</option>`).join("")}</select>`;

export { logoMeasureScript, logoBgSelect, LOGO_BG_OPTIONS };
