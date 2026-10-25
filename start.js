// Owner testing: add ?checkout=test to the Start page URL to use Stripe test mode (no real charges).
const TEST_CHECKOUT = new URLSearchParams(location.search).get('checkout') === 'test';
if (TEST_CHECKOUT) document.addEventListener('DOMContentLoaded', () => {
  const note = document.createElement('div');
  note.textContent = 'TEST MODE — Stripe test checkout. Use card 4242 4242 4242 4242. No real charge.';
  note.setAttribute('role', 'status');
  note.style.cssText = 'position:sticky;top:0;z-index:1000;background:#ffd84d;color:#071f2c;font-weight:700;text-align:center;padding:10px 16px;';
  document.body.prepend(note);
});
// Paid services use one selection per project. Custom work goes straight to inquiry.
const cart = {};
const itemsEl = document.getElementById('cartItems');
const totalEl = document.getElementById('cartTotal');
const continueBtn = document.getElementById('continueBtn');
const clearBtn = document.getElementById('clearBtn');
const intakeStep = document.getElementById('intakeStep');
const checkoutBtn = document.getElementById('checkoutBtn');
const backBtn = document.getElementById('backBtn');
const statusEl = document.getElementById('status');
const menuPagesEl = document.getElementById('menuPages');
const serviceChoicesEl = document.getElementById('optionalServices');
const leadNameEl = document.getElementById('lead_name');
const leadBusinessEl = document.getElementById('lead_business');
const leadEmailEl = document.getElementById('lead_email');
const leadPhoneEl = document.getElementById('lead_phone');
const leadNotesEl = document.getElementById('lead_notes');
const scopeConfirmEl = document.getElementById('scopeConfirm');
const MENU_SKU = 'online_menu_qr';
const money = cents => '$' + (cents / 100).toFixed(2);
const briefIds = ['conversionUrl', 'conversionGoal', 'googleMode', 'googleUrl', 'accessibilityUrl', 'accessibilityPriority'];
const quoteTemplates = {
  website: 'I’d like a quote for Website Design & Custom Builds: a new website or redesign for my business.',
  app: 'I’d like to discuss a mobile app, its requirements, and a quote for my business.'
};
let checkoutInFlight = false;
let uploadedDocumentRequest = null;
let lockedFieldValues = null;
let automaticQuoteTemplate = '';
let previousInquiryService = '';

