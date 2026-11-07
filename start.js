// Start page: one plan or bundle (monthly or annual) plus any one-time setups, then secure Stripe checkout.
// Prices and availability come from site-catalog.js (GET /api/catalog); nothing here is a price.
// Owner testing: add ?checkout=test to use Stripe test mode (no real charge). Test mode can also check out
// offers that are not on sale yet, so a new plan can be tried before it is listed.
const TEST_CHECKOUT = new URLSearchParams(location.search).get('checkout') === 'test';
if (TEST_CHECKOUT) document.addEventListener('DOMContentLoaded', () => {
  const note = document.createElement('div');
  note.textContent = 'TEST MODE — Stripe test checkout. Use card 4242 4242 4242 4242. No real charge.';
  note.setAttribute('role', 'status');
  note.className = 'test-mode-banner';
  document.body.prepend(note);
});

// Your Website (Nov 6, 2026): websites start in the site generator, where the buyer picks one of 9 designs.
// Old "Website Package" and Conversion Fix links go there; test mode still opens the old package for existing orders.
{
  const q = new URLSearchParams(location.search);
  if (!TEST_CHECKOUT && /^(website|conversion|conversion_fix|CONVERSION_FIX|WEBSITE_PACKAGE)$/.test(q.get('service') || '') && !q.get('wpreview')) {
    location.replace('website-design.html#try-free');
  }
}

const Catalog = window.MenuMadeCatalog;
const $ = id => document.getElementById(id);
const MENU = 'ONLINE_MENU_QR';
const WEBSITE = 'WEBSITE_PACKAGE';
// Short service names used by links from other pages and older emails.
const ALIASES = {
  menu: MENU, online_menu_qr: MENU, 'online-menu-qr': MENU,
  // Conversion Fix is folded into the Website Package (Nov 6, 2026): its old links open the Website Package.
  conversion: WEBSITE, conversion_fix: WEBSITE, CONVERSION_FIX: WEBSITE, google: 'GOOGLE_VISIBILITY',
  accessibility: 'ACCESSIBILITY_MONITORING', website: WEBSITE, app: 'GUEST_APP',
  // The site generator's "Choose this site" (Nov 6, 2026): the chosen design rides along as site_choice.
  sitefiles: 'SITE_FILES'
};
const BRIEFS = {
  CONVERSION_FIX: { panel: 'conversionBrief', fields: ['conversionUrl', 'conversionGoal'], required: ['conversionUrl', 'conversionGoal'] },
  GOOGLE_VISIBILITY: { panel: 'googleBrief', fields: ['googleMode', 'googleUrl'], required: ['googleMode'] }
};
const BRIEF_IDS = ['conversionUrl', 'conversionGoal', 'googleMode', 'googleUrl'];

const order = { plan: null, once: new Set(), custom: [] };
// "Your own plan" (Nov 6, 2026): the monthly services ticked on the plans page, one price. The server prices it the
// same way (src/subscriptions/plans.js); this only shows the buyer the total before checkout.
const CUSTOM = 'CUSTOM_PLAN';
const CUSTOM_SERVICES = ['MENU_CARE', 'REVIEW_REPLIES', 'GOOGLE_PROFILE_CARE', 'SOCIAL_POSTS', 'WEBSITE_CARE', 'ACCESSIBILITY_MONITORING', 'GUEST_APP'];
function cleanCustom(codes) {
  const wanted = new Set(codes.map(c => String(c).trim().toUpperCase()));
  let list = CUSTOM_SERVICES.filter(c => wanted.has(c));
  if (list.includes('GOOGLE_PROFILE_CARE')) list = list.filter(c => c !== 'REVIEW_REPLIES'); // already answers reviews
  return list;
}
function customQuote(codes = order.custom) {
  let list = 0;
  for (const code of codes) { const p = Catalog.priceOf(offer(code), interval()); if (p === null) return null; list += p; }
  const pct = codes.length >= 3 ? 20 : codes.length === 2 ? 10 : 0;
  return { list, pct, cents: Math.floor(list * (100 - pct) / 100 / 100) * 100 };
}
let offers = null;
let checkoutInFlight = false;
let uploadedDocumentRequest = null;
let previewDocumentId = ''; // a free preview's stored menu file, reused so the buyer doesn't upload it again
let lockedFieldValues = null;
// A domain bought with the hosted site (Nov 7, 2026): { name, price_cents, renewal_cents } from /api/domains.
let domainPick = null;
let domainsEnabled = false;
let domainResults = [];

