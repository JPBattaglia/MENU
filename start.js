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

const Catalog = window.MenuMadeCatalog;
const $ = id => document.getElementById(id);
const MENU = 'ONLINE_MENU_QR';
const WEBSITE = 'WEBSITE_PACKAGE';
// Short service names used by links from other pages and older emails.
const ALIASES = {
  menu: MENU, online_menu_qr: MENU, 'online-menu-qr': MENU,
  conversion: 'CONVERSION_FIX', google: 'GOOGLE_VISIBILITY',
  accessibility: 'ACCESSIBILITY_MONITORING', website: WEBSITE, app: 'GUEST_APP'
};
const BRIEFS = {
  CONVERSION_FIX: { panel: 'conversionBrief', fields: ['conversionUrl', 'conversionGoal'], required: ['conversionUrl', 'conversionGoal'] },
  GOOGLE_VISIBILITY: { panel: 'googleBrief', fields: ['googleMode', 'googleUrl'], required: ['googleMode'] }
};
const BRIEF_IDS = ['conversionUrl', 'conversionGoal', 'googleMode', 'googleUrl'];

const order = { plan: null, once: new Set() };
let offers = null;
let checkoutInFlight = false;
let uploadedDocumentRequest = null;
let lockedFieldValues = null;

const els = {
  items: $('cartItems'), total: $('cartTotal'), recurringRow: $('recurringRow'), recurring: $('recurringTotal'),
  continueBtn: $('continueBtn'), clearBtn: $('clearBtn'), intake: $('intakeStep'), checkoutBtn: $('checkoutBtn'),
  backBtn: $('backBtn'), status: $('status'), menuPages: $('menuPages'), picker: $('optionalServices'),
  name: $('lead_name'), business: $('lead_business'), email: $('lead_email'), phone: $('lead_phone'),
  notes: $('lead_notes'), scope: $('scopeConfirm')
};

const interval = () => Catalog?.interval || 'month';
const money = cents => '$' + (cents / 100).toFixed(2);
const offer = code => offers?.get(code) || null;
const cardFor = code => document.querySelector(`.service-card[data-code="${code}"]`);
const nameOf = code => offer(code)?.name || cardFor(code)?.dataset.name || code;
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
  const plan = order.plan ? offer(order.plan) : null;
  if (order.once.has(WEBSITE) && plan && !plan.includes.includes('WEBSITE_CARE')) {
    return `The Website Package comes with Website Care. Check it out on its own, or with a plan that includes Website Care (Pro or Website Care), and add ${plan.name} in a second checkout.`;
  }
  for (const code of [order.plan, ...order.once].filter(Boolean)) {
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
  if (kind === 'plan') {
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
  const plan = effectivePlan();
  if (plan && !plan.trial) today += Catalog.priceOf(offer(plan.code), interval()) || 0;
  els.recurringRow.hidden = !plan;
  if (plan) {
    const o = offer(plan.code);
    els.recurring.textContent = plan.trial
      ? `${nameOf(plan.code)} free for 3 months, then ${Catalog.label(o, interval())}`
      : `${Catalog.label(o, interval())}, renews ${interval() === 'year' ? 'yearly' : 'monthly'} until you cancel`;
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
}

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
    if (order.plan === 'GUEST_APP') order.once.delete('GUEST_APP_SETUP');
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

function remove(code) {
  if (order.plan === code) {
    const setup = offer(code)?.requires_setup;
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
    ...(order.plan ? [{ key: order.plan, qty: 1, interval: interval() }] : []),
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
    }
    els.checkoutBtn.textContent = 'Opening secure checkout…';
    window.MenuMadeFunnel?.track('checkout_attempt');
    const response = await fetch((Catalog?.API || '') + (TEST_CHECKOUT ? '/api/create-checkout-test' : '/api/create-checkout'), {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, interval: interval(), ...(quote ? { menu_pages: quote.pages } : {}), tracking: window.MenuMadeFunnel?.tracking(), customer })
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
  if (add(button.closest('.service-card').dataset.code)) showDetails();
}));
els.items.addEventListener('click', event => {
  if (flowBusy()) return;
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
  render(false);
  if (chosen) { els.picker.open = false; showDetails(false); }
  if (location.hash === '#optionalServices') els.picker.open = true;
}).catch(() => {
  showStatus('Prices could not be loaded. Refresh the page, or send us a message below and we will reply with a checkout link.');
  updateCards();
});

const ask = params.get('ask');
if (ask && /^[A-Z_]+$/.test(ask)) {
  const select = $('inquiryService');
  if (select) select.value = 'Plans and bundles';
  const notes = $('bookingNotes');
  Catalog?.ready.then(map => {
    if (notes && !notes.value) notes.value = `Please let me know when ${map.get(ask)?.name || 'this plan'} is available.`;
  }).catch(() => {});
}
