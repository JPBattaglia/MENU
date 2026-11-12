// Owner sandbox (owner, Nov 12, 2026): a switch that lives in one browser, so he can test every service and plan
// without touching live checkout for anyone else. menu-made.com/?sandbox=on turns it on (any page), ?sandbox=off
// or the bar's button turns it off. While on, every page shows the TEST MODE bar and the two pages that start a
// checkout (start.js, staff-merch.js read window.MenuMadeSandbox) use Stripe test mode. No page links to
// ?sandbox=on, so a buyer never lands in it (booking-api/site-check.test.mjs).
(() => {
  'use strict';
  const KEY = 'mm-owner-sandbox';
  let on = false;
  try {
    const asked = new URLSearchParams(location.search).get('sandbox');
    if (asked === 'on') localStorage.setItem(KEY, '1');
    if (asked === 'off') localStorage.removeItem(KEY);
    on = localStorage.getItem(KEY) === '1';
  } catch { on = false; }
  window.MenuMadeSandbox = on;
  if (!on) return;
  const show = () => {
    const bar = document.createElement('div');
    bar.className = 'test-mode-banner owner-sandbox-bar';
    bar.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = 'TEST MODE on this device. Checkout takes card 4242 4242 4242 4242 (any future date, any CVC). No real charge.';
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.textContent = 'Leave test mode';
    leave.addEventListener('click', () => {
      try { localStorage.removeItem(KEY); } catch { /* storage blocked: nothing to clear */ }
      const url = new URL(location.href);
      url.searchParams.delete('sandbox');
      url.searchParams.delete('checkout');
      location.replace(url.toString());
    });
    bar.append(text, leave);
    document.body.prepend(bar);
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();

(() => {
  'use strict';
  const toggle = document.querySelector('button.gear-burger');
  const nav = document.getElementById('primaryNav');
  if (!toggle || !nav) return;
  const mobile = window.matchMedia('(max-width: 700px)');
  let open = false;

  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let navAnimation = null;
  function slideNav(opening) {
    navAnimation?.cancel();
    if (still() || !document.body.classList.contains('nav-ready')) { nav.hidden = !opening; return; }
    nav.hidden = false;
    const frames = [
      { opacity: 0, transform: 'translateY(-10px)', clipPath: 'inset(0 0 100% 0 round 16px)' },
      { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0 round 16px)' }
    ];
    navAnimation = nav.animate(opening ? frames : frames.slice().reverse(), { duration: opening ? 300 : 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
    navAnimation.onfinish = () => { navAnimation = null; if (!opening) nav.hidden = true; };
  }

  function update() {
    const collapsed = mobile.matches && !open;
    const restoreFocus = collapsed && nav.contains(document.activeElement);
    toggle.hidden = !mobile.matches;
    if (nav.hidden !== collapsed) slideNav(!collapsed);
    nav.inert = collapsed;
    toggle.setAttribute('aria-expanded', String(mobile.matches && open));
    toggle.setAttribute('aria-label', open && mobile.matches ? 'Close navigation menu' : 'Open navigation menu');
    document.body.classList.add('nav-ready');
    if (restoreFocus) toggle.focus();
  }

  toggle.addEventListener('click', () => { open = !open; update(); });
  nav.addEventListener('click', event => {
    if (event.target.closest('a[href]') && mobile.matches) { open = false; update(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobile.matches && open) {
      open = false;
      update();
      toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (mobile.matches && open && !nav.contains(event.target) && !toggle.contains(event.target)) {
      open = false;
      update();
    }
  });
  mobile.addEventListener('change', () => { open = false; update(); });
  update();
})();

// Dropdowns (<details>) slide open and closed instead of jumping (owner, Nov 5, 2026). A details element whose
// content floats over the page (the home "What do you need?" menu) slides its panel; the rest grow and shrink in
// place. Without JavaScript, or with reduced motion, they open instantly as before.
(() => {
  'use strict';
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const running = new WeakMap();

  function floatingPanel(details) {
    const panel = details.querySelector(':scope > :not(summary)');
    return panel && getComputedStyle(panel).position === 'absolute' ? panel : null;
  }

  function animate(details, opening) {
    running.get(details)?.cancel();
    const summary = details.querySelector(':scope > summary');
    const panel = floatingPanel(details);
    let animation;
    if (opening) details.open = true;
    if (panel) {
      const frames = [
        { opacity: 0, transform: 'translateY(-8px)', clipPath: 'inset(0 0 100% 0 round 20px)' },
        { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0 round 20px)' }
      ];
      animation = panel.animate(opening ? frames : frames.slice().reverse(), { duration: opening ? 300 : 200, easing: EASE });
    } else {
      const closed = summary.offsetHeight + parseFloat(getComputedStyle(details).borderTopWidth) + parseFloat(getComputedStyle(details).borderBottomWidth);
      const full = details.offsetHeight;
      details.style.overflow = 'hidden';
      animation = details.animate({ height: opening ? [`${closed}px`, `${full}px`] : [`${full}px`, `${closed}px`] }, { duration: Math.min(450, 220 + (full - closed) * 0.4), easing: EASE });
    }
    running.set(details, animation);
    animation.onfinish = animation.oncancel = () => {
      if (running.get(details) !== animation) return;
      running.delete(details);
      details.style.overflow = '';
      if (!opening && animation.playState === 'finished') details.open = false;
    };
  }

  // Lets page scripts close a dropdown the same smooth way: details.dispatchEvent(new Event('mm:close')).
  document.addEventListener('mm:close', event => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    details.dataset.mmTarget = 'closed';
    if (still()) details.open = false; else animate(details, false);
  }, true);

  document.addEventListener('click', event => {
    const summary = event.target.closest('summary');
    const details = summary?.parentElement;
    if (!(details instanceof HTMLDetailsElement) || summary !== details.querySelector(':scope > summary') || still()) return;
    if (event.target.closest('a, button, input, select, textarea, label') && event.target.closest('a, button, input, select, textarea, label') !== summary) return;
    event.preventDefault();
    // Mid-animation, a second click reverses it; otherwise it follows the element's current state.
    const isOpen = running.has(details) ? details.dataset.mmTarget === 'open' : details.open;
    details.dataset.mmTarget = isOpen ? 'closed' : 'open';
    animate(details, !isOpen);
  });
})();
