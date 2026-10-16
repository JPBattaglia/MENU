// start.js — FULL FILE

const cart = {};
const itemsEl = document.getElementById("cartItems");
const totalEl = document.getElementById("cartTotal");
const continueBtn = document.getElementById("continueBtn");
const clearBtn = document.getElementById("clearBtn");
const intakeStep = document.getElementById("intakeStep");
const checkoutBtn = document.getElementById("checkoutBtn");
const backBtn = document.getElementById("backBtn");
const statusEl = document.getElementById("status");
const menuPagesEl = document.getElementById('menuPages');
const menuPagesErrorEl = document.getElementById('menuPagesError');
const menuConfigEl = document.getElementById('menuConfig');
const extraPagesLabelEl = document.getElementById('extraPagesLabel');
const extraPagesAmountEl = document.getElementById('extraPagesAmount');
const serviceChoicesEl = document.getElementById('optionalServices');
const emptyOrderEl = document.getElementById('emptyOrder');
const websiteQuotePanelEl = document.getElementById('websiteQuotePanel');

const leadNameEl = document.getElementById("lead_name");
const leadBusinessEl = document.getElementById("lead_business");
const leadEmailEl = document.getElementById("lead_email");
const leadPhoneEl = document.getElementById("lead_phone");
const leadNotesEl = document.getElementById("lead_notes");
const scopeConfirmEl = document.getElementById("scopeConfirm");

const emailErrorEl = document.getElementById("lead_email_error");
const phoneErrorEl = document.getElementById("lead_phone_error");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let checkoutInFlight = false;
let uploadedDocumentRequest = null;
let checkoutLockedMenuPages = null;
let automaticWebsiteInquiry = false;
let websiteInquiryPreviousService = '';
const phonePattern = /^[0-9+\-\s().]{7,}$/;
const MENU_SKU = 'online_menu_qr';
const WEBSITE_QUOTE_KEY = 'website_design_custom';
const WEBSITE_NAME = 'Website Design & Custom Builds';
const WEBSITE_INQUIRY_TEMPLATE = 'I’d like a quote for Website Design & Custom Builds: a new website or redesign for my business.';
const money = cents => '$' + (cents / 100).toFixed(2);

function prepareWebsiteInquiry() {
  const service = document.getElementById('inquiryService');
  const notes = document.getElementById('bookingNotes');
  if (!notes.value) {
    websiteInquiryPreviousService = service.value;
    notes.value = WEBSITE_INQUIRY_TEMPLATE;
    automaticWebsiteInquiry = true;
  }
  service.value = 'Other project';
}

function clearAutomaticWebsiteInquiry() {
  const notes = document.getElementById('bookingNotes');
  const service = document.getElementById('inquiryService');
  if (automaticWebsiteInquiry && notes.value === WEBSITE_INQUIRY_TEMPLATE) {
    notes.value = '';
    if (service.value === 'Other project') service.value = websiteInquiryPreviousService;
  }
  automaticWebsiteInquiry = false;
}

function lockCheckoutControls(locked) {
  document.querySelectorAll('[data-select-website], .js-add, #cartItems button, #clearBtn, #continueBtn, #backBtn, #menuPages, #intakeStep input, #intakeStep textarea').forEach(control => {
    control.disabled = locked;
  });
  if (locked) checkoutLockedMenuPages = menuPagesEl.value;
  else checkoutLockedMenuPages = null;
}

function selectWebsiteQuote(moveToOrder = false) {
  if (checkoutInFlight) return;
  Object.keys(cart).forEach(key => delete cart[key]);
  cart[WEBSITE_QUOTE_KEY] = { key: WEBSITE_QUOTE_KEY, name: WEBSITE_NAME, qty: 1, quoteRequired: true, priceLabel: 'To be quoted' };
  prepareWebsiteInquiry();
  clearStatus();
  renderCart();
  if (moveToOrder) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.querySelector('.cart').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    document.getElementById('requestWebsiteQuote').focus({ preventScroll: true });
  }
}

function menuQuote() {
  const raw = menuPagesEl.value.trim();
  const pages = Number(raw);
  if (!raw || !Number.isInteger(pages) || pages < 1 || pages > 50) return null;
  const extraPages = Math.max(0, pages - 3);
  return { pages, extraPages, extrasCents: extraPages * 2000, totalCents: 14400 + extraPages * 2000 };
}

function showStatus(message) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.add("show");
}

function clearStatus() {
  if (!statusEl) return;
  statusEl.textContent = "";
  statusEl.classList.remove("show");
}

function setFieldState(input, errorEl, isValid, message) {
  if (!input) return;
  input.classList.toggle("invalid", !isValid);
  input.setAttribute("aria-invalid", String(!isValid));

  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.toggle("show", !isValid);
  }
}

