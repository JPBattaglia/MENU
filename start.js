// start.js — FULL FILE

const cart = {};
const itemsEl = document.getElementById("cartItems");
const totalEl = document.getElementById("cartTotal");
const continueBtn = document.getElementById("continueBtn");
const clearBtn = document.getElementById("clearBtn");
const intakeStep = document.getElementById("intakeStep");
const checkoutBtn = document.getElementById("checkoutBtn");
const backBtn = document.getElementById("backBtn");

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
        <button data-dec="${item.key}">−</button>
        <span>${item.qty}</span>
        <button data-inc="${item.key}">+</button>
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

  renderCart();
});

clearBtn.addEventListener("click", () => {

  Object.keys(cart).forEach(k => delete cart[k]);
  renderCart();

});

continueBtn.addEventListener("click", () => {

  intakeStep.classList.add("show");
  continueBtn.style.display = "none";

});

backBtn.addEventListener("click", () => {

  intakeStep.classList.remove("show");
  continueBtn.style.display = "inline-block";

});

checkoutBtn.addEventListener("click", async () => {

  const items = Object.values(cart).map(i => ({
    key: i.key,
    qty: i.qty
  }));

  if (!items.length) return;

  try {

    const res = await fetch("https://menu-made.com/api/create-checkout-session", {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ items })
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("Checkout error. Please refresh and try again.");
    }

  } catch (err) {

    alert("Checkout error. Please refresh and try again.");

  }

});

renderCart();