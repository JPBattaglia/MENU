// Holiday Menu popup (owner, Nov 11, 2026): a festive invitation to the Holiday Menu on the Home and Menus pages only, a few seconds
// after the page opens. Owner, Nov 11, 2026 (later): shown on every page load and refresh, not once per browser.
// Never after New Year's Eve.
(function () {
  'use strict';
  // Pacific date as YYYY-MM-DD.
  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  if (today > '2026-12-31' || today < '2026-11-01') return;
  var christmas = today <= '2026-12-25';
  // Not for visitors who came from a paid ad (Nov 15, 2026): they searched for a QR / online menu, and a full-screen
  // Christmas offer covered the page they clicked for before they saw it. The holiday strip at the top still shows.
  // Remembered for the rest of that visit (sessionStorage), so the Home page doesn't pop it either.
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('gclid') || q.get('gbraid') || q.get('wbraid') || q.get('utm_campaign') || q.get('utm_medium') === 'cpc') {
      sessionStorage.setItem('mm-ad-visit', '1');
    }
    if (sessionStorage.getItem('mm-ad-visit') === '1') return;
  } catch (e) { /* storage blocked: fall through and show it as before */ }

  function build() {
    var wrap = document.createElement('div');
    wrap.className = 'mm-xmas-pop';
    wrap.innerHTML =
      '<div class="mm-xmas-card" role="dialog" aria-modal="true" aria-labelledby="mmXmasTitle">' +
        '<button class="mm-xmas-close" type="button" aria-label="Close">×</button>' +
        '<div class="mm-xmas-icons" aria-hidden="true">' + (christmas ? '🎄🎁❄️' : '🥂✨🎉') + '</div>' +
        '<p class="mm-xmas-kicker">Holiday special</p>' +
        '<h2 id="mmXmasTitle">' + (christmas ? 'Get your Christmas menu online' : 'Get your New Year’s Eve menu online') + '</h2>' +
        '<p>Your holiday menu as a phone page with its own QR code, a print PDF and a table tent. It sits beside the menu you already have.</p>' +
        '<div class="mm-xmas-price"><span data-pop-first>$59</span><small>per holiday, or <span data-pop-both>$89</span> for Christmas and New Year’s Eve<span data-pop-early hidden></span>. Or free with any MΞNU plan.</small></div>' +
        '<div class="mm-xmas-actions">' +
          '<a class="btn primary" href="holiday-menu.html#try-free" data-cta-label="Holiday popup">See my holiday menu free</a>' +
          '<button class="mm-xmas-later" type="button">Not now</button>' +
        '</div>' +
      '</div>';
    // Today's prices from the catalog (early bird through Nov 30, Nov 17, 2026).
    if (window.MenuMadeCatalog) window.MenuMadeCatalog.ready.then(function (offers) {
      var h = offers && offers.get('HOLIDAY_MENU') && offers.get('HOLIDAY_MENU').holiday;
      if (!h) return;
      var m = window.MenuMadeCatalog.money;
      wrap.querySelector('[data-pop-first]').textContent = m(h.first_cents);
      wrap.querySelector('[data-pop-both]').textContent = m(h.both_cents);
      var e = wrap.querySelector('[data-pop-early]');
      if (h.early_bird) { e.hidden = false; e.textContent = ' (early bird through ' + h.early_bird_ends + ', then ' + m(h.regular_first_cents) + ')'; }
    }).catch(function () {});
    return wrap;
  }

  function open() {
    var last = document.activeElement;
    var pop = build();
    document.body.appendChild(pop);
    var card = pop.querySelector('.mm-xmas-card');
    var cta = pop.querySelector('.btn.primary');
    function close() {
      document.removeEventListener('keydown', onKey);
      pop.remove();
      if (last && last.focus) last.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var f = card.querySelectorAll('a,button');
      var first = f[0], end = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
      else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
    }
    pop.querySelector('.mm-xmas-close').addEventListener('click', close);
    pop.querySelector('.mm-xmas-later').addEventListener('click', close);
    pop.addEventListener('click', function (e) { if (e.target === pop) close(); });
    document.addEventListener('keydown', onKey);
    cta.focus();
  }

  // Banner button colour (owner, Nov 17, 2026): red when it sits on the right, over the strip's green side; green when
  // the strip wraps and it lands on the left, over the red side. Checked on load and whenever the strip changes size.
  function sideColours() {
    document.querySelectorAll('.mm-holiday-strip').forEach(function (strip) {
      var btn = strip.querySelector('.btn');
      if (!btn) return;
      var check = function () {
        var s = strip.getBoundingClientRect(), b = btn.getBoundingClientRect();
        strip.classList.toggle('mm-strip-btn-left', b.left + b.width / 2 < s.left + s.width / 2);
      };
      check();
      if (window.ResizeObserver) new ResizeObserver(check).observe(strip); else window.addEventListener('resize', check);
    });
  }
  function start() { sideColours(); setTimeout(open, 3000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
