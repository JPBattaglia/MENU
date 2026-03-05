// start.js — MULTI-SERVICE CART VERSION (Stripe Payment Links)

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

let cart = new Map();

function formatUSD(cents){
  return (cents/100).toLocaleString(undefined,{
    style:"currency",
    currency:"USD"
  });
}

function computeTotal(){
  let total = 0;
  cart.forEach(item=>{
    total += item.price * item.qty;
  });
  return total;
}

function renderCart(){

  cartItemsEl.innerHTML = "";

  if(cart.size === 0){

    const li = document.createElement("li");
    li.innerHTML = "<span style='color:#888'>Cart is empty</span>";
    cartItemsEl.appendChild(li);

    cartTotalEl.textContent = "$0";

    if(continueBtn) continueBtn.disabled = true;

    return;
  }

  cart.forEach(item=>{

    const li = document.createElement("li");
    li.className = "cart-item";

    const left = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = item.name;

    const price = document.createElement("small");
    price.textContent = formatUSD(item.price);

    left.appendChild(title);
    left.appendChild(price);

    const right = document.createElement("div");
    right.className = "qty";

    const minus = document.createElement("button");
    minus.textContent = "−";

    minus.onclick = ()=>{
      if(item.qty === 1){
        cart.delete(item.sku);
      }else{
        item.qty--;
        cart.set(item.sku,item);
      }
      renderCart();
    };

    const qty = document.createElement("span");
    qty.textContent = item.qty;

    const plus = document.createElement("button");
    plus.textContent = "+";

    plus.onclick = ()=>{
      item.qty++;
      cart.set(item.sku,item);
      renderCart();
    };

    right.appendChild(minus);
    right.appendChild(qty);
    right.appendChild(plus);

    li.appendChild(left);
    li.appendChild(right);

    cartItemsEl.appendChild(li);

  });

  cartTotalEl.textContent = formatUSD(computeTotal());

  if(continueBtn) continueBtn.disabled = false;

}

function addToCart(sku,name,price){

  const existing = cart.get(sku);

  if(existing){

    existing.qty++;

    cart.set(sku,existing);

  }else{

    cart.set(sku,{
      sku,
      name,
      price,
      qty:1
    });

  }

  renderCart();
}

document.querySelectorAll(".js-add").forEach(btn=>{

  btn.addEventListener("click",()=>{

    const card = btn.closest(".service-card");

    const sku = card.dataset.sku;
    const name = card.dataset.name;
    const price = Number(card.dataset.price);

    addToCart(sku,name,price);

  });

});

clearBtn?.addEventListener("click",()=>{

  cart.clear();

  renderCart();

});

continueBtn?.addEventListener("click",()=>{

  if(cart.size === 0) return;

  intakeStep?.classList.add("show");

});

checkoutBtn?.addEventListener("click",()=>{

  if(cart.size === 0) return;

  const name = leadName?.value.trim();
  const business = leadBusiness?.value.trim();
  const email = leadEmail?.value.trim();

  if(!name || !business || !email){

    alert("Please complete Name, Business name, and Email.");
    return;
  }

  if(!scopeConfirm?.checked){

    alert("Please confirm scope agreement.");
    return;
  }

  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "Redirecting…";

  const firstService = [...cart.values()][0].sku;

  const link = PAYMENT_LINKS[firstService];

  if(!link){

    alert("Checkout configuration error.");
    checkoutBtn.disabled = false;
    return;
  }

  window.location.href = link;

});

renderCart();

})();