const els = {
  items: $('cartItems'), total: $('cartTotal'), recurringRow: $('recurringRow'), recurring: $('recurringTotal'),
  continueBtn: $('continueBtn'), clearBtn: $('clearBtn'), intake: $('intakeStep'), checkoutBtn: $('checkoutBtn'),
  backBtn: $('backBtn'), status: $('status'), menuPages: $('menuPages'), picker: $('optionalServices'),
  name: $('lead_name'), business: $('lead_business'), email: $('lead_email'), phone: $('lead_phone'),
  notes: $('lead_notes'), scope: $('scopeConfirm')
};

const interval = () => Catalog?.interval || 'month';
const money = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const offer = code => offers?.get(code) || null;
const cardFor = code => document.querySelector(`.service-card[data-code="${code}"]`);
const nameOf = code => code === CUSTOM ? 'Your own plan' : (offer(code)?.name || cardFor(code)?.dataset.name || code);
const planCents = code => code === CUSTOM ? (customQuote()?.cents ?? null) : Catalog.priceOf(offer(code), interval());
const wholeMoney = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
const planLabel = code => { if (code !== CUSTOM) return Catalog.label(offer(code), interval()); const c = planCents(code); return c === null ? '' : wholeMoney(c) + (interval() === 'year' ? '/yr' : '/mo'); };
const sellable = o => Boolean(o) && (o.on_sale || TEST_CHECKOUT);

function showStatus(message) { els.status.textContent = message; els.status.classList.add('show'); }
function clearStatus() { els.status.textContent = ''; els.status.classList.remove('show'); }
function setFieldState(input, errorEl, valid, message) {
  input.classList.toggle('invalid', !valid);
  input.setAttribute('aria-invalid', String(!valid));
  if (errorEl) { errorEl.textContent = message; errorEl.classList.toggle('show', !valid); }
}
function clearFieldState(input, errorEl) { setFieldState(input, errorEl, true, ''); }
function validateEmailField() {
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(els.email.value.trim());
  setFieldState(els.email, $('lead_email_error'), valid, 'Enter a valid email address.');
  return valid;
}
function validatePhoneField() {
  const value = els.phone.value.trim();
  const valid = !value || /^[0-9+\-\s().]{7,}$/.test(value);
  setFieldState(els.phone, $('lead_phone_error'), valid, 'Enter a valid phone number.');
  return valid;
}
function inquiryBusy() { return $('bookingForm')?.getAttribute('aria-busy') === 'true'; }
function flowBusy() { return checkoutInFlight || inquiryBusy(); }
function hasItems() { return Boolean(order.plan) || order.once.size > 0; }

function menuQuote() {
  const pkg = offer(MENU)?.menu_package;
  const raw = String(els.menuPages.value).trim(), pages = Number(raw);
  if (!pkg || !raw || !Number.isInteger(pages) || pages < 1 || pages > pkg.max_pages) return null;
  const extraPages = Math.max(0, pages - pkg.included_pages);
  const extrasCents = extraPages * pkg.additional_page_cents;
  return { pages, extraPages, extrasCents, totalCents: pkg.setup_cents + pkg.hosting_first_year_cents + extrasCents, pkg };
}

// The plan the checkout will start. A Website Package bought without a plan starts Website Care on a trial.
function effectivePlan() {
  if (order.plan) return { code: order.plan, trial: false };
  if (order.once.has(WEBSITE)) return { code: 'WEBSITE_CARE', trial: true };
  return null;
}

// Mirrors the order engine's rules so the buyer sees a problem before checkout, not after.
function orderProblem() {
  const plan = order.plan === CUSTOM ? { name: 'your own plan', includes: order.custom } : order.plan ? offer(order.plan) : null;
  if (order.once.has(WEBSITE) && plan && !plan.includes.includes('WEBSITE_CARE')) {
    return order.plan === CUSTOM
      ? 'The Website Package comes with Website Care. Add Website Care to your own plan, or check out the Website Package on its own.'
      : `The Website Package comes with Website Care. Check it out on its own, or with a plan that includes Website Care (Pro or Website Care on its own), and add ${plan.name} in a second checkout.`;
  }
  const codes = order.plan === CUSTOM ? [...order.custom, ...order.once] : [order.plan, ...order.once];
  for (const code of codes.filter(Boolean)) {
    if (offers && !sellable(offer(code))) return `${nameOf(code)} opens soon. Remove it to continue, or ask us about it below.`;
  }
  return '';
}

function updateBriefs() {
  for (const [code, group] of Object.entries(BRIEFS)) {
    const active = order.once.has(code);
    $(group.panel).hidden = !active;
    for (const id of group.fields) {
      const field = $(id);
      field.disabled = !active || checkoutInFlight;
      field.required = active && group.required.includes(id);
    }
  }
  const showGoogleUrl = order.once.has('GOOGLE_VISIBILITY') && $('googleMode').value === 'existing';
  $('googleUrlField').hidden = !showGoogleUrl;
  $('googleUrl').disabled = !showGoogleUrl || checkoutInFlight;
  $('menuUploadNote').hidden = !order.once.has(MENU);
}

