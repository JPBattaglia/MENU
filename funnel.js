(() => {
  'use strict';
  // Anonymous, session-based measurement; never read contact fields or file contents.
  const windowHost = location.hostname;
  if (!['menu-made.com', 'www.menu-made.com'].includes(windowHost)) return;
  const query = new URLSearchParams(location.search);
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1' || query.get('mm_measurement') === 'off') return;
  const paths = new Set(['/', '/index', '/index.html', '/services', '/services.html', '/contact', '/contact.html', '/checkoutsuccess', '/checkoutsuccess.html']);
  const path = paths.has(location.pathname) ? location.pathname : '/other';
  const token = value => /^[a-z0-9_-]{1,64}$/i.test(value || '') ? value.toLowerCase() : null;
  const offers = { online_menu_qr: 'offer_online_menu_qr', conversion_fix: 'offer_conversion_fix', google_visibility: 'offer_google_visibility', accessibility_upgrade: 'offer_accessibility_upgrade', menu: 'offer_online_menu_qr', conversion: 'offer_conversion_fix', google: 'offer_google_visibility', accessibility: 'offer_accessibility_upgrade' };
  let referrer = null;
  try { const u = new URL(document.referrer); if (!['menu-made.com', 'www.menu-made.com'].includes(u.hostname)) referrer = u.hostname.slice(0, 100); } catch {}
  let session;
  try { session = JSON.parse(sessionStorage.getItem('mm_funnel_session')); } catch {}
  const now = Date.now();
  const requestedTest = query.get('mm_measurement') === 'test';
  if (!session || !/^[0-9a-f-]{36}$/i.test(session.id || '') || now - session.lastSeen > 30 * 60 * 1000 || session.test !== requestedTest && query.has('mm_measurement')) {
    session = { id: crypto.randomUUID(), lastSeen: now, test: requestedTest,
      source: requestedTest ? 'internal-test' : token(query.get('utm_source')) || referrer || 'direct',
      medium: token(query.get('utm_medium')) || (referrer ? 'referral' : 'none'),
      campaign: token(query.get('utm_campaign')), referrer, landing_path: path };
  }
  session.lastSeen = now;
  try { sessionStorage.setItem('mm_funnel_session', JSON.stringify(session)); } catch {}
  const tracking = () => ({ visitor_id: session.id, session_id: session.id, source: session.source,
    medium: session.medium, campaign: session.campaign, referrer: session.referrer, landing_path: session.landing_path });
  const stages = new Set(['service_selected', 'details_opened', 'checkout_attempt', 'checkout_error', 'inquiry_attempt', 'inquiry_received', 'booking_link_clicked', 'onboarding_opened', 'onboarding_completed', 'service_link_clicked']);
  const seen = new Set();
  function send(eventType, stage, service) {
    const key = eventType + ':' + stage + ':' + (service || '');
    if (seen.has(key)) return;
    seen.add(key);
    const payload = { ...tracking(), event_type: eventType,
      metadata: { instrumentation: 'mm_funnel_v1', stage, page: path, is_test: session.test } };
    if (offers[service]) payload.offer_id = offers[service];
    // Best-effort measurement must never block a form, upload, or navigation.
    try { Promise.resolve(fetch('/api/funnel-event', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), keepalive: true })).catch(() => {}); } catch {}
  }
  const api = Object.freeze({ tracking, track(stage, service) { if (stages.has(stage)) send('CTA_CLICK', stage, service); } });
  window.MenuMadeFunnel = api;
  send('SITE_VISIT', 'page_view');
  document.addEventListener('click', event => {
    const a = event.target.closest?.('a[href]');
    if (!a) return;
    try {
      const u = new URL(a.href, location.href);
      if (u.hostname === 'www.everyexpert.com' || u.hostname === 'everyexpert.com') api.track('booking_link_clicked');
      else if (u.origin === location.origin && /\/contact(?:\.html)?$/.test(u.pathname) && offers[u.searchParams.get('service')]) api.track('service_link_clicked', u.searchParams.get('service'));
    } catch {}
  });
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const card = entry.target;
        const service = card.dataset.sku || (() => { try { return new URL(card.querySelector('a[href]')?.href).searchParams.get('service'); } catch { return null; } })();
        if (offers[service]) send('OFFER_VIEW', 'offer_view', service);
        observer.unobserve(card);
      }
    }, { threshold: 0.5 });
    document.querySelectorAll('.service-card').forEach(card => observer.observe(card));
  }
})();
