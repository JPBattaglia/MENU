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
    const soon = (text, big) => {
      const s = document.createElement('span');
      s.textContent = text === 'App Store' ? 'App Store: coming soon' : 'Google Play: coming soon';
      s.className = big ? 'btn mm-store-btn mm-store-soon' : 'mm-store-soon';
      s.style.cssText = big ? 'opacity:.75;cursor:default' : 'display:inline-block;padding:10px 18px;border-radius:999px;border:1px dashed #2ad1e0;opacity:.8';
      return s;
    };
    const button = (url, text, big) => {
      if (!url) return soon(text, big);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      if (big) {
        a.className = 'btn primary mm-store-btn';
        a.textContent = text === 'App Store' ? 'Download on the App Store' : 'Get it on Google Play';
        a.setAttribute('aria-label', `${a.textContent} (opens in a new tab)`);
      } else {
        a.textContent = text;
        a.style.cssText = 'display:inline-block;padding:10px 18px;border-radius:999px;background:#012a30;color:#fff;font-weight:700;text-decoration:none;border:1px solid #2ad1e0';
      }
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
      const box = document.createElement('div');
      box.className = 'app-links';
      box.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:center;margin:18px auto;padding:0 16px';
      const label = document.createElement('span');
      label.textContent = 'Get the MENU-MADE app:';
      label.style.cssText = 'font-weight:700';
      box.appendChild(label);
      for (const [url, text] of stores) box.appendChild(button(url, text, false));
      foot.insertBefore(box, foot.firstChild);
    }).catch(() => {});
  } catch { /* the buttons must never break the page */ }
})();