function clearFieldState(input, errorEl) {
  if (!input) return;
  input.classList.remove("invalid");
  input.setAttribute("aria-invalid", "false");
  if (errorEl) errorEl.classList.remove("show");
}

function validateEmailField() {
  const value = leadEmailEl.value.trim();
  const valid = emailPattern.test(value);
  setFieldState(leadEmailEl, emailErrorEl, valid, "Enter a valid email address.");
  return valid;
}

function validatePhoneField() {
  const value = leadPhoneEl.value.trim();
  const valid = value === "" || phonePattern.test(value);
  setFieldState(leadPhoneEl, phoneErrorEl, valid, "Enter a valid phone number.");
  return valid;
}

function renderCart(openEmptyChoices = true) {
  itemsEl.innerHTML = "";
  let total = 0;
  const hasMenu = Boolean(cart[MENU_SKU]);
  const hasWebsiteQuote = Boolean(cart[WEBSITE_QUOTE_KEY]);
  const quote = hasMenu ? menuQuote() : null;
  menuConfigEl.hidden = !hasMenu;
  menuPagesEl.disabled = !hasMenu;
  menuPagesEl.required = hasMenu;
  const validPages = !hasMenu || Boolean(quote);
  setFieldState(menuPagesEl, menuPagesErrorEl, validPages, 'Enter a whole number from 1 to 50.');
  extraPagesLabelEl.textContent = quote ? `Additional pages · ${quote.extraPages}` : 'Additional pages';
  extraPagesAmountEl.textContent = quote ? money(quote.extrasCents) : '—';

  Object.values(cart).forEach(item => {
    const li = document.createElement("li");
    li.className = "cart-item";

    li.innerHTML = `
      <div>
        <strong>${item.quoteRequired ? 'Website Design &amp; Custom Builds' : item.name}</strong>
        <small>${item.key === MENU_SKU ? '1 menu package · includes first-year hosting' : item.priceLabel}</small>
      </div>

      <div class="qty">
        ${item.key === MENU_SKU || item.quoteRequired
          ? `<button class="remove-item" type="button" data-remove="${item.key}" aria-label="Remove ${item.quoteRequired ? 'Website Design and Custom Builds' : 'Online Menu + QR'} from your order">Remove</button>`
          : `<button type="button" data-dec="${item.key}" aria-label="Remove one ${item.name}">−</button>
        <span aria-label="Quantity">${item.qty}</span>
        <button type="button" data-inc="${item.key}" aria-label="Add one ${item.name}">+</button>`}
      </div>
    `;

    itemsEl.appendChild(li);
    if (!item.quoteRequired) total += item.key === MENU_SKU ? (quote?.totalCents || 0) : item.price * item.qty;
  });

  totalEl.textContent = hasWebsiteQuote ? 'Quote required' : validPages ? money(total) : 'Enter page count';
  document.getElementById('orderTotalLabel').textContent = hasWebsiteQuote ? 'Project price' : 'Total due today · USD';
  websiteQuotePanelEl.hidden = !hasWebsiteQuote;

  const hasItems = Object.keys(cart).length > 0;
  emptyOrderEl.hidden = hasItems;
  document.getElementById('orderActions').hidden = !hasItems;
  document.getElementById('billingDetails').hidden = !hasItems || hasWebsiteQuote;
  document.getElementById('orderSecurity').hidden = !hasItems || hasWebsiteQuote;
  continueBtn.disabled = !hasItems || !validPages || hasWebsiteQuote;
  checkoutBtn.disabled = !hasItems || !validPages || hasWebsiteQuote || checkoutInFlight;
  clearBtn.disabled = !hasItems;
  if (!hasItems) {
    if (openEmptyChoices) serviceChoicesEl.open = true;
    intakeStep.classList.remove("show");
    continueBtn.style.display = "inline-block";
  }
  if (hasWebsiteQuote) {
    intakeStep.classList.remove('show');
    continueBtn.style.display = 'none';
  }
}

function addItem(card) {
  if (checkoutInFlight) return;
  clearAutomaticWebsiteInquiry();
  delete cart[WEBSITE_QUOTE_KEY];
  const key = card.dataset.sku;
  const name = card.dataset.name;
  const price = Number(card.dataset.price);
  const priceLabel = card.dataset.priceLabel;

  if (!cart[key]) {
    cart[key] = { key, name, price, priceLabel, qty: 0 };
  }

  cart[key].qty = key === MENU_SKU ? 1 : cart[key].qty + 1;
  window.MenuMadeFunnel?.track("service_selected", key);
  clearStatus();
  renderCart();
}

document.querySelectorAll(".js-add").forEach(btn => {
  btn.addEventListener("click", () => {
    const card = btn.closest(".service-card");
    addItem(card);
    beginService(card.dataset.sku);
  });
});