function inquiryBusy() {
  return document.getElementById('bookingForm').getAttribute('aria-busy') === 'true';
}
function flowBusy() { return checkoutInFlight || inquiryBusy(); }
function showStatus(message) { statusEl.textContent = message; statusEl.classList.add('show'); }
function clearStatus() { statusEl.textContent = ''; statusEl.classList.remove('show'); }
function setFieldState(input, errorEl, valid, message) {
  input.classList.toggle('invalid', !valid);
  input.setAttribute('aria-invalid', String(!valid));
  if (errorEl) { errorEl.textContent = message; errorEl.classList.toggle('show', !valid); }
}
function clearFieldState(input, errorEl) { setFieldState(input, errorEl, true, ''); }
function validateEmailField() {
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmailEl.value.trim());
  setFieldState(leadEmailEl, document.getElementById('lead_email_error'), valid, 'Enter a valid email address.');
  return valid;
}
function validatePhoneField() {
  const value = leadPhoneEl.value.trim();
  const valid = !value || /^[0-9+\-\s().]{7,}$/.test(value);
  setFieldState(leadPhoneEl, document.getElementById('lead_phone_error'), valid, 'Enter a valid phone number.');
  return valid;
}
function clearAutomaticQuoteInquiry() {
  const notes = document.getElementById('bookingNotes');
  const service = document.getElementById('inquiryService');
  if (automaticQuoteTemplate && notes.value === automaticQuoteTemplate) {
    notes.value = '';
    if (service.value === 'website' || service.value === 'app') service.value = previousInquiryService;
  }
  automaticQuoteTemplate = '';
}
function openQuoteInquiry(kind, moveToInquiry = true) {
  if (flowBusy() || !Object.hasOwn(quoteTemplates, kind)) return;
  const intent = new CustomEvent('menumade:quote-intent', { detail: { service: kind }, cancelable: true });
  if (!document.getElementById('bookingForm').dispatchEvent(intent)) return;
  Object.keys(cart).forEach(key => delete cart[key]);
  const service = document.getElementById('inquiryService');
  const notes = document.getElementById('bookingNotes');
  if (!notes.value || notes.value === automaticQuoteTemplate) {
    if (!automaticQuoteTemplate) previousInquiryService = service.value;
    automaticQuoteTemplate = quoteTemplates[kind];
    notes.value = automaticQuoteTemplate;
  }
  service.value = kind;
  serviceChoicesEl.open = false;
  clearStatus();
  renderCart(false);
  window.MenuMadeFunnel?.track('quote_started', kind);
  if (moveToInquiry) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('inquiry').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    document.getElementById('bookingName').focus({ preventScroll: true });
  }
}
function menuQuote() {
  const raw = menuPagesEl.value.trim(), pages = Number(raw);
  if (!raw || !Number.isInteger(pages) || pages < 1 || pages > 50) return null;
  const extraPages = Math.max(0, pages - 3);
  return { pages, extraPages, extrasCents: extraPages * 2000, totalCents: 14400 + extraPages * 2000 };
}
function updateBriefVisibility() {
  const groups = {
    conversion_fix: { panel: 'conversionBrief', fields: ['conversionUrl', 'conversionGoal'], required: ['conversionUrl', 'conversionGoal'] },
    google_visibility: { panel: 'googleBrief', fields: ['googleMode', 'googleUrl'], required: ['googleMode'] },
    accessibility_upgrade: { panel: 'accessibilityBrief', fields: ['accessibilityUrl', 'accessibilityPriority'], required: ['accessibilityUrl'] }
  };
  for (const [sku, group] of Object.entries(groups)) {
    const active = Boolean(cart[sku]);
    document.getElementById(group.panel).hidden = !active;
    for (const id of group.fields) {
      const field = document.getElementById(id);
      field.disabled = !active || checkoutInFlight;
      field.required = active && group.required.includes(id);
    }
  }
  const showGoogleUrl = Boolean(cart.google_visibility) && document.getElementById('googleMode').value === 'existing';
  document.getElementById('googleUrlField').hidden = !showGoogleUrl;
  document.getElementById('googleUrl').disabled = !showGoogleUrl || checkoutInFlight;
}
function updateSelectionButtons() {
  document.querySelectorAll('.js-add').forEach(button => {
    const selected = Boolean(cart[button.closest('.service-card').dataset.sku]);
    button.disabled = selected || checkoutInFlight;
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = selected ? 'Selected' : (button.dataset.selectLabel || 'Select service');
  });
}
function renderCart(openEmptyChoices = true) {
  itemsEl.innerHTML = '';
  const hasItems = Object.keys(cart).length > 0;
  const hasMenu = Boolean(cart[MENU_SKU]), quote = hasMenu ? menuQuote() : null;
  document.getElementById('menuConfig').hidden = !hasMenu;
  menuPagesEl.disabled = !hasMenu || checkoutInFlight;
  menuPagesEl.required = hasMenu;
  const validPages = !hasMenu || Boolean(quote);
  setFieldState(menuPagesEl, document.getElementById('menuPagesError'), validPages, 'Enter a whole number from 1 to 50.');
  document.getElementById('extraPagesLabel').textContent = quote ? `Additional pages · ${quote.extraPages}` : 'Additional pages';
  document.getElementById('extraPagesAmount').textContent = quote ? money(quote.extrasCents) : '—';
  let total = 0;
  for (const item of Object.values(cart)) {
    const li = document.createElement('li');
    li.className = 'cart-item';
    li.innerHTML = `<div><strong>${item.name}</strong><small>${item.key === MENU_SKU ? 'Includes first-year hosting' : item.priceLabel}</small></div><button class="btn secondary remove-item" type="button" data-remove="${item.key}" aria-label="Remove ${item.name}">Remove</button>`;
    itemsEl.appendChild(li);
    total += item.key === MENU_SKU ? (quote?.totalCents || 0) : item.price;
  }
  totalEl.textContent = validPages ? money(total) : 'Enter page count';
  document.getElementById('orderTotalRow').hidden = !hasItems;
  document.getElementById('emptyOrder').hidden = hasItems;
  document.getElementById('orderActions').hidden = !hasItems;
  document.getElementById('billingDetails').hidden = !hasItems;
  document.getElementById('orderSecurity').hidden = !hasItems;
  continueBtn.disabled = !hasItems || !validPages || checkoutInFlight;
  checkoutBtn.disabled = !hasItems || !validPages || checkoutInFlight;
  clearBtn.disabled = !hasItems || checkoutInFlight;
  if (!hasItems) {
    if (openEmptyChoices) serviceChoicesEl.open = true;
    intakeStep.classList.remove('show');
    continueBtn.style.display = 'inline-block';
  }
  updateBriefVisibility();
  updateSelectionButtons();
}
function addItem(card) {
  if (flowBusy()) return false;
  const key = card.dataset.sku;
  if (cart[key]) return false;
  clearAutomaticQuoteInquiry();
  cart[key] = { key, name: card.dataset.name, price: Number(card.dataset.price), priceLabel: card.dataset.priceLabel, qty: 1 };
  window.MenuMadeFunnel?.track('service_selected', key);
  clearStatus(); renderCart(); return true;
}
function beginService(sku, moveToDetails = true) {
  if (flowBusy()) return;
  const card = document.querySelector(`.service-card[data-sku="${sku}"]`);
  if (!card) return;
  if (!cart[sku]) addItem(card);
  intakeStep.classList.add('show'); continueBtn.style.display = 'none';
  window.MenuMadeFunnel?.track('details_opened', sku);
  if (moveToDetails) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.querySelector('.cart').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    leadNameEl.focus({ preventScroll: true });
  }
}
function lockCheckoutControls(locked) {
  const fields = [menuPagesEl, ...briefIds.map(id => document.getElementById(id))];
  lockedFieldValues = locked ? new Map(fields.map(field => [field, field.value])) : null;
  document.querySelectorAll('[data-quote-service], .js-add, #cartItems button, #clearBtn, #continueBtn, #backBtn, #menuPages, #intakeStep input, #intakeStep textarea, #intakeStep select').forEach(control => { control.disabled = locked; });
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
    const field = document.getElementById(id);
    setFieldState(field, document.getElementById(id + 'Error'), false, message);
    showStatus(message); field.focus(); return null;
  }
  if (cart[MENU_SKU]) {
    const quote = menuQuote();
    lines.push(`Menu: ${quote.pages} pages; 2 revisions; first-year hosting; ${money(quote.totalCents)}.`);
  }
  if (cart.conversion_fix) {
    const url = publicUrl(document.getElementById('conversionUrl').value);
    if (!url) return fail('conversionUrl', 'Enter the public website address for the Conversion Fix. Do not include login details.');
    const goal = document.getElementById('conversionGoal').value.trim();
    if (goal.length < 3 || goal.length > 80) return fail('conversionGoal', 'Describe the main customer action in 3–80 characters, such as calls or reservations.');
    lines.push(`Website fix: ${url}\nGoal: ${goal}`);
  }
  if (cart.google_visibility) {
    const mode = document.getElementById('googleMode').value;
    if (!['existing', 'new'].includes(mode)) return fail('googleMode', 'Choose whether you need a new Google Business Profile or help with an existing one.');
    const raw = document.getElementById('googleUrl').value.trim();
    const url = mode === 'existing' && raw ? publicUrl(raw) : '';
    if (mode === 'existing' && raw && !url) return fail('googleUrl', 'Enter a public Google profile link, or leave it blank if you do not have it.');
    lines.push(`Google: ${mode === 'new' ? 'new profile' : 'existing profile'}${url ? '; ' + url : ''}`);
  }
  if (cart.accessibility_upgrade) {
    const url = publicUrl(document.getElementById('accessibilityUrl').value);
    if (!url) return fail('accessibilityUrl', 'Enter the public website address for the Accessibility Upgrade. Do not include login details.');
    const priority = document.getElementById('accessibilityPriority').value.trim();
    if (priority.length > 80) return fail('accessibilityPriority', 'Keep the accessibility priority within 80 characters.');
    lines.push(`Accessibility: ${url}${priority ? '\nPriority: ' + priority : ''}`);
  }
  const brief = lines.join('\n');
  if (brief.length > 420) return fail('lead_notes', 'The combined service brief is too long for checkout. Shorten the links or priorities, or send an inquiry with the full scope.');
  return brief;
}
function composeNotes(brief, notes, limit, documentReference = '') {
  const prefix = [brief, documentReference ? 'Document ref: ' + documentReference : ''].filter(Boolean).join('\n');
  const remaining = Math.max(0, limit - prefix.length - (prefix && notes ? 1 : 0));
  return prefix + (prefix && notes ? '\n' : '') + notes.slice(0, remaining);
}

