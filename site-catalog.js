// Prices and availability for every page come from the order engine's catalog (GET /api/catalog),
// never from numbers typed into the pages. Elements opt in with data attributes:
//   data-price-for="CODE"            filled with that offer's price (plans use the page's billing interval)
//   data-price-interval="month|year" pins one interval instead of following the toggle
//   data-saving-for="BUNDLE_CODE"    filled with the monthly or yearly saving against buying the plans separately
//   data-plan-cta="CODE"             a Choose link: points at the Start page with the interval; off-sale offers say so
//   data-billing-toggle              radio inputs (value month|year) that switch every price on the page
(() => {
  'use strict';
  const onSite = /(^|\.)menu-made\.com$/.test(location.hostname);
  const API = onSite ? '' : 'https://menu-made.com';
  const state = { interval: 'month', offers: null };
  const listeners = [];

  function money(cents, { cents: showCents = false } = {}) {
    const value = cents / 100;
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: showCents || value % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function priceOf(offer, interval) {
    if (!offer) return null;
    return offer.prices ? (offer.prices[interval] ?? null) : offer.price_cents;
  }
  // What the included plans cost bought one by one. Google Profile Care already answers reviews,
  // so Review Replies is not counted again when both are in a bundle.
  function separateCost(bundle, interval, offers) {
    const codes = bundle.includes.filter(code => !(code === 'REVIEW_REPLIES' && bundle.includes.includes('GOOGLE_PROFILE_CARE')));
    let total = 0;
    for (const code of codes) {
      const price = priceOf(offers.get(code), interval);
      if (price === null) return null;
      total += price;
    }
    return total;
  }
  function label(offer, interval) {
    const price = priceOf(offer, interval);
    if (price === null) return '';
    if (!offer.prices) return money(price);
    return money(price) + (interval === 'year' ? '/yr' : '/mo');
  }

  function render() {
    const offers = state.offers;
    document.querySelectorAll('[data-price-for]').forEach(el => {
      if (!offers) return;
      const offer = offers.get(el.dataset.priceFor);
      const interval = el.dataset.priceInterval || state.interval;
      const text = el.hasAttribute('data-price-bare') ? (priceOf(offer, interval) === null ? '' : money(priceOf(offer, interval))) : label(offer, interval);
      el.textContent = text || 'See checkout';
    });
    document.querySelectorAll('[data-saving-for]').forEach(el => {
      const bundle = offers?.get(el.dataset.savingFor);
      const separate = bundle ? separateCost(bundle, state.interval, offers) : null;
      const own = priceOf(bundle, state.interval);
      const saving = separate !== null && own !== null ? separate - own : 0;
      el.hidden = saving <= 0;
      el.textContent = saving > 0 ? `Save ${money(saving)}${state.interval === 'year' ? '/yr' : '/mo'} vs. separately` : '';
    });
    document.querySelectorAll('[data-menu-extra-page]').forEach(el => {
      const pkg = offers?.get('ONLINE_MENU_QR')?.menu_package;
      if (pkg) el.textContent = money(pkg.additional_page_cents);
    });
    document.querySelectorAll('[data-annual-note]').forEach(el => { el.hidden = state.interval !== 'year'; });
    document.querySelectorAll('[data-plan-cta]').forEach(el => {
      const offer = offers?.get(el.dataset.planCta);
      const params = new URLSearchParams({ plan: el.dataset.planCta });
      if (offer?.prices) params.set('interval', state.interval);
      if (offer && !offer.on_sale) {
        el.href = 'contact.html?ask=' + encodeURIComponent(el.dataset.planCta) + '#inquiry';
        el.textContent = 'Opening soon · ask us';
        el.classList.add('is-soon');
      } else {
        el.href = 'contact.html?' + params.toString();
        el.textContent = el.dataset.ctaLabel || 'Choose';
        el.classList.remove('is-soon');
      }
    });
    listeners.forEach(fn => fn(state));
  }

  function setInterval(value) {
    state.interval = value === 'year' ? 'year' : 'month';
    document.querySelectorAll('[data-billing-toggle] input').forEach(input => { input.checked = input.value === state.interval; });
    render();
  }

  const ready = fetch(API + '/api/catalog', { headers: { Accept: 'application/json' } })
    .then(response => response.ok ? response.json() : Promise.reject(new Error('catalog ' + response.status)))
    .then(body => {
      state.offers = new Map((body.offers || []).map(offer => [offer.code, offer]));
      document.documentElement.classList.add('catalog-ready');
      render();
      return state.offers;
    })
    .catch(error => {
      document.documentElement.classList.add('catalog-failed');
      document.querySelectorAll('[data-price-for]').forEach(el => { el.textContent = 'Shown at checkout'; });
      throw error;
    });

  ready.catch(() => {});

  document.addEventListener('change', event => {
    if (event.target.closest('[data-billing-toggle]')) setInterval(event.target.value);
  });

  window.MenuMadeCatalog = {
    API,
    ready,
    money,
    priceOf,
    label,
    separateCost,
    get interval() { return state.interval; },
    setInterval,
    onRender(fn) { listeners.push(fn); if (state.offers) fn(state); }
  };
})();
