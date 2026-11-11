// Holiday Menu popup (owner, Nov 11, 2026): a festive invitation to the Holiday Menu on the main pages, a few seconds
// after the page opens. Owner, Nov 11, 2026 (later): shown on every page load and refresh, not once per browser.
// Never after New Year's Eve.
(function () {
  'use strict';
  // Pacific date as YYYY-MM-DD.
  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  if (today > '2026-12-31' || today < '2026-11-01') return;
  var christmas = today <= '2026-12-25';

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
        '<div class="mm-xmas-price">$59<small>per holiday, or $89 for Christmas and New Year’s Eve</small></div>' +
        '<div class="mm-xmas-actions">' +
          '<a class="btn primary" href="holiday-menu.html#try-free" data-cta-label="Holiday popup">See my holiday menu free</a>' +
          '<button class="mm-xmas-later" type="button">Not now</button>' +
        '</div>' +
      '</div>';
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

  function start() { setTimeout(open, 3000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
