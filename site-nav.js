(() => {
  'use strict';
  const toggle = document.querySelector('button.gear-burger');
  const nav = document.getElementById('primaryNav');
  if (!toggle || !nav) return;
  const mobile = window.matchMedia('(max-width: 700px)');
  let open = false;

  function update() {
    const collapsed = mobile.matches && !open;
    const restoreFocus = collapsed && nav.contains(document.activeElement);
    toggle.hidden = !mobile.matches;
    nav.hidden = collapsed;
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
