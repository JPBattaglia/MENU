// start.js — MULTI ITEM CART + STRIPE CHECKOUT SESSION

(() => {

const cart = new Map();

const cartItemsEl = document.getElementById("cartItems");
const cartTotalEl = document.getElementById("cartTotal");

const continueBtn = document.getElementById("continueBtn");
const clearBtn = document.getElementById("clearBtn");
const checkoutBtn = document.getElementById("checkoutBtn");

const intakeStep = document.getElementById("intakeStep");

const leadName = document.getElementById("lead_name");
const leadBusiness = document.getElementById("lead_business");
const leadEmail = document.getElementById("lead_email");
const leadPhone = document.getElementById("lead_phone");
const leadNotes = document.getElementById("lead_notes");
const scopeConfirm = document.getElementById("scopeConfirm");

function formatUSD(cents){
  return (cents / 100).toLocaleString(undefined,{
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
    li.innerHTML = "<span style='opacity:.6'>Cart is empty</span>";

    cartItemsEl.appendChild(li);

    cartTotalEl.textContent = "$0";

    continueBtn.disabled = true;

    return;

  }

  cart.forEach(item=>{

    const li = document.createElement("li");
    li.className = "cart-item";

    li.innerHTML = `
    <div>
    <strong>${item.name}</strong>
    <small>${formatUSD(item.price)}</small>
    </div>

    <div class="qty">

    <button data-minus="${item.sku}">−</button>

    <span>${item.qty}</span>

    <button data-plus="${item.sku}">+</button>

    </div>
    `;

    cartItemsEl.appendChild(li);

  });

  cartTotalEl.textContent = formatUSD(computeTotal());

  continueBtn.disabled = false;

}

function addToCart(sku,name,price){

  if(cart.has(sku)){

    const item = cart.get(sku);
    item.qty++;

    cart.set(sku,item);

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

function changeQty(sku,delta){

  if(!cart.has(sku)) return;

  const item = cart.get(sku);

  item.qty += delta;

  if(item.qty <= 0){

    cart.delete(sku);

  }else{

    cart.set(sku,item);

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

cartItemsEl.addEventListener("click",(e)=>{

  const plus = e.target.dataset.plus;
  const minus = e.target.dataset.minus;

  if(plus) changeQty(plus,1);

  if(minus) changeQty(minus,-1);

});

clearBtn?.addEventListener("click",()=>{

  cart.clear();

  renderCart();

});

continueBtn?.addEventListener("click",()=>{

  if(cart.size === 0) return;

  intakeStep?.classList.add("show");

});

checkoutBtn?.addEventListener("click",async ()=>{

  if(cart.size === 0) return;

  const name = leadName.value.trim();
  const business = leadBusiness.value.trim();
  const email = leadEmail.value.trim();

  if(!name || !business || !email){

    alert("Please complete Name, Business name, and Email.");
    return;

  }

  if(!scopeConfirm.checked){

    alert("Please confirm the scope agreement.");
    return;

  }

  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "Redirecting…";

  try{

    const items = [...cart.values()].map(item=>({
      key: item.sku,
      qty: item.qty
    }));

    const response = await fetch("/api/create-checkout-session",{
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body: JSON.stringify({ items })
    });

    const data = await response.json();

    if(!data.url){
      throw new Error("Missing checkout URL");
    }

    window.location.href = data.url;

  }catch(err){

    alert("Checkout connection error.");
    checkoutBtn.disabled=false;
    checkoutBtn.textContent="Proceed to Secure Checkout";

  }

});

renderCart();

})();