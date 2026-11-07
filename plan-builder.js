// Plans page "Build your own plan" (owner, Nov 6, 2026): tick the services you need, see the total as you go.
// Two or more monthly services become "Your own plan": 10% off for two, 20% off for three or more, rounded down to
// whole dollars. The order engine prices it the same way at checkout (src/subscriptions/plans.js); prices come from
// site-catalog.js, never from this file. When Starter, Growth or Pro covers the same services for the same or less,
// the builder says so.
(() => {
  'use strict';
  const root = document.querySelector('[data-plan-builder]');
  const Catalog = window.MenuMadeCatalog;
  if (!root || !Catalog) return;
  const BUNDLES = ['BUNDLE_STARTER', 'BUNDLE_GROWTH', 'BUNDLE_PRO'];
  const BUNDLE_NAMES = { BUNDLE_STARTER: 'Starter', BUNDLE_GROWTH: 'Growth', BUNDLE_PRO: 'Pro' };
  const $ = sel => root.querySelector(sel);
  const boxes = () => [...root.querySelectorAll('input[type="checkbox"][data-code]')];
  const box = code => root.querySelector(`input[data-code="${code}"]`);
  let offers = null;
  let totalInView = true;

  const unit = () => (Catalog.interval === 'year' ? '/yr' : '/mo');
  const money = cents => Catalog.money(cents);
  const price = code => Catalog.priceOf(offers?.get(code), Catalog.interval);
  const once = code => Catalog.priceOf(offers?.get(code), 'month');
  const nameOf = code => offers?.get(code)?.name || box(code)?.dataset.name || code;

  function picks() {
    const monthly = boxes().filter(b => b.dataset.kind === 'month' && b.checked && !b.disabled).map(b => b.dataset.code);
    const oneTime = boxes().filter(b => b.dataset.kind === 'once' && b.checked).map(b => b.dataset.code);
    return { monthly, oneTime };
  }

  // Google Profile Care already answers reviews; the Website Package with monthly services needs Website Care in them.
  function applyRules(changed) {
    const gpc = box('GOOGLE_PROFILE_CARE'), rr = box('REVIEW_REPLIES');
    rr.disabled = gpc.checked;
    rr.closest('.mm-pick').classList.toggle('is-covered', gpc.checked);
    $('[data-note="REVIEW_REPLIES"]').hidden = !gpc.checked;
    const site = box('WEBSITE_PACKAGE'), care = box('WEBSITE_CARE');
    if (!site || !care) return;
    const otherMonthly = boxes().some(b => b.dataset.kind === 'month' && b.checked && b !== care && !b.disabled);
    if (site.checked && otherMonthly && !care.checked && changed !== care) care.checked = true;
    if (site.checked && otherMonthly && changed === care && !care.checked) site.checked = false;
  }

  function customCents(codes) {
    let list = 0;
    for (const code of codes) { const p = price(code); if (p === null) return null; list += p; }
    const pct = codes.length >= 3 ? 20 : codes.length === 2 ? 10 : 0;
    return { list, pct, cents: Math.floor(list * (100 - pct) / 100 / 100) * 100 };
  }

  // The cheapest fixed plan that covers every monthly service picked, if it costs the same or less.
  function betterBundle(monthly, monthlyCents) {
    if (!monthly.length || monthly.includes('GUEST_APP')) return null;
    let best = null;
    for (const code of BUNDLES) {
      const b = offers?.get(code);
      if (!b || !b.on_sale) continue;
      if (!monthly.every(c => b.includes.includes(c))) continue;
      const cents = price(code);
      if (cents === null || cents > monthlyCents) continue;
      if (!best || cents < best.cents) best = { code, cents, extra: b.includes.filter(c => !monthly.includes(c) && !(c === 'REVIEW_REPLIES' && monthly.includes('GOOGLE_PROFILE_CARE'))) };
    }
    return best;
  }

  function row(label, value, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    div.append(dt, dd);
    return div;
  }

  function checkoutUrl(monthly, oneTime, planCode = null) {
    const params = new URLSearchParams();
    if (planCode) params.set('plan', planCode);
    else if (monthly.length === 1) params.set('plan', monthly[0]);
    else if (monthly.length > 1) params.set('custom', monthly.join(','));
    if (planCode || monthly.length) params.set('interval', Catalog.interval);
    if (oneTime.length) params.set('add', oneTime.join(','));
    return 'contact.html?' + params.toString();
  }

  function render() {
    if (!offers) return;
    const { monthly, oneTime } = picks();
    const lines = $('[data-lines]');
    lines.innerHTML = '';
    const go = $('[data-checkout]'), hint = $('[data-hint]');
    hint.hidden = true;
    const bar = $('[data-bar]');
    bar.hidden = true;
    if (!monthly.length && !oneTime.length) {
      $('[data-empty]').hidden = false;
      go.setAttribute('aria-disabled', 'true'); go.classList.add('is-disabled'); go.href = '#build';
      return;
    }
    $('[data-empty]').hidden = true;
    go.removeAttribute('aria-disabled'); go.classList.remove('is-disabled');

    let monthlyCents = 0;
    const trial = oneTime.includes('WEBSITE_PACKAGE') && !monthly.length;
    if (monthly.length) {
      for (const code of monthly) lines.append(row(nameOf(code), money(price(code)) + unit()));
      const q = customCents(monthly);
      if (q && q.pct) lines.append(row(`Your own plan, ${q.pct}% off`, '−' + money(q.list - q.cents) + unit(), 'is-saving'));
      monthlyCents = q ? q.cents : 0;
      lines.append(row(monthly.length > 1 ? 'Your own plan' : 'Monthly', money(monthlyCents) + unit(), 'is-subtotal'));
    }
    let oneTimeCents = 0;
    for (const code of oneTime) {
      const cents = once(code) || 0;
      oneTimeCents += cents;
      lines.append(row(nameOf(code) + (code === 'ONLINE_MENU_QR' ? ' (first year, up to 3 pages)' : ' (one time)'), money(cents)));
    }
    if (monthly.includes('GUEST_APP')) {
      const setup = once('GUEST_APP_SETUP') || 0;
      oneTimeCents += setup;
      lines.append(row('Guest App setup (one time)', money(setup)));
    }
    if (trial) lines.append(row('Website Care', `free for 3 months, then ${money(price('WEBSITE_CARE'))}${unit()}`));
    lines.append(row('Due today', money(oneTimeCents + monthlyCents), 'is-total'));
    if (monthly.length) lines.append(row('Then', `${money(monthlyCents)}${unit()} until you cancel`, 'is-renew'));

    // Phones: a slim bar keeps the running total in view while ticking; hidden once the total panel itself is on screen.
    bar.hidden = totalInView;
    $('[data-bar-text]').textContent = `Today ${money(oneTimeCents + monthlyCents)}` + (monthly.length ? ` · then ${money(monthlyCents)}${unit()}` : '');
    const better = betterBundle(monthly, monthlyCents);
    if (better) {
      const name = BUNDLE_NAMES[better.code];
      const saving = monthlyCents - better.cents;
      const extras = better.extra.map(nameOf);
      hint.hidden = false;
      $('[data-hint-text]').textContent = `${name} covers ${monthly.length > 1 ? 'all of this' : 'this'}${extras.length ? `, plus ${extras.join(' and ')},` : ''} for ${money(better.cents)}${unit()}${saving > 0 ? `, ${money(saving)}${unit()} less` : ''}.`;
      const link = $('[data-hint-link]');
      link.textContent = `Choose ${name} instead`;
      link.href = checkoutUrl([], oneTime, better.code);
    }
    go.href = checkoutUrl(monthly, oneTime);
  }

  // The bar shows only while the list is on screen and the total panel isn't.
  const seen = new Map();
  if ('IntersectionObserver' in window) {
    const watch = new IntersectionObserver(entries => {
      for (const e of entries) seen.set(e.target, e.isIntersecting);
      totalInView = Boolean(seen.get($('.mm-builder-total'))) || !seen.get($('.mm-builder-list'));
      const bar = $('[data-bar]');
      bar.hidden = totalInView || !(picks().monthly.length || picks().oneTime.length);
    });
    watch.observe($('.mm-builder-total'));
    watch.observe($('.mm-builder-list'));
  }

  root.addEventListener('change', event => {
    if (event.target.matches('input[type="checkbox"][data-code]')) { applyRules(event.target); render(); }
  });
  $('[data-checkout]').addEventListener('click', event => {
    if (event.currentTarget.getAttribute('aria-disabled') === 'true') { event.preventDefault(); boxes()[0]?.focus(); }
  });
  Catalog.onRender(() => render());
  Catalog.ready.then(map => { offers = map; applyRules(null); render(); }).catch(() => {
    $('[data-empty]').textContent = 'Prices could not be loaded. Refresh the page, or choose a plan above.';
  });
})();
