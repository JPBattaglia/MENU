(() => {
  'use strict';
  // Anonymous, session-based measurement; never read contact fields or file contents.
  const windowHost = location.hostname;
  if (!['menu-made.com', 'www.menu-made.com'].includes(windowHost)) return;
  const query = new URLSearchParams(location.search);
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1' || query.get('mm_measurement') === 'off') return;
  const pageNames = ['index', 'services', 'contact', 'about', 'accessability', 'portfolio', 'sample-menu', 'checkoutsuccess', 'website-design', 'google-visibility', 'accessibility-services', 'work-pinecrest', 'work-nino', 'work-marios', 'app-demo', 'plans', 'privacy', 'account'];
  const paths = new Set(['/', ...pageNames.flatMap(name => ['/' + name, '/' + name + '.html'])]);
  const path = paths.has(location.pathname) ? location.pathname : '/other';
  const token = value => /^[a-z0-9_-]{1,64}$/i.test(value || '') ? value.toLowerCase() : null;
  const services = { online_menu_qr: 'online_menu_qr', menu: 'online_menu_qr', 'online-menu-qr': 'online_menu_qr', conversion_fix: 'conversion_fix', conversion: 'conversion_fix', google_visibility: 'google_visibility', google: 'google_visibility', accessibility_upgrade: 'accessibility_upgrade', accessibility: 'accessibility_upgrade', website: 'website', app: 'app', other: 'other' };
  // Catalog codes (BUNDLE_GROWTH, MENU_CARE…) from the Stage 9 pages are tracked as lower-case codes with their offer id.
  const serviceSlug = value => typeof value === 'string' && Object.hasOwn(services, value) ? services[value] : (typeof value === 'string' && /^[A-Z][A-Z_]{2,40}$/.test(value) ? value.toLowerCase() : undefined);
  const offers = { online_menu_qr: 'offer_online_menu_qr', conversion_fix: 'offer_conversion_fix', google_visibility: 'offer_google_visibility', accessibility_upgrade: 'offer_accessibility_upgrade', website_package: 'offer_website_package', accessibility_monitoring: 'offer_accessibility_monitoring' };
  services.website_package = 'website_package'; services.accessibility_monitoring = 'accessibility_monitoring';
  const pageServices = { 'website-design': 'website_package', 'google-visibility': 'google_visibility', 'accessibility-services': 'accessibility_monitoring' };
  const caseServices = { 'work-pinecrest': 'online_menu_qr', 'work-nino': 'website', 'work-marios': 'website' };
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
  const stages = new Set(['sample_menu_view', 'start_clicked', 'service_selected', 'details_opened', 'checkout_attempt', 'checkout_error', 'inquiry_attempt', 'inquiry_received', 'quote_started', 'quote_received', 'booking_link_clicked', 'onboarding_opened', 'onboarding_completed', 'service_link_clicked', 'case_study_view', 'demo_view']);
  const seen = new Set();
  function send(eventType, stage, service) {
    const selectedService = serviceSlug(service);
    const key = eventType + ':' + stage + ':' + (selectedService || '');
    if (seen.has(key)) return;
    seen.add(key);
    const payload = { ...tracking(), event_type: eventType,
      metadata: { instrumentation: 'mm_funnel_v1', stage, page: path, is_test: session.test,
        ...(selectedService ? { service: selectedService } : {}) } };
    if (selectedService && Object.hasOwn(offers, selectedService)) payload.offer_id = offers[selectedService];
    else if (selectedService && /^[a-z][a-z_]{2,40}$/.test(selectedService) && selectedService.includes('_') && !Object.hasOwn(services, selectedService)) payload.offer_id = 'offer_' + selectedService;
    // Best-effort measurement must never block a form, upload, or navigation.
    try { Promise.resolve(fetch('/api/funnel-event', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), keepalive: true })).catch(() => {}); } catch {}
  }
  const api = Object.freeze({ tracking, track(stage, service) { if (stages.has(stage)) send('CTA_CLICK', stage, service); } });
  window.MenuMadeFunnel = api;
  send('SITE_VISIT', 'page_view');
  if (/^\/sample-menu(?:\.html)?$/.test(path)) api.track('sample_menu_view', 'online_menu_qr');
  const pageName = path.slice(1).replace(/\.html$/, '');
  if (Object.hasOwn(pageServices, pageName)) send('OFFER_VIEW', 'offer_view', pageServices[pageName]);
  if (Object.hasOwn(caseServices, pageName)) api.track('case_study_view', caseServices[pageName]);
  if (pageName === 'app-demo') api.track('demo_view', 'app');
  document.addEventListener('click', event => {
    const menuControl = event.target.closest?.('[data-start-menu]');
    let isStart = Boolean(menuControl || event.target.closest?.('[data-funnel-start]'));
    let startService = menuControl ? 'online_menu_qr' : undefined;
    const a = event.target.closest?.('a[href]');
    if (a) try {
      const u = new URL(a.href, location.href);
      if (u.hostname === 'www.everyexpert.com' || u.hostname === 'everyexpert.com') api.track('booking_link_clicked');
      else if (u.origin === location.origin && /^\/contact(?:\.html)?$/.test(u.pathname)) {
        const rawService = u.searchParams.get('service') || u.searchParams.get('plan');
        const service = serviceSlug(rawService);
        if (service) api.track('service_link_clicked', service);
        if (service === 'website' || service === 'app') api.track('quote_started', service);
        const menuLink = service === 'online_menu_qr';
        const defaultStart = !rawService && ['', '#checkout', '#details'].includes(u.hash);
        if (u.hash === '#inquiry') isStart = false;
        else if (menuLink || defaultStart) {
          isStart = true;
          if (menuLink) startService = 'online_menu_qr';
        }
      }
    } catch {}
    if (isStart) api.track('start_clicked', startService);
  });
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const card = entry.target;
        const service = serviceSlug(card.dataset.code || card.dataset.sku || (() => { try { return new URL(card.querySelector('a[href]')?.href).searchParams.get('service'); } catch { return null; } })());
        if (service) send('OFFER_VIEW', 'offer_view', service);
        observer.unobserve(card);
      }
    }, { threshold: 0.5 });
    document.querySelectorAll('.service-card').forEach(card => observer.observe(card));
  }
})();