document.querySelectorAll('.js-add').forEach(button => button.addEventListener('click', () => {
  const card = button.closest('.service-card'); if (addItem(card)) beginService(card.dataset.sku);
}));
document.querySelectorAll('[data-quote-service]').forEach(button => button.addEventListener('click', event => {
  event.preventDefault(); openQuoteInquiry(button.dataset.quoteService);
}));
itemsEl.addEventListener('click', event => {
  if (flowBusy()) return;
  const remove = event.target.dataset.remove;
  if (!remove || !cart[remove]) return;
  delete cart[remove]; clearStatus(); renderCart();
});
[menuPagesEl, ...briefIds.map(id => document.getElementById(id))].forEach(field => {
  field.addEventListener(field.id === 'googleMode' ? 'change' : 'input', () => {
    if (checkoutInFlight) { if (lockedFieldValues?.has(field)) field.value = lockedFieldValues.get(field); return; }
    clearStatus(); clearFieldState(field, document.getElementById(field.id + 'Error'));
    if (field === menuPagesEl) renderCart(); else updateBriefVisibility();
  });
});
clearBtn.addEventListener('click', () => { if (flowBusy()) return; Object.keys(cart).forEach(key => delete cart[key]); clearStatus(); renderCart(); });
continueBtn.addEventListener('click', () => { if (flowBusy() || !Object.keys(cart).length) return; intakeStep.classList.add('show'); continueBtn.style.display = 'none'; window.MenuMadeFunnel?.track('details_opened'); });
backBtn.addEventListener('click', () => { if (flowBusy()) return; intakeStep.classList.remove('show'); continueBtn.style.display = 'inline-block'; });
for (const [field, errorId, validate] of [[leadEmailEl, 'lead_email_error', validateEmailField], [leadPhoneEl, 'lead_phone_error', validatePhoneField]]) {
  field.addEventListener('input', () => { clearStatus(); if (field.value.trim()) validate(); else clearFieldState(field, document.getElementById(errorId)); });
  field.addEventListener('blur', () => { if (field.value.trim()) validate(); });
}
checkoutBtn.addEventListener('click', async () => {
  if (flowBusy()) return;
  const items = Object.values(cart).map(item => ({ key: item.key, qty: 1 }));
  if (!items.length) { showStatus('Choose a service before continuing to checkout.'); serviceChoicesEl.open = true; return; }
  const quote = cart[MENU_SKU] ? menuQuote() : null;
  if (cart[MENU_SKU] && !quote) { showStatus('Enter a whole number from 1 to 50 for your menu pages.'); menuPagesEl.focus(); return; }
  const name = leadNameEl.value.trim(), business = leadBusinessEl.value.trim(), email = leadEmailEl.value.trim(), phone = leadPhoneEl.value.trim(), notes = leadNotesEl.value.trim();
  if (!name) { showStatus('Please enter your name.'); leadNameEl.focus(); return; }
  if (!business) { showStatus('Please enter your business name.'); leadBusinessEl.focus(); return; }
  if (!validateEmailField()) { leadEmailEl.focus(); return; }
  if (!validatePhoneField()) { leadPhoneEl.focus(); return; }
  const brief = collectBrief(); if (brief === null) return;
  if (!scopeConfirmEl.checked) { showStatus('Please confirm standard scope before checkout.'); scopeConfirmEl.focus(); return; }
  const customer = { name, business, email, phone, notes: composeNotes(brief, notes, 500) };
  const file = document.getElementById('lead_document').files[0];
  const controller = new AbortController(); let timeout;
  clearStatus(); checkoutInFlight = true; checkoutBtn.disabled = true; lockCheckoutControls(true);
  checkoutBtn.textContent = file ? 'Preparing document…' : 'Opening secure checkout…';
  try {
    window.MenuMadeDocuments.validate(file);
    const fingerprint = await window.MenuMadeDocuments.fingerprint(file);
    timeout = setTimeout(() => controller.abort(), 60000);
    if (file) {
      const documentNotes = composeNotes(brief, 'Services: ' + Object.values(cart).map(item => item.name).join(', ') + '\n' + notes, 1200);
      const payload = { type: 'inquiry', purpose: 'checkout', service: 'Other project', name, business, email, notes: documentNotes, website: '' };
      const key = JSON.stringify(payload) + fingerprint;
      if (!uploadedDocumentRequest || uploadedDocumentRequest.key !== key) uploadedDocumentRequest = { key, payload: { ...payload, requestId: crypto.randomUUID() }, received: false };
      if (!uploadedDocumentRequest.received) { await window.MenuMadeDocuments.send(uploadedDocumentRequest.payload, file, controller.signal); uploadedDocumentRequest.received = true; }
      customer.notes = composeNotes(brief, notes, 500, uploadedDocumentRequest.payload.requestId);
      document.getElementById('lead_document_status').textContent = 'Document received. Reference: ' + uploadedDocumentRequest.payload.requestId;
    }
    checkoutBtn.textContent = 'Opening secure checkout…'; window.MenuMadeFunnel?.track('checkout_attempt');
    const response = await fetch(TEST_CHECKOUT ? '/api/create-checkout-test' : '/api/create-checkout', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, ...(quote ? { menu_pages: quote.pages } : {}), tracking: window.MenuMadeFunnel?.tracking(), customer }) });
    const result = await response.json();
    if (!response.ok) { window.MenuMadeFunnel?.track('checkout_error'); showStatus(result?.error?.message || result?.error || 'Checkout error. Please refresh and try again.'); return; }
    if (result.url) { window.location.href = result.url; return; }
    showStatus('Checkout error. Please refresh and try again.');
  } catch (error) {
    window.MenuMadeFunnel?.track('checkout_error');
    showStatus(error.name === 'AbortError' ? 'The connection timed out. Please try again; the same document request will not be duplicated.' : error.message || 'Checkout error. Please refresh and try again.');
  } finally {
    clearTimeout(timeout); checkoutInFlight = false; lockCheckoutControls(false); checkoutBtn.textContent = 'Proceed to secure checkout'; renderCart();
  }
});
document.querySelectorAll('[data-start-menu]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); beginService(MENU_SKU); }));
document.querySelectorAll('[data-choose-services]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault(); serviceChoicesEl.open = true;
  const summary = document.getElementById('serviceChoicesSummary');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  summary.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }); summary.focus({ preventScroll: true });
}));
renderCart(false);
const requestedService = new URLSearchParams(location.search).get('service')?.toLowerCase();
const serviceSkus = { menu: MENU_SKU, online_menu_qr: MENU_SKU, 'online-menu-qr': MENU_SKU, conversion: 'conversion_fix', google: 'google_visibility', accessibility: 'accessibility_upgrade' };
if (Object.hasOwn(serviceSkus, requestedService)) { beginService(serviceSkus[requestedService]); serviceChoicesEl.open = false; }
else if (Object.hasOwn(quoteTemplates, requestedService)) openQuoteInquiry(requestedService);
if (location.hash === '#optionalServices') serviceChoicesEl.open = true;