document.querySelectorAll('[data-select-website]').forEach(button => {
  button.addEventListener('click', () => selectWebsiteQuote(true));
});
document.getElementById('requestWebsiteQuote').addEventListener('click', () => {
  prepareWebsiteInquiry();
});

itemsEl.addEventListener("click", e => {
  if (checkoutInFlight) return;
  const inc = e.target.dataset.inc;
  const dec = e.target.dataset.dec;
  const remove = e.target.dataset.remove;

  if (remove && cart[remove]) delete cart[remove];

  if (inc && cart[inc] && inc !== MENU_SKU && !cart[inc].quoteRequired) {
    cart[inc].qty++;
  }

  if (dec && cart[dec]) {
    cart[dec].qty--;
    if (cart[dec].qty <= 0) delete cart[dec];
  }

  clearStatus();
  renderCart();
});

menuPagesEl.addEventListener('input', () => {
  if (checkoutInFlight) {
    menuPagesEl.value = checkoutLockedMenuPages;
    return;
  }
  clearStatus();
  renderCart();
});

clearBtn.addEventListener("click", () => {
  if (checkoutInFlight) return;
  Object.keys(cart).forEach(k => delete cart[k]);
  clearStatus();
  renderCart();
});

continueBtn.addEventListener("click", () => {
  if (checkoutInFlight) return;
  if (!Object.keys(cart).length || cart[WEBSITE_QUOTE_KEY]) return;
  intakeStep.classList.add("show");
  window.MenuMadeFunnel?.track("details_opened");
  continueBtn.style.display = "none";
  clearStatus();
});

backBtn.addEventListener("click", () => {
  if (checkoutInFlight) return;
  intakeStep.classList.remove("show");
  continueBtn.style.display = "inline-block";
  clearStatus();
});

if (leadEmailEl) {
  leadEmailEl.addEventListener("input", () => {
    clearStatus();
    if (leadEmailEl.value.trim() === "") {
      clearFieldState(leadEmailEl, emailErrorEl);
      return;
    }
    validateEmailField();
  });

  leadEmailEl.addEventListener("blur", () => {
    if (leadEmailEl.value.trim() !== "") validateEmailField();
  });
}

if (leadPhoneEl) {
  leadPhoneEl.addEventListener("input", () => {
    clearStatus();
    if (leadPhoneEl.value.trim() === "") {
      clearFieldState(leadPhoneEl, phoneErrorEl);
      return;
    }
    validatePhoneField();
  });

  leadPhoneEl.addEventListener("blur", () => {
    if (leadPhoneEl.value.trim() !== "") validatePhoneField();
  });
}

