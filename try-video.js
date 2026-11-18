// How-to videos beside the free generators: a full-screen button that always works (owner, Nov 12, 2026: the
// player's own enlarge button did nothing on his Mac, while the iPhone's worked). Order of attempts:
//   1. the browser's full screen on the video's frame (Chrome, Safari, Firefox on a Mac or PC)
//   2. the iPhone / iPad video player (webkitEnterFullscreen)
//   3. when the browser says no: the video fills the whole window, with a Close button and Esc.
// The player's own enlarge button is hidden (controlsList nofullscreen) so there's one button that works.
(() => {
  'use strict';
  const figures = [...document.querySelectorAll('.mm-try-video')];
  if (!figures.length) return;

  const realFullscreen = (el) => {
    if (document.fullscreenEnabled && el.requestFullscreen) return el.requestFullscreen();
    if (document.webkitFullscreenEnabled && el.webkitRequestFullscreen) return Promise.resolve(el.webkitRequestFullscreen());
    return Promise.reject(new Error('no fullscreen'));
  };
  const inFullscreen = () => document.fullscreenElement || document.webkitFullscreenElement;

  for (const figure of figures) {
    const video = figure.querySelector('video');
    if (!video) continue;
    video.setAttribute('controlslist', 'nofullscreen');
    video.disablePictureInPicture = false;

    const frame = document.createElement('div');
    frame.className = 'mm-video-frame';
    video.replaceWith(frame);
    frame.append(video);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mm-video-full';
    open.setAttribute('aria-label', 'Watch full screen');
    open.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Full screen</span>';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mm-video-close';
    close.textContent = 'Close';
    close.hidden = true;
    frame.append(open, close);

    let filled = false;
    const fillWindow = () => {
      filled = true;
      frame.classList.add('is-filling');
      document.documentElement.classList.add('mm-video-open');
      close.hidden = false;
      close.focus();
    };
    const unfill = () => {
      if (!filled) return;
      filled = false;
      frame.classList.remove('is-filling');
      document.documentElement.classList.remove('mm-video-open');
      close.hidden = true;
      open.focus();
    };

    const enlarge = () => {
      const playing = !video.paused;
      if (video.preload === 'none') video.preload = 'auto';
      // Owner, Nov 17, 2026: in the Claude app's browser the full-screen request never answers (neither yes nor no),
      // so the button did nothing. Whatever the request does, if the video isn't full screen after a moment it fills
      // the window instead; a late "yes" still wins (the fill is undone when full screen starts).
      let settled = false;
      const fallback = () => {
        if (settled || inFullscreen()) return;
        settled = true;
        if (typeof video.webkitEnterFullscreen === 'function' && /iP(hone|ad|od)/.test(navigator.userAgent)) {
          try { video.webkitEnterFullscreen(); return; } catch { /* fall through */ }
        }
        fillWindow();
      };
      realFullscreen(frame).then(() => { setTimeout(fallback, 300); }).catch(fallback);
      setTimeout(fallback, 700);
      if (!playing) video.play().catch(() => {});
    };

    open.addEventListener('click', enlarge);
    video.addEventListener('dblclick', (event) => { event.preventDefault(); if (inFullscreen()) document.exitFullscreen?.(); else if (filled) unfill(); else enlarge(); });
    close.addEventListener('click', unfill);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') unfill(); });
  }

  const sync = () => {
    document.documentElement.classList.toggle('mm-video-fs', Boolean(inFullscreen()));
    // A full-screen "yes" that arrives after the window fill took over: drop the fill.
    if (inFullscreen()) document.querySelectorAll('.mm-video-frame.is-filling .mm-video-close').forEach((b) => b.click());
  };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
})();