function updateCards() {
  document.querySelectorAll('.js-add').forEach(button => {
    const card = button.closest('.service-card');
    const code = card.dataset.code;
    const selected = card.dataset.kind === 'plan' ? order.plan === code : order.once.has(code);
    const o = offer(code);
    const soon = Boolean(offers) && !sellable(o);
    button.disabled = selected || checkoutInFlight || !offers || soon;
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = selected ? 'Selected' : soon ? 'Opening soon' : !offers ? 'Loading…' : (button.dataset.selectLabel || 'Add');
    card.classList.toggle('is-selected', selected);
    card.classList.toggle('is-soon', soon);
  });
}

function lineFor(code, kind) {
  const o = offer(code);
  const li = document.createElement('li');
  li.className = 'cart-item';
  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = nameOf(code);
  const small = document.createElement('small');
  if (kind === 'plan' && code === CUSTOM) {
    const q = customQuote();
    small.textContent = order.custom.map(nameOf).join(', ') + ' · ' + planLabel(CUSTOM) + (q?.pct ? `, ${q.pct}% off` : '') + (interval() === 'year' ? ' · billed yearly' : ' · billed monthly');
  } else if (kind === 'plan') {
    small.textContent = Catalog.label(o, interval()) + (interval() === 'year' ? ' · billed yearly' : ' · billed monthly');
  } else if (code === MENU) {
    const quote = menuQuote();
    small.textContent = quote ? `${quote.pages} page${quote.pages === 1 ? '' : 's'} · first-year hosting included` : 'Enter your page count';
  } else if (code === 'GUEST_APP_SETUP') {
    small.textContent = Catalog.label(o, interval()) + ' · one-time app build';
  } else {
    small.textContent = Catalog.label(o, interval()) + ' · one-time';
  }
  text.append(strong, small);
  li.append(text);
  if (code !== 'GUEST_APP_SETUP') {
    const remove = document.createElement('button');
    remove.className = 'btn secondary remove-item';
    remove.type = 'button';
    remove.dataset.remove = code;
    remove.setAttribute('aria-label', 'Remove ' + nameOf(code));
    remove.textContent = 'Remove';
    li.append(remove);
  }
  return li;
}

function render(openEmptyChoices = true) {
  els.items.innerHTML = '';
  const any = hasItems();
  const hasMenu = order.once.has(MENU);
  const quote = hasMenu ? menuQuote() : null;
  $('menuConfig').hidden = !hasMenu;
  els.menuPages.disabled = !hasMenu || checkoutInFlight;
  els.menuPages.required = hasMenu;
  const validPages = !hasMenu || Boolean(quote);
  setFieldState(els.menuPages, $('menuPagesError'), validPages, `Enter a whole number from 1 to ${offer(MENU)?.menu_package?.max_pages || 50}.`);
  if (quote) {
    $('menuSetupAmount').textContent = money(quote.pkg.setup_cents);
    $('menuHostingAmount').textContent = money(quote.pkg.hosting_first_year_cents);
    $('extraPagesLabel').textContent = `Additional pages · ${quote.extraPages}`;
    $('extraPagesAmount').textContent = money(quote.extrasCents);
  }
  if (order.plan) els.items.append(lineFor(order.plan, 'plan'));
  let today = 0;
  for (const code of order.once) {
    els.items.append(lineFor(code, 'once'));
    today += code === MENU ? (quote?.totalCents || 0) : (Catalog.priceOf(offer(code), interval()) || 0);
  }
  if (domainPick && !domainAllowed()) domainPick = null;
  if (domainPick) {
    els.items.append(domainLine());
    today += domainPick.price_cents;
  }
  const plan = effectivePlan();
  if (plan && !plan.trial) today += planCents(plan.code) || 0;
  els.recurringRow.hidden = !plan;
  if (plan) {
    els.recurring.textContent = plan.trial
      ? `${nameOf(plan.code)} free for 3 months, then ${planLabel(plan.code)}`
      : `${planLabel(plan.code)}, renews ${interval() === 'year' ? 'yearly' : 'monthly'} until you cancel`;
  }
  els.total.textContent = validPages ? money(today) : 'Enter page count';
  const problem = any ? orderProblem() : '';
  $('orderProblem').textContent = problem;
  $('orderProblem').hidden = !problem;
  $('orderTotalRow').hidden = !any;
  $('emptyOrder').hidden = any;
  $('orderActions').hidden = !any;
  $('billingDetails').hidden = !any;
  $('orderSecurity').hidden = !any;
  const blocked = !any || !validPages || Boolean(problem) || checkoutInFlight || !offers;
  els.continueBtn.disabled = blocked;
  els.checkoutBtn.disabled = blocked;
  els.clearBtn.disabled = !any || checkoutInFlight;
  if (!any) {
    if (openEmptyChoices) els.picker.open = true;
    els.intake.classList.remove('show');
    els.continueBtn.hidden = false;
  }
  updateBriefs();
  updateCards();
  renderSiteAddons();
  renderDomain();
}

