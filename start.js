/* start.js — FULL FILE (Menu-Made Cart + Intake + Stripe Checkout redirect)
   - Sends ALL cart items to your Cloudflare Worker endpoint
   - Uses service "key" = data-sku (menu, conversion, google, accessibility)
   - Calls ABSOLUTE API URL so local testing on 127.0.0.1 works (no /api on localhost)
*/

(() => {
  "use strict";

  // ====== CONFIG (DO NOT CHANGE UNLESS YOU MEAN IT) ======
  const API_URL = "https://menu-made.com/api/create-checkout-session";
  const CART_STORAGE_KEY = "mm_cart_v1";

  // ====== DOM ======
  const cartItemsEl = document.getElementById("cartItems");
  const cartTotalEl = document.getElementById("cartTotal");
  const continueBtn = document.getElementById("continueBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");
  const intakeStepEl = document.getElementById("intakeStep");

  const checkoutBtn = document.getElementById("checkoutBtn");
  const backBtn = document.getElementById("backBtn");

  const leadNameEl = document.getElementById("lead_name");
  const leadBusinessEl = document.getElementById("lead_business");
  const leadEmailEl = document.getElementById("lead_email");
  const leadPhoneEl = document.getElementById("lead_phone");
  const leadNotesEl = document.getElementById("lead_notes");
  const scopeConfirmEl = document.getElementById("scopeConfirm");

  // Service cards (buttons)
  const addBtns = Array.from(document.querySelectorAll(".js-add"));

  // ====== STATE ======
  // cart item shape:
  // { key, name, priceCents, priceLabel, priceId, qty }
  let cart = loadCart();

  // ====== HELPERS ======
  function moneyFromCents(cents) {
    const n = Number(cents || 0);
    return "$" + (n / 100).toFixed(2).replace(/\.00$/, "");
  }

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("show", !!msg);
    // Keep styling minimal (no CSS changes). Rely on existing colors.
    if (isError) statusEl.style.color = "rgba(255,150,150,.95)";
    else statusEl.style.color = "";
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // ignore
    }
  }

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? sanitizeCart(parsed) : [];
    } catch {
      return [];
    }
  }

  function sanitizeCart(items) {
    const out = [];
    for (const it of items) {
      const key = String(it?.key || "");
      if (!key) continue;
      const qty = Math.max(1, Math.floor(Number(it?.qty || 1)));
      out.push({
        key,
        name: String(it?.name || ""),
        priceCents: Math.max(0, Math.floor(Number(it?.priceCents || 0))),
        priceLabel: String(it?.priceLabel || ""),
        priceId: String(it?.priceId || ""),
        qty,
      });
    }
    // de-dupe by key
    const map = new Map();
    for (const it of out) {
      if (map.has(it.key)) map.get(it.key).qty += it.qty;
      else map.set(it.key, { ...it });
    }
    return Array.from(map.values());
  }

  function cartTotalCents() {
    return cart.reduce((sum, it) => sum + (Number(it.priceCents || 0) * Number(it.qty || 1)), 0);
  }

  function enableCartButtons() {
    const has = cart.length > 0;
    if (continueBtn) continueBtn.disabled = !has;
    if (clearBtn) clearBtn.disabled = !has;
  }

  function showIntake(show) {
    if (!intakeStepEl) return;
    intakeStepEl.classList.toggle("show", !!show);
  }

  function clearIntakeErrors() {
    // No CSS edits; just clear status
    setStatus("");
  }

  function requiredValue(el) {
    return String(el?.value || "").trim();
  }

  function getLeadPayload() {
    const name = requiredValue(leadNameEl);
    const business = requiredValue(leadBusinessEl);
    const email = requiredValue(leadEmailEl);
    const phone = requiredValue(leadPhoneEl);
    const notes = requiredValue(leadNotesEl);
    const scopeOk = !!scopeConfirmEl?.checked;

    return { name, business, email, phone, notes, scopeOk };
  }

  function validateLead() {
    const { name, business, email, scopeOk } = getLeadPayload();
    if (!name) return { ok: false, msg: "Name is required." };
    if (!business) return { ok: false, msg: "Business name is required." };
    if (!email) return { ok: false, msg: "Email is required." };
    if (!scopeOk) return { ok: false, msg: "Please confirm standard scope." };
    return { ok: true };
  }

  // IMPORTANT: Worker expects items with { key, qty }
  function buildWorkerItemsPayload() {
    return cart.map((it) => ({
      key: String(it.key || ""),           // REQUIRED for Worker PRICE_MAP
      qty: Math.max(1, Math.floor(Number(it.qty || 1))),
      // keep extras harmless (Worker will ignore if not used)
      priceId: String(it.priceId || ""),
      name: String(it.name || "")
    }));
  }

  // ====== RENDER ======
  function renderCart() {
    if (!cartItemsEl || !cartTotalEl) return;

    cartItemsEl.innerHTML = "";

    if (cart.length === 0) {
      cartItemsEl.innerHTML = "";
      cartTotalEl.textContent = "$0";
      enableCartButtons();
      showIntake(false);
      return;
    }

    for (const it of cart) {
      const li = document.createElement("li");
      li.className = "cart-item";

      const left = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = it.name || it.key;
      const sub = document.createElement("small");
      sub.textContent = it.priceLabel ? it.priceLabel : moneyFromCents(it.priceCents);
      left.appendChild(title);
      left.appendChild(sub);

      const right = document.createElement("div");
      right.className = "qty";

      const minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "–";
      minus.addEventListener("click", () => {
        updateQty(it.key, (it.qty || 1) - 1);
      });

      const qty = document.createElement("span");
      qty.textContent = String(it.qty || 1);

      const plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.addEventListener("click", () => {
        updateQty(it.key, (it.qty || 1) + 1);
      });

      right.appendChild(minus);
      right.appendChild(qty);
      right.appendChild(plus);

      li.appendChild(left);
      li.appendChild(right);
      cartItemsEl.appendChild(li);
    }

    const total = cartTotalCents();
    cartTotalEl.textContent = moneyFromCents(total);

    enableCartButtons();
  }

  function updateQty(key, newQty) {
    const k = String(key || "");
    if (!k) return;

    const qty = Math.floor(Number(newQty || 0));
    if (qty <= 0) {
      cart = cart.filter((it) => it.key !== k);
    } else {
      cart = cart.map((it) => (it.key === k ? { ...it, qty } : it));
    }

    saveCart();
    renderCart();
  }

  function addToCartFromCard(cardEl) {
    const card = cardEl;
    const key = String(card?.getAttribute("data-sku") || "").trim(); // menu / conversion / google / accessibility
    const name = String(card?.getAttribute("data-name") || "").trim();
    const priceCents = Math.floor(Number(card?.getAttribute("data-price") || 0));
    const priceLabel = String(card?.getAttribute("data-price-label") || "").trim();
    const priceId = String(card?.getAttribute("data-price-id") || "").trim(); // fine to keep

    if (!key) return;

    const existing = cart.find((it) => it.key === key);
    if (existing) {
      existing.qty = Math.min(99, (existing.qty || 1) + 1);
      cart = cart.map((it) => (it.key === key ? { ...existing } : it));
    } else {
      cart.push({
        key,
        name,
        priceCents: Number.isFinite(priceCents) ? priceCents : 0,
        priceLabel,
        priceId,
        qty: 1,
      });
    }

    cart = sanitizeCart(cart);
    saveCart();
    renderCart();
    setStatus("");
  }

  // ====== CHECKOUT FLOW ======
  async function createCheckoutSessionAndRedirect() {
    clearIntakeErrors();

    if (cart.length === 0) {
      setStatus("Cart is empty.", true);
      return;
    }

    const leadCheck = validateLead();
    if (!leadCheck.ok) {
      setStatus(leadCheck.msg, true);
      return;
    }

    // UI state
    if (checkoutBtn) checkoutBtn.disabled = true;
    if (backBtn) backBtn.disabled = true;
    setStatus("Redirecting...");

    const { name, business, email, phone, notes } = getLeadPayload();

    const body = {
      items: buildWorkerItemsPayload(), // IMPORTANT: sends ALL items
      lead: { name, business, email, phone, notes }
    };

    let res;
    let data;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (checkoutBtn) checkoutBtn.disabled = false;
      if (backBtn) backBtn.disabled = false;
      setStatus("Checkout connection error.", true);
      return;
    }

    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok || !data || !data.url) {
      if (checkoutBtn) checkoutBtn.disabled = false;
      if (backBtn) backBtn.disabled = false;

      const msg =
        (data && (data.error || data.message)) ||
        "Checkout error. Please try again.";
      setStatus(String(msg), true);
      return;
    }

    // Redirect to Stripe Checkout
    window.location.href = data.url;
  }

  // ====== EVENTS ======
  // Add buttons
  addBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const card = e.currentTarget?.closest(".service-card");
      if (!card) return;
      addToCartFromCard(card);
    });
  });

  // Continue / Clear
  if (continueBtn) {
    continueBtn.addEventListener("click", () => {
      if (cart.length === 0) return;
      showIntake(true);
      setStatus("");
      // Scroll intake into view on smaller screens
      intakeStepEl?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      cart = [];
      saveCart();
      renderCart();
      setStatus("");
    });
  }

  // Back from intake
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      showIntake(false);
      setStatus("");
      if (checkoutBtn) checkoutBtn.disabled = false;
      if (backBtn) backBtn.disabled = false;
    });
  }

  // Checkout
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      createCheckoutSessionAndRedirect();
    });
  }

  // ====== INIT ======
  renderCart();
  enableCartButtons();
  showIntake(false);
})();