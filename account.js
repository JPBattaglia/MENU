// Account page: emailed sign-in link, then a summary of plans, orders, deliveries and private links.
// The session is an HttpOnly cookie set by /api/account/open; this script never sees it. All data is rendered with
// textContent and links are only ever https://menu-made.com or https://billing.stripe.com addresses from our API.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = /(^|\.)menu-made\.com$/.test(location.hostname) ? '' : 'https://menu-made.com';
  const money = (cents, currency = 'USD') => (cents / 100).toLocaleString('en-US', { style: 'currency', currency });
  const day = iso => iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const STATUS = { ACTIVE: 'Active', TRIALING: 'Free trial', PAST_DUE: 'Payment due', CANCELLED: 'Cancelled', EXPIRED: 'Ended', INCOMPLETE: 'Not started', UNPAID: 'Unpaid', PAUSED: 'Paused' };
  const ORDER_STATUS = { PAID: 'Paid', ONBOARDING_REQUIRED: 'Waiting for your details', READY_FOR_PRODUCTION: 'In the queue', IN_PRODUCTION: 'Being made', QC_REQUIRED: 'Being checked', CUSTOMER_APPROVAL_REQUIRED: 'Waiting for your approval', DELIVERED: 'Delivered', COMPLETED: 'Completed', REFUND_PENDING: 'Refund pending', REFUNDED: 'Refunded' };

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function safeLink(item) {
    let url;
    try { url = new URL(item.url); } catch { return null; }
    if (url.protocol !== 'https:' || !['menu-made.com', 'billing.stripe.com'].includes(url.hostname) && !url.hostname.endsWith('.menu-made.com')) return null;
    const a = el('a', item.label, 'cta-pill');
    a.href = url.href;
    a.rel = 'noopener';
    return a;
  }
  function card(title, lines, links) {
    const box = el('article', '', 'mm-card');
    box.append(el('h3', title));
    for (const line of lines.filter(Boolean)) box.append(el('p', line, 'mini'));
    const actions = el('div', '', 'mm-account-actions');
    for (const item of links || []) { const a = safeLink(item); if (a) actions.append(a); }
    if (actions.children.length) box.append(actions);
    return box;
  }
  function empty(container, text) { container.replaceChildren(el('p', text, 'mini')); }

  function render(me) {
    $('signIn').hidden = true;
    $('dashboard').hidden = false;
    $('accountEmail').textContent = me.email || '';
    $('accountTitle').textContent = me.name ? `Welcome back, ${me.name.split(' ')[0]}` : 'Your Menu-Made account';
    $('accountIntro').textContent = 'Everything you have with Menu-Made, and the links to make changes.';

    const biz = $('accountBusinesses');
    biz.replaceChildren();
    for (const b of me.businesses || []) {
      const hosting = b.menu_hosting;
      const links = [b.menu && { label: 'Your online menu', url: b.menu }, hosting && { label: hosting.status === 'OFFLINE' ? 'Bring your menu back with Menu Care' : 'Keep your menu online with Menu Care', url: hosting.renew_url }, b.website && { label: 'Your website', url: b.website }, b.app && { label: 'Your Guest App', url: b.app }].filter(Boolean);
      const lines = hosting ? [hosting.status === 'OFFLINE' ? `Your online menu is offline (since ${day(hosting.offline_at)}).` : `Your online menu goes offline on ${day(hosting.offline_at)} unless you add Menu Care.`] : [];
      if (links.length) biz.append(card(b.name, lines, links));
    }

    const plans = $('accountPlans');
    plans.replaceChildren();
    for (const p of me.plans || []) {
      const price = p.amount_cents != null ? `${money(p.amount_cents, p.currency)} / ${p.interval === 'YEAR' ? 'year' : 'month'}` : '';
      const when = p.cancel_at_period_end ? `Ends ${day(p.renews_at)}` : p.status === 'TRIALING' && p.trial_ends_at ? `Free until ${day(p.trial_ends_at)}` : p.renews_at ? `Renews ${day(p.renews_at)}` : '';
      const google = p.google ? (p.google.connected ? `Google profile connected${p.google.profile ? ': ' + p.google.profile : ''}` : 'Google profile not connected yet: connect it so we can start') : '';
      plans.append(card(p.name, [[STATUS[p.status] || p.status, price, when].filter(Boolean).join(' · '), google], p.links));
    }
    if (!plans.children.length) empty(plans, 'No plans yet. See the plans on the Plans page.');

    const orders = $('accountOrders');
    orders.replaceChildren();
    for (const o of me.orders || []) {
      orders.append(card(o.items || 'Order', [[day(o.date), money(o.total_cents, o.currency), ORDER_STATUS[o.status] || o.status, o.test ? 'Test order' : ''].filter(Boolean).join(' · '), o.actions?.length ? 'Your next step:' : ''], o.actions));
    }
    if (!orders.children.length) empty(orders, 'No one-time orders.');

    const deliveries = $('accountDeliveries');
    deliveries.replaceChildren();
    for (const d of me.deliveries || []) {
      deliveries.append(card(d.label, [[d.product, day(d.date)].filter(Boolean).join(' · ')], [{ label: 'Open', url: d.url }]));
    }
    if (!deliveries.children.length) empty(deliveries, 'Nothing delivered yet. Deliveries appear here as soon as they’re sent to you.');
  }

  async function load() {
    try {
      const response = await fetch(API + '/api/account/me', { credentials: 'include', headers: { Accept: 'application/json' } });
      if (response.ok) render(await response.json());
    } catch {}
  }

  $('signInForm').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('signInEmail').value.trim();
    const status = $('signInStatus');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = 'Enter the email address you used at checkout.'; $('signInEmail').focus(); return; }
    $('signInBtn').disabled = true;
    status.textContent = 'Sending…';
    try {
      const response = await fetch(API + '/api/account/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const body = await response.json().catch(() => ({}));
      status.textContent = body.message || body.error || 'Something went wrong. Please try again.';
    } catch {
      status.textContent = 'Something went wrong. Please try again.';
    } finally {
      $('signInBtn').disabled = false;
    }
  });

  $('signOutBtn').addEventListener('click', async () => {
    try { await fetch(API + '/api/account/sign-out', { method: 'POST', credentials: 'include' }); } catch {}
    location.reload();
  });

  load();
})();
