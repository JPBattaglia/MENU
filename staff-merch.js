// Staff merch page (stage 10): pick Nino Battaglia shirt designs, colours, sizes and quantities, optionally add your
// logo, get Printful's delivery price, then pay with Stripe. Designs come from the Nino shop's public catalog (edge
// cached); every price is re-checked and quoted by menu-made.com (/api/merch/quote) before payment, so nothing shown
// here is trusted at checkout. Owner testing: ?checkout=test uses Stripe test mode and makes only a Printful draft.
(() => {
  const NINO_API = 'https://nino-printful-commerce-api.ijpbattaglia.workers.dev';
  const API = location.hostname.endsWith('menu-made.com') ? '' : 'https://menu-made.com';
  const TEST = new URLSearchParams(location.search).get('checkout') === 'test';
  const $ = (id) => document.getElementById(id);
  const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const state = { products: [], cart: new Map(), product: null, color: null, logoId: null, quote: null };

  if (TEST) {
    const note = document.createElement('div');
    note.className = 'test-mode-banner'; note.setAttribute('role', 'status');
    note.textContent = 'TEST MODE: Stripe test checkout (card 4242 4242 4242 4242). Printful gets a draft only; nothing is printed.';
    document.body.prepend(note);
  }

  const status = (msg, id = 'merchStatus') => { const el = $(id); el.textContent = msg || ''; el.hidden = !msg; };
  const totalShirts = () => [...state.cart.values()].reduce((n, l) => n + l.quantity, 0);
  const discount = (n) => (n >= 24 ? 15 : n >= 12 ? 10 : 0);

  async function loadDesigns() {
    try {
      const res = await fetch(NINO_API + '/api/products', { headers: { Accept: 'application/json' } });
      const data = await res.json();
      state.products = (data.products || []).filter((p) => p.variants?.some((v) => v.available));
      renderDesigns();
    } catch {
      $('designGrid').innerHTML = '<p>The designs could not be loaded. Please refresh the page in a minute.</p>';
    }
  }

  function renderDesigns() {
    const q = $('designSearch').value.trim().toLowerCase();
    const list = state.products.filter((p) => !q || p.title.toLowerCase().includes(q));
    $('designCount').textContent = `${list.length} design${list.length === 1 ? '' : 's'}`;
    $('designGrid').innerHTML = list.slice(0, 60).map((p) => `<button type="button" class="merch-design" data-id="${esc(p.id)}" aria-pressed="${state.product?.id === p.id}">
      <img loading="lazy" src="${esc(p.image || p.variants[0]?.image || '')}" alt="" width="240" height="240"><span>${esc(p.title)}</span></button>`).join('') + (list.length > 60 ? '<p class="merch-more">Search to find more designs.</p>' : '');
  }

  function pickDesign(id) {
    state.product = state.products.find((p) => String(p.id) === String(id)) || null;
    state.color = null;
    renderDesigns();
    renderPicker();
    $('pickerStep').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPicker() {
    const p = state.product;
    if (!p) { $('pickerStep').hidden = true; return; }
    $('pickerStep').hidden = false;
    const colors = [...new Map(p.variants.filter((v) => v.available).map((v) => [v.color, v])).values()];
    if (!state.color || !colors.some((v) => v.color === state.color)) state.color = colors[0]?.color || null;
    const current = p.variants.find((v) => v.color === state.color && v.image);
    $('pickerTitle').textContent = p.title;
    $('pickerImage').src = current?.image || p.image || '';
    $('pickerImage').alt = `${p.title} in ${state.color || ''}`;
    $('colorList').innerHTML = colors.map((v) => `<button type="button" class="merch-swatch" data-color="${esc(v.color)}" aria-pressed="${v.color === state.color}" title="${esc(v.color)}"><span style="background:${esc(v.color_hex || '#ccc')}"></span>${esc(v.color)}</button>`).join('');
    const sizes = p.variants.filter((v) => v.available && v.color === state.color);
    $('sizeList').innerHTML = sizes.map((v) => {
      const inCart = state.cart.get(String(v.id))?.quantity || 0;
      return `<label class="merch-size"><span>${esc(v.size)} <small>${money(v.price.amount)}</small></span><input type="number" min="0" max="100" step="1" inputmode="numeric" value="${inCart || ''}" placeholder="0" data-variant="${esc(v.id)}" aria-label="Quantity, size ${esc(v.size)}"></label>`;
    }).join('');
  }

  function setQuantity(variantId, quantity) {
    const p = state.product;
    const v = p.variants.find((x) => String(x.id) === String(variantId));
    if (!v) return;
    const q = Math.max(0, Math.min(100, Math.floor(Number(quantity) || 0)));
    if (q === 0) state.cart.delete(String(v.id));
    else state.cart.set(String(v.id), { product_id: String(p.id), variant_id: String(v.id), quantity: q, title: p.title, color: v.color, size: v.size, price: v.price.amount });
    state.quote = null;
    renderCart();
  }

  function renderCart() {
    const lines = [...state.cart.values()];
    const n = totalShirts();
    const logo = $('wantLogo').checked;
    const pct = discount(n);
    $('cartLines').innerHTML = lines.length ? lines.map((l) => `<li><span>${esc(l.title)} · ${esc(l.color)} · ${esc(l.size)} × ${l.quantity}</span><button type="button" class="link-btn" data-remove="${esc(l.variant_id)}" aria-label="Remove">Remove</button></li>`).join('') : '<li class="muted">No shirts yet.</li>';
    const subtotal = lines.reduce((s, l) => s + Math.round((l.price + (logo ? 500 : 0)) * (100 - pct) / 100) * l.quantity, 0);
    $('cartSummary').textContent = n ? `${n} shirt${n === 1 ? '' : 's'}${pct ? `, ${pct}% team discount` : n < 12 ? ` (add ${12 - n} more for 10% off)` : ''} · about ${money(subtotal)} before delivery` : '';
    $('detailsStep').hidden = n === 0;
    $('quoteBox').hidden = true;
  }

  async function uploadLogo(file) {
    status('');
    if (!file) { state.logoId = null; return; }
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 5e6) { status('The logo must be a PNG or JPG under 5 MB.', 'detailsStatus'); return; }
    const form = new FormData(); form.append('logo', file);
    const res = await fetch(API + '/api/merch/logo', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) { status(data.error || 'The logo could not be uploaded.', 'detailsStatus'); return; }
    state.logoId = data.logo_id;
    $('logoPreview').src = URL.createObjectURL(file); $('logoPreview').hidden = false;
  }

  const field = (id) => $(id).value.trim();

  async function getQuote(event) {
    event.preventDefault();
    status('', 'detailsStatus');
    if ($('wantLogo').checked && !state.logoId) { status('Upload your logo, or untick "Add our logo".', 'detailsStatus'); return; }
    const recipient = { name: field('shipName'), address1: field('shipAddress1'), address2: field('shipAddress2'), city: field('shipCity'), state_code: field('shipState').toUpperCase(), zip: field('shipZip'), country_code: field('shipCountry').toUpperCase() || 'US' };
    $('quoteBtn').disabled = true; $('quoteBtn').textContent = 'Checking…';
    try {
      const res = await fetch(API + '/api/merch/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: TEST ? 'sandbox' : 'live', logo_id: $('wantLogo').checked ? state.logoId : null, recipient, items: [...state.cart.values()].map(({ product_id, variant_id, quantity }) => ({ product_id, variant_id, quantity })) }) });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { status(data.error || 'We could not price that order. Check the address and try again.', 'detailsStatus'); return; }
      state.quote = data;
      renderQuote();
    } finally { $('quoteBtn').disabled = false; $('quoteBtn').textContent = 'Get delivery price'; }
  }

  function renderQuote() {
    const q = state.quote; const p = q.pricing;
    $('quoteLines').innerHTML = q.lines.map((l) => `<tr><td>${esc(l.title)}<br><small>${esc(l.color)} · ${esc(l.size)}</small></td><td>${l.quantity}</td><td>${money(l.unit_cents)}</td><td>${money(l.line_cents)}</td></tr>`).join('');
    $('quoteRates').innerHTML = q.rates.map((r, i) => `<label class="merch-rate"><input type="radio" name="rate" value="${esc(r.id)}" ${i === 0 ? 'checked' : ''}> ${esc(r.name)} · ${money(r.amount_cents)}${r.min_days ? ` <small>(${r.min_days}-${r.max_days} days)</small>` : ''}</label>`).join('');
    const update = () => {
      const rate = q.rates.find((r) => r.id === document.querySelector('input[name="rate"]:checked')?.value) || q.rates[0];
      $('quoteTotal').innerHTML = `Shirts ${money(p.subtotal_cents)}${p.discount_percent ? ` <small>(${p.discount_percent}% team discount, you save ${money(p.discount_cents)})</small>` : ''} + delivery ${money(rate.amount_cents)} = <strong>${money(p.subtotal_cents + rate.amount_cents)}</strong>`;
    };
    $('quoteRates').onchange = update; update();
    $('quoteBox').hidden = false;
    $('quoteBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function checkout() {
    status('', 'quoteStatus');
    const customer = { name: field('buyerName'), email: field('buyerEmail'), business: field('buyerBusiness'), phone: field('buyerPhone') };
    if (!customer.business || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) { status('Enter your business name and a valid email.', 'quoteStatus'); return; }
    $('payBtn').disabled = true; $('payBtn').textContent = 'Opening secure checkout…';
    const res = await fetch(API + '/api/merch/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quote_id: state.quote.quote_id, rate_id: document.querySelector('input[name="rate"]:checked')?.value, customer }) });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.url) { location.href = data.url; return; }
    $('payBtn').disabled = false; $('payBtn').textContent = 'Pay securely';
    status(data.error || 'Checkout could not open. Please try again.', 'quoteStatus');
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadDesigns();
    $('designSearch').addEventListener('input', renderDesigns);
    $('designGrid').addEventListener('click', (e) => { const b = e.target.closest('.merch-design'); if (b) pickDesign(b.dataset.id); });
    $('colorList').addEventListener('click', (e) => { const b = e.target.closest('.merch-swatch'); if (b) { state.color = b.dataset.color; renderPicker(); } });
    $('sizeList').addEventListener('change', (e) => { if (e.target.dataset.variant) setQuantity(e.target.dataset.variant, e.target.value); });
    $('cartLines').addEventListener('click', (e) => { const id = e.target.dataset.remove; if (id) { state.cart.delete(id); renderCart(); if (state.product) renderPicker(); } });
    $('wantLogo').addEventListener('change', () => { $('logoField').hidden = !$('wantLogo').checked; renderCart(); });
    $('logoFile').addEventListener('change', (e) => uploadLogo(e.target.files[0]));
    $('detailsForm').addEventListener('submit', getQuote);
    $('payBtn').addEventListener('click', checkout);
    renderCart();
  });
})();
