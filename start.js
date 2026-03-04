// start.js — FULL FILE (Wires start.html → Stripe Checkout → checkoutsuccess.html / checkoutcancel.html)
(() => {
  const CHECKOUT_ENDPOINT = "/.netlify/functions/create-checkout-session";

  // Pre-checkout lead capture (Formspree)
  const FORMSPREE_ENDPOINT = "https://formspree.io/f/xnjqbely";

  // Local snapshots (used for repeat attempts + abandoned checkout follow-up)
  const CART_SNAPSHOT_KEY = "mm_last_checkout_cart_v2";
  const LEAD_SNAPSHOT_KEY = "mm_last_lead_v1";

  const formatUSD = (cents) => (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
  const byId = (id) => document.getElementById(id);

  // Required DOM
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

  if (!cartItemsEl || !cartTotalEl || !continueBtn || !clearBtn || !checkoutBtn || !intakeStep || !statusEl) return;

  const setStatus = (msg) => {
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("show", !!msg);
  };

  // Build products list from DOM (data attributes)
  const products = Array.from(document.querySelectorAll(".product-grid .service-card")).map((card) => ({
    sku: card.dataset.sku || "",
    name: card.dataset.name || "",
    priceCents: Number(card.dataset.price || "0"),
    priceLabel: card.dataset.priceLabel || "",
    priceId: card.dataset.priceId || ""
  }));
  const productsBySku = new Map(products.map((p) => [p.sku, p]));

  // Cart map: sku -> { sku, name, priceCents, priceLabel, priceId, qty }
  const cart = new Map();

  const updateButtons = () => {
    const hasItems = cart.size > 0;
    continueBtn.disabled = !hasItems;
    clearBtn.disabled = !hasItems;
  };

  const computeTotal = () => {
    let total = 0;
    cart.forEach((item) => { total += item.priceCents * item.qty; });
    return total;
  };

  const renderCart = () => {
    cartItemsEl.innerHTML = "";

    if (cart.size === 0) {
      const empty = document.createElement("li");
      empty.className = "cart-item";
      empty.innerHTML = "<span style='color:var(--muted)'>Cart is empty</span>";
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
      sub.textContent = item.priceLabel ? item.priceLabel : formatUSD(item.priceCents);

      left.appendChild(title);
      left.appendChild(sub);

      const right = document.createElement("div");
      right.className = "qty";

      const minus = document.createElement("button");
      minus.type = "button";
      minus.setAttribute("aria-label", "Decrease quantity");
      minus.textContent = "−";
      minus.addEventListener("click", () => {
        if (item.qty <= 1) cart.delete(item.sku);
        else {
          item.qty -= 1;
          cart.set(item.sku, item);
        }
        if (cart.size === 0) intakeStep.classList.remove("show");
        renderCart();
      });

      const qty = document.createElement("span");
      qty.textContent = String(item.qty);

      const plus = document.createElement("button");
      plus.type = "button";
      plus.setAttribute("aria-label", "Increase quantity");
      plus.textContent = "+";
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
    setStatus("");
    renderCart();
  };

  // Wire Add buttons
  document.querySelectorAll(".js-add").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".service-card");
      if (!card) return;
      addToCart(card.dataset.sku);
    });
  });

  // Clear
  clearBtn.addEventListener("click", () => {
    cart.clear();
    setStatus("");
    intakeStep.classList.remove("show");
    renderCart();
  });

  // Snapshot helpers
  const snapshotCart = () => {
    const snap = {
      v: 2,
      created_at: new Date().toISOString(),
      items: Array.from(cart.values()).map((i) => ({
        sku: i.sku,
        name: i.name,
        qty: i.qty,
        priceCents: i.priceCents,
        priceLabel: i.priceLabel,
        priceId: i.priceId
      })),
      totalCents: computeTotal()
    };
    try { localStorage.setItem(CART_SNAPSHOT_KEY, JSON.stringify(snap)); } catch (e) {}
    return snap;
  };

  const snapshotLead = () => {
    const snap = {
      v: 1,
      created_at: new Date().toISOString(),
      name: (leadName && leadName.value ? leadName.value : "").trim(),
      business: (leadBusiness && leadBusiness.value ? leadBusiness.value : "").trim(),
      email: (leadEmail && leadEmail.value ? leadEmail.value : "").trim(),
      phone: (leadPhone && leadPhone.value ? leadPhone.value : "").trim(),
      notes: (leadNotes && leadNotes.value ? leadNotes.value : "").trim()
    };
    try { localStorage.setItem(LEAD_SNAPSHOT_KEY, JSON.stringify(snap)); } catch (e) {}
    return snap;
  };

  const validatePriceIds = () => {
    const missing = [];
    cart.forEach((item) => {
      if (!item.priceId || item.priceId.indexOf("PRICE_ID_") === 0) missing.push(item.name);
    });
    if (missing.length) {
      setStatus("Missing Stripe Price IDs for: " + missing.join(", "));
      return false;
    }
    return true;
  };

  // Continue / Back
  continueBtn.addEventListener("click", () => {
    if (cart.size === 0) return;
    setStatus("");
    intakeStep.classList.add("show");
    if (leadName) setTimeout(() => leadName.focus(), 50);
  });

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      intakeStep.classList.remove("show");
      setStatus("");
    });
  }

  // Lead to Formspree (best-effort)
  const postLeadToFormspree = async (leadSnap, cartSnap) => {
    const fd = new FormData();
    fd.append("source", "Start Page (pre-checkout)");
    fd.append("name", leadSnap.name);
    fd.append("business_name", leadSnap.business);
    fd.append("email", leadSnap.email);
    fd.append("phone", leadSnap.phone);
    fd.append("notes", leadSnap.notes);
    fd.append("cart_items", JSON.stringify(cartSnap.items));
    fd.append("cart_total", formatUSD(cartSnap.totalCents));

    const res = await fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      body: fd,
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) throw new Error("Lead capture failed");
  };

  // Checkout
  checkoutBtn.addEventListener("click", async () => {
    setStatus("");

    if (cart.size === 0) {
      setStatus("Cart is empty.");
      return;
    }
    if (!validatePriceIds()) return;

    const name = (leadName && leadName.value ? leadName.value : "").trim();
    const business = (leadBusiness && leadBusiness.value ? leadBusiness.value : "").trim();
    const email = (leadEmail && leadEmail.value ? leadEmail.value : "").trim();
    const phone = (leadPhone && leadPhone.value ? leadPhone.value : "").trim();
    const notes = (leadNotes && leadNotes.value ? leadNotes.value : "").trim();
    const scopeOk = !!(scopeConfirm && scopeConfirm.checked);

    if (!name || !business || !email) {
      setStatus("Please complete Name, Business name, and Email.");
      return;
    }
    if (!scopeOk) {
      setStatus("Please confirm standard scope to proceed.");
      return;
    }

    const cartSnap = snapshotCart();
    const leadSnap = snapshotLead();

    // Capture lead first (so you can recover interrupted checkouts)
    setStatus("Saving details…");
    try {
      await postLeadToFormspree(leadSnap, cartSnap);
    } catch (e) {
      // Proceed anyway (lead is still in localStorage)
      setStatus("Details saved locally. Proceeding to checkout…");
    }

    const lineItems = Array.from(cart.values()).map((item) => ({
      priceId: item.priceId,
      quantity: item.qty
    }));

    setStatus("Creating secure checkout…");
    checkoutBtn.disabled = true;

    try {
      const res = await fetch(CHECKOUT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lineItems,
          successUrl: window.location.origin + "/checkoutsuccess.html",
          cancelUrl: window.location.origin + "/checkoutcancel.html",
          customerEmail: email,
          lead: { name, business, email, phone, notes }
        })
      });

      if (!res.ok) throw new Error(await res.text() || "Checkout request failed");

      const data = await res.json();
      if (!data || !data.url) throw new Error("No checkout URL returned");

      window.location.href = data.url;
    } catch (err) {
      setStatus("Checkout error: " + (err && err.message ? err.message : "Unknown error"));
      checkoutBtn.disabled = false;
    }
  });

  // Pre-add from ?service=
  (function init() {
    const params = new URLSearchParams(window.location.search);
    const service = (params.get("service") || "").toLowerCase().trim();
    const map = { menu: "menu", conversion: "conversion", google: "google", accessibility: "accessibility" };

    if (map[service]) {
      addToCart(map[service]);
      const target = document.getElementById("checkout");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    renderCart();

    // Prefill from prior lead snapshot (speeds second attempt)
    try {
      const prev = JSON.parse(localStorage.getItem(LEAD_SNAPSHOT_KEY) || "null");
      if (prev && prev.email) {
        if (leadName) leadName.value = prev.name || "";
        if (leadBusiness) leadBusiness.value = prev.business || "";
        if (leadEmail) leadEmail.value = prev.email || "";
        if (leadPhone) leadPhone.value = prev.phone || "";
        if (leadNotes) leadNotes.value = prev.notes || "";
      }
    } catch (e) {}
  })();
})();