(() => {
  'use strict';
  const section = document.querySelector('.work-next');
  if (!section) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;

  function update() {
    frame = 0;
    if (reducedMotion.matches) {
      section.style.removeProperty('--work-parallax-offset');
      return;
    }
    const rect = section.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const distance = window.innerHeight / 2 - (rect.top + rect.height / 2);
    const offset = Math.max(-80, Math.min(80, distance * 0.16));
    section.style.setProperty('--work-parallax-offset', `${offset.toFixed(2)}px`);
  }

  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('pageshow', schedule, { passive: true });
  reducedMotion.addEventListener('change', schedule);
  schedule();
})();
