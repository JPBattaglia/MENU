// Free Online Menu + QR preview (Nov 4, 2026). Uploads the menu the same way checkout does (stored, no emails), then
// asks the worker to build the preview. booking-api/src/marketing/public-preview.js holds the limits.
(() => {
  'use strict';
  const form = document.getElementById('tryForm');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const status = $('tryStatus');
  const button = $('tryBtn');
  const API = window.MenuMadeCatalog?.API || '';
  let busy = false;
  let upload = null; // { key, requestId } so a retry doesn't upload the same file twice

  // Rep mode (owner, Nov 5, 2026): /online-menu?rep=<signed link from the owner's email>. For showing a business its
  // own phone menu during a visit: their email is optional (blank = the link goes to the Menu-made inbox) and the
  // public limits don't apply. The link is kept on this device so a home-screen shortcut keeps working.
  const params = new URLSearchParams(location.search);
  let rep = params.get('rep') || '';
  try { if (rep) localStorage.setItem('mm-rep', rep); else rep = localStorage.getItem('mm-rep') || ''; } catch { /* storage off */ }
  if (rep) {
    form.classList.add('is-rep');
    const label = form.querySelector('label[for="try_email"]');
    if (label) label.textContent = 'Their email (optional, we send them the link)';
    $('try_email').required = false;
    const fine = form.querySelector('.mm-try-fine');
    if (fine) fine.textContent = 'Rep mode: no limits for you. Take a photo of their menu or upload the PDF.';
    const intro = document.createElement('p');
    intro.className = 'mm-try-rep';
    intro.textContent = 'Rep mode is on for this device.';
    form.prepend(intro);
  }

  const say = (html, isError = false) => { status.innerHTML = html; status.classList.toggle('is-error', isError); };
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const business = $('try_business').value.trim();
    const email = $('try_email').value.trim() || (rep ? 'info@menu-made.com' : '');
    const file = $('try_file').files[0];
    if (!business) { say('Add your business name.', true); $('try_business').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Add an email address we can send the link to.', true); $('try_email').focus(); return; }
    if (!file) { say('Choose your menu file (a PDF or a photo).', true); $('try_file').focus(); return; }
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) { say('Previews work from a PDF or a photo (PNG, JPEG or WebP).', true); return; }
    busy = true; button.disabled = true; button.textContent = 'Sending your menu…';
    say('');
    try {
      window.MenuMadeDocuments.validate(file);
      const key = [business, email.toLowerCase(), await window.MenuMadeDocuments.fingerprint(file)].join('|');
      if (!upload || upload.key !== key) {
        const requestId = crypto.randomUUID();
        await window.MenuMadeDocuments.send({ type: 'inquiry', purpose: 'checkout', service: 'Other project', name: business, business, email,
          notes: 'Free menu preview', website: $('try_website').value, requestId }, file);
        upload = { key, requestId };
      }
      button.textContent = 'Reading your menu…';
      say('Reading your menu. This takes about a minute; keep this page open.');
      window.MenuMadeFunnel?.track?.('menu_preview_start');
      const response = await fetch(API + '/api/menu-preview/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: upload.requestId, email, business, tracking: window.MenuMadeFunnel?.tracking?.() || {}, ...(rep ? { rep } : {}) })
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.ok && result.url) {
        window.MenuMadeFunnel?.track?.('menu_preview_ready');
        if (rep) say(`Ready in ${esc(result.seconds ?? '?')} seconds. <a class="btn primary" href="${esc(result.url)}" target="_blank" rel="noopener">Show their menu<span class="mm-sr"> (opens in a new tab)</span></a> ${result.start ? `<a class="btn ghost" href="${esc(result.start)}">Start their order</a>` : ''} The link is emailed too.`);
        else if (result.reused) say(`You already have a preview of this menu. <a class="btn primary" href="${esc(result.url)}" target="_blank" rel="noopener">Open my menu<span class="mm-sr"> (opens in a new tab)</span></a>`);
        else say(`Your preview is ready. <a class="btn primary" href="${esc(result.url)}" target="_blank" rel="noopener">Open my menu<span class="mm-sr"> (opens in a new tab)</span></a> We’ve emailed you the link too.`);
        return;
      }
      if (result?.used && result.start) {
        say(`${esc(result.error)} <a class="btn ghost" href="${esc(result.start)}">Start my order</a>`, true);
        return;
      }
      if (response.status === 410 || response.status === 404) upload = null;
      say(esc(result?.error || 'Something went wrong making your preview. Please try again.'), true);
    } catch (error) {
      say(esc(error?.message || 'Something went wrong. Please try again.'), true);
    } finally {
      busy = false; button.disabled = false; button.textContent = 'Generate menu';
    }
  });
})();