// Your own domain: shown under the add-ons once the site is hosted (Website Care, the Pro plan, or your own plan with it).
const usd = cents => '$' + (cents / 100).toFixed(2);
function siteHosted() {
  return order.plan === 'WEBSITE_CARE' || order.plan === 'BUNDLE_PRO' || (order.plan === CUSTOM && order.custom.includes('WEBSITE_CARE'));
}
function domainAllowed() { return domainsEnabled && order.once.has('SITE_FILES') && siteHosted(); }
function domainLine() {
  const li = document.createElement('li');
  li.className = 'cart-item';
  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = 'Domain: ' + domainPick.name;
  const small = document.createElement('small');
  small.textContent = `${usd(domainPick.price_cents)} · first year, in your name · renews at ${usd(domainPick.renewal_cents)}/yr only if you say so`;
  text.append(strong, small);
  const remove = document.createElement('button');
  remove.className = 'btn secondary remove-item';
  remove.type = 'button';
  remove.dataset.removeDomain = '1';
  remove.setAttribute('aria-label', 'Remove domain ' + domainPick.name);
  remove.textContent = 'Remove';
  li.append(text, remove);
  return li;
}
function renderDomain() {
  const box = $('siteDomain');
  if (!box) return;
  box.hidden = !domainAllowed();
  if (box.hidden) return;
  const query = $('domainQuery');
  if (!query.value && els.business.value.trim()) query.value = els.business.value.trim();
  const list = $('domainResults');
  list.innerHTML = '';
  for (const d of domainResults) {
    const li = document.createElement('li');
    const picked = domainPick?.name === d.name;
    li.classList.toggle('is-selected', picked);
    li.classList.toggle('is-off', !d.available);
    const text = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = d.name;
    const small = document.createElement('small');
    small.textContent = d.available ? `${usd(d.price_cents)} first year · renews ${usd(d.renewal_cents)}/yr` : d.reason;
    text.append(strong, small);
    li.append(text);
    if (d.available) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn secondary';
      button.dataset.domain = d.name;
      button.textContent = picked ? 'Added' : 'Add';
      button.setAttribute('aria-pressed', String(picked));
      button.disabled = checkoutInFlight;
      li.append(button);
    }
    list.append(li);
  }
}
async function searchDomains() {
  const q = $('domainQuery').value.trim();
  const note = $('domainNote');
  if (q.length < 2) { note.textContent = 'Type your business name or the domain you want.'; return; }
  const button = $('domainSearchBtn');
  button.disabled = true; note.textContent = 'Searching…';
  try {
    const response = await fetch((Catalog?.API || '') + '/api/domains?q=' + encodeURIComponent(q));
    const data = await response.json();
    if (!data?.ok) { note.textContent = data?.error || 'Domain search is not answering right now. Try again in a minute.'; return; }
    domainResults = (data.results || []).slice(0, 8);
    note.textContent = domainResults.some(d => d.available) ? 'Add one to your order. The price covers the first year.' : 'Nothing free for that name. Try a different spelling or ending.';
    renderDomain();
  } catch {
    note.textContent = 'Domain search is not answering right now. Try again in a minute.';
  } finally {
    button.disabled = false;
  }
}
$('domainSearchBtn')?.addEventListener('click', () => { if (!flowBusy()) searchDomains(); });
$('domainQuery')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (!flowBusy()) searchDomains(); } });
$('domainResults')?.addEventListener('click', event => {
  const button = event.target.closest('[data-domain]');
  if (!button || flowBusy()) return;
  const d = domainResults.find(r => r.name === button.dataset.domain);
  domainPick = domainPick?.name === d?.name ? null : (d ? { name: d.name, price_cents: d.price_cents, renewal_cents: d.renewal_cents } : null);
  clearStatus();
  render(false);
});
fetch((Catalog?.API || '') + '/api/domains').then(r => r.json()).then(data => { domainsEnabled = Boolean(data?.enabled); render(false); }).catch(() => {});

