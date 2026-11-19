// "Get the app" buttons (owner, Nov 10, 2026). Asks menu-made.com which stores have the MENU-MADE app public and
// adds a button for each to the page footer. Before launch the answer is empty and nothing shows.
// Nov 13, 2026 (owner: "put links to the menu apps in menu site"): pages may also carry a visible
// "Get the MENU-MADE app" section ([data-app-section], hidden in the markup); it is shown with the same buttons once
// at least one store has the app.
// Inside the apps (owner, Nov 13, 2026) none of this shows: pages the MENU-MADE app opens carry mm_app=1, and the
// in-app browser remembers it for the rest of that visit (session storage, so a phone's normal browser is unaffected).
(() => {
  'use strict';
  try {
    const KEY = 'mm-in-app';
    let inApp = /(?:^|[?&])mm_app=1(?:&|$)/.test(location.search.slice(1));
    try { if (inApp) sessionStorage.setItem(KEY, '1'); else inApp = sessionStorage.getItem(KEY) === '1'; } catch { /* storage off: this page only */ }
    if (inApp) return;
    const foot = document.querySelector('footer');
    if (!window.fetch) return;
    // Nov 15, 2026 (owner: "It should be both or it should recognize the system being used and offer based off
    // of that"): iPhones and iPads see the App Store, Android sees Google Play, computers see both. A store whose
    // app is not public yet (Apple review) shows as "Coming soon" instead of a link, so iPhone visitors are never
    // sent to Google Play.
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const android = !ios && /Android/i.test(ua);
    // Nov 18, 2026 (owner): the stores' own badges (icon + "App Store" / "Google Play"), the official artwork both
    // stores require, served from assets/badges. Footer badges are a little smaller than the section ones.
    const BADGES = { 'App Store': ['assets/badges/app-store.svg', 'Download on the App Store', 120 / 40],
      'Google Play': ['assets/badges/google-play.svg', 'Get it on Google Play', 180 / 53.333] };
    const soon = (text, big) => {
      const s = document.createElement('span');
      s.textContent = text === 'App Store' ? 'App Store: coming soon' : 'Google Play: coming soon';
      s.className = big ? 'btn mm-store-btn mm-store-soon' : 'mm-store-soon';
      s.style.cssText = big ? 'opacity:.75;cursor:default' : 'display:inline-block;padding:10px 18px;border-radius:999px;border:1px dashed #2ad1e0;opacity:.8';
      return s;
    };
    const button = (url, text, big) => {
      if (!url) return soon(text, big);
      const [src, label, ratio] = BADGES[text];
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'mm-store-badge';
      a.setAttribute('aria-label', `${label} (opens in a new tab)`);
      a.style.cssText = 'display:inline-block;line-height:0;border-radius:8px';
      const img = document.createElement('img');
      const h = big ? 52 : 44;
      img.src = '/' + src; img.alt = label; img.height = h; img.width = Math.round(h * ratio);
      img.style.cssText = `height:${h}px;width:auto;display:block`;
      a.appendChild(img);
      return a;
    };
    fetch('https://menu-made.com/api/app-links/menumade').then(r => r.ok ? r.json() : null).then(links => {
      if (!links || (!links.apple && !links.google)) return;
      let stores = [[links.apple, 'App Store'], [links.google, 'Google Play']];
      if (ios) stores = stores.slice(0, 1);
      else if (android) stores = stores.slice(1);
      else stores = stores.filter(([url]) => url).length ? stores : [];
      if (!stores.some(([url]) => url) && !ios) return;
      for (const section of document.querySelectorAll('[data-app-section]')) {
        const slot = section.querySelector('[data-app-buttons]');
        if (!slot) continue;
        for (const [url, text] of stores) slot.appendChild(button(url, text, true));
        section.hidden = false;
      }
      if (!foot) return;
      // Footer layout (owner, Nov 18, 2026: "doesn't fit well in the footer for certain screen sizes"): phones and
      // tablets get the label on its own line with the badges side by side, centred; wider screens put the block on
      // the left side of the footer, lined up with the page content.
      const css = document.createElement('style');
      css.textContent = '.app-links{display:flex;flex-direction:column;align-items:center;gap:10px;margin:18px auto;padding:0 16px;max-width:1120px;box-sizing:border-box}'
        + '.app-links-label{font-weight:700}.app-links-row{display:flex;gap:10px;justify-content:center;flex-wrap:nowrap}'
        + '.app-links-row img{height:40px!important}'
        + '@media (min-width:900px){.app-links{align-items:flex-start;padding:0 28px}.app-links-row{justify-content:flex-start}.app-links-row img{height:44px!important}}';
      document.head.appendChild(css);
      const box = document.createElement('div');
      box.className = 'app-links';
      const label = document.createElement('span');
      label.className = 'app-links-label';
      label.textContent = 'Get the MENU-MADE app:';
      box.appendChild(label);
      const row = document.createElement('div');
      row.className = 'app-links-row';
      for (const [url, text] of stores) row.appendChild(button(url, text, false));
      box.appendChild(row);
      foot.insertBefore(box, foot.firstChild);
    }).catch(() => {});
  } catch { /* the buttons must never break the page */ }
})();
