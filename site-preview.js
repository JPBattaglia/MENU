// Free site generator preview (owner, Nov 5, 2026). Uploads the menu the same way checkout does (stored, no emails),
// then asks the worker to build the site. booking-api/src/marketing/website-preview.js holds the limits.
// Rep mode (a signed link from the owner's email, kept on this device by menu-preview.js) skips the limits.
(() => {
  'use strict';
  const form = document.getElementById('siteTryForm');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const status = $('siteTryStatus');
  const button = $('siteTryBtn');
  const API = window.MenuMadeCatalog?.API || '';
  let busy = false;
  let upload = null; // { key, requestId } so a retry doesn't upload the same file twice
  let rep = new URLSearchParams(location.search).get('rep') || '';
  try { if (rep) localStorage.setItem('mm-rep', rep); else rep = localStorage.getItem('mm-rep') || ''; } catch { /* storage off */ }
  if (rep) {
    const label = form.querySelector('label[for="site_email"]');
    if (label) label.textContent = 'Their email (optional, we send them the link)';
    $('site_email').required = false;
    const note = document.createElement('p');
    note.className = 'mm-try-rep';
    note.textContent = 'Rep mode is on for this device.';
    form.prepend(note);
  }

  const say = (html, isError = false) => { status.innerHTML = html; status.classList.toggle('is-error', isError); };
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const business = $('site_business').value.trim();
    const email = $('site_email').value.trim() || (rep ? 'info@menu-made.com' : '');
    const file = $('site_file').files[0];
    if (!business) { say('Add your business name.', true); $('site_business').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Add an email address we can send the link to.', true); $('site_email').focus(); return; }
    if (!file) { say('Choose your menu file (a PDF or a photo).', true); $('site_file').focus(); return; }
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) { say('Previews work from a PDF or a photo (PNG, JPEG or WebP).', true); return; }
    busy = true; button.disabled = true; button.textContent = 'Sending your menu…';
    say('');
    try {
      window.MenuMadeDocuments.validate(file);
      const key = [business, email.toLowerCase(), await window.MenuMadeDocuments.fingerprint(file)].join('|');
      if (!upload || upload.key !== key) {
        const requestId = crypto.randomUUID();
        await window.MenuMadeDocuments.send({ type: 'inquiry', purpose: 'checkout', service: 'Other project', name: business, business, email,
          notes: 'Free website preview', website: $('site_hp').value, requestId }, file);
        upload = { key, requestId };
      }
      button.textContent = 'Building your website…';
      say('Building your website from your menu. This takes about a minute; keep this page open.');
      window.MenuMadeFunnel?.track?.('website_preview_start');
      const response = await fetch(API + '/api/website-preview/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: upload.requestId, email, business, phone: $('site_phone').value, address: $('site_address').value,
          hours: $('site_hours').value, website: $('site_current').value, city: $('site_city')?.value || '', tracking: window.MenuMadeFunnel?.tracking?.() || {}, ...(rep ? { rep } : {}) })
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.ok && result.url) {
        window.MenuMadeFunnel?.track?.('website_preview_ready');
        if (rep) say(`Ready in ${esc(result.seconds ?? '?')} seconds. <a class="btn primary" href="${esc(result.url)}" target="_blank" rel="noopener">Show their website<span class="mm-sr"> (opens in a new tab)</span></a> ${result.start ? `<a class="btn ghost" href="${esc(result.start)}">Start their order</a>` : ''} The link is emailed too.`);
        else say(`Your website preview is ready. <a class="btn primary" href="${esc(result.url)}" target="_blank" rel="noopener">Open my website<span class="mm-sr"> (opens in a new tab)</span></a> We’ve emailed you the link too.`);
        return;
      }
      if (result?.used && result.start) { say(`${esc(result.error)} <a class="btn ghost" href="${esc(result.start)}">Start my order</a>`, true); return; }
      if (response.status === 410 || response.status === 404) upload = null;
      say(esc(result?.error || 'Something went wrong making your preview. Please try again.'), true);
    } catch (error) {
      say(esc(error?.message || 'Something went wrong. Please try again.'), true);
    } finally {
      busy = false; button.disabled = false; button.textContent = 'Generate my site';
    }
  });
})();