// "Choose this site" lands here with the site in the order (owner, Nov 6, 2026): Website Care, the Pro plan, or
// Website Care plus other monthly services (your own plan, 10% / 20% off) are one tap away. One plan per order.
const SITE_ADDON_EXTRAS = ['MENU_CARE', 'REVIEW_REPLIES', 'GOOGLE_PROFILE_CARE', 'SOCIAL_POSTS', 'ACCESSIBILITY_MONITORING'];
function renderSiteAddons() {
  const panel = $('siteAddons');
  if (!panel) return;
  panel.hidden = !order.once.has('SITE_FILES') || !offers;
  if (panel.hidden) return;
  panel.querySelectorAll('[data-price]').forEach(el => { const o = offer(el.dataset.price); el.textContent = o ? Catalog.label(o, interval()) : ''; });
  const extras = order.plan === CUSTOM && order.custom.includes('WEBSITE_CARE') ? order.custom.filter(c => c !== 'WEBSITE_CARE') : [];
  panel.querySelectorAll('[data-addon]').forEach(row => {
    const code = row.dataset.addon, on = order.plan === code;
    row.classList.toggle('is-selected', on);
    const button = row.querySelector('button');
    button.textContent = on ? 'Added' : 'Add';
    button.setAttribute('aria-pressed', String(on));
    button.disabled = checkoutInFlight || !sellable(offer(code));
  });
  panel.querySelectorAll('.site-addon-own input').forEach(box => { box.checked = extras.includes(box.value); box.disabled = checkoutInFlight || !sellable(offer(box.value)); });
  const note = $('siteAddonNote');
  if (order.plan === CUSTOM && order.custom.includes('WEBSITE_CARE')) {
    const q = customQuote();
    note.textContent = `Your plan: ${order.custom.map(nameOf).join(', ')}, ${planLabel(CUSTOM)}${q?.pct ? ` (${q.pct}% off)` : ''}.`;
  } else if (order.plan === 'WEBSITE_CARE' || order.plan === 'BUNDLE_PRO') {
    note.textContent = 'Your site goes live at its own web address once it is made.';
  } else if (order.plan) {
    note.textContent = `${nameOf(order.plan)} doesn't include hosting: you get the zip to put online yourself. Choose an option above to have us host it instead.`;
  } else {
    note.textContent = '';
  }
}
$('siteAddons')?.addEventListener('click', event => {
  const button = event.target.closest('[data-addon-add]');
  if (!button || flowBusy()) return;
  const code = button.dataset.addonAdd;
  if (order.plan === code) remove(code); else add(code, { quiet: true });
  clearStatus();
  render(false);
});
$('siteAddons')?.addEventListener('change', event => {
  const box = event.target.closest('.site-addon-own input');
  if (!box || flowBusy()) return;
  const ticked = [...document.querySelectorAll('.site-addon-own input')].filter(b => b.checked).map(b => b.value);
  if (ticked.length) setCustom(['WEBSITE_CARE', ...ticked]);
  else if (order.plan === CUSTOM) add('WEBSITE_CARE', { quiet: true });
  clearStatus();
  render(false);
});

function add(code, { quiet = false } = {}) {
  if (flowBusy() || !offers) return false;
  const o = offer(code);
  if (!o || !sellable(o)) { if (!quiet) showStatus(`${nameOf(code)} opens soon. Ask us about it below.`); return false; }
  clearStatus();
  if (code === 'WEBSITE_CARE' && order.once.has(WEBSITE)) {
    if (!quiet) showStatus('Website Care is already included free for 3 months with your Website Package.');
    return false;
  }
  if (code === WEBSITE && order.plan === 'WEBSITE_CARE') {
    order.plan = null;
    showStatus('The Website Package includes 3 months of Website Care, so the separate Website Care plan was removed.');
  }
  if (o.prices) {
    if (order.plan === code) return false;
    if (order.plan && !quiet) showStatus(`Your order has one plan at a time, so ${nameOf(order.plan)} was replaced by ${o.name}. Bundles combine plans for less.`);
    if (order.plan === 'GUEST_APP' || (order.plan === CUSTOM && order.custom.includes('GUEST_APP'))) order.once.delete('GUEST_APP_SETUP');
    order.custom = [];
    order.plan = code;
    if (o.requires_setup) order.once.add(o.requires_setup);
  } else {
    if (order.once.has(code)) return false;
    order.once.add(code);
  }
  window.MenuMadeFunnel?.track('service_selected', code);
  render();
  return true;
}

// Your own plan from the plans page: two or more monthly services; one is just that service.
function setCustom(codes) {
  if (flowBusy() || !offers) return false;
  const list = cleanCustom(codes).filter(code => sellable(offer(code)));
  if (list.length < 2) return list.length ? add(list[0], { quiet: true }) : false;
  if (order.plan === 'GUEST_APP' || (order.plan === CUSTOM && order.custom.includes('GUEST_APP'))) order.once.delete('GUEST_APP_SETUP');
  order.plan = CUSTOM;
  order.custom = list;
  if (list.includes('GUEST_APP')) order.once.add('GUEST_APP_SETUP');
  window.MenuMadeFunnel?.track('service_selected', CUSTOM);
  render();
  return true;
}

