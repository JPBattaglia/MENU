// Free Online Menu + QR preview (Nov 4, 2026). Uploads the menu the same way checkout does (stored, no emails), then
// asks the worker to build the preview. booking-api/src/marketing/public-preview.js holds the limits.
// The Holiday Menu page (holiday-menu.html, Nov 10, 2026) uses the same form with a Christmas / New Year's Eve choice:
// its preview shows the holiday designs and "Make it live" goes to the Holiday Menu checkout.
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
    if (label) label.textContent = 'Email (we send you the link)';
    $('try_email').required = false;
    const fine = form.querySelector('.mm-try-fine');
    if (fine) fine.textContent = 'Rep mode: no limits for you. Take a photo of their menu or upload the PDF.';
    const intro = document.createElement('p');
    intro.className = 'mm-try-rep';
    intro.textContent = 'Rep mode is on for this device.';
    form.prepend(intro);
  }

  const say = (html, isError = false) => { status.innerHTML = html; status.classList.toggle('is-error', isError); };
  // Holiday picker: the "which menu now" question shows only for Both; ?occasion=newyear (the link emailed after a
  // both-holidays order) picks that holiday.
  {
    const first = document.getElementById('occasionFirst');
    const wanted = params.get('occasion');
    const pick = form.querySelector(`input[name="occasion"][value="${wanted === 'newyear' || wanted === 'christmas' ? wanted : ''}"]`);
    if (pick) pick.checked = true;
    const sync = () => { if (first) first.hidden = form.querySelector('input[name="occasion"]:checked')?.value !== 'both'; };
    form.querySelectorAll('input[name="occasion"]').forEach(input => input.addEventListener('change', sync));
    sync();
  }
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const business = $('try_business').value.trim();
    const email = $('try_email').value.trim() || (rep ? 'info@menu-made.com' : '');
    const file = $('try_file').files[0];
    // Holiday picker: "Both: $89" (owner, Nov 12, 2026) uploads one holiday's menu now; the choice rides to checkout
    // in this browser (start.js reads mm-holiday-both), where it can still be ticked or unticked.
    let occasion = form.querySelector('input[name="occasion"]:checked')?.value || '';
    const both = occasion === 'both';
    if (both) occasion = form.querySelector('input[name="occasion_first"]:checked')?.value || 'christmas';
    if (occasion) { try { if (both) localStorage.setItem('mm-holiday-both', '1'); else localStorage.removeItem('mm-holiday-both'); } catch { /* storage off */ } }
    if (!business) { say('Add your business name.', true); $('try_business').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Add an email address we can send the link to.', true); $('try_email').focus(); return; }
    if (!file) { say('Choose your menu file (a PDF or a photo).', true); $('try_file').focus(); return; }
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) { say('Previews work from a PDF or a photo (PNG, JPEG or WebP).', true); return; }
    busy = true; button.disabled = true; button.textContent = 'Sending your menu…';
    say('');
    try {
      window.MenuMadeDocuments.validate(file);
      const key = [business, email.toLowerCase(), occasion, await window.MenuMadeDocuments.fingerprint(file)].join('|');
      if (!upload || upload.key !== key) {
        const requestId = crypto.randomUUID();
        await window.MenuMadeDocuments.send({ type: 'inquiry', purpose: 'checkout', service: 'Other project', name: business, business, email,
          notes: occasion ? 'Free holiday menu preview' : 'Free menu preview', website: $('try_website').value, requestId }, file);
        upload = { key, requestId };
      }
      button.textContent = 'Reading your menu…';
      say('Reading your menu. This takes about a minute; keep this page open.');
      window.MenuMadeFunnel?.track?.('menu_preview_start');
      const response = await fetch(API + '/api/menu-preview/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: upload.requestId, email, business, tracking: window.MenuMadeFunnel?.tracking?.() || {}, ...(rep ? { rep } : {}), ...(window.MenuMadeSandbox === true ? { sandbox: true } : {}), ...(occasion ? { occasion } : {}), ...(both ? { both: true } : {}) })
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.ok && result.url) {
        window.MenuMadeFunnel?.track?.('menu_preview_ready');
        if (rep) say(`Ready in ${esc(result.seconds ?? '?')} seconds. <a class="btn primary" href="${esc(result.url)}" target="_blank" rel="noopener">Show my menu<span class="mm-sr"> (opens in a new tab)</span></a> The link is emailed too.`);
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
