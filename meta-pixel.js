(() => {
  'use strict';
  // Meta (Facebook/Instagram) Pixel for menu-made.com (owner, Nov 23, 2026).
  // Lets Meta ads optimise for people who make a free preview, start checkout or buy, and lets us retarget
  // previewers who didn't check out. Same privacy rules as the Google Ads tag: nothing loads when the browser
  // sends Global Privacy Control or Do Not Track, off menu-made.com, or in sandbox/test sessions.
  // Until PIXEL_ID is filled in, this file does nothing and window.mmMeta is a harmless no-op.
  const PIXEL_ID = '';
  const noop = () => {};
  window.mmMeta = noop;
  const n = navigator;
  if (!PIXEL_ID || !/^\d{10,20}$/.test(PIXEL_ID)) return;
  if (n.globalPrivacyControl === true || n.doNotTrack === '1' || window.doNotTrack === '1') return;
  if (!['menu-made.com', 'www.menu-made.com'].includes(location.hostname)) return;
  const q = new URLSearchParams(location.search);
  if (q.get('mm_measurement') === 'off' || q.get('mm_measurement') === 'test') return;

  /* Meta's standard loader, unminified. */
  if (!window.fbq) {
    const f = window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); };
    if (!window._fbq) window._fbq = f;
    f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
    const s = document.createElement('script');
    s.async = true; s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }
  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');

  // mmMeta('Lead' | 'InitiateCheckout' | 'Purchase', params, eventID). Sandbox runs never count.
  window.mmMeta = (event, params = {}, eventID) => {
    if (window.MenuMadeSandbox === true) return;
    try { window.fbq('track', event, params, eventID ? { eventID: String(eventID) } : undefined); } catch { /* blocked */ }
  };
})();