function remove(code) {
  if (order.plan === code) {
    const setup = code === CUSTOM ? (order.custom.includes('GUEST_APP') ? 'GUEST_APP_SETUP' : null) : offer(code)?.requires_setup;
    order.custom = [];
    order.plan = null;
    if (setup) order.once.delete(setup);
  } else {
    order.once.delete(code);
  }
  clearStatus();
  render();
}

function showDetails(moveToDetails = true) {
  els.intake.classList.add('show');
  els.continueBtn.hidden = true;
  window.MenuMadeFunnel?.track('details_opened');
  if (moveToDetails) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.querySelector('.cart').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    els.name.focus({ preventScroll: true });
  }
}

function lockControls(locked) {
  const fields = [els.menuPages, ...BRIEF_IDS.map($)];
  lockedFieldValues = locked ? new Map(fields.map(field => [field, field.value])) : null;
  document.querySelectorAll('.js-add, #cartItems button, #clearBtn, #continueBtn, #backBtn, #menuPages, #intakeStep input, #intakeStep textarea, #intakeStep select, [data-billing-toggle] input')
    .forEach(control => { control.disabled = locked; });
}

function publicUrl(value) {
  const raw = value.trim();
  if (!raw || raw.length > 180) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : 'https://' + raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return null;
    return url.href;
  } catch { return null; }
}

function collectBrief() {
  const lines = [];
  function fail(id, message) {
    const field = $(id);
    setFieldState(field, $(id + 'Error'), false, message);
    showStatus(message); field.focus(); return null;
  }
  if (order.once.has(MENU)) {
    const quote = menuQuote();
    lines.push(`Menu: ${quote.pages} pages; first-year hosting; ${money(quote.totalCents)}.`);
  }
  if (order.once.has('CONVERSION_FIX')) {
    const url = publicUrl($('conversionUrl').value);
    if (!url) return fail('conversionUrl', 'Enter the public website address for the Conversion Fix. Do not include login details.');
    const goal = $('conversionGoal').value.trim();
    if (goal.length < 3 || goal.length > 80) return fail('conversionGoal', 'Describe the main customer action in 3–80 characters, such as calls or reservations.');
    lines.push(`Website fix: ${url}\nGoal: ${goal}`);
  }
  if (order.once.has('GOOGLE_VISIBILITY')) {
    const mode = $('googleMode').value;
    if (!['existing', 'new'].includes(mode)) return fail('googleMode', 'Choose whether you need a new Google Business Profile or help with an existing one.');
    const raw = $('googleUrl').value.trim();
    const url = mode === 'existing' && raw ? publicUrl(raw) : '';
    if (mode === 'existing' && raw && !url) return fail('googleUrl', 'Enter a public Google profile link, or leave it blank if you do not have it.');
    lines.push(`Google: ${mode === 'new' ? 'new profile' : 'existing profile'}${url ? '; ' + url : ''}`);
  }
  const brief = lines.join('\n');
  if (brief.length > 420) return fail('lead_notes', 'The combined service brief is too long for checkout. Shorten the links, or send us a message with the details.');
  return brief;
}

function composeNotes(brief, notes, limit, documentReference = '') {
  const prefix = [brief, documentReference ? 'Document ref: ' + documentReference : ''].filter(Boolean).join('\n');
  const remaining = Math.max(0, limit - prefix.length - (prefix && notes ? 1 : 0));
  return prefix + (prefix && notes ? '\n' : '') + notes.slice(0, remaining);
}

