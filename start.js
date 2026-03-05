// start.js — FULL FILE (Wires start.html → Stripe Checkout → checkoutsuccess.html / checkoutcancel.html)
(() => {
  const CHECKOUT_ENDPOINT = "/.netlify/functions/create-checkout-session";

  const FORMSPREE_ENDPOINT = "https://formspree.io/f/xnjqbely";

  const CART_SNAPSHOT_KEY = "mm_last_checkout_cart_v2";
  const LEAD_SNAPSHOT_KEY = "mm_last_lead_v1";

  const formatUSD = (cents) =>
    (cents / 100).toLocaleString(undefined, {
      style: "currency",
      currency: "USD"
    });

  const byId = (id) => document.getElementById(id);

  const cartItemsEl = byId("cartItems");
  const cartTotalEl = byId("cartTotal");
  const continueBtn = byId("continueBtn");
  const clearBtn = byId("clearBtn");
  const checkoutBtn = byId("checkoutBtn");
  const backBtn = byId("backBtn");
  const intakeStep = byId("intakeStep");
  const statusEl = byId("status");

  const leadName = byId("lead_name");
  const leadBusiness = byId("lead_business");
  const leadEmail = byId("lead_email");
  const leadPhone = byId("lead_phone");
  const leadNotes = byId("lead_notes");
  const scopeConfirm = byId("scopeConfirm");

  if (!cartItemsEl || !cartTotalEl) return;

  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("show", !!msg);
  };

  const products = Array.from(
    document.querySelectorAll(".product-grid .service-card")
  ).map((card) => ({
    sku: card.dataset.sku || "",
    name: card.dataset.name || "",
    priceCents: Number(card.dataset.price || "0"),
    priceLabel: card.dataset.priceLabel || "",
    priceId: card.dataset.priceId || ""
  }));

  const productsBySku = new Map(products.map((p) => [p.sku, p]));

  const cart = new Map();

  const updateButtons = () => {
    const hasItems = cart.size > 0;
    if (continueBtn) continueBtn.disabled = !hasItems;
    if (clearBtn) clearBtn.disabled = !hasItems;
  };

  const computeTotal = () => {
    let total = 0;
    cart.forEach((item) => {
      total += item.priceCents * item.qty;
    });
    return total;
  };

  const renderCart = () => {
    cartItemsEl.innerHTML = "";

    if (cart.size === 0) {
      const empty = document.createElement("li");
      empty.className = "cart-item";
      empty.innerHTML =
        "<span style='color:var(--muted)'>Cart is empty</span>";
      cartItemsEl.appendChild(empty);
      cartTotalEl.textContent = formatUSD(0);
      updateButtons();
      return;
    }

    cart.forEach((item) => {
      const li = document.createElement("li");
      li.className = "cart-item";

      const left = document.createElement("div");

      const title = document.createElement("strong");
      title.textContent = item.name;

      const sub = document.createElement("small");
      sub.textContent = item.priceLabel
        ? item.priceLabel
        : formatUSD(item.priceCents);

      left.appendChild(title);
      left.appendChild(sub);

      const right = document.createElement("div");
      right.className = "qty";

      const minus = document.createElement("button");
      minus.textContent = "−";
      minus.type = "button";

      minus.addEventListener("click", () => {
        if (item.qty <= 1) cart.delete(item.sku);
        else {
          item.qty -= 1;
          cart.set(item.sku, item);
        }

        if (cart.size === 0 && intakeStep)
          intakeStep.classList.remove("show");

        renderCart();
      });

      const qty = document.createElement("span");
      qty.textContent = item.qty;

      const plus = document.createElement("button");
      plus.textContent = "+";
      plus.type = "button";

      plus.addEventListener("click", () => {
        item.qty += 1;
        cart.set(item.sku, item);
        renderCart();
      });

      right.appendChild(minus);
      right.appendChild(qty);
      right.appendChild(plus);

      li.appendChild(left);
      li.appendChild(right);

      cartItemsEl.appendChild(li);
    });

    cartTotalEl.textContent = formatUSD(computeTotal());

    updateButtons();
  };

  const addToCart = (sku) => {
    const product = productsBySku.get(sku);
    if (!product) return;

    const existing = cart.get(sku);

    if (existing) {
      existing.qty += 1;
      cart.set(sku, existing);
    } else {
      cart.set(sku, {
        sku,
        name: product.name,
        priceCents: product.priceCents,
        priceLabel: product.priceLabel,
        priceId: product.priceId,
        qty: 1
      });
    }

    renderCart();
  };

  document.querySelectorAll(".js-add").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".service-card");
      if (!card) return;
      addToCart(card.dataset.sku);
    });
  });

  clearBtn?.addEventListener("click", () => {
    cart.clear();
    renderCart();
    setStatus("");
  });

  const snapshotCart = () => {
    const snap = {
      items: Array.from(cart.values()),
      totalCents: computeTotal()
    };

    try {
      localStorage.setItem(CART_SNAPSHOT_KEY, JSON.stringify(snap));
    } catch {}

    return snap;
  };

  const snapshotLead = () => {
    const snap = {
      name: leadName?.value || "",
      business: leadBusiness?.value || "",
      email: leadEmail?.value || "",
      phone: leadPhone?.value || "",
      notes: leadNotes?.value || ""
    };

    try {
      localStorage.setItem(LEAD_SNAPSHOT_KEY, JSON.stringify(snap));
    } catch {}

    return snap;
  };

  continueBtn?.addEventListener("click", () => {
    if (cart.size === 0) return;
    intakeStep?.classList.add("show");
  });

  backBtn?.addEventListener("click", () => {
    intakeStep?.classList.remove("show");
  });

  checkoutBtn?.addEventListener("click", async () => {

    if (cart.size === 0) return;

    const name = leadName?.value?.trim();
    const business = leadBusiness?.value?.trim();
    const email = leadEmail?.value?.trim();

    if (!name || !business || !email) {
      setStatus("Please complete Name, Business name, and Email.");
      return;
    }

    if (!scopeConfirm?.checked) {
      setStatus("Please confirm standard scope to proceed.");
      return;
    }

    const cartSnap = snapshotCart();
    const leadSnap = snapshotLead();

    checkoutBtn.disabled = true;
    checkoutBtn.textContent = "Redirecting…";

    try {

      const res = await fetch(CHECKOUT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          items: cartSnap.items.map((i) => ({
            priceId: i.priceId,
            quantity: i.qty
          })),
          successUrl:
            window.location.origin + "/checkoutsuccess.html",
          cancelUrl:
            window.location.origin + "/checkoutcancel.html",
          customerEmail: leadSnap.email,
          lead: leadSnap
        })
      });

      if (!res.ok) throw new Error("Checkout failed");

      const data = await res.json();

      if (!data.url) throw new Error("Missing checkout URL");

      window.location.href = data.url;

    } catch (err) {

      setStatus(
        "Checkout temporarily unavailable. Please try again."
      );

      checkoutBtn.disabled = false;
      checkoutBtn.textContent = "Proceed to secure checkout";
    }
  });

  (function init() {
    const params = new URLSearchParams(window.location.search);

    const service = params.get("service");

    if (service) addToCart(service);

    renderCart();
  })();

})();