// start.js — Stripe Payment Link checkout (no Netlify functions)

(() => {

const PAYMENT_LINKS = {

  conversion: "https://buy.stripe.com/bJeaEXgRldkk7yQ7Sx9IQ0c",
  visibility: "https://buy.stripe.com/00wfZh58D4NOdXe8WB9IQ0b",
  accessibility: "https://buy.stripe.com/bJebJ144zfss6uM1u99IQ0a",
  menu: "https://buy.stripe.com/4gMaEX6cH8002ewb4J9IQ09"

};

const cartItemsEl = document.getElementById("cartItems");
const cartTotalEl = document.getElementById("cartTotal");
const continueBtn = document.getElementById("continueBtn");
const clearBtn = document.getElementById("clearBtn");
const checkoutBtn = document.getElementById("checkoutBtn");
const intakeStep = document.getElementById("intakeStep");

const leadName = document.getElementById("lead_name");
const leadBusiness = document.getElementById("lead_business");
const leadEmail = document.getElementById("lead_email");
const scopeConfirm = document.getElementById("scopeConfirm");

let cart = [];

function formatUSD(cents){

  return (cents / 100).toLocaleString(undefined,{
    style:"currency",
    currency:"USD"
  });

}

function renderCart(){

  cartItemsEl.innerHTML = "";

  if(cart.length === 0){

    const li = document.createElement("li");
    li.innerHTML = "<span style='color:#888'>Cart is empty</span>";
    cartItemsEl.appendChild(li);

    cartTotalEl.textContent = "$0";

    if(continueBtn) continueBtn.disabled = true;

    return;

  }

  let total = 0;

  cart.forEach(item => {

    total += item.price;

    const li = document.createElement("li");
    li.className = "cart-item";

    li.innerHTML = `
      <strong>${item.name}</strong>
      <small>${formatUSD(item.price)}</small>
    `;

    cartItemsEl.appendChild(li);

  });

  cartTotalEl.textContent = formatUSD(total);

  if(continueBtn) continueBtn.disabled = false;

}

function addToCart(service,name,price){

  cart = [{ service,name,price }];

  renderCart();

}

document.querySelectorAll(".js-add").forEach(btn => {

  btn.addEventListener("click", () => {

    const card = btn.closest(".service-card");

    const service = card.dataset.sku;
    const name = card.dataset.name;
    const price = Number(card.dataset.price);

    addToCart(service,name,price);

  });

});

clearBtn?.addEventListener("click", () => {

  cart = [];

  renderCart();

});

continueBtn?.addEventListener("click", () => {

  if(cart.length === 0) return;

  intakeStep?.classList.add("show");

});

checkoutBtn?.addEventListener("click", () => {

  if(cart.length === 0) return;

  const name = leadName?.value.trim();
  const business = leadBusiness?.value.trim();
  const email = leadEmail?.value.trim();

  if(!name || !business || !email){

    alert("Please complete Name, Business name, and Email.");

    return;

  }

  if(!scopeConfirm?.checked){

    alert("Please confirm the scope agreement.");

    return;

  }

  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "Redirecting…";

  const service = cart[0].service;

  const link = PAYMENT_LINKS[service];

  if(!link){

    alert("Checkout configuration error.");
    return;

  }

  window.location.href = link;

});

renderCart();

})();