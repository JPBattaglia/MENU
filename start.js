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
const phonePattern = /^[0-9+\-\s().]{7,}$/;
const MENU_SKU = 'online_menu_qr';
const money = cents => '$' + (cents / 100).toFixed(2);

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

function renderCart() {
  itemsEl.innerHTML = "";
  let total = 0;
  const hasMenu = Boolean(cart[MENU_SKU]);
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
        <strong>${item.name}</strong>
        <small>${item.key === MENU_SKU ? '1 menu package · includes first-year hosting' : item.priceLabel}</small>
      </div>

      <div class="qty">
        ${item.key === MENU_SKU
          ? '<button class="remove-item" type="button" data-remove="online_menu_qr" aria-label="Remove Online Menu + QR from your order">Remove</button>'
          : `<button type="button" data-dec="${item.key}" aria-label="Remove one ${item.name}">−</button>
        <span aria-label="Quantity">${item.qty}</span>
        <button type="button" data-inc="${item.key}" aria-label="Add one ${item.name}">+</button>`}
      </div>
    `;

    itemsEl.appendChild(li);
    total += item.key === MENU_SKU ? (quote?.totalCents || 0) : item.price * item.qty;
  });

  totalEl.textContent = validPages ? money(total) : 'Enter page count';

  const hasItems = Object.keys(cart).length > 0;
  emptyOrderEl.hidden = hasItems;
  document.getElementById('orderActions').hidden = !hasItems;
  document.getElementById('billingDetails').hidden = !hasItems;
  continueBtn.disabled = !hasItems || !validPages;
  checkoutBtn.disabled = !hasItems || !validPages || checkoutInFlight;
  clearBtn.disabled = !hasItems;
  if (!hasItems) {
    serviceChoicesEl.open = true;
    intakeStep.classList.remove("show");
    continueBtn.style.display = "inline-block";
  }
}

function addItem(card) {
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

itemsEl.addEventListener("click", e => {
  const inc = e.target.dataset.inc;
  const dec = e.target.dataset.dec;
  const remove = e.target.dataset.remove;

  if (remove && cart[remove]) delete cart[remove];

  if (inc && cart[inc] && inc !== MENU_SKU) {
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
  clearStatus();
  renderCart();
});

clearBtn.addEventListener("click", () => {
  Object.keys(cart).forEach(k => delete cart[k]);
  clearStatus();
  renderCart();
});

continueBtn.addEventListener("click", () => {
  intakeStep.classList.add("show");
  window.MenuMadeFunnel?.track("details_opened");
  continueBtn.style.display = "none";
  clearStatus();
});

backBtn.addEventListener("click", () => {
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
  const items = Object.values(cart).map(i => ({
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
    checkoutBtn.textContent = 'Proceed to secure checkout';
    renderCart();
  }
});

renderCart();
// Carry the chosen service into checkout without adding duplicate quantities.
function beginService(sku, moveToDetails = true) {
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
if (requestedService === 'app' || requestedService === 'website') {
  const service = document.getElementById('inquiryService');
  if (service) service.value = 'Other project';
  const notes = document.getElementById('bookingNotes');
  if (notes && !notes.value) notes.value = requestedService === 'website'
    ? 'I’d like to discuss a new website or redesign for my business.'
    : 'I’d like to discuss a mobile app and its requirements for my business.';
  document.getElementById('inquiry')?.scrollIntoView();
}
