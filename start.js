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

const leadNameEl = document.getElementById("lead_name");
const leadBusinessEl = document.getElementById("lead_business");
const leadEmailEl = document.getElementById("lead_email");
const leadPhoneEl = document.getElementById("lead_phone");
const leadNotesEl = document.getElementById("lead_notes");
const scopeConfirmEl = document.getElementById("scopeConfirm");

const emailErrorEl = document.getElementById("lead_email_error");
const phoneErrorEl = document.getElementById("lead_phone_error");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[0-9+\-\s().]{7,}$/;

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

  Object.values(cart).forEach(item => {
    const li = document.createElement("li");
    li.className = "cart-item";

    li.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <small>${item.priceLabel}</small>
      </div>

      <div class="qty">
        <button type="button" data-dec="${item.key}">−</button>
        <span>${item.qty}</span>
        <button type="button" data-inc="${item.key}">+</button>
      </div>
    `;

    itemsEl.appendChild(li);
    total += item.price * item.qty;
  });

  totalEl.textContent = "$" + (total / 100).toFixed(2);

  const hasItems = total > 0;
  continueBtn.disabled = !hasItems;
  clearBtn.disabled = !hasItems;
}

function addItem(card) {
  const key = card.dataset.sku;
  const name = card.dataset.name;
  const price = Number(card.dataset.price);
  const priceLabel = card.dataset.priceLabel;

  if (!cart[key]) {
    cart[key] = { key, name, price, priceLabel, qty: 0 };
  }

  cart[key].qty++;
  clearStatus();
  renderCart();
}

document.querySelectorAll(".js-add").forEach(btn => {
  btn.addEventListener("click", () => {
    const card = btn.closest(".service-card");
    addItem(card);
  });
});

itemsEl.addEventListener("click", e => {
  const inc = e.target.dataset.inc;
  const dec = e.target.dataset.dec;

  if (inc && cart[inc]) {
    cart[inc].qty++;
  }

  if (dec && cart[dec]) {
    cart[dec].qty--;
    if (cart[dec].qty <= 0) delete cart[dec];
  }

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
  const items = Object.values(cart).map(i => ({
    key: i.key,
    qty: i.qty
  }));

  if (!items.length) {
    showStatus("Add at least one service before checkout.");
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
    notes
  };

  try {
    const res = await fetch("/api/create-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items,
        customer
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showStatus(data?.error?.message || data?.error || "Checkout error. Please refresh and try again.");
      return;
    }

    if (data.url) {
      window.location.href = data.url;
      return;
    }

    showStatus("Checkout error. Please refresh and try again.");
  } catch (err) {
    showStatus("Checkout error. Please refresh and try again.");
  }
});

renderCart();