// start.js — MULTI ITEM CART + STRIPE CHECKOUT SESSION

(() => {

const cart = new Map();

const cartItemsEl = document.getElementById("cartItems");
const cartTotalEl = document.getElementById("cartTotal");

const continueBtn = document.getElementById("continueBtn");
const clearBtn = document.getElementById("clearBtn");
const checkoutBtn = document.getElementById("checkoutBtn");
const backBtn = document.getElementById("backBtn");

const intakeStep = document.getElementById("intakeStep");
const statusEl = document.getElementById("status");

const leadName = document.getElementById("lead_name");
const leadBusiness = document.getElementById("lead_business");
const leadEmail = document.getElementById("lead_email");
const leadPhone = document.getElementById("lead_phone");
const leadNotes = document.getElementById("lead_notes");
const scopeConfirm = document.getElementById("scopeConfirm");

const CHECKOUT_API = "https://menu-made.com/api/create-checkout-session";

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

function setStatus(message = ""){
  if(!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("show", !!message);
}

function renderCart(){

  cartItemsEl.innerHTML = "";

  if(cart.size === 0){

    const li = document.createElement("li");
    li.innerHTML = "<span style='opacity:.6'>Cart is empty</span>";

    cartItemsEl.appendChild(li);

    cartTotalEl.textContent = "$0";

    if (continueBtn) continueBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    if (checkoutBtn) checkoutBtn.disabled = true;

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

<button type="button" data-minus="${item.sku}">−</button>

<span>${item.qty}</span>

<button type="button" data-plus="${item.sku}">+</button>

</div>
`;

    cartItemsEl.appendChild(li);

  });

  cartTotalEl.textContent = formatUSD(computeTotal());

  if (continueBtn) continueBtn.disabled = false;
  if (clearBtn) clearBtn.disabled = false;
  if (checkoutBtn) checkoutBtn.disabled = false;

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
    if(!card) return;

    const sku = card.dataset.sku;
    const name = card.dataset.name;
    const price = Number(card.dataset.price);

    addToCart(sku,name,price);
    setStatus("");

  });

});

cartItemsEl?.addEventListener("click",(e)=>{

  const plus = e.target.dataset.plus;
  const minus = e.target.dataset.minus;

  if(plus) changeQty(plus,1);

  if(minus) changeQty(minus,-1);

});

clearBtn?.addEventListener("click",()=>{

  cart.clear();
  setStatus("");
  renderCart();

});

continueBtn?.addEventListener("click",()=>{

  if(cart.size === 0) return;

  intakeStep?.classList.add("show");
  setStatus("");

});

backBtn?.addEventListener("click",()=>{

  intakeStep?.classList.remove("show");
  setStatus("");

});

checkoutBtn?.addEventListener("click",async ()=>{

  if(cart.size === 0) return;

  const name = leadName.value.trim();
  const business = leadBusiness.value.trim();
  const email = leadEmail.value.trim();
  const phone = leadPhone.value.trim();
  const notes = leadNotes.value.trim();

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
  setStatus("");

  try{

    const items = [...cart.values()].map(item=>({
      key: item.sku,
      qty: item.qty
    }));

    const response = await fetch(CHECKOUT_API,{
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body: JSON.stringify({
        items,
        lead: {
          name,
          business,
          email,
          phone,
          notes
        }
      })
    });

    const data = await response.json().catch(()=>({}));

    if(!response.ok || !data.url){
      throw new Error(data.error || "Checkout connection error.");
    }

    window.location.href = data.url;

  }catch(err){

    alert("Checkout connection error.");
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = "Proceed to Secure Checkout";

  }

});

renderCart();

})();