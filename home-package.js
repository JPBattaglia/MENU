(() => {
  const details = document.querySelector('.package-details');
  if (!details) return;
  const summary = details.querySelector('summary');
  const grid = details.closest('.hero-grid');
  let animation;
  let expanded = details.open;
  summary.addEventListener('click', event => {
    event.preventDefault();
    const start = details.getBoundingClientRect().height;
    animation?.cancel();
    expanded = !expanded;
    details.open = true;
    grid.classList.toggle('package-expanded', expanded);
    const end = expanded ? details.getBoundingClientRect().height : summary.getBoundingClientRect().height + 2;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    animation = details.animate({height: [start + 'px', end + 'px']}, {
      duration: reduced ? 0 : 420, easing: 'cubic-bezier(.22,1,.36,1)'
    });
    animation.onfinish = () => { details.open = expanded; animation = null; };
  });
})();