async function checkout() {
  if (flowBusy()) return;
  if (!hasItems()) { showStatus('Choose a plan or service before continuing to checkout.'); els.picker.open = true; return; }
  const problem = orderProblem();
  if (problem) { showStatus(problem); return; }
  const quote = order.once.has(MENU) ? menuQuote() : null;
  if (order.once.has(MENU) && !quote) { showStatus('Enter how many pages your menu has.'); els.menuPages.focus(); return; }
  const name = els.name.value.trim(), business = els.business.value.trim(), email = els.email.value.trim(), phone = els.phone.value.trim(), notes = els.notes.value.trim();
  if (!name) { showStatus('Please enter your name.'); els.name.focus(); return; }
  if (!business) { showStatus('Please enter your business name.'); els.business.focus(); return; }
  if (!validateEmailField()) { els.email.focus(); return; }
  if (!validatePhoneField()) { els.phone.focus(); return; }
  const brief = collectBrief(); if (brief === null) return;
  if (!els.scope.checked) { showStatus('Please confirm you have read what is included.'); els.scope.focus(); return; }
  const items = [
    ...(order.plan ? [{ key: order.plan, qty: 1, interval: interval(), ...(order.plan === CUSTOM ? { includes: order.custom } : {}) }] : []),
    ...[...order.once].map(code => ({ key: code, qty: 1 }))
  ];
  const customer = { name, business, email, phone, notes: composeNotes(brief, notes, 500) };
  const file = $('lead_document').files[0];
  const controller = new AbortController(); let timeout;
  clearStatus(); checkoutInFlight = true; els.checkoutBtn.disabled = true; lockControls(true);
  els.checkoutBtn.textContent = file ? 'Sending your menu…' : 'Opening secure checkout…';
  try {
    window.MenuMadeDocuments.validate(file);
    const fingerprint = await window.MenuMadeDocuments.fingerprint(file);
    timeout = setTimeout(() => controller.abort(), 60000);
    if (file) {
      const documentNotes = composeNotes(brief, 'Services: ' + items.map(item => nameOf(item.key)).join(', ') + '\n' + notes, 1200);
      const payload = { type: 'inquiry', purpose: 'checkout', service: 'Other project', name, business, email, notes: documentNotes, website: '' };
      const key = JSON.stringify(payload) + fingerprint;
      if (!uploadedDocumentRequest || uploadedDocumentRequest.key !== key) uploadedDocumentRequest = { key, payload: { ...payload, requestId: crypto.randomUUID() }, received: false };
      if (!uploadedDocumentRequest.received) { await window.MenuMadeDocuments.send(uploadedDocumentRequest.payload, file, controller.signal); uploadedDocumentRequest.received = true; }
      customer.notes = composeNotes(brief, notes, 500, uploadedDocumentRequest.payload.requestId);
      $('lead_document_status').textContent = 'Menu received. Reference: ' + uploadedDocumentRequest.payload.requestId;
    } else if (previewDocumentId && order.once.has(MENU)) {
      customer.notes = composeNotes(brief, notes, 500, previewDocumentId);
    }
    els.checkoutBtn.textContent = 'Opening secure checkout…';
    window.MenuMadeFunnel?.track('checkout_attempt');
    const response = await fetch((Catalog?.API || '') + (TEST_CHECKOUT ? '/api/create-checkout-test' : '/api/create-checkout'), {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, interval: interval(), ...(quote ? { menu_pages: quote.pages } : {}), ...(siteChoice && order.once.has('SITE_FILES') ? { site_choice: siteChoice } : {}), ...(domainPick && domainAllowed() ? { domain: domainPick.name } : {}), tracking: window.MenuMadeFunnel?.tracking(), customer })
    });
    const result = await response.json();
    if (!response.ok) { window.MenuMadeFunnel?.track('checkout_error'); showStatus(result?.error?.message || result?.error || 'Checkout error. Please refresh and try again.'); return; }
    if (result.url) { window.location.href = result.url; return; }
    showStatus('Checkout error. Please refresh and try again.');
  } catch (error) {
    window.MenuMadeFunnel?.track('checkout_error');
    showStatus(error.name === 'AbortError' ? 'The connection timed out. Please try again; your menu will not be sent twice.' : error.message || 'Checkout error. Please refresh and try again.');
  } finally {
    clearTimeout(timeout); checkoutInFlight = false; lockControls(false); els.checkoutBtn.textContent = 'Proceed to secure checkout'; render();
  }
}

document.querySelectorAll('.js-add').forEach(button => button.addEventListener('click', () => {
  // Your Website needs a design picked in the generator first.
  if (button.closest('.service-card').dataset.code === 'SITE_FILES' && !siteChoice) { location.href = 'website-design.html#try-free'; return; }
  if (add(button.closest('.service-card').dataset.code)) showDetails();
}));
els.items.addEventListener('click', event => {
  if (flowBusy()) return;
  if (event.target.dataset?.removeDomain) { domainPick = null; render(false); return; }
  const code = event.target.dataset?.remove;
  if (code && (order.plan === code || order.once.has(code))) remove(code);
});
[els.menuPages, ...BRIEF_IDS.map($)].forEach(field => {
  field.addEventListener(field.id === 'googleMode' ? 'change' : 'input', () => {
    if (checkoutInFlight) { if (lockedFieldValues?.has(field)) field.value = lockedFieldValues.get(field); return; }
    clearStatus(); clearFieldState(field, $(field.id + 'Error'));
    if (field === els.menuPages) render(); else updateBriefs();
  });
});
els.clearBtn.addEventListener('click', () => { if (flowBusy()) return; order.plan = null; order.once.clear(); clearStatus(); render(); });
els.continueBtn.addEventListener('click', () => { if (flowBusy() || !hasItems()) return; showDetails(false); });
els.backBtn.addEventListener('click', () => { if (flowBusy()) return; els.intake.classList.remove('show'); els.continueBtn.hidden = false; });
for (const [field, errorId, validate] of [[els.email, 'lead_email_error', validateEmailField], [els.phone, 'lead_phone_error', validatePhoneField]]) {
  field.addEventListener('input', () => { clearStatus(); if (field.value.trim()) validate(); else clearFieldState(field, $(errorId)); });
  field.addEventListener('blur', () => { if (field.value.trim()) validate(); });
}
els.checkoutBtn.addEventListener('click', checkout);
document.querySelectorAll('[data-choose-services]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault(); els.picker.open = true;
  const summary = $('serviceChoicesSummary');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  summary.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }); summary.focus({ preventScroll: true });
}));

