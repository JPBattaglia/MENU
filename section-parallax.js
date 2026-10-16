(() => {
  const sections = [...document.querySelectorAll('.section-image')];
  if (!sections.length) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let pendingFrame = null;

  function updateOffsets() {
    pendingFrame = null;
    if (document.hidden) return;

    // Read positions together before writing, so scrolling does not interleave
    // layout reads and style updates for each section.
    const offsets = reducedMotion.matches
      ? sections.map(() => 0)
      : sections.map(section => section.getBoundingClientRect().top * -0.2);

    sections.forEach((section, index) => {
      section.style.setProperty('--section-parallax-offset', `${offsets[index]}px`);
    });
  }

  function scheduleUpdate() {
    if (pendingFrame !== null || document.hidden) return;
    pendingFrame = window.requestAnimationFrame(updateOffsets);
  }

  window.addEventListener('scroll', () => {
    if (!reducedMotion.matches) scheduleUpdate();
  }, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });
  reducedMotion.addEventListener('change', scheduleUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    } else if (!document.hidden) {
      scheduleUpdate();
    }
  });

  scheduleUpdate();
})();
