// start.js — Multi-item cart with Stripe Payment Links

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

  return (cents/100).toLocaleString(undefined,{
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

    cartTotalEl.textContent="$0";

    continueBtn.disabled=true;

    return;

  }

  let total=0;

  cart.forEach((item,index)=>{

    total+=item.price*item.qty;

    const li=document.createElement("li");
    li.className="cart-item";

    li.innerHTML=`
      <div>
        <strong>${item.name}</strong>
        <small>${formatUSD(item.price)}</small>
      </div>
      <div class="qty">
        <button data-index="${index}" class="minus">−</button>
        <span>${item.qty}</span>
        <button data-index="${index}" class="plus">+</button>
      </div>
    `;

    cartItemsEl.appendChild(li);

  });

  cartTotalEl.textContent=formatUSD(total);

  continueBtn.disabled=false;

}

function addToCart(service,name,price){

  const existing = cart.find(i => i.service === service);

  if(existing){

    existing.qty += 1;

  } else {

    cart.push({
      service,
      name,
      price,
      qty:1
    });

  }

  renderCart();

}

document.querySelectorAll(".js-add").forEach(btn=>{

  btn.addEventListener("click",()=>{

    const card=btn.closest(".service-card");

    const service=card.dataset.sku;
    const name=card.dataset.name;
    const price=Number(card.dataset.price);

    addToCart(service,name,price);

  });

});

cartItemsEl.addEventListener("click",(e)=>{

  const minus=e.target.classList.contains("minus");
  const plus=e.target.classList.contains("plus");

  if(!minus && !plus) return;

  const index=Number(e.target.dataset.index);

  if(plus){

    cart[index].qty++;

  }

  if(minus){

    cart[index].qty--;

    if(cart[index].qty<=0){
      cart.splice(index,1);
    }

  }

  renderCart();

});

clearBtn?.addEventListener("click",()=>{

  cart=[];

  renderCart();

});

continueBtn?.addEventListener("click",()=>{

  if(cart.length===0) return;

  intakeStep?.classList.add("show");

});

checkoutBtn?.addEventListener("click",()=>{

  if(cart.length===0) return;

  const name=leadName.value.trim();
  const business=leadBusiness.value.trim();
  const email=leadEmail.value.trim();

  if(!name||!business||!email){

    alert("Please complete Name, Business name, and Email.");

    return;

  }

  if(!scopeConfirm.checked){

    alert("Please confirm the scope agreement.");

    return;

  }

  checkoutBtn.disabled=true;
  checkoutBtn.textContent="Redirecting…";

  // If multiple services, send to first service payment link
  const firstService = cart[0].service;

  const link = PAYMENT_LINKS[firstService];

  if(!link){

    alert("Checkout configuration error.");

    checkoutBtn.disabled=false;

    return;

  }

  window.location.href=link;

});

renderCart();

})();