// Catalog arrives → prices on cards, then any plan or service named in the link is selected.
const params = new URLSearchParams(location.search);
const requestedInterval = params.get('interval');
if (requestedInterval === 'year' || requestedInterval === 'month') Catalog?.setInterval(requestedInterval);
Catalog?.onRender(() => { if (offers) render(false); });
render(false);
(Catalog?.ready || Promise.reject(new Error('no catalog'))).then(map => {
  offers = map;
  const requested = [params.get('plan'), params.get('service')?.toLowerCase()]
    .map(value => (value && Object.hasOwn(ALIASES, value)) ? ALIASES[value] : value)
    .filter(code => code && /^[A-Z_]+$/.test(code) && offers.has(code));
  let chosen = false;
  for (const code of requested) chosen = add(code, { quiet: false }) || chosen;
  // From the plans page builder: ?custom=A,B (two or more monthly services) and ?add=X,Y (one-time services).
  const custom = (params.get('custom') || '').split(',').filter(Boolean);
  if (custom.length) chosen = setCustom(custom) || chosen;
  for (const raw of (params.get('add') || '').split(',').filter(Boolean)) {
    const code = Object.hasOwn(ALIASES, raw) ? ALIASES[raw] : raw.toUpperCase();
    if (/^[A-Z_]+$/.test(code) && offers.has(code) && !offers.get(code).prices) chosen = add(code, { quiet: true }) || chosen;
  }
  render(false);
  if (chosen) { els.picker.open = false; showDetails(false); }
  if (location.hash === '#optionalServices') els.picker.open = true;
}).catch(() => {
  showStatus('Prices could not be loaded. Refresh the page, or send us a message below and we will reply with a checkout link.');
  updateCards();
});

// "Make it live" from a free menu preview: prefill the details and attach the menu file it was made from.
const previewToken = params.get('preview');
if (previewToken && /^[a-f0-9]{36}$/.test(previewToken)) {
  fetch((Catalog?.API || '') + '/api/menu-preview/handoff/' + previewToken).then(r => r.json()).then(data => {
    if (!data?.ok || !/^[0-9a-f-]{36}$/.test(data.request_id || '')) return;
    previewDocumentId = data.request_id;
    if (!els.business.value) els.business.value = data.business || '';
    if (!els.email.value) els.email.value = data.email || '';
    if (!els.name.value) els.name.focus();
    $('lead_document_status').textContent = 'The menu from your preview is attached. Add a different file only if you want to replace it.';
  }).catch(() => {});
}

// "Make it live" from a free website preview (Nov 5, 2026): prefill the business and email. The intake form after
// payment starts from what the preview was built from.
const sitePreviewToken = params.get('wpreview');
const siteDesign = params.get('design');
const siteChoice = sitePreviewToken && /^[a-f0-9]{36}$/.test(sitePreviewToken) && /^[a-z]+$/.test(siteDesign || '') ? { token: sitePreviewToken, design: siteDesign } : null;
if (sitePreviewToken && /^[a-f0-9]{36}$/.test(sitePreviewToken)) {
  fetch((Catalog?.API || '') + '/api/website-preview/handoff/' + sitePreviewToken).then(r => r.json()).then(data => {
    if (!data?.ok) return;
    if (!els.business.value) els.business.value = data.business || '';
    if (!els.email.value && data.email && data.email !== 'info@menu-made.com') els.email.value = data.email;
    if (!els.name.value) els.name.focus();
  }).catch(() => {});
}

const ask = params.get('ask');
if (ask && /^[A-Z_]+$/.test(ask)) {
  const select = $('inquiryService');
  if (select) select.value = 'Plans and bundles';
  const notes = $('bookingNotes');
  Catalog?.ready.then(map => {
    if (notes && !notes.value) notes.value = `Please let me know when ${map.get(ask)?.name || 'this plan'} is available.`;
  }).catch(() => {});
}