checkoutBtn.addEventListener("click", async () => {
  if (checkoutInFlight) return;
  if (cart[WEBSITE_QUOTE_KEY]) {
    prepareWebsiteInquiry();
    showStatus('Website Design & Custom Builds requires a project quote. Use Request a Website Quote to send your inquiry.');
    return;
  }
  const items = Object.values(cart).filter(item => !item.quoteRequired).map(i => ({
    key: i.key,
    qty: i.qty
  }));

  if (!items.length) {
    showStatus("Choose a service before continuing to checkout.");
    serviceChoicesEl.open = true;
    return;
  }
  const quote = cart[MENU_SKU] ? menuQuote() : null;
  if (cart[MENU_SKU] && !quote) {
    showStatus('Enter a whole number from 1 to 50 for your menu pages.');
    menuPagesEl.focus();
    return;
  }

  const name = leadNameEl.value.trim();
  const business = leadBusinessEl.value.trim();
  const email = leadEmailEl.value.trim();
  const phone = leadPhoneEl.value.trim();
  const notes = leadNotesEl.value.trim();

  if (!name) {
    showStatus("Please enter your name.");
    leadNameEl.focus();
    return;
  }

  if (!business) {
    showStatus("Please enter your business name.");
    leadBusinessEl.focus();
    return;
  }

  if (!validateEmailField()) {
    showStatus("Please enter a valid email address.");
    leadEmailEl.focus();
    return;
  }

  if (!validatePhoneField()) {
    showStatus("Please enter a valid phone number.");
    leadPhoneEl.focus();
    return;
  }

  if (!scopeConfirmEl.checked) {
    showStatus("Please confirm standard scope before checkout.");
    scopeConfirmEl.focus();
    return;
  }

  clearStatus();

  const customer = {
    name,
    business,
    email,
    phone,
    notes: notes.slice(0, 500)
  };

  const file = document.getElementById('lead_document').files[0];
  const controller = new AbortController();
  let timeout;
  checkoutInFlight = true;
  checkoutBtn.disabled = true;
  lockCheckoutControls(true);
  checkoutBtn.textContent = file ? 'Preparing document…' : 'Opening secure checkout…';
  try {
    window.MenuMadeDocuments.validate(file);
    const fingerprint = await window.MenuMadeDocuments.fingerprint(file);
    checkoutBtn.textContent = file ? 'Sending document…' : 'Opening secure checkout…';
    timeout = setTimeout(() => controller.abort(), 60000);
    if (file) {
      const payload = { type: 'inquiry', service: 'Other project', name, business, email,
        notes: ('Document for selected services: ' + Object.values(cart).map(i => i.name).join(', ') + (quote ? `\nMenu scope: ${quote.pages} pages, two revisions, first-year hosting; menu package ${money(quote.totalCents)}.` : '') + '\n' + notes).slice(0, 1200), website: '' };
      const key = JSON.stringify(payload) + fingerprint;
      if (!uploadedDocumentRequest || uploadedDocumentRequest.key !== key) {
        uploadedDocumentRequest = { key, payload: { ...payload, requestId: crypto.randomUUID() }, received: false };
      }
      if (!uploadedDocumentRequest.received) {
        await window.MenuMadeDocuments.send(uploadedDocumentRequest.payload, file, controller.signal);
        uploadedDocumentRequest.received = true;
      }
      customer.notes = ('Document inquiry reference: ' + uploadedDocumentRequest.payload.requestId + '\n' + notes).slice(0, 500);
      document.getElementById('lead_document_status').textContent = 'Document received. Reference: ' + uploadedDocumentRequest.payload.requestId;
    }
    checkoutBtn.textContent = 'Opening secure checkout…';
    window.MenuMadeFunnel?.track("checkout_attempt");
    const res = await fetch("/api/create-checkout", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items,
        ...(quote ? { menu_pages: quote.pages } : {}),
        tracking: window.MenuMadeFunnel?.tracking(),
        customer
      })
    });

    const data = await res.json();

    if (!res.ok) {
      window.MenuMadeFunnel?.track("checkout_error");
      showStatus(data?.error?.message || data?.error || "Checkout error. Please refresh and try again.");
      return;
    }

    if (data.url) {
      window.location.href = data.url;
      return;
    }

    showStatus("Checkout error. Please refresh and try again.");
  } catch (err) {
    window.MenuMadeFunnel?.track("checkout_error");
    showStatus(err.name === 'AbortError' ? 'The connection timed out. Please try again; the same document request will not be duplicated.' : err.message || 'Checkout error. Please refresh and try again.');
  } finally {
    clearTimeout(timeout);
    checkoutInFlight = false;
    lockCheckoutControls(false);
    checkoutBtn.textContent = 'Proceed to secure checkout';
    renderCart();
  }
});

renderCart(false);
// Carry the chosen service into checkout without adding duplicate quantities.
function beginService(sku, moveToDetails = true) {
  if (checkoutInFlight) return;
  const card = document.querySelector(`.service-card[data-sku="${sku}"]`);
  if (!card) return;
  if (!cart[sku]) addItem(card);
  intakeStep.classList.add('show');
  continueBtn.style.display = 'none';
  window.MenuMadeFunnel?.track('details_opened');
  if (moveToDetails) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.querySelector('.cart').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    leadNameEl.focus({ preventScroll: true });
  }
}
document.querySelectorAll('[data-start-menu]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    beginService('online_menu_qr');
  });
});
document.querySelectorAll('[data-choose-services]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    serviceChoicesEl.open = true;
    const summary = document.getElementById('serviceChoicesSummary');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    summary.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    summary.focus({ preventScroll: true });
  });
});
const requestedService = new URLSearchParams(location.search).get('service')?.toLowerCase();
const serviceSkus = { menu: MENU_SKU, online_menu_qr: MENU_SKU, 'online-menu-qr': MENU_SKU, conversion: 'conversion_fix', google: 'google_visibility', accessibility: 'accessibility_upgrade' };
if (Object.hasOwn(serviceSkus, requestedService)) {
  beginService(serviceSkus[requestedService]);
  serviceChoicesEl.open = false;
}
else if (requestedService === 'website') {
  selectWebsiteQuote(location.hash !== '#inquiry');
}
else if (requestedService !== 'app') {
  // A generic Start opens at the introduction with the menu selected; the
  // visitor opens contact details when ready to continue.
  const menuCard = document.querySelector(`.service-card[data-sku="${MENU_SKU}"]`);
  if (menuCard) addItem(menuCard);
}
if (requestedService === 'app' || (requestedService === 'website' && location.hash === '#inquiry')) {
  const service = document.getElementById('inquiryService');
  if (service) service.value = 'Other project';
  const notes = document.getElementById('bookingNotes');
  if (notes && !notes.value) notes.value = requestedService === 'website'
    ? 'I’d like to discuss a new website or redesign for my business.'
    : 'I’d like to discuss a mobile app and its requirements for my business.';
  document.getElementById('inquiry')?.scrollIntoView();
}
if (location.hash === '#optionalServices') serviceChoicesEl.open = true;
