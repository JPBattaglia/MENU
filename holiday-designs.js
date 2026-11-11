// Holiday Menu page (owner, Nov 11, 2026): tap a design to see it full size, scroll down the whole menu, and step
// through all six with the arrows (keyboard arrows and swipes too). Esc, the close button or a click outside closes it.
(function () {
  'use strict';
  var imgs = [].slice.call(document.querySelectorAll('.mm-holiday-designs img[data-large]'));
  if (!imgs.length) return;
  var box, pic, title, note, index = 0, last = null;

  function caption(img) {
    var fc = img.closest('figure').querySelector('figcaption');
    return { name: fc.firstChild.textContent.trim(), blurb: (fc.querySelector('span') || {}).textContent || '' };
  }

  function build() {
    box = document.createElement('div');
    box.className = 'mm-lightbox';
    box.hidden = true;
    box.innerHTML =
      '<div class="mm-lightbox-panel" role="dialog" aria-modal="true" aria-labelledby="mmLbTitle">' +
        '<div class="mm-lightbox-head"><div><h2 id="mmLbTitle"></h2><p></p></div>' +
        '<button class="mm-lightbox-close" type="button" aria-label="Close">×</button></div>' +
        '<div class="mm-lightbox-scroll"><img alt=""></div>' +
        '<div class="mm-lightbox-foot">' +
          '<button class="mm-lightbox-nav" type="button" data-step="-1" aria-label="Previous design">‹<span> Previous</span></button>' +
          '<a class="btn primary" href="#try-free" data-cta-label="Holiday design viewer">See my menu in it free</a>' +
          '<button class="mm-lightbox-nav" type="button" data-step="1" aria-label="Next design"><span>Next </span>›</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(box);
    pic = box.querySelector('img');
    title = box.querySelector('h2');
    note = box.querySelector('.mm-lightbox-head p');
    box.querySelector('.mm-lightbox-close').addEventListener('click', close);
    box.querySelector('.btn.primary').addEventListener('click', close);
    box.querySelectorAll('.mm-lightbox-nav').forEach(function (b) {
      b.addEventListener('click', function () { show(index + Number(b.dataset.step)); });
    });
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    var x0 = null;
    pic.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    pic.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) show(index + (dx < 0 ? 1 : -1));
    });
  }

  function show(i) {
    index = (i + imgs.length) % imgs.length;
    var img = imgs[index], c = caption(img);
    pic.src = img.dataset.large;
    pic.alt = img.alt;
    title.textContent = c.name;
    note.textContent = c.blurb;
    box.querySelector('.mm-lightbox-scroll').scrollTop = 0;
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'Tab') {
      var f = box.querySelectorAll('a,button');
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }

  function open(i) {
    if (!box) build();
    last = document.activeElement;
    show(i);
    box.hidden = false;
    document.documentElement.classList.add('mm-lightbox-open');
    document.addEventListener('keydown', onKey);
    box.querySelector('.mm-lightbox-close').focus();
  }

  function close() {
    box.hidden = true;
    document.documentElement.classList.remove('mm-lightbox-open');
    document.removeEventListener('keydown', onKey);
    if (last && last.focus) last.focus();
  }

  imgs.forEach(function (img, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mm-design-zoom';
    b.setAttribute('aria-label', 'See the ' + caption(img).name + ' design full size');
    img.parentNode.insertBefore(b, img);
    b.appendChild(img);
    b.addEventListener('click', function () { open(i); });
  });
})();
